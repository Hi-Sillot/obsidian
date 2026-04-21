import { ItemView, WorkspaceLeaf, Notice, TFile, Platform } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { FilePublishInfo, PublishStatus } from '../types';
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
	{ key: 'localStatus', label: '本地状态' },
	{ key: 'siteStatus', label: '站点状态' },
];

export class PublishPanelView extends ItemView {
	plugin: VuePressPublisherPlugin;
	private fileList: FilePublishInfo[] = [];
	private filter: PublishFilter = 'all';
	private isLoading = false;
	private paginationBar: PaginationBar;

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
	}

	private renderTable(container: HTMLElement, filtered: FilePublishInfo[]) {
		const wrapper = container.createDiv({ cls: 'sillot-publish-table-wrapper' });
		const table = wrapper.createEl('table', { cls: 'sillot-publish-table' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: '☑' });
		headRow.createEl('th', { text: '文件' });
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
		let published = 0, outdated = 0, unpublished = 0;
		for (const info of this.fileList) {
			const status = this.getWorstStatus(info.localStatus, info.siteStatus);
			if (status === 'published') published++;
			else if (status === 'outdated') outdated++;
			else unpublished++;
		}
		return { total: this.fileList.length, published, outdated, unpublished };
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

		if (target === 'local') {
			await this.publishToLocal(files);
		} else {
			await this.publishToGitHub(files);
		}
	}

	private async publishToLocal(files: TFile[]) {
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
			const result = await checker.publishMultipleToLocal(files);
			notice.hide();
			new Notice(`本地发布完成：成功 ${result.success}，失败 ${result.failed}`);
			await this.refreshStatus();
		} catch (e) {
			notice.hide();
			new Notice(`本地发布失败：${e.message}`);
		} finally {
			this.plugin.taskTracker.endTask(taskId);
		}
	}

	private async publishToGitHub(files: TFile[]) {
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

			const publishResult = await api.publishFiles(allPublishFiles, {
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
			if (publishResult.prUrl) {
				new Notice(`已创建 PR #${publishResult.prNumber}`);
			} else {
				new Notice(`已发布 ${files.length} 个文件到 GitHub`);
			}
			await this.refreshStatus();
		} catch (e) {
			notice.hide();
			new Notice(`GitHub 发布失败：${e.message}`);
		} finally {
			this.plugin.taskTracker.endTask(taskId);
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
		} catch (e) {
			notice.hide();
			new Notice(`打包失败：${e.message}`);
		} finally {
			this.plugin.taskTracker.endTask(taskId);
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
		this.contentEl.empty();
	}
}
