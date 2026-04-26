import { MarkdownView, Modal, Notice, Platform, TFile, type ViewStateResult } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { ParsedSyncBlock, PublishStatus, FilePublishInfo, DiffResult, DiffCompareSource } from '../types';
import type { TaskTracker } from '../utils/TaskTracker';
import { generatePublishId, setPublishIdInContent } from '../sync/PublishStatusChecker';
import { MoveDocumentModal } from './MoveDocumentModal';
import {
	createDocSyncPanelApp,
	type DocSyncPanelAPI,
} from './vue/DocSyncPanelHelper';

const PANEL_CONTAINER_CLASS = 'sillot-doc-sync-panel-container';

type PanelState = 'minimized' | 'default' | 'expanded';
type PublishDisplayMode = 'default' | 'expanded';
type ActiveTab = 'sync' | 'publish' | 'components' | 'authors';

export class DocSyncPanel implements DocSyncPanelAPI {
	private plugin: VuePressPublisherPlugin;
	private currentFile: TFile | null = null;
	private panelEl: HTMLElement | null = null;
	private vueApp: ReturnType<typeof createDocSyncPanelApp> | null = null;
	private _publishInfo: FilePublishInfo | null = null;
	private _diffResult: DiffResult | null = null;
	private _publishDisplayMode: PublishDisplayMode = 'default';
	private _activeTab: ActiveTab = 'sync';
	private _compareSource: DiffCompareSource = 'local';
	private taskTrackerUnsubscribe: (() => void) | null = null;
	private lastModeKey: string = '';
	private modeCheckInterval: number | null = null;
	private renderGen = 0;
	private updateTimer: number | null = null;
	private _syncBlocks: ParsedSyncBlock[] = [];
	private _components: Array<{ tag: string; detail: string; line: number; ch: number }> = [];
	private _footnoteInfo: { defCount: number; refCount: number; defs: Array<{ id: string; content: string; num: number; refCount: number }> } = { defCount: 0, refCount: 0, defs: [] };

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
			if (this.getPanelState() === 'minimized' && this.vueApp) {
				this.vueApp.forceUpdate();
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
				if (this.vueApp) {
					this.vueApp.forceUpdate();
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
		if (this.vueApp) {
			this.vueApp.forceUpdate();
		}
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
		this.vueApp = createDocSyncPanelApp(this.panelEl, this);
	}

	private removePanel() {
		if (this.vueApp) {
			this.vueApp.unmount();
			this.vueApp = null;
		}
		if (this.panelEl) {
			this.panelEl.remove();
			this.panelEl = null;
		}
		document.querySelectorAll(`.${PANEL_CONTAINER_CLASS}`).forEach(el => el.remove());
		this.currentFile = null;
		this._publishInfo = null;
		this._diffResult = null;
		this._syncBlocks = [];
		this._components = [];
		this._footnoteInfo = { defCount: 0, refCount: 0, defs: [] };
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
		this._syncBlocks = blocks.filter(b => b.scope === 'document');

		this._publishInfo = null;
		this._diffResult = null;
		const checker = this.plugin.publishStatusChecker;
		if (checker && this.currentFile) {
			try {
				this._publishInfo = await checker.checkFileStatus(this.currentFile);
			} catch {}
			if (gen !== this.renderGen) return;
			try {
				this._diffResult = await checker.computeDiff(this.currentFile, this._compareSource);
				if (this._diffResult) {
					this._compareSource = this._diffResult.compareSource;
				}
			} catch {}
			if (gen !== this.renderGen) return;
		}

		if (this.currentFile) {
			this._components = await this.extractComponents(this.currentFile);
			this._footnoteInfo = await this.extractFootnotes(content);
		}

		if (!this.panelEl) return;
		this.panelEl.className = `${PANEL_CONTAINER_CLASS} sillot-doc-sync-panel--${this.state}`;

		if (this.vueApp) {
			this.vueApp.forceUpdate();
		}
	}

	private getActiveMarkdownView(): MarkdownView | null {
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) return null;
		return activeLeaf.view;
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

	private async extractFootnotes(content: string): Promise<{ defCount: number; refCount: number; defs: Array<{ id: string; content: string; num: number; refCount: number }> }> {
		// 移除代码块，避免误统计
		const noCode = content.replace(/```[\s\S]*?```/g, '');
		const lines = noCode.split('\n');
		const defs = new Map<string, string>();
		const refCounts = new Map<string, number>();
		let refCount = 0;

		// 匹配 \[^id]: 或 [^id]: 定义
		const fnDefRegex = /^\s*\\?\[\^(\S+?)\]:\s*(.*)$/;
		// 匹配 \[^id] 或 [^id] 引用（不含定义行）
		const fnRefRegex = /\\?\[\^(\S+?)\]/g;

		for (const line of lines) {
			const defMatch = line.match(fnDefRegex);
			if (defMatch) {
				defs.set(defMatch[1], defMatch[2].trim());
			} else {
				// 只有非定义行才统计引用
				let refMatch;
				while ((refMatch = fnRefRegex.exec(line)) !== null) {
					refCount++;
					const id = refMatch[1];
					refCounts.set(id, (refCounts.get(id) || 0) + 1);
				}
				fnRefRegex.lastIndex = 0;
			}
		}

		const defArray = Array.from(defs.entries()).map(([id, content], idx) => ({
			id,
			content,
			num: idx + 1,
			refCount: refCounts.get(id) || 0,
		}));

		return { defCount: defArray.length, refCount, defs: defArray };
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

	private confirmAction(title: string, message: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(this.plugin.app, title, message, resolve);
			modal.open();
		});
	}

