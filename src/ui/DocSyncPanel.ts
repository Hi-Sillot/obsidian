import { MarkdownView, Modal, Notice, Platform, TFile, Setting, type ViewStateResult } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { ParsedSyncBlock, PublishStatus, FilePublishInfo, DiffResult, DiffCompareSource } from '../types';
import type { TaskTracker } from '../utils/TaskTracker';
import { generatePublishId, setPublishIdInContent } from '../sync/PublishStatusChecker';

const PANEL_CLASS = 'sillot-doc-sync-panel';
const PANEL_CONTAINER_CLASS = 'sillot-doc-sync-panel-container';

type PanelState = 'minimized' | 'default' | 'expanded';
type PublishDisplayMode = 'default' | 'expanded';
type ActiveTab = 'sync' | 'publish' | 'components' | 'authors';

const STATUS_CONFIG: Record<PublishStatus, { icon: string; text: string; cls: string }> = {
	unpublished: { icon: '⚪', text: '未发布', cls: `${PANEL_CLASS}-publish-status--unpublished` },
	published: { icon: '🟢', text: '已发布', cls: `${PANEL_CLASS}-publish-status--published` },
	outdated: { icon: '🟡', text: '待更新', cls: `${PANEL_CLASS}-publish-status--outdated` },
};

export class DocSyncPanel {
	private plugin: VuePressPublisherPlugin;
	private currentFile: TFile | null = null;
	private panelEl: HTMLElement | null = null;
	private publishInfo: FilePublishInfo | null = null;
	private diffResult: DiffResult | null = null;
	private publishDisplayMode: PublishDisplayMode = 'default';
	private activeTab: ActiveTab = 'sync';
	private compareSource: DiffCompareSource = 'local';
	private taskTrackerUnsubscribe: (() => void) | null = null;
	private lastModeKey: string = '';
	private modeCheckInterval: number | null = null;
	private renderGen = 0;
	private updateTimer: number | null = null;

	constructor(plugin: VuePressPublisherPlugin) {
		this.plugin = plugin;
	}

