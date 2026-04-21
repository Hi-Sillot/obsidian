import { ItemView, WorkspaceLeaf, Notice, TFile, Platform } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { FilePublishInfo, PublishStatus } from '../types';
import type { PRCheckResult, PRCheckStatus, PRState } from '../utils/PRCheckPoller';
import { PaginationBar } from './PaginationBar';

export const VIEW_TYPE_PUBLISH = 'sillot-publish';

type PublishFilter = 'all' | 'unpublished' | 'outdated' | 'published';
type PublishTarget = 'local' | 'github';

const STATUS_LABELS: Record<PublishStatus, { text: string; icon: string; cls: string }> = {
	unpublished: { text: '未发布', icon: '⚪', cls: 'sillot-publish-status--unpublished' },
	published: { text: '已发布', icon: '🟢', cls: 'sillot-publish-status--published' },
	outdated: { text: '待更新', icon: '🟡', cls: 'sillot-publish-status--outdated' },
};

const PUBLISH_SEARCH_COLUMNS = [
	{ key: 'fileName', label: '文件' },
	{ key: 'vuepressPath', label: 'VuePress 路径' },
	{ key: 'publishId', label: '发布ID' },
	{ key: 'localStatus', label: '本地状态' },
	{ key: 'siteStatus', label: '站点状态' },
];