	private async touchLocalPublishedFile(file: TFile) {
		const checker = this.plugin.publishStatusChecker;
		if (checker) {
			await checker.touchPublishedFile(file);
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

	private async updateFrontmatterAuthors(authors: Array<{ name: string; slug: string; avatar?: string; verified?: boolean }>) {
		if (!this.currentFile) return;
		const fileContent = await this.plugin.app.vault.read(this.currentFile);

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

		const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) {
			if (authors.length > 0) {
				const newContent = `---\n${authorYaml}\n---\n\n${fileContent}`;
				await this.plugin.app.vault.modify(this.currentFile, newContent);
			}
			return;
		}

		let frontmatter = frontmatterMatch[1];
		frontmatter = frontmatter.replace(/\n?author:[\s\S]*?(?=\n\w|$)/, '');

		if (authors.length > 0) {
			frontmatter = `${frontmatter}\n${authorYaml}`.trim();
		}

		const newContent = fileContent.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatter}\n---`);
		await this.plugin.app.vault.modify(this.currentFile, newContent);
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

	// DocSyncPanelAPI 实现

	getPanelState(): PanelState { return this.state; }
	setPanelState(s: PanelState) { this.setState(s); }
	getActiveTab(): ActiveTab { return this._activeTab; }
	setActiveTab(t: ActiveTab) { this._activeTab = t; if (this.vueApp) this.vueApp.forceUpdate(); }
	getEditorMode() {
		const view = this.getActiveMarkdownView();
		if (!view) return 'live-preview' as const;
		const state = view.getState();
		const mode = state.mode as string;
		const source = state.source as boolean | undefined;
		if (mode === 'preview') return 'reading' as const;
		if (mode === 'source' && source) return 'source' as const;
		return 'live-preview' as const;
	}
	toggleEditorMode() {
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
	getSyncBlocks(): ParsedSyncBlock[] { return this._syncBlocks; }
	getPublishInfo(): FilePublishInfo | null { return this._publishInfo; }
	getDiffResult(): DiffResult | null { return this._diffResult; }
	getPublishDisplayMode(): PublishDisplayMode { return this._publishDisplayMode; }
	setPublishDisplayMode(m: PublishDisplayMode) { this._publishDisplayMode = m; }
	getCompareSource(): DiffCompareSource { return this._compareSource; }
	setCompareSource(s: DiffCompareSource) { this._compareSource = s; }
	getActiveTasks() {
		return this.plugin.taskTracker.getActiveTasks().map(t => ({
			id: t.id,
			label: t.label,
			progress: t.progress,
			status: 'running' as const,
		}));
	}
	getComponents() { return this._components; }
	getAuthors() { return this.getCurrentAuthors(); }
	getCurrentFile(): TFile | null { return this.currentFile; }
	isDesktop() { return Platform.isDesktop; }
	getFootnoteInfo() { return this._footnoteInfo; }

	async syncCurrentDoc() {
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

	async publishCurrentDoc(target: 'local' | 'github') {
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

	moveDocument() {
		if (!this.currentFile || !this._publishInfo?.vuepressPath) {
			new Notice('无法获取文档路径信息');
			return;
		}
		const oldPath = this._publishInfo.vuepressPath;
		const docsDir = this.plugin.settings.vuepressDocsDir || 'docs';
		new MoveDocumentModal(
			this.plugin.app,
			this.plugin,
			oldPath,
			docsDir,
			(result) => {
				new Notice(`文档路径已修改为: ${result.newPath}`);
				this.renderPanel();
			}
		).open();
	}

	async editPublishId() {
		if (!this.currentFile || !this._publishInfo) return;
		const currentId = this._publishInfo.publishId || '';
		const newId = await new Promise<string | null>((resolve) => {
			const modal = new Modal(this.plugin.app);
			modal.titleEl.setText('修改发布ID');
			modal.contentEl.createEl('p', { text: '发布ID用于唯一标识文档，修改后可能影响发布状态匹配。' });
			const input = modal.contentEl.createEl('input', {
				type: 'text',
				cls: 'sillot-doc-sync-panel-publish-id-input',
				attr: { value: currentId, placeholder: 'pub_YYYYMMDD_xxxxxx' },
			}) as HTMLInputElement;
			input.style.width = '100%';
			input.style.marginTop = '8px';
			const warnEl = modal.contentEl.createEl('p', {
				text: '⚠️ 修改发布ID可能导致文档与已发布版本失去关联',
				cls: 'sillot-doc-sync-panel-publish-id-warn',
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
			const btnContainer = modal.contentEl.createDiv({ cls: 'sillot-doc-sync-panel-publish-id-btns' });
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
			this._publishInfo.publishId = newId;
			if (this.vueApp) this.vueApp.forceUpdate();
			new Notice(`发布ID已更新为: ${newId}`);
		} catch (e) {
			new Notice(`更新发布ID失败: ${e.message}`);
		}
	}

	async generatePublishId() {
		if (!this.currentFile) return;
		try {
			const content = await this.plugin.app.vault.read(this.currentFile);
			const newId = generatePublishId();
			const newContent = setPublishIdInContent(content, newId);
			await this.plugin.app.vault.modify(this.currentFile, newContent);
			if (this._publishInfo) {
				this._publishInfo.publishId = newId;
			}
			if (this.vueApp) this.vueApp.forceUpdate();
			new Notice(`已生成发布ID: ${newId}`);
		} catch (e) {
			new Notice(`生成发布ID失败: ${e.message}`);
		}
	}

	async rollbackToPublishedVersion() {
		if (!this.currentFile || !this._diffResult) return;
		const diff = this._diffResult;
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

	copyDiffAsMarkdown() {
		const diff = this._diffResult;
		if (!diff) return;
		const contextRadius = 3;
		const showLines = this.computeVisibleDiffLines(diff, contextRadius);
		const lines: string[] = [];
		const sourceLabel = diff.compareSource === 'local' ? '本地' : '云端';
		lines.push('```diff');
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

	async recomputeDiff() {
		if (!this.currentFile) return;
		const checker = this.plugin.publishStatusChecker;
		if (!checker) return;
		const previousSource = this._compareSource;
		try {
			this._diffResult = await checker.computeDiff(this.currentFile, this._compareSource);
			if (this._diffResult) {
				this._compareSource = this._diffResult.compareSource;
				if (this._diffResult.fallback) {
					const originalLabel = previousSource === 'local' ? '本地' : '云端';
					new Notice(`${originalLabel}对比源不可用，已回退`, 3000);
				}
			} else {
				new Notice('无法获取对比版本内容', 3000);
			}
		} catch (e) {
			this._diffResult = null;
			new Notice(`对比失败：${e.message}`, 4000);
		}
		if (this.vueApp) {
			this.vueApp.forceUpdate();
		}
	}

	removeAuthor(index: number) {
		if (!this.currentFile) return;
		const currentAuthors = this.getCurrentAuthors();
		if (index < 0 || index >= currentAuthors.length) return;
		const removed = currentAuthors[index];
		const newAuthors = currentAuthors.filter((_, i) => i !== index);
		this.updateFrontmatterAuthors(newAuthors).then(() => {
			new Notice(`已移除作者：${removed.name}`);
			this.renderPanel();
		});
	}

	openAddAuthorModal() {}

	addAuthor(author: { name: string; slug: string; avatar?: string; verified?: boolean }) {
		if (!this.currentFile) return;
		const currentAuthors = this.getCurrentAuthors();
		const newAuthors = [...currentAuthors, author];
		this.updateFrontmatterAuthors(newAuthors).then(() => {
			new Notice(`已添加作者：${author.name}`);
			this.renderPanel();
		});
	}

	jumpToLine(line: number, ch: number) {
		const activeLeaf = this.plugin.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) return;
		const markdownView = activeLeaf.view;
		const state = markdownView.getState();
		if (state.mode !== 'source' || !state.source) {
			markdownView.setState(
				{ ...state, mode: 'source', source: true },
				{ history: false }
			);
			setTimeout(() => {
				const editor = markdownView.editor;
				editor.setCursor({ line, ch });
				editor.focus();
			}, 50);
		} else {
			const editor = markdownView.editor;
			editor.setCursor({ line, ch });
			editor.focus();
		}
	}