	register() {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => this.update())
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', () => this.update())
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', () => this.update())
		);

		this.taskTrackerUnsubscribe = this.plugin.taskTracker.onChange(() => {
			if (this.state === 'minimized' && this.panelEl) {
				this.updateTaskIndicator();
			}
		});

		this.plugin.app.workspace.onLayoutReady(() => {
			this.update();
			this.startModeCheck();
		});
	}

	private startModeCheck() {
		this.modeCheckInterval = window.setInterval(() => {
			const view = this.getActiveMarkdownView();
			if (!view) return;
			const state = view.getState();
			const modeKey = `${state.mode}-${state.source}`;
			if (modeKey !== this.lastModeKey) {
				this.lastModeKey = modeKey;
				if (this.state === 'minimized' && this.panelEl) {
					const modeBadge = this.panelEl.querySelector(`.${PANEL_CLASS}-mode-badge`);
					if (modeBadge) {
						modeBadge.empty();
						this.renderModeBadge(modeBadge as HTMLElement);
					}
				}
			}
		}, 500);
	}

	destroy() {
		if (this.updateTimer) {
			window.clearTimeout(this.updateTimer);
			this.updateTimer = null;
		}
		if (this.modeCheckInterval) {
			window.clearInterval(this.modeCheckInterval);
			this.modeCheckInterval = null;
		}
		if (this.taskTrackerUnsubscribe) {
			this.taskTrackerUnsubscribe();
			this.taskTrackerUnsubscribe = null;
		}
		this.removePanel();
	}

	private get state(): PanelState {
		return this.plugin.settings.docSyncPanelState;
	}

	private setState(s: PanelState) {
		this.plugin.settings.docSyncPanelState = s;
		this.plugin.saveSettings();
		this.scheduleRender();
	}

	private scheduleRender() {
		requestAnimationFrame(() => this.renderPanel());
	}

	update() {
		if (this.updateTimer) {
			window.clearTimeout(this.updateTimer);
		}
		this.updateTimer = window.setTimeout(() => {
			this.updateTimer = null;
			this.doUpdate();
		}, 50);
	}

	private doUpdate() {
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) {
			this.removePanel();
			return;
		}
		const file = activeLeaf.view.file;
		if (!file) {
			this.removePanel();
			return;
		}
		this.currentFile = file;
		this.ensurePanel(activeLeaf.view);
		this.renderPanel();
	}

	private ensurePanel(view: MarkdownView) {
		document.querySelectorAll(`.${PANEL_CONTAINER_CLASS}`).forEach(el => {
			if (el !== this.panelEl) el.remove();
		});
		const existing = view.containerEl.querySelector(`.${PANEL_CONTAINER_CLASS}`);
		if (existing && existing.parentElement === view.containerEl) {
			this.panelEl = existing as HTMLElement;
			return;
		}
		this.panelEl = view.containerEl.createDiv({ cls: PANEL_CONTAINER_CLASS });
	}

	private removePanel() {
		if (this.panelEl) {
			this.panelEl.remove();
			this.panelEl = null;
		}
		document.querySelectorAll(`.${PANEL_CONTAINER_CLASS}`).forEach(el => el.remove());
		this.currentFile = null;
		this.publishInfo = null;
		this.diffResult = null;
	}

	private async renderPanel() {
		if (!this.panelEl || !this.currentFile) return;

		const gen = ++this.renderGen;

		const content = await this.plugin.app.vault.read(this.currentFile);
		if (gen !== this.renderGen) return;

		const syncManager = this.plugin.syncManager;
		const blocks = syncManager
			? syncManager.parseSyncBlocks(content, this.currentFile.path)
			: [];
		const docBlocks = blocks.filter(b => b.scope === 'document');

		this.publishInfo = null;
		this.diffResult = null;
		const checker = this.plugin.publishStatusChecker;
		if (checker && this.currentFile) {
			try {
				this.publishInfo = await checker.checkFileStatus(this.currentFile);
			} catch {}
			if (gen !== this.renderGen) return;
			try {
				this.diffResult = await checker.computeDiff(this.currentFile, this.compareSource);
				if (this.diffResult) {
					this.compareSource = this.diffResult.compareSource;
				}
			} catch {}
			if (gen !== this.renderGen) return;
		}

		this.panelEl.empty();
		this.panelEl.className = `${PANEL_CONTAINER_CLASS} ${PANEL_CLASS}--${this.state}`;

		if (this.state === 'minimized') {
			this.renderMinimized(docBlocks);
		} else {
			this.renderPanelControls();
			if (this.state === 'default') {
				await this.renderDefault(docBlocks);
			} else {
				await this.renderExpanded(docBlocks);
			}
			this.renderTabBar();
		}
	}

	private renderPanelControls() {
		const controls = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-controls` });
		controls.createEl('button', { text: '−', cls: `${PANEL_CLASS}-state-btn`, attr: { title: '最小化' } }).onclick = () => this.setState('minimized');
		const expandBtn = controls.createEl('button', { text: '□', cls: `${PANEL_CLASS}-state-btn`, attr: { title: this.state === 'expanded' ? '默认' : '最大化' } });
		expandBtn.onclick = () => this.setState(this.state === 'expanded' ? 'default' : 'expanded');
	}

	private renderMinimized(blocks: ParsedSyncBlock[]) {
		const wrapper = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-minimized-wrapper` });

		const modeBadge = wrapper.createDiv({ cls: `${PANEL_CLASS}-minimized ${PANEL_CLASS}-mode-badge` });
		this.renderModeBadge(modeBadge);
		modeBadge.onclick = (e) => {
			e.stopPropagation();
			this.toggleEditorMode();
		};

		const publishBadge = wrapper.createDiv({ cls: `${PANEL_CLASS}-minimized ${PANEL_CLASS}-publish-badge` });
		this.renderMinimizedPublishStatus(publishBadge);
		publishBadge.onclick = (e) => {
			e.stopPropagation();
			this.activeTab = 'publish';
			this.publishDisplayMode = 'default';
			this.setState('default');
		};

		const syncBadge = wrapper.createDiv({ cls: `${PANEL_CLASS}-minimized ${PANEL_CLASS}-sync-badge` });
		syncBadge.createEl('span', { cls: `${PANEL_CLASS}-icon`, text: '🔗' });
		syncBadge.createEl('span', { cls: `${PANEL_CLASS}-count`, text: `${blocks.length}` });
		syncBadge.title = `同步块: ${blocks.length}`;
		syncBadge.onclick = (e) => {
			e.stopPropagation();
			this.activeTab = 'sync';
			this.setState('default');
		};

		this.renderTaskIndicator(wrapper);
	}

	private renderModeBadge(container: HTMLElement) {
		const view = this.getActiveMarkdownView();
		if (!view) return;

		const state = view.getState();
		const mode = state.mode as string;
		const source = state.source as boolean | undefined;

		if (mode === 'preview') {
			container.createEl('span', { cls: `${PANEL_CLASS}-icon`, text: '📖' });
			container.createEl('span', { cls: `${PANEL_CLASS}-mode-text`, text: '阅读' });
			container.title = '阅读模式 - 点击切换为编辑模式';
		} else if (mode === 'source' && source) {
			container.createEl('span', { cls: `${PANEL_CLASS}-icon`, text: '📝' });
			container.createEl('span', { cls: `${PANEL_CLASS}-mode-text`, text: '源码' });
			container.title = '源码模式 - 点击切换为实时预览';
		} else {
			container.createEl('span', { cls: `${PANEL_CLASS}-icon`, text: '✏️' });
			container.createEl('span', { cls: `${PANEL_CLASS}-mode-text`, text: '预览' });
			container.title = '实时预览模式 - 点击切换为源码模式';
		}
	}

	private toggleEditorMode() {
		const view = this.getActiveMarkdownView();
		if (!view) return;

		const state = view.getState();
		const mode = state.mode as string;
		const source = state.source as boolean | undefined;

		if (mode === 'preview') {
			view.setState({ ...state, mode: 'source', source: false }, { history: false } as ViewStateResult);
		} else if (mode === 'source' && source) {
			view.setState({ ...state, mode: 'source', source: false }, { history: false } as ViewStateResult);
		} else {
			view.setState({ ...state, mode: 'source', source: true }, { history: false } as ViewStateResult);
		}
	}

	private getActiveMarkdownView(): MarkdownView | null {
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) return null;
		return activeLeaf.view;
	}

	private renderTaskIndicator(wrapper: HTMLElement) {
		const existing = wrapper.querySelector(`.${PANEL_CLASS}-task-indicator`);
		if (existing) existing.remove();

		const tasks = this.plugin.taskTracker.getActiveTasks();
		if (tasks.length === 0) return;

		const indicator = wrapper.createDiv({ cls: `${PANEL_CLASS}-task-indicator` });

		const task = tasks[tasks.length - 1];
		const progressBar = indicator.createDiv({ cls: `${PANEL_CLASS}-task-progress` });
		const fill = progressBar.createDiv({ cls: `${PANEL_CLASS}-task-progress-fill` });
		if (task.progress < 0) {
			progressBar.addClass(`${PANEL_CLASS}-task-progress--indeterminate`);
		} else {
			fill.style.width = `${Math.max(0, Math.min(100, task.progress))}%`;
		}

		const label = indicator.createDiv({ cls: `${PANEL_CLASS}-task-label`, text: task.label });
		label.title = task.label;

		if (tasks.length > 1) {
			indicator.addClass(`${PANEL_CLASS}-task-indicator--multi`);
			const moreBtn = indicator.createDiv({ cls: `${PANEL_CLASS}-task-more` });
			moreBtn.createSpan({ text: '等' });
			moreBtn.createSpan({ cls: `${PANEL_CLASS}-task-more-num`, text: `${tasks.length - 1}` });
			moreBtn.createSpan({ text: '个任务' });
			indicator.onclick = (e) => {
				e.stopPropagation();
				const list = indicator.querySelector(`.${PANEL_CLASS}-task-list`);
				if (list) {
					list.toggleClass(`${PANEL_CLASS}-task-list--hidden`, !list.hasClass(`${PANEL_CLASS}-task-list--hidden`));
				} else {
					this.renderTaskList(indicator, tasks);
				}
			};
		}
	}

	private renderTaskList(indicator: HTMLElement, tasks: ReturnType<TaskTracker['getActiveTasks']>) {
		const list = indicator.createDiv({ cls: `${PANEL_CLASS}-task-list` });
		for (const t of tasks) {
			const row = list.createDiv({ cls: `${PANEL_CLASS}-task-list-row` });
			const bar = row.createDiv({ cls: `${PANEL_CLASS}-task-progress` });
			const fill = bar.createDiv({ cls: `${PANEL_CLASS}-task-progress-fill` });
			if (t.progress < 0) {
				bar.addClass(`${PANEL_CLASS}-task-progress--indeterminate`);
			} else {
				fill.style.width = `${Math.max(0, Math.min(100, t.progress))}%`;
			}
			row.createDiv({ cls: `${PANEL_CLASS}-task-label`, text: t.label }).title = t.label;
		}
	}

	private updateTaskIndicator() {
		const wrapper = this.panelEl?.querySelector(`.${PANEL_CLASS}-minimized-wrapper`);
		if (!wrapper) return;

		const indicator = wrapper.querySelector(`.${PANEL_CLASS}-task-indicator`);
		const tasks = this.plugin.taskTracker.getActiveTasks();

		if (tasks.length === 0) {
			if (indicator) indicator.remove();
			return;
		}

		if (!indicator) {
			this.renderTaskIndicator(wrapper as HTMLElement);
			return;
		}

		const task = tasks[tasks.length - 1];

		const progressBar = indicator.querySelector(`:scope > .${PANEL_CLASS}-task-progress`);
		if (progressBar) {
			const fill = progressBar.querySelector(`.${PANEL_CLASS}-task-progress-fill`);
			if (fill) {
				if (task.progress < 0) {
					progressBar.addClass(`${PANEL_CLASS}-task-progress--indeterminate`);
					(fill as HTMLElement).style.width = '';
				} else {
					progressBar.removeClass(`${PANEL_CLASS}-task-progress--indeterminate`);
					(fill as HTMLElement).style.width = `${Math.max(0, Math.min(100, task.progress))}%`;
				}
			}
		}

		const moreBtn = indicator.querySelector(`.${PANEL_CLASS}-task-more`);
		if (tasks.length > 1) {
			(indicator as HTMLElement).addClass(`${PANEL_CLASS}-task-indicator--multi`);
			if (!moreBtn) {
				const btn = (indicator as HTMLElement).createDiv({ cls: `${PANEL_CLASS}-task-more` });
				btn.createSpan({ text: '等' });
				btn.createSpan({ cls: `${PANEL_CLASS}-task-more-num`, text: `${tasks.length - 1}` });
				btn.createSpan({ text: '个任务' });
				(indicator as HTMLElement).onclick = (e) => {
					e.stopPropagation();
					const list = indicator.querySelector(`.${PANEL_CLASS}-task-list`);
					if (list) {
						list.toggleClass(`${PANEL_CLASS}-task-list--hidden`, !list.hasClass(`${PANEL_CLASS}-task-list--hidden`));
					} else {
						this.renderTaskList(indicator as HTMLElement, tasks);
					}
				};
			} else {
				const numSpan = moreBtn.querySelector(`.${PANEL_CLASS}-task-more-num`);
				if (numSpan) (numSpan as HTMLElement).textContent = `${tasks.length - 1}`;
			}
		} else {
			(indicator as HTMLElement).removeClass(`${PANEL_CLASS}-task-indicator--multi`);
			(indicator as HTMLElement).onclick = null;
			if (moreBtn) moreBtn.remove();
			const list = indicator.querySelector(`.${PANEL_CLASS}-task-list`);
			if (list) list.remove();
		}

		const label = indicator.querySelector(`:scope > .${PANEL_CLASS}-task-label`);
		if (label) {
			(label as HTMLElement).textContent = task.label;
			(label as HTMLElement).title = task.label;
		}
	}

	private renderMinimizedPublishStatus(container: HTMLElement) {
		if (!this.publishInfo) {
			container.createEl('span', { cls: `${PANEL_CLASS}-publish-status ${PANEL_CLASS}-publish-status--loading`, text: '📤…' });
			container.title = '发布状态加载中';
			return;
		}

		const localCfg = STATUS_CONFIG[this.publishInfo.localStatus];
		const siteCfg = STATUS_CONFIG[this.publishInfo.siteStatus];

		if (Platform.isDesktop) {
			const localEl = container.createEl('span', { cls: `${PANEL_CLASS}-publish-status ${localCfg.cls}` });
			localEl.textContent = `本地${localCfg.icon}`;
			localEl.title = `本地: ${localCfg.text}`;
		}

		const siteEl = container.createEl('span', { cls: `${PANEL_CLASS}-publish-status ${siteCfg.cls}` });
		siteEl.textContent = `站点${siteCfg.icon}`;
		siteEl.title = `站点: ${siteCfg.text}`;

		if (this.diffResult && (this.diffResult.addedCount > 0 || this.diffResult.removedCount > 0)) {
			const diffEl = container.createEl('span', { cls: `${PANEL_CLASS}-diff-summary` });
			diffEl.innerHTML = `<span class="${PANEL_CLASS}-diff-added">+${this.diffResult.addedCount}</span> <span class="${PANEL_CLASS}-diff-removed">-${this.diffResult.removedCount}</span>`;
			diffEl.title = `差异: +${this.diffResult.addedCount} -${this.diffResult.removedCount}`;
		}
	}

	private renderTabBar() {
		const tabBar = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-tab-bar` });

		const syncTab = tabBar.createDiv({
			cls: `${PANEL_CLASS}-tab ${this.activeTab === 'sync' ? `${PANEL_CLASS}-tab--active` : ''}`,
		});
		syncTab.createEl('span', { text: '🔗 文档级同步' });
		syncTab.onclick = () => {
			if (this.activeTab !== 'sync') {
				this.activeTab = 'sync';
				this.renderPanel();
			}
		};

		const publishTab = tabBar.createDiv({
			cls: `${PANEL_CLASS}-tab ${this.activeTab === 'publish' ? `${PANEL_CLASS}-tab--active` : ''}`,
		});
		publishTab.createEl('span', { text: '📤 发布情况' });
		publishTab.onclick = () => {
			if (this.activeTab !== 'publish') {
				this.activeTab = 'publish';
				this.renderPanel();
			}
		};

		const componentsTab = tabBar.createDiv({
			cls: `${PANEL_CLASS}-tab ${this.activeTab === 'components' ? `${PANEL_CLASS}-tab--active` : ''}`,
		});
		componentsTab.createEl('span', { text: '🏷️ 组件' });
		componentsTab.onclick = () => {
			if (this.activeTab !== 'components') {
				this.activeTab = 'components';
				this.renderPanel();
			}
		};

		const authorsTab = tabBar.createDiv({
			cls: `${PANEL_CLASS}-tab ${this.activeTab === 'authors' ? `${PANEL_CLASS}-tab--active` : ''}`,
		});
		authorsTab.createEl('span', { text: '👤 作者' });
		authorsTab.onclick = () => {
			if (this.activeTab !== 'authors') {
				this.activeTab = 'authors';
				this.renderPanel();
			}
		};

	}

	private async renderDefault(blocks: ParsedSyncBlock[]) {
		if (this.activeTab === 'sync') {
			this.renderSyncContent(blocks);
		} else if (this.activeTab === 'components') {
			await this.renderComponentsContent();
		} else if (this.activeTab === 'authors') {
			this.renderAuthorsContent();
		} else {
			this.renderPublishContent();
		}
	}

	private async renderExpanded(blocks: ParsedSyncBlock[]) {
		if (this.activeTab === 'sync') {
			this.renderSyncContent(blocks);
			this.renderSyncDetail(blocks);
		} else if (this.activeTab === 'components') {
			await this.renderComponentsContent();
		} else if (this.activeTab === 'authors') {
			this.renderAuthorsContent();
		} else {
			this.renderPublishContent();
		}
	}

	private renderSyncContent(blocks: ParsedSyncBlock[]) {
		const contentArea = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-tab-content` });

		const header = contentArea.createDiv({ cls: `${PANEL_CLASS}-sync-header` });
		header.createEl('span', { text: `同步块 (${blocks.length})`, cls: `${PANEL_CLASS}-title` });
		header.createEl('button', { text: '同步', cls: `${PANEL_CLASS}-sync-btn` }).onclick = () => this.syncCurrentDoc();

		if (blocks.length === 0) {
			contentArea.createDiv({ text: '此文档无文档级同步块', cls: `${PANEL_CLASS}-empty` });
		} else {
			const table = contentArea.createEl('table', { cls: `${PANEL_CLASS}-table` });
			const thead = table.createEl('thead');
			thead.createEl('tr').innerHTML = '<th>ID</th><th>类型</th><th>版本</th>';
			const tbody = table.createEl('tbody');
			for (const block of blocks) {
				const row = tbody.createEl('tr');
				row.createEl('td', { text: block.syncId });
				row.createEl('td', { text: block.type });
				row.createEl('td', { text: block.localTime || '-' });
			}
		}
	}

	private renderSyncDetail(blocks: ParsedSyncBlock[]) {
		if (blocks.length === 0) return;

		const detailArea = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-detail` });
		for (const block of blocks) {
			const item = detailArea.createDiv({ cls: `${PANEL_CLASS}-detail-item` });
			const itemHeader = item.createDiv({ cls: `${PANEL_CLASS}-detail-header` });
			itemHeader.createEl('strong', { text: block.syncId });
			itemHeader.createEl('span', { text: ` · ${block.type} · ${block.localTime || '-'}`, cls: `${PANEL_CLASS}-detail-meta` });

			const actions = itemHeader.createDiv({ cls: `${PANEL_CLASS}-detail-actions` });
			actions.createEl('button', { text: '复制', cls: `${PANEL_CLASS}-action-btn` }).onclick = () => {
				navigator.clipboard.writeText(block.content);
				new Notice('已复制内容', 1500);
			};
			actions.createEl('button', { text: '删除', cls: `${PANEL_CLASS}-action-btn ${PANEL_CLASS}-action-btn--danger` }).onclick = async () => {
				if (!this.currentFile) return;
				const fileContent = await this.plugin.app.vault.read(this.currentFile);
				const newContent = fileContent.replace(block.fullMatch, '');
				await this.plugin.app.vault.modify(this.currentFile, newContent);
				new Notice(`已删除 ${block.syncId}`);
				this.renderPanel();
			};
			actions.createEl('button', { text: '编辑', cls: `${PANEL_CLASS}-action-btn` }).onclick = () => {
				this.openBlockForEdit(block);
			};

			if (block.content) {
				const contentEl = item.createDiv({ cls: `${PANEL_CLASS}-detail-content` });
				contentEl.textContent = block.content.length > 200
					? block.content.substring(0, 200) + '...'
					: block.content;
			}
		}
	}

	private renderPublishContent() {
		const contentArea = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-tab-content` });

		const header = contentArea.createDiv({ cls: `${PANEL_CLASS}-publish-header` });
		header.createEl('span', { text: '📤 发布情况', cls: `${PANEL_CLASS}-title` });

		const btnArea = header.createDiv({ cls: `${PANEL_CLASS}-publish-header-actions` });
		btnArea.createEl('button', {
			text: '发布到本地',
			cls: `${PANEL_CLASS}-sync-btn`,
			attr: { title: '发布到本地 VuePress 项目' },
		}).onclick = () => this.publishCurrentDoc('local');
		btnArea.createEl('button', {
			text: '发布到 GitHub',
			cls: `${PANEL_CLASS}-sync-btn`,
			attr: { title: '发布到 GitHub' },
		}).onclick = () => this.publishCurrentDoc('github');

		const toggleBtn = btnArea.createEl('button', {
			cls: `${PANEL_CLASS}-sync-btn`,
			attr: { title: this.publishDisplayMode === 'expanded' ? '收起详情' : '展开详情' },
		});
		toggleBtn.textContent = this.publishDisplayMode === 'expanded' ? '▴' : '▾';
		toggleBtn.onclick = () => {
			this.publishDisplayMode = this.publishDisplayMode === 'expanded' ? 'default' : 'expanded';
			this.renderPanel();
		};

		if (!this.publishInfo) {
			contentArea.createDiv({ text: '发布状态不可用', cls: `${PANEL_CLASS}-empty` });
			return;
		}

		this.renderPublishInfoTable(contentArea);

		if (this.publishDisplayMode === 'expanded') {
			this.renderPublishExpanded(contentArea);
		}
	}

	private renderPublishInfoTable(container: HTMLElement) {
		const info = this.publishInfo!;

		const table = container.createEl('table', { cls: `${PANEL_CLASS}-publish-info-table` });
		const tbody = table.createEl('tbody');

		if (Platform.isDesktop) {
			const localRow = tbody.createEl('tr');
			localRow.createEl('td', { text: '本地', cls: `${PANEL_CLASS}-publish-info-label` });
			const localCell = localRow.createEl('td');
			const localCfg = STATUS_CONFIG[info.localStatus];
			const localStatusEl = localCell.createEl('span', { cls: `${PANEL_CLASS}-publish-status ${localCfg.cls}` });
			localStatusEl.textContent = `${localCfg.icon} ${localCfg.text}`;
			if (info.localMtime) {
				localCell.createEl('span', { text: ` · ${this.formatTimestamp(info.localMtime)}`, cls: `${PANEL_CLASS}-publish-info-time` });
			}
		}

		const siteRow = tbody.createEl('tr');
		siteRow.createEl('td', { text: '站点', cls: `${PANEL_CLASS}-publish-info-label` });
		const siteCell = siteRow.createEl('td');
		const siteCfg = STATUS_CONFIG[info.siteStatus];
		const siteStatusEl = siteCell.createEl('span', { cls: `${PANEL_CLASS}-publish-status ${siteCfg.cls}` });
		siteStatusEl.textContent = `${siteCfg.icon} ${siteCfg.text}`;
		if (info.siteMtime) {
			siteCell.createEl('span', { text: ` · ${this.formatTimestamp(info.siteMtime)}`, cls: `${PANEL_CLASS}-publish-info-time` });
		}

		if (info.vuepressPath) {
			const pathRow = tbody.createEl('tr');
			pathRow.createEl('td', { text: '路径', cls: `${PANEL_CLASS}-publish-info-label` });
			pathRow.createEl('td', { text: info.vuepressPath, cls: `${PANEL_CLASS}-publish-info-path` });
		}

		const idRow = tbody.createEl('tr');
		idRow.createEl('td', { text: '发布ID', cls: `${PANEL_CLASS}-publish-info-label` });
		const idCell = idRow.createEl('td');
		if (info.publishId) {
			const idSpan = idCell.createEl('span', { text: info.publishId, cls: `${PANEL_CLASS}-publish-id` });
			const editBtn = idCell.createEl('button', { text: '✏️', cls: `${PANEL_CLASS}-publish-id-edit-btn`, attr: { title: '修改发布ID' } });
			editBtn.onclick = () => this.editPublishId();
		} else {
			const warnSpan = idCell.createEl('span', { text: '⚠️ 无发布ID', cls: `${PANEL_CLASS}-publish-id-missing` });
			const genBtn = idCell.createEl('button', { text: '生成', cls: `${PANEL_CLASS}-publish-id-gen-btn`, attr: { title: '生成发布ID' } });
			genBtn.onclick = () => this.generatePublishId();
		}

		if (this.diffResult && (this.diffResult.addedCount > 0 || this.diffResult.removedCount > 0)) {
			const diffRow = tbody.createEl('tr');
			diffRow.createEl('td', { text: '差异', cls: `${PANEL_CLASS}-publish-info-label` });
			const diffCell = diffRow.createEl('td');
			diffCell.innerHTML = `<span class="${PANEL_CLASS}-diff-added">+${this.diffResult.addedCount}</span> <span class="${PANEL_CLASS}-diff-removed">-${this.diffResult.removedCount}</span> <span class="${PANEL_CLASS}-diff-unchanged">~${this.diffResult.unchangedCount}</span>`;
		}
	}

	private renderPublishExpanded(container: HTMLElement) {
		if (this.diffResult) {
			this.renderDiffView(container);
		} else if (this.publishInfo && this.publishInfo.localStatus === 'unpublished' && this.publishInfo.siteStatus === 'unpublished') {
			container.createDiv({ text: '文件尚未发布，无差异可比较', cls: `${PANEL_CLASS}-empty` });
		} else {
			container.createDiv({ text: '差异信息不可用（可能未配置本地 VuePress 项目路径）', cls: `${PANEL_CLASS}-empty` });
		}
	}

	private renderDiffView(container: HTMLElement) {
		const diff = this.diffResult!;

		const hasLocal = Platform.isDesktop && !!this.plugin.settings.localVuePressRoot;
		const hasSite = !!this.plugin.settings.siteDomain;

		const diffSection = container.createDiv({ cls: `${PANEL_CLASS}-diff-section` });

		const diffHeader = diffSection.createDiv({ cls: `${PANEL_CLASS}-diff-header` });
		const headerLeft = diffHeader.createDiv({ cls: `${PANEL_CLASS}-diff-header-left` });
		headerLeft.createEl('span', { text: '差异对比', cls: `${PANEL_CLASS}-diff-title` });

		if (hasLocal && hasSite) {
			const sourceToggle = headerLeft.createEl('select', { cls: `${PANEL_CLASS}-diff-source-select` });
			const localOpt = sourceToggle.createEl('option', { text: '对比: 本地', attr: { value: 'local' } });
			const siteOpt = sourceToggle.createEl('option', { text: '对比: 云端', attr: { value: 'site' } });
			if (this.compareSource === 'local') {
				localOpt.selected = true;
			} else {
				siteOpt.selected = true;
			}
			sourceToggle.onchange = async () => {
				const newSource = sourceToggle.value as DiffCompareSource;
				if (newSource === this.compareSource) return;
				this.compareSource = newSource;
				await this.recomputeDiff();
			};
		} else if (hasLocal) {
			headerLeft.createEl('span', { text: '(对比: 本地)', cls: `${PANEL_CLASS}-diff-line-count` });
		} else if (hasSite) {
			headerLeft.createEl('span', { text: '(对比: 云端)', cls: `${PANEL_CLASS}-diff-line-count` });
		}

		const headerRight = diffHeader.createDiv({ cls: `${PANEL_CLASS}-diff-header-right` });
		headerRight.createEl('button', {
			text: '复制 Diff',
			cls: `${PANEL_CLASS}-action-btn`,
			attr: { title: '复制为 Markdown 代码块' },
		}).onclick = () => this.copyDiffAsMarkdown(diff);

		if (diff.addedCount > 0 || diff.removedCount > 0) {
			headerRight.createEl('button', {
				text: '回滚',
				cls: `${PANEL_CLASS}-action-btn ${PANEL_CLASS}-action-btn--danger`,
				attr: { title: `用${diff.compareSource === 'local' ? '本地' : '云端'}版本覆盖当前文档` },
			}).onclick = () => this.rollbackToPublishedVersion(diff);
		}

		const contextRadius = 3;
		const showLines = this.computeVisibleDiffLines(diff, contextRadius);

		const diffRange = this.computeDiffRange(diff);

		const statsBar = diffSection.createDiv({ cls: `${PANEL_CLASS}-diff-stats` });
		statsBar.createEl('span', { text: diffRange, cls: `${PANEL_CLASS}-diff-line-count` });
		statsBar.createEl('span', { text: `+${diff.addedCount} 新增`, cls: `${PANEL_CLASS}-diff-stats-added` });
		statsBar.createEl('span', { text: `-${diff.removedCount} 删除`, cls: `${PANEL_CLASS}-diff-stats-removed` });
		statsBar.createEl('span', { text: `~${diff.unchangedCount} 未变`, cls: `${PANEL_CLASS}-diff-stats-unchanged` });

		if (diff.fallback) {
			const originalLabel = diff.compareSource === 'local' ? '云端' : '本地';
			const fallbackLabel = diff.compareSource === 'local' ? '本地' : '云端';
			const fallbackNotice = statsBar.createEl('span', { cls: `${PANEL_CLASS}-diff-fallback-notice` });
			fallbackNotice.textContent = `⚠ ${originalLabel}不可用，已回退到${fallbackLabel}`;
		}

		const diffBody = diffSection.createDiv({ cls: `${PANEL_CLASS}-diff-body` });

		let lastShown = -1;
		for (let i = 0; i < diff.lines.length; i++) {
			if (!showLines.has(i)) continue;

			if (lastShown >= 0 && i - lastShown > 1) {
				const sep = diffBody.createDiv({ cls: `${PANEL_CLASS}-diff-sep` });
				sep.textContent = '⋯';
			}
			lastShown = i;

			const line = diff.lines[i];
			const lineEl = diffBody.createDiv({ cls: `${PANEL_CLASS}-diff-line ${PANEL_CLASS}-diff-line--${line.type}` });

			const lineNoEl = lineEl.createDiv({ cls: `${PANEL_CLASS}-diff-line-no` });
			lineNoEl.createEl('span', { text: line.oldLineNo != null ? String(line.oldLineNo) : '' });
			lineNoEl.createEl('span', { text: line.newLineNo != null ? String(line.newLineNo) : '' });

			const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
			const contentEl = lineEl.createDiv({ cls: `${PANEL_CLASS}-diff-line-content` });
			contentEl.textContent = `${prefix} ${line.content}`;
		}
	}

	private computeVisibleDiffLines(diff: DiffResult, contextRadius: number): Set<number> {
		const showLines = new Set<number>();
		for (let i = 0; i < diff.lines.length; i++) {
			if (diff.lines[i].type !== 'unchanged') {
				for (let j = Math.max(0, i - contextRadius); j <= Math.min(diff.lines.length - 1, i + contextRadius); j++) {
					showLines.add(j);
				}
			}
		}

		if (showLines.size === 0) {
			for (let i = 0; i < Math.min(diff.lines.length, 10); i++) {
				showLines.add(i);
			}
		}
		return showLines;
	}

	private computeDiffRange(diff: DiffResult): string {
		let firstOld = -1, lastOld = -1, firstNew = -1, lastNew = -1;
		for (const line of diff.lines) {
			if (line.type === 'unchanged') continue;
			if (line.oldLineNo != null) {
				if (firstOld === -1 || line.oldLineNo < firstOld) firstOld = line.oldLineNo;
				if (lastOld === -1 || line.oldLineNo > lastOld) lastOld = line.oldLineNo;
			}
			if (line.newLineNo != null) {
				if (firstNew === -1 || line.newLineNo < firstNew) firstNew = line.newLineNo;
				if (lastNew === -1 || line.newLineNo > lastNew) lastNew = line.newLineNo;
			}
		}

		if (firstOld === -1 && firstNew === -1) {
			return `${diff.oldLineCount} → ${diff.newLineCount} 行`;
		}

		const oldRange = firstOld === lastOld ? `${firstOld}` : `${firstOld}-${lastOld}`;
		const newRange = firstNew === lastNew ? `${firstNew}` : `${firstNew}-${lastNew}`;
		return `行 ${oldRange} → ${newRange}`;
	}

	private async recomputeDiff() {
		if (!this.currentFile) return;
		const checker = this.plugin.publishStatusChecker;
		if (!checker) return;

		const previousSource = this.compareSource;
		try {
			this.diffResult = await checker.computeDiff(this.currentFile, this.compareSource);
			if (this.diffResult) {
				this.compareSource = this.diffResult.compareSource;
				if (this.diffResult.fallback) {
					const originalLabel = previousSource === 'local' ? '本地' : '云端';
					new Notice(`${originalLabel}对比源不可用，已回退`, 3000);
				}
			} else {
				new Notice('无法获取对比版本内容', 3000);
			}
		} catch (e) {
			this.diffResult = null;
			new Notice(`对比失败：${e.message}`, 4000);
		}
		this.renderPanel();
	}

	private copyDiffAsMarkdown(diff: DiffResult) {
		const contextRadius = 3;
		const showLines = this.computeVisibleDiffLines(diff, contextRadius);

		const lines: string[] = [];
		const sourceLabel = diff.compareSource === 'local' ? '本地' : '云端';
		lines.push(`\`\`\`diff`);
		lines.push(`# Diff: Obsidian vs ${sourceLabel}发布版本`);
		lines.push(`# ${this.computeDiffRange(diff)} (+${diff.addedCount} -${diff.removedCount})`);
		lines.push('');

		let lastShown = -1;
		for (let i = 0; i < diff.lines.length; i++) {
			if (!showLines.has(i)) continue;

			if (lastShown >= 0 && i - lastShown > 1) {
				lines.push('');
				lines.push('⋯');
				lines.push('');
			}
			lastShown = i;

			const line = diff.lines[i];
			const oldNo = line.oldLineNo != null ? String(line.oldLineNo).padStart(4) : '    ';
			const newNo = line.newLineNo != null ? String(line.newLineNo).padStart(4) : '    ';
			const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
			lines.push(`${prefix} ${oldNo} ${newNo} | ${line.content}`);
		}

		lines.push('```');

		navigator.clipboard.writeText(lines.join('\n'));
		new Notice('已复制 Diff 为 Markdown 代码块', 2000);
	}

	private async editPublishId() {
		if (!this.currentFile || !this.publishInfo) return;

		const currentId = this.publishInfo.publishId || '';
		const newId = await new Promise<string | null>((resolve) => {
			const modal = new Modal(this.plugin.app);
			modal.titleEl.setText('修改发布ID');
			modal.contentEl.createEl('p', { text: '发布ID用于唯一标识文档，修改后可能影响发布状态匹配。' });

			const input = modal.contentEl.createEl('input', {
				type: 'text',
				cls: `${PANEL_CLASS}-publish-id-input`,
				attr: { value: currentId, placeholder: 'pub_YYYYMMDD_xxxxxx' },
			}) as HTMLInputElement;
			input.style.width = '100%';
			input.style.marginTop = '8px';

			const warnEl = modal.contentEl.createEl('p', {
				text: '⚠️ 修改发布ID可能导致文档与已发布版本失去关联',
				cls: `${PANEL_CLASS}-publish-id-warn`,
			});
			warnEl.style.color = 'var(--text-warning)';
			warnEl.style.fontSize = '12px';
			warnEl.style.display = 'none';

			input.addEventListener('input', () => {
				const val = input.value.trim();
				if (val && val !== currentId) {
					warnEl.style.display = 'block';
				} else {
					warnEl.style.display = 'none';
				}
			});

			const btnContainer = modal.contentEl.createDiv({ cls: `${PANEL_CLASS}-publish-id-btns` });
			btnContainer.style.display = 'flex';
			btnContainer.style.gap = '8px';
			btnContainer.style.marginTop = '12px';
			btnContainer.style.justifyContent = 'flex-end';

			const cancelBtn = btnContainer.createEl('button', { text: '取消' });
			cancelBtn.onclick = () => { modal.close(); resolve(null); };

			const saveBtn = btnContainer.createEl('button', { text: '保存', cls: 'mod-cta' });
			saveBtn.onclick = () => { modal.close(); resolve(input.value.trim()); };

			modal.open();
			setTimeout(() => { input.focus(); input.select(); }, 100);
		});

		if (newId === null || newId === currentId) return;

		try {
			const content = await this.plugin.app.vault.read(this.currentFile);
			const newContent = setPublishIdInContent(content, newId);
			await this.plugin.app.vault.modify(this.currentFile, newContent);
			this.publishInfo.publishId = newId;
			this.renderPanel();
			new Notice(`发布ID已更新为: ${newId}`);
		} catch (e) {
			new Notice(`更新发布ID失败: ${e.message}`);
		}
	}

	private async generatePublishId() {
		if (!this.currentFile) return;

		try {
			const content = await this.plugin.app.vault.read(this.currentFile);
			const newId = generatePublishId();
			const newContent = setPublishIdInContent(content, newId);
			await this.plugin.app.vault.modify(this.currentFile, newContent);
			if (this.publishInfo) {
				this.publishInfo.publishId = newId;
			}
			this.renderPanel();
			new Notice(`已生成发布ID: ${newId}`);
		} catch (e) {
			new Notice(`生成发布ID失败: ${e.message}`);
		}
	}

	private async rollbackToPublishedVersion(diff: DiffResult) {
		if (!this.currentFile) return;
		const sourceLabel = diff.compareSource === 'local' ? '本地' : '云端';

		const confirmed = await this.confirmAction(
			`确认回滚`,
			`将用${sourceLabel}发布版本覆盖当前 Obsidian 文档内容，此操作不可撤销。`
		);
		if (!confirmed) return;

		try {
			await this.plugin.app.vault.modify(this.currentFile, diff.publishedContent);
			await this.touchLocalPublishedFile(this.currentFile);
			new Notice(`已回滚到${sourceLabel}发布版本`);
			this.renderPanel();
		} catch (e) {
			new Notice(`回滚失败：${e.message}`);
		}
	}

	private async touchLocalPublishedFile(file: TFile) {
		const checker = this.plugin.publishStatusChecker;
		if (checker) {
			await checker.touchPublishedFile(file);
		}
	}

	private confirmAction(title: string, message: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(this.plugin.app, title, message, resolve);
			modal.open();
		});
	}

	private formatTimestamp(mtime: number | null): string {
		if (!mtime) return '-';
		const d = new Date(mtime);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	private async syncCurrentDoc() {
		if (!this.plugin.syncManager || !this.currentFile) return;
		const taskId = `sync-${Date.now()}`;
		this.plugin.taskTracker.startTask(taskId, '同步文档中...');
		const notice = new Notice('同步中...', 0);
		try {
			const result = await this.plugin.syncManager.syncFile(this.currentFile);
			notice.hide();
			new Notice(`同步完成：${result.synced} 项，冲突 ${result.conflicts} 项`);
			this.renderPanel();
			this.plugin.taskTracker.endTask(taskId, 'success');
		} catch (error) {
			notice.hide();
			new Notice(`同步失败：${error.message}`);
			this.plugin.taskTracker.endTask(taskId, 'failed', error.message);
		}
	}

	private async publishCurrentDoc(target: 'local' | 'github') {
		if (!this.currentFile) return;
		const taskId = `publish-${Date.now()}`;
		if (target === 'local') {
			const checker = this.plugin.publishStatusChecker;
			if (!checker) {
				new Notice('发布状态检查器未初始化');
				return;
			}
			this.plugin.taskTracker.startTask(taskId, '发布到本地中...');
			try {
				await checker.publishToLocal(this.currentFile);
				new Notice('本地发布成功');
				this.plugin.ensureFileInSyncPaths(this.currentFile);
				this.plugin.cleanVaultSyncPaths();
				this.renderPanel();
				this.plugin.refreshPublishPanel();
				this.plugin.taskTracker.endTask(taskId, 'success');
			} catch (e) {
				new Notice(`本地发布失败：${e.message}`);
				this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
			}
		} else {
			this.plugin.taskTracker.startTask(taskId, '发布到 GitHub 中...');
			try {
				this.plugin.publishFile(this.currentFile);
				this.plugin.taskTracker.endTask(taskId, 'success');
			} catch (e) {
				this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
			}
		}
	}

	private openBlockForEdit(block: ParsedSyncBlock) {
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) return;
		const editor = activeLeaf.view.editor;
		const fileContent = editor.getValue();
		const lines = fileContent.split('\n');

		let lineIndex = -1;
		let ch = -1;
		let searchPos = 0;
		for (let i = 0; i < lines.length; i++) {
			const lineStart = searchPos;
			const lineEnd = lineStart + lines[i].length;
			if (block.startPos >= lineStart && block.startPos <= lineEnd) {
				lineIndex = i;
				ch = block.startPos - lineStart;
				break;
			}
			searchPos = lineEnd + 1;
		}
		if (lineIndex >= 0) {
			editor.setCursor({ line: lineIndex, ch });
			editor.focus();
		}
	}

	private async renderComponentsContent() {
		const contentArea = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-tab-content` });

		if (!this.currentFile) {
			contentArea.createDiv({ text: '无当前文档', cls: `${PANEL_CLASS}-empty` });
			return;
		}

		const fileContent = this.plugin.app.vault.getAbstractFileByPath(this.currentFile.path);
		if (!fileContent) {
			contentArea.createDiv({ text: '无法读取文档内容', cls: `${PANEL_CLASS}-empty` });
			return;
		}

		const components = await this.extractComponents(this.currentFile);

		const header = contentArea.createDiv({ cls: `${PANEL_CLASS}-sync-header` });
		header.createEl('span', { text: `自定义组件 (${components.length})`, cls: `${PANEL_CLASS}-title` });

		if (components.length === 0) {
			contentArea.createDiv({ text: '此文档未使用自定义组件', cls: `${PANEL_CLASS}-empty` });
			return;
		}

		const list = contentArea.createDiv({ cls: `${PANEL_CLASS}-component-list` });
		for (const comp of components) {
			const item = list.createDiv({ cls: `${PANEL_CLASS}-component-item` });
			const tagEl = item.createEl('span', { cls: `${PANEL_CLASS}-component-tag`, text: comp.tag });
			if (comp.detail) {
				item.createEl('span', { cls: `${PANEL_CLASS}-component-detail`, text: comp.detail });
			}
			item.createEl('span', { cls: `${PANEL_CLASS}-component-line`, text: `第 ${comp.line + 1} 行` });
			item.onclick = () => this.jumpToLine(comp.line, comp.ch);
		}
	}

	private async extractComponents(file: TFile): Promise<Array<{ tag: string; detail: string; line: number; ch: number }>> {
		const content = this.plugin.app.vault.getAbstractFileByPath(file.path);
		if (!content) return [];

		const text = await this.plugin.app.vault.cachedRead(file) || '';
		const lines = text.split('\n');
		const results: Array<{ tag: string; detail: string; line: number; ch: number }> = [];
		const regex = /<(GithubLabel|VSCodeSettingsLink|BannerTop|C)\s+[^>]*\/?>/g;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let match;
			while ((match = regex.exec(line)) !== null) {
				const tag = match[1];
				const full = match[0];
				let detail = '';

				if (tag === 'GithubLabel') {
					const m = full.match(/(?:name|label)="([^"]+)"/);
					if (m) detail = m[1];
				} else if (tag === 'VSCodeSettingsLink') {
					const m = full.match(/id="([^"]+)"/);
					if (m) detail = m[1];
				} else if (tag === 'C') {
					const m = full.match(/id="([^"]+)"/);
					if (m) detail = m[1];
				} else if (tag === 'BannerTop') {
					const m = full.match(/type="([^"]+)"/);
					if (m) detail = m[1];
				}

				results.push({ tag, detail, line: i, ch: match.index });
			}
			regex.lastIndex = 0;
		}

		return results;
	}

	private async jumpToLine(line: number, ch: number) {
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) return;
		const markdownView = activeLeaf.view;

		// Switch to source mode first to ensure the cursor can be positioned correctly
		// (Live Preview mode may have different line mapping due to rendered elements like tables)
		const state = markdownView.getState();
		if (state.mode !== 'source' || !state.source) {
			markdownView.setState(
				{ ...state, mode: 'source', source: true },
				{ history: false }
			);
			// Wait for the editor to switch modes
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		const editor = markdownView.editor;
		editor.setCursor({ line, ch });
		editor.focus();
	}

	private renderAuthorsContent() {
		const contentArea = this.panelEl!.createDiv({ cls: `${PANEL_CLASS}-tab-content` });

		if (!this.currentFile) {
			contentArea.createDiv({ text: '无当前文档', cls: `${PANEL_CLASS}-empty` });
			return;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(this.currentFile);
		const frontmatter = cache?.frontmatter;
		const authorData = frontmatter?.author;

		const header = contentArea.createDiv({ cls: `${PANEL_CLASS}-sync-header` });
		header.createEl('span', { text: `作者 (${this.getCurrentAuthors().length})`, cls: `${PANEL_CLASS}-title` });

		// Add author button (requires local VuePress root)
		const canAddAuthor = !!this.plugin.settings.localVuePressRoot;
		if (canAddAuthor) {
			const addBtn = header.createEl('button', { text: '+ 添加', cls: `${PANEL_CLASS}-sync-btn` });
			addBtn.onclick = () => this.openAddAuthorModal();
		}

		const authors = this.getCurrentAuthors();
		if (authors.length === 0) {
			contentArea.createDiv({ text: '此文档未设置作者', cls: `${PANEL_CLASS}-empty` });
			return;
		}

		const list = contentArea.createDiv({ cls: `${PANEL_CLASS}-author-list` });
		for (let i = 0; i < authors.length; i++) {
			const author = authors[i];
			const item = list.createDiv({ cls: `${PANEL_CLASS}-author-item` });

			const avatarEl = item.createDiv({ cls: `${PANEL_CLASS}-author-avatar` });
			if (author.avatar) {
				avatarEl.createEl('img', { attr: { src: author.avatar, alt: author.name } });
			} else {
				avatarEl.textContent = author.name.charAt(0).toUpperCase();
			}

			const infoEl = item.createDiv({ cls: `${PANEL_CLASS}-author-info` });
			const nameRow = infoEl.createDiv({ cls: `${PANEL_CLASS}-author-name-row` });
			nameRow.createEl('span', { cls: `${PANEL_CLASS}-author-name`, text: author.name });
			if (author.verified) {
				nameRow.createEl('span', { cls: `${PANEL_CLASS}-author-verified`, text: '✓' });
			}
			infoEl.createEl('span', { cls: `${PANEL_CLASS}-author-slug`, text: `@${author.slug}` });

			const actionsEl = item.createDiv({ cls: `${PANEL_CLASS}-author-actions` });
			const removeBtn = actionsEl.createEl('button', { text: '删除', cls: `${PANEL_CLASS}-action-btn ${PANEL_CLASS}-action-btn--danger` });
			removeBtn.onclick = () => this.removeAuthor(i);
		}
	}

	private getCurrentAuthors(): Array<{ name: string; slug: string; avatar?: string; verified?: boolean }> {
		if (!this.currentFile) return [];
		const cache = this.plugin.app.metadataCache.getFileCache(this.currentFile);
		const authorData = cache?.frontmatter?.author;
		if (!authorData) return [];

		const authors = Array.isArray(authorData) ? authorData : [authorData];
		return authors.map((a: unknown) => {
			if (typeof a === 'string') {
				return { name: a, slug: a.toLowerCase().replace(/\s+/g, '-') };
			}
			if (typeof a === 'object' && a !== null) {
				const obj = a as Record<string, unknown>;
				const name = String(obj.name || '');
				return {
					name,
					slug: String(obj.slug || name.toLowerCase().replace(/\s+/g, '-')),
					avatar: obj.avatar ? String(obj.avatar) : undefined,
					verified: Boolean(obj.verified),
				};
			}
			return { name: String(a), slug: String(a).toLowerCase().replace(/\s+/g, '-') };
		}).filter(a => a.name);
	}

	private async loadAvailableAuthors(): Promise<Array<{ name: string; slug: string; avatar?: string; verified?: boolean }>> {
		try {
			// Try to get authors from bridge assets first (works on both desktop and mobile)
			const bridgeAuthors = this.plugin.bridgeManager.getAssets().authors?.authors;
			if (bridgeAuthors) {
				return Object.values(bridgeAuthors).map(a => ({
					name: a.name,
					slug: a.slug,
					avatar: a.avatar,
					verified: a.verified,
				}));
			}

			// Fallback: read from local VuePress temp file (desktop only)
			const vpRoot = this.plugin.settings.localVuePressRoot;
			if (!vpRoot) return [];

			const sep = vpRoot.includes('\\') ? '\\' : '/';
			const authorDataPath = `${vpRoot}${sep}docs${sep}.vuepress${sep}.temp${sep}author-data.ts`;

			const { readFileSync, existsSync } = require('fs') as typeof import('fs');
			if (!existsSync(authorDataPath)) return [];

			const content = readFileSync(authorDataPath, 'utf-8');
			const match = content.match(/export\s+default\s+(\{[\s\S]*\})\s+as\s+Record/);
			if (!match) return [];

			const jsonStr = match[1];
			const data = JSON.parse(jsonStr) as Record<string, { name: string; slug: string; avatar?: string; verified?: boolean; posts?: unknown[] }>;

			return Object.values(data).map(a => ({
				name: a.name,
				slug: a.slug,
				avatar: a.avatar,
				verified: a.verified,
			}));
		} catch (e) {
			console.error('加载作者列表失败', e);
			return [];
		}
	}

	private openAddAuthorModal() {
		const modal = new Modal(this.plugin.app);
		modal.titleEl.setText('添加作者');

		const contentEl = modal.contentEl;
		contentEl.createEl('p', { text: '从已有作者中选择要添加的作者：', cls: 'setting-item-description' });

		let availableAuthors: Array<{ name: string; slug: string; avatar?: string; verified?: boolean }> = [];
		const currentSlugs = new Set(this.getCurrentAuthors().map(a => a.slug));

		const listContainer = contentEl.createDiv({ cls: 'sillot-author-select-list' });

		this.loadAvailableAuthors().then(authors => {
			availableAuthors = authors.filter(a => !currentSlugs.has(a.slug));
			listContainer.empty();

			if (availableAuthors.length === 0) {
				listContainer.createDiv({ text: '没有可添加的作者（所有作者已在列表中）', cls: 'sillot-author-select-empty' });
				return;
			}

			for (const author of availableAuthors) {
				const item = listContainer.createDiv({ cls: 'sillot-author-select-item' });

				const avatarEl = item.createDiv({ cls: 'sillot-author-select-avatar' });
				if (author.avatar) {
					avatarEl.createEl('img', { attr: { src: author.avatar, alt: author.name } });
				} else {
					avatarEl.textContent = author.name.charAt(0).toUpperCase();
				}

				const infoEl = item.createDiv({ cls: 'sillot-author-select-info' });
				infoEl.createEl('span', { cls: 'sillot-author-select-name', text: author.name });
				infoEl.createEl('span', { cls: 'sillot-author-select-slug', text: `@${author.slug}` });

				const addBtn = item.createEl('button', { text: '添加', cls: 'sillot-author-select-btn' });
				addBtn.onclick = () => {
					this.addAuthor(author);
					modal.close();
				};
			}
		});

		modal.open();
	}

	private async addAuthor(author: { name: string; slug: string; avatar?: string; verified?: boolean }) {
		if (!this.currentFile) return;
		const currentAuthors = this.getCurrentAuthors();
		const newAuthors = [...currentAuthors, author];
		await this.updateFrontmatterAuthors(newAuthors);
		new Notice(`已添加作者：${author.name}`);
		this.renderPanel();
	}

	private async removeAuthor(index: number) {
		if (!this.currentFile) return;
		const currentAuthors = this.getCurrentAuthors();
		if (index < 0 || index >= currentAuthors.length) return;

		const removed = currentAuthors[index];
		const newAuthors = currentAuthors.filter((_, i) => i !== index);
		await this.updateFrontmatterAuthors(newAuthors);
		new Notice(`已移除作者：${removed.name}`);
		this.renderPanel();
	}

	private async updateFrontmatterAuthors(authors: Array<{ name: string; slug: string; avatar?: string; verified?: boolean }>) {
		if (!this.currentFile) return;
		const fileContent = await this.plugin.app.vault.read(this.currentFile);

		// Build author YAML
		let authorYaml: string;
		if (authors.length === 0) {
			authorYaml = '';
		} else if (authors.length === 1) {
			const a = authors[0];
			const fields = [`name: ${a.name}`, `slug: ${a.slug}`];
			if (a.avatar) fields.push(`avatar: ${a.avatar}`);
			if (a.verified) fields.push(`verified: true`);
			authorYaml = `author:\n  ${fields.join('\n  ')}`;
		} else {
			const items = authors.map(a => {
				const fields = [`name: ${a.name}`, `slug: ${a.slug}`];
				if (a.avatar) fields.push(`avatar: ${a.avatar}`);
				if (a.verified) fields.push(`verified: true`);
				return `- ${fields.join('\n    ')}`;
			});
			authorYaml = `author:\n${items.join('\n')}`;
		}

		// Replace or add author in frontmatter
		const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			// No frontmatter, add one
			if (authors.length > 0) {
				const newContent = `---\n${authorYaml}\n---\n\n${fileContent}`;
				await this.plugin.app.vault.modify(this.currentFile, newContent);
			}
			return;
		}

		let frontmatter = frontmatterMatch[1];

		// Remove existing author field
		frontmatter = frontmatter.replace(/\n?author:[\s\S]*?(?=\n\w|$)/, '');

		if (authors.length > 0) {
			frontmatter = `${frontmatter}\n${authorYaml}`.trim();
		}

		const newContent = fileContent.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatter}\n---`);
		await this.plugin.app.vault.modify(this.currentFile, newContent);
	}
}

class ConfirmModal extends Modal {
	private title: string;
	private message: string;
	private resolve: (value: boolean) => void;

	constructor(app: import('obsidian').App, title: string, message: string, resolve: (value: boolean) => void) {
		super(app);
		this.title = title;
		this.message = message;
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: this.title });
		contentEl.createEl('p', { text: this.message, cls: 'setting-item-description' });

		const btnRow = contentEl.createDiv({ cls: 'modal-button-container' });
		btnRow.createEl('button', { text: '取消' }).onclick = () => {
			this.close();
			this.resolve(false);
		};
		btnRow.createEl('button', { text: '确认', cls: 'mod-warning' }).onclick = () => {
			this.close();
			this.resolve(true);
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}