export class PublishPanelView extends ItemView {
	plugin: VuePressPublisherPlugin;
	private fileList: FilePublishInfo[] = [];
	private filter: PublishFilter = 'all';
	private isLoading = false;
	private paginationBar: PaginationBar;
	private prCheckUnsubscribe: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VuePressPublisherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.paginationBar = new PaginationBar({
			columns: PUBLISH_SEARCH_COLUMNS,
			onChange: () => this.reRenderTable(),
		});
	}

	getViewType() { return VIEW_TYPE_PUBLISH; }
	getDisplayText() { return '发布管理'; }
	getIcon() { return 'upload'; }

	async onOpen() {
		this.render();
		await this.refreshStatus();
		this.prCheckUnsubscribe = this.plugin.prCheckPoller.onChange(() => {
			this.render();
		});
	}

	async refreshStatus() {
		if (this.isLoading) return;
		this.isLoading = true;
		this.renderLoading();

		try {
			const checker = this.plugin.publishStatusChecker;
			if (!checker) {
				this.renderError('发布状态检查器未初始化');
				return;
			}

			const allFiles = this.plugin.app.vault.getMarkdownFiles();
			const files = allFiles.filter(f => checker.isFileInSyncPaths(f));
			this.fileList = await checker.checkMultipleFiles(files);
			this.render();
		} catch (e) {
			this.renderError(e.message);
		} finally {
			this.isLoading = false;
		}
	}

	private render() {
		const container = this.contentEl;
		container.empty();
		container.addClass('sillot-publish-view');

		const headerRow = container.createDiv({ cls: 'sillot-panel-header' });
		headerRow.createEl('h4', { text: '📤 发布管理' });
		const closeBtn = headerRow.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => { this.leaf.detach(); };

		const summary = this.getSummary();
		const summaryEl = container.createDiv({ cls: 'sillot-publish-summary' });
		summaryEl.createEl('span', { text: `📄 ${summary.total}`, cls: 'sillot-publish-summary-item' });
		summaryEl.createEl('span', { text: `🟢${summary.published}`, cls: 'sillot-publish-summary-item' });
		summaryEl.createEl('span', { text: `🟡${summary.outdated}`, cls: 'sillot-publish-summary-item' });
		summaryEl.createEl('span', { text: `⚪${summary.unpublished}`, cls: 'sillot-publish-summary-item' });
		if (summary.noId > 0) {
			summaryEl.createEl('span', { text: `⚠️${summary.noId}无ID`, cls: 'sillot-publish-summary-item sillot-publish-summary-warning' });
		}

		const toolbar = container.createDiv({ cls: 'sillot-publish-toolbar' });

		const filterSelect = toolbar.createEl('select', { cls: 'sillot-publish-filter-select' }) as HTMLSelectElement;
		const filterOptions: { key: PublishFilter; label: string }[] = [
			{ key: 'all', label: '全部' },
			{ key: 'unpublished', label: '⚪ 未发布' },
			{ key: 'outdated', label: '🟡 待更新' },
			{ key: 'published', label: '🟢 已发布' },
		];
		for (const f of filterOptions) {
			const opt = filterSelect.createEl('option', { text: f.label, attr: { value: f.key } }) as HTMLOptionElement;
			if (f.key === this.filter) opt.selected = true;
		}
		filterSelect.onchange = () => {
			this.filter = filterSelect.value as PublishFilter;
			this.paginationBar.resetPage();
			this.render();
		};

		toolbar.createEl('button', { text: '🔄', cls: 'sillot-publish-action-btn', attr: { title: '刷新状态' } }).onclick = () => this.refreshStatus();
		toolbar.createEl('button', { text: '☑', cls: 'sillot-publish-action-btn', attr: { title: '反选' } }).onclick = () => this.invertSelection();

		if (Platform.isDesktop) {
			toolbar.createEl('button', { text: '📁', cls: 'sillot-publish-action-btn', attr: { title: '发布选中到本地' } }).onclick = () => this.publishSelected('local');
		}
		toolbar.createEl('button', { text: '☁️', cls: 'sillot-publish-action-btn', attr: { title: '发布选中到 GitHub' } }).onclick = () => this.publishSelected('github');
		toolbar.createEl('button', { text: '📦', cls: 'sillot-publish-action-btn', attr: { title: '打包选中为 ZIP' } }).onclick = () => this.packSelectedAsZip();

		const filtered = this.getFilteredFiles();
		if (filtered.length === 0) {
			container.createDiv({ text: '没有匹配的文件', cls: 'sillot-publish-empty' });
			return;
		}

		this.renderTable(container, filtered);
		this.renderPRCards(container);
	}

	private renderTable(container: HTMLElement, filtered: FilePublishInfo[]) {
		const wrapper = container.createDiv({ cls: 'sillot-publish-table-wrapper' });
		const table = wrapper.createEl('table', { cls: 'sillot-publish-table' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: '☑' });
		headRow.createEl('th', { text: '文件' });
		headRow.createEl('th', { text: '发布ID' });
		headRow.createEl('th', { text: 'VuePress 路径' });
		if (Platform.isDesktop) {
			headRow.createEl('th', { text: '本地' });
		}
		headRow.createEl('th', { text: '站点' });

		const state = this.paginationBar.getState();
		const { pageItems, totalPages } = PaginationBar.paginate(filtered, state.currentPage, state.pageSize);
		if (state.currentPage > totalPages) {
			this.paginationBar.setPage(totalPages);
		}

		const tbody = table.createEl('tbody');
		for (const info of pageItems) {
			const row = tbody.createEl('tr');
			row.dataset.filePath = info.filePath;

			const checkCell = row.createEl('td');
			const checkbox = checkCell.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
			checkbox.checked = info.localStatus !== 'published' || info.siteStatus !== 'published';

			row.createEl('td', { text: info.fileName, cls: 'sillot-publish-filename' });

			const idCell = row.createEl('td', { cls: 'sillot-publish-id-cell' });
			if (info.publishId) {
				idCell.createEl('span', { text: info.publishId, cls: 'sillot-publish-id', attr: { title: info.publishId } });
			} else {
				idCell.createEl('span', { text: '⚠️无', cls: 'sillot-publish-id-missing', attr: { title: '缺少发布ID，建议发布时自动生成' } });
			}

			row.createEl('td', { text: info.vuepressPath || '-', cls: 'sillot-publish-vpath' });

			if (Platform.isDesktop) {
				const localCell = row.createEl('td');
				const ls = STATUS_LABELS[info.localStatus];
				localCell.createEl('span', { text: `${ls.icon}`, cls: ls.cls, attr: { title: ls.text } });
			}

			const siteCell = row.createEl('td');
			const ss = STATUS_LABELS[info.siteStatus];
			siteCell.createEl('span', { text: `${ss.icon}`, cls: ss.cls, attr: { title: ss.text } });
		}

		const paginationContainer = wrapper.createDiv({ cls: 'sillot-publish-pagination' });
		this.paginationBar.render(paginationContainer, filtered.length);
	}

	private reRenderTable() {
		const container = this.contentEl;
		const tableWrapper = container.querySelector('.sillot-publish-table-wrapper');
		if (tableWrapper) tableWrapper.remove();

		const filtered = this.getFilteredFiles();
		if (filtered.length === 0) {
			container.createDiv({ text: '没有匹配的文件', cls: 'sillot-publish-empty' });
			return;
		}
		this.renderTable(container, filtered);
	}

	private renderLoading() {
		const container = this.contentEl;
		const existing = container.querySelector('.sillot-publish-loading');
		if (existing) return;

		const headerRow = container.createDiv({ cls: 'sillot-panel-header' });
		headerRow.createEl('h4', { text: '📤 发布管理' });
		const closeBtn = headerRow.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => { this.leaf.detach(); };

		container.createDiv({ text: '正在检查发布状态...', cls: 'sillot-publish-loading' });
	}

	private renderError(msg: string) {
		const container = this.contentEl;
		container.empty();
		container.addClass('sillot-publish-view');

		const headerRow = container.createDiv({ cls: 'sillot-panel-header' });
		headerRow.createEl('h4', { text: '📤 发布管理' });
		const closeBtn = headerRow.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => { this.leaf.detach(); };

		container.createDiv({ text: `❌ ${msg}`, cls: 'sillot-publish-error' });
		container.createEl('button', { text: '重试', cls: 'sillot-publish-action-btn' }).onclick = () => this.refreshStatus();
	}

	private getSummary() {
		let published = 0, outdated = 0, unpublished = 0, noId = 0;
		for (const info of this.fileList) {
			const status = this.getWorstStatus(info.localStatus, info.siteStatus);
			if (status === 'published') published++;
			else if (status === 'outdated') outdated++;
			else unpublished++;
			if (!info.publishId) noId++;
		}
		return { total: this.fileList.length, published, outdated, unpublished, noId };
	}

	private getWorstStatus(a: PublishStatus, b: PublishStatus): PublishStatus {
		if (a === 'unpublished' || b === 'unpublished') return 'unpublished';
		if (a === 'outdated' || b === 'outdated') return 'outdated';
		return 'published';
	}

	private getFilteredFiles(): FilePublishInfo[] {
		let result = this.fileList;
		if (this.filter !== 'all') {
			result = result.filter(info => {
				const status = this.getWorstStatus(info.localStatus, info.siteStatus);
				return status === this.filter;
			});
		}
		const state = this.paginationBar.getState();
		if (state.searchQuery) {
			result = PaginationBar.filterBySearch(result, state.searchQuery, state.searchColumns, (info, col) => {
				switch (col) {
					case 'fileName': return info.fileName;
					case 'vuepressPath': return info.vuepressPath || '';
					case 'publishId': return info.publishId || '';
					case 'localStatus': return STATUS_LABELS[info.localStatus].text;
					case 'siteStatus': return STATUS_LABELS[info.siteStatus].text;
					default: return '';
				}
			});
		}
		return result;
	}

	private getSelectedFiles(): TFile[] {
		const checkboxes = this.contentEl.querySelectorAll('.sillot-publish-table input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
		const selected: TFile[] = [];
		checkboxes.forEach((cb) => {
			if (cb.checked) {
				const row = cb.closest('tr');
				const filePath = row?.dataset.filePath;
				if (filePath) {
					const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) selected.push(file);
				}
			}
		});
		return selected;
	}

	private invertSelection() {
		const checkboxes = this.contentEl.querySelectorAll('.sillot-publish-table input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
		checkboxes.forEach((cb) => { cb.checked = !cb.checked; });
	}

	private async publishSelected(target: PublishTarget) {
		const files = this.getSelectedFiles();
		if (files.length === 0) {
			new Notice('请先选择要发布的文件');
			return;
		}

		const { PermalinkConflictChecker } = await import('../sync/PermalinkConflictChecker');
		const conflictChecker = new PermalinkConflictChecker(this.plugin.app, {
			publishRootPath: this.plugin.settings.publishRootPath,
			vuepressDocsDir: this.plugin.settings.vuepressDocsDir,
			localVuePressRoot: this.plugin.settings.localVuePressRoot,
			logger: this.plugin.logger,
		});

		const conflicts = await conflictChecker.checkConflictsForFiles(files);
		let resolutions: Map<string, import('../sync/PermalinkConflictChecker').ConflictResolution> | null = null;

		if (conflicts.length > 0) {
			new Notice(`发现 ${conflicts.length} 个 permalink 冲突，请逐个解决`);
			resolutions = await conflictChecker.resolveConflicts(conflicts);
		}

		if (target === 'local') {
			await this.publishToLocal(files, conflictChecker, resolutions, conflicts);
		} else {
			await this.publishToGitHub(files, conflictChecker, resolutions, conflicts);
		}
	}

	private async publishToLocal(
		files: TFile[],
		conflictChecker?: import('../sync/PermalinkConflictChecker').PermalinkConflictChecker,
		resolutions?: Map<string, import('../sync/PermalinkConflictChecker').ConflictResolution> | null,
		conflicts?: import('../sync/PermalinkConflictChecker').PermalinkConflict[]
	) {
		if (!Platform.isDesktop) {
			new Notice('本地发布仅支持桌面端');
			return;
		}
		const checker = this.plugin.publishStatusChecker;
		if (!checker) {
			new Notice('发布状态检查器未初始化');
			return;
		}

		const taskId = `publish-local-${Date.now()}`;
		this.plugin.taskTracker.startTask(taskId, `发布 ${files.length} 个文件到本地...`);
		const notice = new Notice(`正在发布 ${files.length} 个文件到本地...`, 0);
		try {
			let filesToPublish = files;
			let removePermalinkFiles = new Set<string>();

			if (conflictChecker && resolutions && conflicts && conflicts.length > 0) {
				const skipPermalinks = new Set<string>();
				for (const conflict of conflicts) {
					const resolution = resolutions.get(conflict.permalink);
					if (resolution?.action === 'skip') {
						skipPermalinks.add(conflict.permalink);
					} else if (resolution?.action === 'remove-permalink') {
						removePermalinkFiles.add(conflict.publishFile.path);
					}
				}
				if (skipPermalinks.size > 0) {
					filesToPublish = files.filter(f => {
						const cache = this.plugin.app.metadataCache.getFileCache(f);
						const permalink = cache?.frontmatter?.permalink ? String(cache.frontmatter.permalink) : null;
						return !permalink || !skipPermalinks.has(permalink);
					});
				}
				if (filesToPublish.length === 0) {
					notice.hide();
					new Notice('所有文件因 permalink 冲突被跳过');
					return;
				}
			}

			const result = await checker.publishMultipleToLocalWithModifier(filesToPublish, (file, content) => {
				if (removePermalinkFiles.has(file.path)) {
					return this.stripPermalinkFromContent(content);
				}
				return content;
			});
			notice.hide();
			new Notice(`本地发布完成：成功 ${result.success}，失败 ${result.failed}`);
			await this.refreshStatus();
			this.plugin.taskTracker.endTask(taskId, 'success');
		} catch (e) {
			notice.hide();
			new Notice(`本地发布失败：${e.message}`);
			this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
		}
	}

	private async publishToGitHub(
		files: TFile[],
		conflictChecker?: import('../sync/PermalinkConflictChecker').PermalinkConflictChecker,
		resolutions?: Map<string, import('../sync/PermalinkConflictChecker').ConflictResolution> | null,
		conflicts?: import('../sync/PermalinkConflictChecker').PermalinkConflict[]
	) {
		const { githubToken, githubRepo, defaultBranch, vuepressDocsDir, publishBranchPrefix, publishCreatePR } = this.plugin.settings;
		if (!githubToken || !githubRepo) {
			new Notice('请先在插件设置中配置 GitHub Token 和仓库');
			return;
		}

		const taskId = `publish-github-${Date.now()}`;
		this.plugin.taskTracker.startTask(taskId, `发布 ${files.length} 个文件到 GitHub...`);
		const notice = new Notice(`正在发布 ${files.length} 个文件到 GitHub...`, 0);
		try {
			const { FileCollector } = await import('../sync/fileCollector');
			const { PathMapper } = await import('../sync/pathMapper');
			const { GitHubApi } = await import('../sync/githubApi');

			const collector = new FileCollector(this.plugin.app.vault, this.plugin.app.metadataCache);
			const mapper = new PathMapper({ docsDir: vuepressDocsDir, publishRootPath: this.plugin.settings.publishRootPath });
			const api = new GitHubApi(githubRepo, githubToken);

			const allPublishFiles: { path: string; content: string }[] = [];
			for (const file of files) {
				const collected = await collector.collectForPublish(file);
				const mdContent = await this.plugin.app.vault.read(collected.md);
				const mdTargetPath = mapper.mapMarkdownPath(collected.md.path);
				allPublishFiles.push({ path: mdTargetPath, content: btoa(unescape(encodeURIComponent(mdContent))) });

				for (const asset of collected.assets) {
					const assetData = await this.plugin.app.vault.readBinary(asset);
					const assetTargetPath = mapper.mapAssetPath(asset.path);
					let binary = '';
					const bytes = new Uint8Array(assetData);
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]);
					}
					allPublishFiles.push({ path: assetTargetPath, content: btoa(binary) });
				}
			}

			const now = new Date();
			const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
			const targetBranch = publishCreatePR ? `${publishBranchPrefix}${ts}` : defaultBranch;

			let publishFiles = allPublishFiles;
			if (conflictChecker && resolutions && conflicts && conflicts.length > 0) {
				publishFiles = conflictChecker.applyResolutions(allPublishFiles, resolutions, conflicts);
				if (publishFiles.length === 0) {
					notice.hide();
					new Notice('所有文件因 permalink 冲突被跳过');
					return;
				}
			}

			const publishResult = await api.publishFiles(publishFiles, {
				commitMessage: `Publish ${files.length} files from Obsidian`,
				baseBranch: defaultBranch,
				targetBranch,
				createPR: publishCreatePR,
				onProgress: (percent, msg) => {
					this.plugin.taskTracker.updateTask(taskId, percent, msg);
					notice.setMessage(msg);
				},
			});

			notice.hide();
			if (publishResult.prUrl && publishResult.prNumber) {
				this.plugin.taskTracker.updateTask(taskId, 90, `PR #${publishResult.prNumber} 已创建，等待构建检查...`);
				this.plugin.prCheckPoller.startPolling(
					String(publishResult.prNumber),
					{
						prNumber: publishResult.prNumber,
						branch: publishResult.branch,
						headSha: publishResult.commitSha,
						filePath: files.map(f => f.path).join(', '),
						startedAt: Date.now(),
					},
					() => this.plugin.createGitHubApi(),
				);
				this.plugin.savePRCheckPending();

				const prNumber = publishResult.prNumber;
				const unsubscribe = this.plugin.prCheckPoller.onChange((checkResult) => {
					if (!checkResult) return;
					if (checkResult.prNumber !== prNumber) return;
					if (checkResult.status === 'pending') {
						this.plugin.taskTracker.updateTask(taskId, 92, `PR #${prNumber} 构建检查中...`);
						return;
					}
					unsubscribe();

					if (checkResult.status === 'success') {
						this.plugin.taskTracker.endTask(taskId, 'success', `PR #${prNumber} 构建通过`);
					} else if (checkResult.status === 'warning') {
						this.plugin.taskTracker.endTask(taskId, 'success', `PR #${prNumber} 构建有警告`);
					} else {
						this.plugin.taskTracker.endTask(taskId, 'failed', `PR #${prNumber} 构建失败`);
					}

					const { PRCheckModal } = require('../ui/PRCheckModal');
					const modal = new PRCheckModal(this.app, this.plugin, prNumber, checkResult.branch);
					modal.open();
				});

				new Notice(`已创建 PR #${publishResult.prNumber}，正在等待构建检查...`);
			} else {
				new Notice(`已发布 ${files.length} 个文件到 GitHub`);
				this.plugin.taskTracker.endTask(taskId, 'success');
			}
			await this.refreshStatus();
		} catch (e) {
			notice.hide();
			new Notice(`GitHub 发布失败：${e.message}`);
			this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
		}
	}

	private stripPermalinkFromContent(content: string): string {
		const lines = content.split(/\r?\n/);
		if (lines[0] !== '---') return content;
		const endIdx = lines.indexOf('---', 1);
		if (endIdx === -1) return content;

		const newLines = [];
		for (let i = 0; i < lines.length; i++) {
			if (i > 0 && i < endIdx && lines[i].startsWith('permalink:')) continue;
			newLines.push(lines[i]);
		}
		return newLines.join('\n');
	}

	private prFilter: 'all' | 'open' | 'closed' | 'merged' = 'all';

	private renderPRCards(container: HTMLElement) {
		const results = this.plugin.prCheckPoller.getAllResults();
		const pending = this.plugin.prCheckPoller.getPendingForPersistence();
		const allPRs: { prNumber: number; branch: string; status: PRCheckStatus; result?: PRCheckResult }[] = [];

		for (const info of pending) {
			const result = results.get(String(info.prNumber));
			allPRs.push({
				prNumber: info.prNumber,
				branch: info.branch,
				status: result?.status || 'pending',
				result: result || undefined,
			});
		}
		for (const [key, result] of results) {
			if (!allPRs.some(p => String(p.prNumber) === key)) {
				allPRs.push({
					prNumber: result.prNumber,
					branch: result.branch,
					status: result.status,
					result,
				});
			}
		}

		allPRs.sort((a, b) => b.prNumber - a.prNumber);

		const filtered = this.prFilter === 'all'
			? allPRs
			: allPRs.filter(pr => pr.result?.prState === this.prFilter);

		const section = container.createDiv({ cls: 'sillot-pr-cards-section' });

		const headerRow = section.createDiv({ cls: 'sillot-pr-cards-header' });
		headerRow.createEl('h4', { text: `🔀 Pull Requests (${allPRs.length})` });

		const filterSelect = headerRow.createEl('select', { cls: 'sillot-pr-cards-filter' }) as HTMLSelectElement;
		const filterOpts: { key: 'all' | 'open' | 'closed' | 'merged'; label: string }[] = [
			{ key: 'all', label: '全部' },
			{ key: 'open', label: '🟢 开启' },
			{ key: 'closed', label: '🔴 已关闭' },
			{ key: 'merged', label: '🟣 已合并' },
		];
		for (const f of filterOpts) {
			const opt = filterSelect.createEl('option', { text: f.label, attr: { value: f.key } }) as HTMLOptionElement;
			if (f.key === this.prFilter) opt.selected = true;
		}
		filterSelect.onchange = () => {
			this.prFilter = filterSelect.value as 'all' | 'open' | 'closed' | 'merged';
			this.render();
		};

		if (filtered.length === 0) {
			section.createDiv({ text: allPRs.length === 0 ? '暂无 PR' : '无匹配的 PR', cls: 'sillot-pr-cards-empty' });
			return;
		}

		const list = section.createDiv({ cls: 'sillot-pr-cards-list' });

		for (const pr of filtered) {
			const card = list.createDiv({ cls: 'sillot-pr-card' });

			const header = card.createDiv({ cls: 'sillot-pr-card-header' });
			const statusConfig: Record<PRCheckStatus, { icon: string; text: string; cls: string }> = {
				pending: { icon: '⏳', text: '构建中', cls: 'sillot-pr-card-status--pending' },
				success: { icon: '✅', text: '通过', cls: 'sillot-pr-card-status--success' },
				warning: { icon: '⚠️', text: '有警告', cls: 'sillot-pr-card-status--warning' },
				failure: { icon: '❌', text: '失败', cls: 'sillot-pr-card-status--failure' },
				timeout: { icon: '⌛', text: '超时', cls: 'sillot-pr-card-status--timeout' },
				error: { icon: '🔌', text: '查询失败', cls: 'sillot-pr-card-status--error' },
			};
			const sc = statusConfig[pr.status];
			header.createEl('span', { text: `${sc.icon} ${sc.text}`, cls: `sillot-pr-card-status ${sc.cls}` });

			const prStateConfig: Record<PRState, { icon: string; text: string; cls: string }> = {
				open: { icon: '🟢', text: '开启', cls: 'sillot-pr-card-prstate--open' },
				closed: { icon: '🔴', text: '已关闭', cls: 'sillot-pr-card-prstate--closed' },
				merged: { icon: '🟣', text: '已合并', cls: 'sillot-pr-card-prstate--merged' },
			};
			if (pr.result?.prState) {
				const pc = prStateConfig[pr.result.prState];
				header.createEl('span', { text: `${pc.icon} ${pc.text}`, cls: `sillot-pr-card-prstate ${pc.cls}` });
			}

			header.createEl('span', { text: `PR #${pr.prNumber}`, cls: 'sillot-pr-card-number' });

			const removeBtn = header.createEl('button', { text: '✕', cls: 'sillot-pr-card-remove-btn', attr: { title: '移除记录' } });
			removeBtn.onclick = (e) => {
				e.stopPropagation();
				this.plugin.prCheckPoller.removeResult(String(pr.prNumber));
				this.plugin.savePRCheckPending();
				this.render();
			};

			const body = card.createDiv({ cls: 'sillot-pr-card-body' });
			body.createEl('span', { text: `🌿 ${pr.branch}`, cls: 'sillot-pr-card-branch' });

			if (pr.result && pr.result.checkRuns.length > 0) {
				const runs = body.createDiv({ cls: 'sillot-pr-card-runs' });
				for (const run of pr.result.checkRuns) {
					const runIcon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : run.status === 'completed' ? '⚪' : '⏳';
					const runEl = runs.createDiv({ cls: 'sillot-pr-card-run' });
					runEl.createSpan({ text: runIcon, cls: 'sillot-pr-card-run-icon' });
					runEl.createSpan({ text: run.name, cls: 'sillot-pr-card-run-name' });
					if (run.detailsUrl) {
						const link = runEl.createEl('a', { text: '详情', cls: 'sillot-pr-card-run-link' });
						link.href = run.detailsUrl;
						link.target = '_blank';
					}
				}
			}

			const actions = card.createDiv({ cls: 'sillot-pr-card-actions' });
			actions.createEl('button', { text: '🔗 查看', cls: 'sillot-pr-card-btn' }).onclick = () => {
				const repo = this.plugin.settings.githubRepo;
				window.open(`https://github.com/${repo}/pull/${pr.prNumber}`, '_blank');
			};

			if ((pr.status === 'success' || pr.status === 'warning') && pr.result?.prState === 'open') {
				actions.createEl('button', { text: '🔀 合并', cls: 'sillot-pr-card-btn sillot-pr-card-btn--cta' }).onclick = async () => {
					await this.mergePR(pr.prNumber);
				};
			}

			if (pr.status === 'failure' || pr.status === 'timeout' || pr.status === 'error') {
				actions.createEl('button', { text: '🔄 重新检查', cls: 'sillot-pr-card-btn sillot-pr-card-btn--cta' }).onclick = () => {
					this.plugin.prCheckPoller.startPolling(
						String(pr.prNumber),
						{
							prNumber: pr.prNumber,
							branch: pr.branch,
							headSha: pr.result?.headSha || '',
							filePath: '',
							startedAt: Date.now(),
						},
						() => this.plugin.createGitHubApi(),
					);
					new Notice('已开始重新检查 PR #' + pr.prNumber);
				};
			}

			if (pr.status !== 'pending') {
				actions.createEl('button', { text: '📋 详情', cls: 'sillot-pr-card-btn' }).onclick = () => {
					const { PRCheckModal } = require('../ui/PRCheckModal');
					const modal = new PRCheckModal(this.app, this.plugin, pr.prNumber, pr.branch);
					modal.open();
				};
			}
		}
	}

	private async mergePR(prNumber: number) {
		const api = this.plugin.createGitHubApi();
		if (!api) {
			new Notice('GitHub API 未配置');
			return;
		}

		const notice = new Notice(`正在合并 PR #${prNumber}...`, 0);
		try {
			await api.mergePullRequest(prNumber, {
				commitTitle: `Merge PR #${prNumber}`,
				mergeMethod: 'merge',
			});
			notice.hide();
			new Notice(`PR #${prNumber} 已合并`);
			this.plugin.prCheckPoller.stopPolling(String(prNumber));
			this.plugin.prCheckPoller.updatePRState(String(prNumber), 'merged');
			await this.plugin.savePRCheckPending();
			await this.refreshStatus();
		} catch (e: any) {
			notice.hide();
			new Notice(`合并 PR 失败：${e.message}`);
		}
	}

	private async packSelectedAsZip() {
		const files = this.getSelectedFiles();
		if (files.length === 0) {
			new Notice('请先选择要打包的文件');
			return;
		}

		const { FileCollector } = await import('../sync/fileCollector');
		const { PathMapper } = await import('../sync/pathMapper');

		const collector = new FileCollector(this.plugin.app.vault, this.plugin.app.metadataCache);
		const mapper = new PathMapper({ docsDir: this.plugin.settings.vuepressDocsDir, publishRootPath: this.plugin.settings.publishRootPath });

		const taskId = `pack-zip-${Date.now()}`;
		this.plugin.taskTracker.startTask(taskId, `打包 ${files.length} 个文件...`);
		const notice = new Notice(`正在打包 ${files.length} 个文件...`, 0);
		try {
			const zip = new (await import('jszip')).default();
			let packed = 0;
			for (const file of files) {
				const collected = await collector.collectForPublish(file);
				const mdContent = await this.plugin.app.vault.read(collected.md);
				const mdTargetPath = mapper.mapMarkdownPath(collected.md.path);
				zip.file(mdTargetPath, mdContent);

				for (const asset of collected.assets) {
					const assetData = await this.plugin.app.vault.readBinary(asset);
					const assetTargetPath = mapper.mapAssetPath(asset.path);
					zip.file(assetTargetPath, assetData);
				}
				packed++;
				this.plugin.taskTracker.updateTask(taskId, Math.round((packed / files.length) * 100), `打包中 (${packed}/${files.length})...`);
			}

			const zipBlob = await zip.generateAsync({ type: 'blob' });
			const fileName = `sillot-publish-${new Date().toISOString().slice(0, 10)}.zip`;

			if (Platform.isMobileApp) {
				await this.saveZipToMobile(zipBlob, fileName);
			} else {
				const url = URL.createObjectURL(zipBlob);
				const a = document.createElement('a');
				a.href = url;
				a.download = fileName;
				a.click();
				URL.revokeObjectURL(url);
			}

			notice.hide();
			new Notice(`已打包 ${files.length} 个文件`);
			this.plugin.taskTracker.endTask(taskId, 'success');
		} catch (e) {
			notice.hide();
			new Notice(`打包失败：${e.message}`);
			this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
		}
	}

	private async saveZipToMobile(blob: Blob, fileName: string) {
		const arrayBuffer = await blob.arrayBuffer();
		const base64 = this.arrayBufferToBase64(arrayBuffer);

		const vaultPath = (this.plugin.app.vault.adapter as any).basePath || '';
		const targetPath = `${vaultPath}/${fileName}`;

		try {
			await this.plugin.app.vault.adapter.writeBinary(fileName, arrayBuffer);
			new Notice(`ZIP 已保存到：${fileName}`);
		} catch (e) {
			new Notice(`保存失败：${e.message}`);
			throw e;
		}
	}

	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	async onClose() {
		if (this.prCheckUnsubscribe) {
			this.prCheckUnsubscribe();
			this.prCheckUnsubscribe = null;
		}
		this.contentEl.empty();
	}
}
