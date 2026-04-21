import { ItemView, WorkspaceLeaf, Notice, Modal, App, Setting, MarkdownView, EditorPosition } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { PluginSyncInfo } from '../types';
import { PaginationBar } from './PaginationBar';

export const VIEW_TYPE_PLUGIN_SYNC = 'vuepress-publisher-sync-view';

type SortField = 'sync_id' | 'updated_at';
type SortDir = 'asc' | 'desc';

const SYNC_SEARCH_COLUMNS = [
	{ key: 'sync_id', label: 'ID' },
	{ key: 'sync_type', label: '类型' },
	{ key: 'description', label: '描述' },
	{ key: 'category', label: '分类' },
];

export class PluginSyncView extends ItemView {
	plugin: VuePressPublisherPlugin;
	private list: PluginSyncInfo[] = [];
	private lastMarkdownView: MarkdownView | null = null;
	private lastCursor: EditorPosition = { line: 0, ch: 0 };

	private sortField: SortField = 'updated_at';
	private sortDir: SortDir = 'desc';
	private paginationBar: PaginationBar;

	constructor(leaf: WorkspaceLeaf, plugin: VuePressPublisherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.paginationBar = new PaginationBar({
			columns: SYNC_SEARCH_COLUMNS,
			onChange: () => this.reRender(),
		});
	}

	getViewType() { return VIEW_TYPE_PLUGIN_SYNC; }
	getDisplayText() { return '同步管理'; }
	getIcon() { return 'refresh-cw'; }