	removeSyncBlock(block: ParsedSyncBlock) {
		if (!this.currentFile) return;
		this.plugin.app.vault.read(this.currentFile).then(fileContent => {
			const newContent = fileContent.replace(block.fullMatch, '');
			this.plugin.app.vault.modify(this.currentFile!, newContent).then(() => {
				new Notice(`已删除 ${block.syncId}`);
				this.renderPanel();
			});
		});
	}

	copySyncBlockContent(content: string) {
		navigator.clipboard.writeText(content);
		new Notice('已复制内容', 1500);
	}

	editSyncBlock(block: ParsedSyncBlock) { this.openBlockForEdit(block); }

	refreshPanel() { this.renderPanel(); }

	loadAvailableAuthors(): Promise<Array<{ name: string; slug: string; avatar?: string; verified?: boolean }>> {
		try {
			const bridgeAuthors = this.plugin.bridgeManager.getAssets().authors?.authors;
			if (bridgeAuthors) {
				return Promise.resolve(Object.values(bridgeAuthors).map(a => ({
					name: a.name,
					slug: a.slug,
					avatar: a.avatar,
					verified: a.verified,
				})));
			}
			const vpRoot = this.plugin.settings.localVuePressRoot;
			if (!vpRoot) return Promise.resolve([]);
			const sep = vpRoot.includes('\\') ? '\\' : '/';
			const authorDataPath = `${vpRoot}${sep}docs${sep}.vuepress${sep}.temp${sep}author-data.ts`;
			const { readFileSync, existsSync } = require('fs') as typeof import('fs');
			if (!existsSync(authorDataPath)) return Promise.resolve([]);
			const content = readFileSync(authorDataPath, 'utf-8');
			const match = content.match(/export\s+default\s+(\{[\s\S]*\})\s+as\s+Record/);
			if (!match) return Promise.resolve([]);
			const jsonStr = match[1];
			const data = JSON.parse(jsonStr) as Record<string, { name: string; slug: string; avatar?: string; verified?: boolean; posts?: unknown[] }>;
			return Promise.resolve(Object.values(data).map(a => ({
				name: a.name,
				slug: a.slug,
				avatar: a.avatar,
				verified: a.verified,
			})));
		} catch (e) {
			console.error('加载作者列表失败', e);
			return Promise.resolve([]);
		}
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