	async onOpen() {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.lastMarkdownView = leaf.view;
				}
			})
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (view instanceof MarkdownView) {
					this.lastMarkdownView = view;
					this.lastCursor = editor.getCursor();
				}
			})
		);
		this.lastMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		await this.refresh();
	}

	async refresh() {
		const container = this.contentEl;
		container.empty();

		const headerRow = container.createDiv({ cls: 'sillot-panel-header' });
		headerRow.createEl('h4', { text: '插件级同步块' });
		const closeBtn = headerRow.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => { this.leaf.detach(); };

		const toolbar = container.createDiv({ cls: 'sillot-sync-toolbar' });
		toolbar.createEl('button', { text: '刷新' }).onclick = () => this.refresh();
		toolbar.createEl('button', { text: '新建' }).onclick = () => this.showCreateModal();
		toolbar.createEl('button', { text: '同步所有文档' }).onclick = () => this.syncAllDocuments();
		toolbar.createEl('button', { text: '测试连接' }).onclick = () => this.testConnection();
		toolbar.createEl('button', { text: '初始化表' }).onclick = () => this.initTables();

		const batchBar = container.createDiv({ cls: 'sillot-sync-batch-bar' });
		batchBar.createEl('button', { text: '☑ 反选', cls: 'sillot-sync-batch-btn' }).onclick = () => this.invertSelection();
		batchBar.createEl('button', { text: '🗑 删除选中', cls: 'sillot-sync-batch-btn sillot-sync-batch-btn--danger' }).onclick = () => this.deleteSelected();
		batchBar.createEl('button', { text: '🔄 同步选中', cls: 'sillot-sync-batch-btn' }).onclick = () => this.syncSelected();

		const statusEl = container.createDiv({ cls: 'sillot-sync-status' });
		const webhookUrl = this.plugin.settings.kdocsWebhookUrl;
		if (!webhookUrl) {
			statusEl.createEl('p', { text: '⚠️ 未配置金山文档 Webhook URL，请在插件设置中配置。', cls: 'sillot-sync-warn' });
			return;
		}

		if (!this.plugin.syncManager) {
			return;
		}

		this.renderSortControls(container);
		this.renderTable(container);

		const cachedList = this.plugin.syncCache.list;
		if (cachedList.length > 0) {
			this.list = cachedList;
		}

		this.refreshFromCloud();
	}

	private renderSortControls(container: HTMLElement) {
		const sortBar = container.createDiv({ cls: 'sillot-sync-sort-bar' });
		sortBar.createEl('span', { text: '排序：', cls: 'sillot-sync-sort-label' });

		const fieldBtn = sortBar.createEl('button', {
			text: this.sortField === 'sync_id' ? '按 ID' : '按更新时间',
			cls: 'sillot-sync-sort-btn',
		});
		fieldBtn.onclick = () => {
			this.sortField = this.sortField === 'sync_id' ? 'updated_at' : 'sync_id';
			this.paginationBar.resetPage();
			this.reRender();
		};

		const dirBtn = sortBar.createEl('button', {
			text: this.sortDir === 'asc' ? '↑ 升序' : '↓ 降序',
			cls: 'sillot-sync-sort-btn',
		});
		dirBtn.onclick = () => {
			this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
			this.paginationBar.resetPage();
			this.reRender();
		};
	}

	private getSortedList(): PluginSyncInfo[] {
		const sorted = [...this.list];
		sorted.sort((a, b) => {
			let cmp = 0;
			if (this.sortField === 'sync_id') {
				cmp = a.sync_id.localeCompare(b.sync_id);
			} else {
				cmp = (a.updated_at || '').localeCompare(b.updated_at || '');
			}
			return this.sortDir === 'asc' ? cmp : -cmp;
		});
		return sorted;
	}

	private getFilteredSortedList(): PluginSyncInfo[] {
		const sorted = this.getSortedList();
		const state = this.paginationBar.getState();
		if (!state.searchQuery) return sorted;
		return PaginationBar.filterBySearch(sorted, state.searchQuery, state.searchColumns, (item, col) => {
			switch (col) {
				case 'sync_id': return item.sync_id;
				case 'sync_type': return item.sync_type;
				case 'description': return item.description || '';
				case 'category': return item.category || '';
				default: return '';
			}
		});
	}

	private renderTable(container: HTMLElement) {
		const wrapper = container.createDiv({ cls: 'sillot-sync-table-wrapper' });
		const table = wrapper.createEl('table', { cls: 'sillot-sync-table' });
		const thead = table.createEl('thead');
		thead.createEl('tr').innerHTML = '<th>☑</th><th>ID</th><th>类型</th><th>描述</th><th>分类</th><th>操作</th>';
		const tbody = table.createEl('tbody', { cls: 'sillot-sync-tbody' });

		const filtered = this.getFilteredSortedList();
		const state = this.paginationBar.getState();
		const { pageItems, totalPages } = PaginationBar.paginate(filtered, state.currentPage, state.pageSize);
		if (state.currentPage > totalPages) {
			this.paginationBar.setPage(totalPages);
		}

		if (pageItems.length === 0) {
			tbody.createEl('tr').createEl('td', { text: '暂无同步块，点击"新建"创建', attr: { colspan: '6' } });
		} else {
			for (const item of pageItems) {
				const row = tbody.createEl('tr');
				row.dataset.syncId = item.sync_id;

				const checkCell = row.createEl('td');
				checkCell.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;

				row.createEl('td', { text: item.sync_id });
				row.createEl('td', { text: item.sync_type });
				row.createEl('td', { text: item.description || '-' });
				row.createEl('td', { text: item.category || '-' });
				const actions = row.createEl('td', { cls: 'sillot-sync-actions' });
				actions.createEl('button', { text: '插入', cls: 'sillot-sync-action-btn' }).onclick = () => this.insertSyncPlaceholder(item);
				actions.createEl('button', { text: '复制', cls: 'sillot-sync-action-btn' }).onclick = () => this.copySyncContent(item);
				actions.createEl('button', { text: '编辑', cls: 'sillot-sync-action-btn' }).onclick = () => this.showEditModal(item);
			}
		}

		const paginationContainer = wrapper.createDiv({ cls: 'sillot-sync-pagination' });
		this.paginationBar.render(paginationContainer, filtered.length);
	}

	private reRender() {
		const container = this.contentEl;
		const tableWrapper = container.querySelector('.sillot-sync-table-wrapper');
		if (tableWrapper) tableWrapper.remove();
		const sortBar = container.querySelector('.sillot-sync-sort-bar');
		if (sortBar) sortBar.remove();
		this.renderSortControls(container);
		this.renderTable(container);
	}

	private getSelectedSyncIds(): string[] {
		const checkboxes = this.contentEl.querySelectorAll('.sillot-sync-table input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
		const ids: string[] = [];
		checkboxes.forEach((cb) => {
			if (cb.checked) {
				const row = cb.closest('tr');
				const syncId = row?.dataset.syncId;
				if (syncId) ids.push(syncId);
			}
		});
		return ids;
	}

	private invertSelection() {
		const checkboxes = this.contentEl.querySelectorAll('.sillot-sync-table input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
		checkboxes.forEach((cb) => { cb.checked = !cb.checked; });
	}

	private async deleteSelected() {
		const ids = this.getSelectedSyncIds();
		if (ids.length === 0) {
			new Notice('请先选择要删除的同步块');
			return;
		}
		if (!this.plugin.syncManager) return;
		let success = 0;
		let failed = 0;
		for (const id of ids) {
			try {
				const res = await this.plugin.syncManager.deletePluginSync(id);
				if (res.success) success++;
				else failed++;
			} catch {
				failed++;
			}
		}
		new Notice(`删除完成：成功 ${success}，失败 ${failed}`);
		await this.refresh();
	}

	private async syncSelected() {
		const ids = this.getSelectedSyncIds();
		if (ids.length === 0) {
			new Notice('请先选择要同步的同步块');
			return;
		}
		if (!this.plugin.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		const notice = new Notice(`正在同步 ${ids.length} 个同步块...`, 0);
		let total = 0;
		try {
			for (const id of ids) {
				const item = this.list.find(i => i.sync_id === id);
				if (item) {
					const res = await this.plugin.syncManager!.createOrUpdatePluginSync(item);
					if (res.success) total++;
				}
			}
			notice.hide();
			new Notice(`✅ 同步完成：${total} 项`);
		} catch (error) {
			notice.hide();
			new Notice(`❌ 同步失败: ${error.message || error}`);
		}
	}

	private async copySyncContent(item: PluginSyncInfo) {
		let content = item.sync_content || '';
		if (!content) {
			const cached = this.plugin.syncCache.content[item.sync_id];
			if (cached) {
				content = cached.sync_content;
			} else if (this.plugin.syncManager) {
				try {
					const res = await this.plugin.syncManager.client.getPluginSync(item.sync_id);
					if (res.success && res.data) {
						content = res.data.sync_content || '';
					}
				} catch {}
			}
		}
		if (content) {
			await navigator.clipboard.writeText(content);
			new Notice('已复制内容', 1500);
		} else {
			new Notice('内容为空', 1500);
		}
	}

	private async refreshFromCloud() {
		try {
			const res = await this.plugin.syncManager!.getPluginSyncList();
			if (res.success) {
				this.list = res.data || [];
				this.plugin.updateSyncListCache(this.list);
				this.reRender();
			}
		} catch {}
	}

	async testConnection() {
		if (!this.plugin.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		new Notice('正在测试连接...', 2000);
		try {
			const result = await this.plugin.syncManager.healthCheck();
			if (result.ok) {
				new Notice(`✅ ${result.detail}`, 5000);
			} else {
				new Notice(`❌ ${result.detail}`, 8000);
			}
		} catch (error) {
			new Notice(`❌ 连接异常: ${error.message || error}`, 8000);
		}
	}

	async initTables() {
		if (!this.plugin.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		new Notice('正在初始化数据表...', 2000);
		try {
			const res = await this.plugin.syncManager.client.initTables();
			if (res.success) {
				const created = res.created || [];
				if (created.length > 0) {
					new Notice(`✅ 已创建表: ${created.join(', ')}`, 5000);
				} else {
					new Notice('✅ 所有表已存在，无需创建。', 3000);
				}
				await this.refresh();
			} else {
				new Notice(`❌ 初始化失败: ${res.error || '未知错误'}`, 8000);
			}
		} catch (error) {
			const msg = error.message || error;
			if (msg.includes('undefined') && msg.includes('CreateFields')) {
				new Notice('❌ 初始化失败：请确认使用的是「多维表」文档，而非智能表格。', 8000);
			} else {
				new Notice(`❌ 初始化失败: ${msg}`, 8000);
			}
		}
	}

	insertSyncPlaceholder(item: PluginSyncInfo) {
		const view = this.lastMarkdownView || this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice('请先打开一个笔记编辑器');
			return;
		}
		const editor = view.editor;
		const placeholder = item.sync_type === 'codeblock'
			? `\`\`\`sync-global\n${item.sync_id}\n\`\`\``
			: `\`sync-global:${item.sync_id}\``;
		const cursor = editor.getCursor();
		const from = { line: cursor.line, ch: cursor.ch };
		editor.replaceRange(placeholder, from);
		const lines = placeholder.split('\n');
		const endLine = from.line + lines.length - 1;
		const endCh = lines.length === 1 ? from.ch + lines[0].length : lines[lines.length - 1].length;
		editor.setCursor({ line: endLine, ch: endCh });
		this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
		new Notice(`✅ 已插入 ${item.sync_id}`, 2000);
	}

	showCreateModal() {
		if (!this.plugin.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		const modal = new SyncEditModal(this.app, '', 'inline', '', '', '', async (data) => {
			if (!data.sync_id || data.sync_id.trim() === '') {
				new Notice('Sync ID 不能为空');
				return;
			}
			try {
				const res = await this.plugin.syncManager!.createOrUpdatePluginSync(data);
				if (res.success) {
					new Notice(`✅ 已创建 ${data.sync_id}`);
					await this.refresh();
				} else {
					new Notice(`❌ 创建失败: ${res.error || '未知错误'}`);
				}
			} catch (error) {
				new Notice(`❌ 创建失败: ${error.message || error}`);
			}
		});
		modal.open();
	}

	async showEditModal(item: PluginSyncInfo) {
		let syncContent = item.sync_content || '';
		if (!syncContent) {
			const cached = this.plugin.syncCache.content[item.sync_id];
			if (cached) {
				syncContent = cached.sync_content;
			} else if (this.plugin.syncManager) {
				try {
					const res = await this.plugin.syncManager.client.getPluginSync(item.sync_id);
					if (res.success && res.data) {
						syncContent = res.data.sync_content || '';
					}
				} catch {}
			}
		}
		const modal = new SyncEditModal(this.app, item.sync_id, item.sync_type, syncContent, item.description, item.category, async (data) => {
			try {
				const res = await this.plugin.syncManager!.createOrUpdatePluginSync(data);
				if (res.success) {
					new Notice(`✅ 已更新 ${data.sync_id}`);
					await this.refresh();
				} else {
					new Notice(`❌ 更新失败: ${res.error || '未知错误'}`);
				}
			} catch (error) {
				new Notice(`❌ 更新失败: ${error.message || error}`);
			}
		});
		modal.open();
	}

	async deleteSync(syncId: string) {
		if (!this.plugin.syncManager) return;
		try {
			const res = await this.plugin.syncManager.deletePluginSync(syncId);
			if (res.success) {
				new Notice(`✅ 已删除 ${syncId}`);
				await this.refresh();
			} else {
				new Notice(`❌ 删除失败: ${res.error || '未知错误'}`);
			}
		} catch (error) {
			new Notice(`❌ 删除失败: ${error.message || error}`);
		}
	}

	async syncAllDocuments() {
		if (!this.plugin.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		const files = this.app.vault.getMarkdownFiles();
		const notice = new Notice('同步中...', 0);
		let total = 0;
		try {
			for (const file of files) {
				const res = await this.plugin.syncManager.syncFile(file);
				total += res.synced;
			}
			notice.hide();
			new Notice(`✅ 同步完成：${total} 项`);
		} catch (error) {
			notice.hide();
			new Notice(`❌ 同步失败: ${error.message || error}`);
		}
	}

	async onClose() {}
}

class SyncEditModal extends Modal {
	private syncId: string;
	private syncType: string;
	private syncContent: string;
	private description: string;
	private category: string;

	constructor(
		app: App,
		syncId: string,
		syncType: string,
		syncContent: string,
		description: string,
		category: string,
		private onSubmit: (data: { sync_id: string; sync_type: 'inline' | 'codeblock'; sync_content: string; description?: string; category?: string }) => Promise<void>,
	) {
		super(app);
		this.syncId = syncId;
		this.syncType = syncType;
		this.syncContent = syncContent;
		this.description = description;
		this.category = category;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.syncId ? '编辑同步块' : '新建同步块' });

		new Setting(contentEl)
			.setName('Sync ID')
			.setDesc('全局唯一标识符，如 site-footer')
			.addText(text => text
				.setValue(this.syncId)
				.setPlaceholder('例如 site-footer')
				.onChange(v => this.syncId = v));

		new Setting(contentEl)
			.setName('同步类型')
			.addDropdown(dropdown => dropdown
				.addOptions({ inline: '行内 (inline)', codeblock: '代码块 (codeblock)' })
				.setValue(this.syncType)
				.onChange(v => this.syncType = v));

		new Setting(contentEl)
			.setName('描述')
			.addText(text => text
				.setValue(this.description)
				.setPlaceholder('描述此同步块的用途')
				.onChange(v => this.description = v));

		new Setting(contentEl)
			.setName('分类')
			.addText(text => text
				.setValue(this.category)
				.setPlaceholder('分类标签')
				.onChange(v => this.category = v));

		new Setting(contentEl)
			.setName('同步内容')
			.addTextArea(text => text
				.setValue(this.syncContent)
				.setPlaceholder('输入要同步的内容')
				.onChange(v => this.syncContent = v));

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('保存')
				.setCta()
				.onClick(() => {
					if (!this.syncId || this.syncId.trim() === '') {
						new Notice('Sync ID 不能为空');
						return;
					}
					this.close();
					this.onSubmit({
						sync_id: this.syncId.trim(),
						sync_type: this.syncType as 'inline' | 'codeblock',
						sync_content: this.syncContent,
						description: this.description,
						category: this.category,
					});
				}));
	}

	onClose() {
		this.contentEl.empty();
	}
}
