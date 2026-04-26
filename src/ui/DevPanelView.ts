import { ItemView, WorkspaceLeaf, Notice, Modal, App, Setting, TFile } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import { PaginationBar, type SearchColumn } from './PaginationBar';

export const VIEW_TYPE_DEV_PANEL = 'sillot-dev-panel';

type DevTab = 'overview' | 'network' | 'cache' | 'bridge' | 'logs' | 'vault';

const CACHE_SEARCH_COLUMNS: SearchColumn[] = [
	{ key: 'sync_id', label: 'ID' },
	{ key: 'sync_type', label: '类型' },
	{ key: 'description', label: '描述' },
	{ key: 'category', label: '分类' },
];

const VAULT_SEARCH_COLUMNS: SearchColumn[] = [
	{ key: 'path', label: '路径' },
	{ key: 'size', label: '大小' },
];

const PATHMAP_SEARCH_COLUMNS: SearchColumn[] = [
	{ key: 'vuepressPath', label: 'VuePress 路径' },
	{ key: 'sourceRelPath', label: '源文件路径' },
	{ key: 'title', label: '标题' },
];

const PUBLISH_STATUS_SEARCH_COLUMNS: SearchColumn[] = [
	{ key: 'filePath', label: '源文件路径' },
	{ key: 'publishId', label: '发布ID' },
];

interface LogEntry {
	timestamp: string;
	level: 'info' | 'warn' | 'error';
	message: string;
	detail?: string;
}

export class DevPanelView extends ItemView {
	plugin: VuePressPublisherPlugin;
	private currentTab: DevTab = 'overview';
	private logs: LogEntry[] = [];
	private maxLogs = 200;
	private pluginLogFilter: Set<string> = new Set(['error', 'warn', 'info', 'debug', 'banner']);
	private kdocsLastResult: { action: string; result: any; elapsed: number } | null = null;
	private cachePagination: PaginationBar;
	private vaultPagination: PaginationBar;
	private pathMapPagination: PaginationBar;
	private publishStatusPagination: PaginationBar;
	private cachedLogContent: string | null = null;
	private cachedLogLines: string[] = [];
	private logPath = '.obsidian/plugins/sillot/log/sillot.log';
	private maxLogDisplayLines = 500;

	constructor(leaf: WorkspaceLeaf, plugin: VuePressPublisherPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.cachePagination = new PaginationBar({
			columns: CACHE_SEARCH_COLUMNS,
			onChange: () => this.renderTabContent(),
		});
		this.vaultPagination = new PaginationBar({
			columns: VAULT_SEARCH_COLUMNS,
			onChange: () => this.renderTabContent(),
		});
		this.pathMapPagination = new PaginationBar({
			columns: PATHMAP_SEARCH_COLUMNS,
			onChange: () => this.renderTabContent(),
		});
		this.publishStatusPagination = new PaginationBar({
			columns: PUBLISH_STATUS_SEARCH_COLUMNS,
			onChange: () => this.renderTabContent(),
		});
	}

	getViewType() { return VIEW_TYPE_DEV_PANEL; }
	getDisplayText() { return 'DevPanel'; }
	getIcon() { return 'bug'; }

	async onOpen() {
		this.render();
	}

	async onClose() {
	}

	private render() {
		const container = this.contentEl;
		container.empty();
		container.addClass('sillot-dev-panel');

		const header = container.createDiv({ cls: 'sillot-panel-header' });
		header.createEl('h4', { text: '🔧 DevPanel' });
		const refreshBtn = header.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '刷新面板' } });
		refreshBtn.innerHTML = '🔄';
		refreshBtn.style.marginRight = '4px';
		refreshBtn.onclick = () => { this.renderTabContent(); };
		const closeBtn = header.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => { this.leaf.detach(); };

		const tabBar = container.createDiv({ cls: 'sillot-dev-tabs' });
		const tabs: { key: DevTab; label: string; icon: string }[] = [
			{ key: 'overview', label: '概览', icon: '📊' },
			{ key: 'network', label: '调试', icon: '🔧' },
			{ key: 'cache', label: '缓存', icon: '💾' },
			{ key: 'bridge', label: 'Bridge', icon: '🌉' },
			{ key: 'logs', label: '日志', icon: '📋' },
			{ key: 'vault', label: 'Vault', icon: '📁' },
		];
		for (const tab of tabs) {
			const btn = tabBar.createEl('button', {
				text: `${tab.icon} ${tab.label}`,
				cls: this.currentTab === tab.key ? 'sillot-dev-tab sillot-dev-tab--active' : 'sillot-dev-tab',
			});
			btn.onclick = () => {
				this.currentTab = tab.key;
				this.render();
			};
		}

		this.renderTabContent();
	}

	private renderTabContent() {
		const container = this.contentEl;
		const existing = container.querySelector('.sillot-dev-content');
		if (existing) existing.remove();

		const content = container.createDiv({ cls: 'sillot-dev-content' });

		switch (this.currentTab) {
			case 'overview': this.renderOverview(content); break;
			case 'network': this.renderNetwork(content); break;
			case 'cache': this.renderCache(content); break;
			case 'bridge': this.renderBridge(content); break;
			case 'logs': this.renderLogs(content); break;
			case 'vault': this.renderVault(content); break;
		}
	}

	private renderOverview(container: HTMLElement) {
		const s = this.plugin.settings;
		const syncMgr = this.plugin.syncManager;
		const cache = this.plugin.syncCache;

		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: '插件状态' });

		const statusList = card.createDiv({ cls: 'sillot-dev-status-list' });
		this.addStatusItem(statusList, '插件版本', (this.plugin.app as any).plugins?.manifests?.['sillot']?.version || 'dev', 'info');
		this.addStatusItem(statusList, 'SyncManager', syncMgr ? '✅ 已初始化' : '❌ 未配置', syncMgr ? 'ok' : 'error');
		this.addStatusItem(statusList, 'GitHub Token', s.githubToken ? `✅ 已配置 (${s.githubToken.substring(0, 8)}...)` : '❌ 未配置', s.githubToken ? 'ok' : 'error');
		this.addStatusItem(statusList, 'GitHub Repo', s.githubRepo || '❌ 未配置', s.githubRepo ? 'ok' : 'error');
		this.addStatusItem(statusList, 'KDocs Webhook', s.kdocsWebhookUrl ? `✅ 已配置` : '❌ 未配置', s.kdocsWebhookUrl ? 'ok' : 'error');
		this.addStatusItem(statusList, 'AirScript Token', s.airscriptToken ? `✅ 已配置` : '❌ 未配置', s.airscriptToken ? 'ok' : 'error');
		this.addStatusItem(statusList, '默认分支', s.defaultBranch, 'info');
		this.addStatusItem(statusList, '文档面板形态', s.docSyncPanelState, 'info');
		this.addStatusItem(statusList, '平台', (this.plugin.app as any).isMobile ? '📱 Mobile' : '🖥️ Desktop', 'info');

		const pathCard = container.createDiv({ cls: 'sillot-dev-card' });
		pathCard.createEl('h5', { text: '本地路径' });
		const pathList = pathCard.createDiv({ cls: 'sillot-dev-status-list' });

		const vaultRoot = (this.plugin.app.vault.adapter as any).basePath || '';
		this.addStatusItem(pathList, 'Vault 根目录', vaultRoot || '未知（移动端）', vaultRoot ? 'ok' : 'warn');

		const pluginDir = vaultRoot ? `${vaultRoot}.obsidian${vaultRoot.endsWith('\\') ? '' : '\\'}plugins${vaultRoot.endsWith('\\') ? '' : '\\'}sillot` : '';
		this.addStatusItem(pathList, '插件目录', pluginDir || '未知', pluginDir ? 'ok' : 'warn');

		const configFile = vaultRoot ? `${pluginDir}${vaultRoot.endsWith('\\') ? '' : '\\'}data.json` : '';
		this.addStatusItem(pathList, '插件配置文件', configFile || '未知', configFile ? 'ok' : 'warn');

		const manifestFile = vaultRoot ? `${pluginDir}${vaultRoot.endsWith('\\') ? '' : '\\'}manifest.json` : '';
		this.addStatusItem(pathList, 'manifest.json', manifestFile || '未知', manifestFile ? 'ok' : 'warn');

		const activeFile = this.plugin.app.workspace.getActiveFile();
		const activeFilePath = activeFile ? (vaultRoot ? `${vaultRoot}${activeFile.path}` : activeFile.path) : '无打开文件';
		this.addStatusItem(pathList, '当前文件', activeFilePath, activeFile ? 'ok' : 'warn');

		const projectRoot = s.localVuePressRoot || '';
		this.addStatusItem(pathList, 'VuePress 站点目录', projectRoot || '未配置（请在设置中填写）', projectRoot ? 'ok' : 'warn');

		const pathActions = pathCard.createDiv({ cls: 'sillot-dev-actions' });
		pathActions.createEl('button', { text: '📋 复制 Vault 路径', cls: 'sillot-dev-btn' }).onclick = () => {
			if (vaultRoot) {
				navigator.clipboard.writeText(vaultRoot);
				new Notice('已复制 Vault 根路径');
			} else {
				new Notice('无法获取 Vault 路径（移动端）');
			}
		};
		pathActions.createEl('button', { text: '📋 复制插件路径', cls: 'sillot-dev-btn' }).onclick = () => {
			if (pluginDir) {
				navigator.clipboard.writeText(pluginDir);
				new Notice('已复制插件目录路径');
			} else {
				new Notice('无法获取插件路径');
			}
		};
		pathActions.createEl('button', { text: '📋 复制当前文件路径', cls: 'sillot-dev-btn' }).onclick = () => {
			if (activeFile) {
				const fullPath = vaultRoot ? `${vaultRoot}${activeFile.path}` : activeFile.path;
				navigator.clipboard.writeText(fullPath);
				new Notice('已复制当前文件绝对路径');
			} else {
				new Notice('无打开文件');
			}
		};
		pathActions.createEl('button', { text: '📋 复制站点路径', cls: 'sillot-dev-btn' }).onclick = () => {
			if (projectRoot) {
				navigator.clipboard.writeText(projectRoot);
				new Notice('已复制 VuePress 站点路径');
			} else {
				new Notice('未配置 VuePress 站点路径');
			}
		};

		const cacheCard = container.createDiv({ cls: 'sillot-dev-card' });
		cacheCard.createEl('h5', { text: '缓存统计' });
		const cacheList = cacheCard.createDiv({ cls: 'sillot-dev-status-list' });
		this.addStatusItem(cacheList, '同步块列表', `${cache.list.length} 条`, 'info');
		this.addStatusItem(cacheList, '内容缓存', `${Object.keys(cache.content).length} 条`, 'info');
		const inlineCount = cache.list.filter(i => i.sync_type === 'inline').length;
		const codeblockCount = cache.list.filter(i => i.sync_type === 'codeblock').length;
		this.addStatusItem(cacheList, '行内 / 代码块', `${inlineCount} / ${codeblockCount}`, 'info');

		const actionCard = container.createDiv({ cls: 'sillot-dev-card' });
		actionCard.createEl('h5', { text: '快捷操作' });
		const actions = actionCard.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🔄 刷新全部', cls: 'sillot-dev-btn' }).onclick = () => this.render();
		actions.createEl('button', { text: '🗑️ 清空缓存', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = () => {
			this.plugin.syncCache = { list: [], content: {} };
			this.plugin.saveSettings();
			new Notice('缓存已清空');
			this.render();
		};
		actions.createEl('button', { text: '📋 导出诊断信息', cls: 'sillot-dev-btn' }).onclick = () => this.exportDiagnostics();
		actions.createEl('button', { text: '🧪 测试连接', cls: 'sillot-dev-btn' }).onclick = () => this.runConnectionTest();
		actions.createEl('button', { text: '📊 解析当前文档', cls: 'sillot-dev-btn' }).onclick = () => this.parseCurrentDoc();
	}

	private renderNetwork(container: HTMLElement) {
		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: '网络连通性检测' });

		const statusArea = card.createDiv({ cls: 'sillot-dev-network-status', attr: { id: 'sillot-network-status' } });
		statusArea.createEl('p', { text: '点击下方按钮开始检测...', cls: 'sillot-dev-hint' });

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🌐 检测全部', cls: 'sillot-dev-btn' }).onclick = () => this.checkAllNetwork(statusArea);
		actions.createEl('button', { text: '🐙 GitHub API', cls: 'sillot-dev-btn' }).onclick = () => this.checkGitHub(statusArea);
		actions.createEl('button', { text: '📄 站点域名', cls: 'sillot-dev-btn' }).onclick = () => this.checkSite(statusArea);
		actions.createEl('button', { text: '📊 KDocs', cls: 'sillot-dev-btn' }).onclick = () => this.checkKDocs(statusArea);

		const requestCard = container.createDiv({ cls: 'sillot-dev-card' });
		requestCard.createEl('h5', { text: 'API 请求测试' });
		const reqActions = requestCard.createDiv({ cls: 'sillot-dev-actions' });
		reqActions.createEl('button', { text: '📡 KDocs Ping', cls: 'sillot-dev-btn' }).onclick = async () => {
			if (!this.plugin.syncManager) { new Notice('未配置 SyncManager'); return; }
			this.addLog('info', 'KDocs Ping 请求发送');
			const start = Date.now();
			try {
				const res = await this.plugin.syncManager.client.ping();
				const elapsed = Date.now() - start;
				this.addLog(res.success ? 'info' : 'error', `KDocs Ping 响应 (${elapsed}ms)`, JSON.stringify(res));
				new Notice(`Ping ${res.success ? '成功' : '失败'} (${elapsed}ms)`);
			} catch (e) {
				this.addLog('error', `KDocs Ping 异常`, e.message);
				new Notice(`Ping 异常: ${e.message}`);
			}
		};
		reqActions.createEl('button', { text: '📡 KDocs 列表', cls: 'sillot-dev-btn' }).onclick = async () => {
			if (!this.plugin.syncManager) { new Notice('未配置 SyncManager'); return; }
			this.addLog('info', 'KDocs listPluginSyncs 请求发送');
			const start = Date.now();
			try {
				const res = await this.plugin.syncManager.getPluginSyncList();
				const elapsed = Date.now() - start;
				this.addLog(res.success ? 'info' : 'error', `listPluginSyncs 响应 (${elapsed}ms)`, `count=${Array.isArray(res.data) ? res.data.length : 0}`);
				new Notice(`列表 ${res.success ? '成功' : '失败'} (${elapsed}ms, ${Array.isArray(res.data) ? res.data.length : 0} 条)`);
			} catch (e) {
				this.addLog('error', `listPluginSyncs 异常`, e.message);
				new Notice(`列表异常: ${e.message}`);
			}
		};
		reqActions.createEl('button', { text: '📡 GitHub Rate', cls: 'sillot-dev-btn' }).onclick = async () => {
			const { githubToken } = this.plugin.settings;
			if (!githubToken) { new Notice('未配置 GitHub Token'); return; }
			try {
				const { requestUrl } = require('obsidian') as typeof import('obsidian');
				const res = await requestUrl({
					url: 'https://api.github.com/rate_limit',
					headers: { Authorization: `Bearer ${githubToken}` },
				});
				const data = res.json;
				const core = data.resources?.core;
				if (core) {
					this.addLog('info', 'GitHub Rate Limit', `剩余 ${core.remaining}/${core.limit}, 重置于 ${new Date(core.reset * 1000).toLocaleTimeString()}`);
					new Notice(`Rate: ${core.remaining}/${core.remaining === core.limit ? '未认证' : '已认证'}`);
				}
			} catch (e) {
				this.addLog('error', 'GitHub Rate Limit 检测失败', e.message);
				new Notice(`检测失败: ${e.message}`);
			}
		};

		this.renderTaskTrackerDemo(container);
		this.renderKDocsApiDemo(container);
	}

	private kdocsApiResultEl: HTMLElement | null = null;

	private renderKDocsApiDemo(container: HTMLElement) {
		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: '云文档 API (KSDrive)' });

		const hint = card.createEl('p', {
			text: '通过 AirScript Webhook 调用 KSDrive API，查看、修改和创建云文档。',
			cls: 'sillot-dev-hint'
		});

		const apiRef = card.createDiv({ cls: 'sillot-dev-kdocs-ref' });
		const methods = [
			{ name: 'KSDrive.openFile(url)', desc: '打开指定文档，返回 File 对象', params: 'url: 文档分享链接' },
			{ name: 'KSDrive.listFiles(opts)', desc: '列出目录下的表格文件', params: 'dirUrl, offset, count, includeExts' },
			{ name: 'KSDrive.createFile(type, opts)', desc: '创建或另存一个文件', params: 'type: FileType, name, dirUrl?, source?' },
		];
		for (const m of methods) {
			const row = apiRef.createDiv({ cls: 'sillot-dev-kdocs-ref-row' });
			row.createEl('code', { text: m.name });
			row.createSpan({ text: ` — ${m.desc}` });
			if (m.params) {
				row.createDiv({ cls: 'sillot-dev-kdocs-ref-params', text: `参数: ${m.params}` });
			}
		}

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });

		actions.createEl('button', { text: '📂 浏览云文档', cls: 'sillot-dev-btn' }).onclick = () => {
			this.showKDocsFileTreeModal();
		};

		actions.createEl('button', { text: '📄 打开文档', cls: 'sillot-dev-btn' }).onclick = () => {
			this.showKDocsOpenFileDialog();
		};

		actions.createEl('button', { text: '➕ 创建文件', cls: 'sillot-dev-btn' }).onclick = () => {
			this.showKDocsCreateFileDialog();
		};

		actions.createEl('button', { text: '📋 列出目录', cls: 'sillot-dev-btn' }).onclick = () => {
			this.showKDocsListDirDialog();
		};

		actions.createEl('button', { text: '📖 获取OVCP字典', cls: 'sillot-dev-btn' }).onclick = () => {
			this.showKDocsOvcpDictDialog();
		};

		const resultArea = card.createDiv({ cls: 'sillot-dev-kdocs-result' });
		if (this.kdocsLastResult) {
			this.renderKDocsResult(resultArea, this.kdocsLastResult.action, this.kdocsLastResult.result, this.kdocsLastResult.elapsed);
		} else {
			resultArea.createEl('p', { text: '点击上方按钮调用 API...', cls: 'sillot-dev-hint' });
		}
		this.kdocsApiResultEl = resultArea;
	}

	private showKDocsFileTreeModal() {
		const modal = new Modal(this.app);
		modal.titleEl.setText('📂 浏览云文档');

		const contentEl = modal.contentEl;
		contentEl.addClass('sillot-dev-kdocs-tree-modal');

		const toolbar = contentEl.createDiv({ cls: 'sillot-dev-kdocs-tree-toolbar' });
		toolbar.createEl('button', { text: '🔄 刷新', cls: 'sillot-dev-btn' }).onclick = () => loadRoot();

		const treeContainer = contentEl.createDiv({ cls: 'sillot-dev-kdocs-tree-container' });
		treeContainer.createEl('p', { text: '⏳ 加载云文档列表...', cls: 'sillot-dev-hint' });

		const loadDir = async (dirUrl?: string): Promise<any> => {
			if (!this.plugin.syncManager) {
				new Notice('未配置 SyncManager');
				return null;
			}
			const client = this.plugin.syncManager.client;
			const taskId = `kdocs-tree-${Date.now()}`;
			this.plugin.taskTracker.startTask(taskId, dirUrl ? '加载目录...' : '加载云文档...');

			const start = Date.now();
			try {
				const opts: any = { count: 100 };
				if (dirUrl) opts.dirUrl = dirUrl;
				const res = await client.call('ksdListFiles', opts);
				const elapsed = Date.now() - start;
				this.plugin.taskTracker.endTask(taskId);
				this.addLog('info', `ksdListFiles 响应 (${elapsed}ms)`, JSON.stringify(res).slice(0, 300));
				return res;
			} catch (e) {
				this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
				this.addLog('error', 'ksdListFiles 异常', e.message);
				return null;
			}
		};

		const renderFolder = (container: HTMLElement, f: any, depth: number) => {
			const row = container.createDiv({ cls: 'sillot-dev-kdocs-tree-row sillot-dev-kdocs-tree-row--folder' });
			row.style.paddingLeft = `${depth * 16 + 4}px`;

			const toggle = row.createEl('span', { cls: 'sillot-dev-kdocs-tree-toggle', text: '▸' });
			const icon = row.createSpan({ cls: 'sillot-dev-kdocs-tree-icon', text: '📁' });
			const label = row.createSpan({ cls: 'sillot-dev-kdocs-tree-label', text: f.fileName || '未命名文件夹' });
			const typeBadge = row.createSpan({ cls: 'sillot-dev-kdocs-tree-type', text: f.fileType });

			let expanded = false;
			let childrenEl: HTMLElement | null = null;
			let loaded = false;

			const doExpand = async () => {
				if (!childrenEl) {
					childrenEl = container.createDiv({ cls: 'sillot-dev-kdocs-tree-children' });
					childrenEl.style.display = 'none';
				}

				if (!loaded) {
					childrenEl.empty();
					childrenEl.style.display = '';
					childrenEl.createEl('p', { text: '⏳ 加载中...', cls: 'sillot-dev-hint', attr: { style: `padding-left: ${(depth + 1) * 16 + 4}px` } });

					const res = await loadDir(f.fileId);
					if (res && res.success !== false && res.data) {
						loaded = true;
						childrenEl.empty();
						const subFiles = res.data.files || [];
						const subFolders = subFiles.filter((sf: any) => sf.fileType === '文件夹');
						const subDocs = subFiles.filter((sf: any) => sf.fileType !== '文件夹');
						for (const sf of subFolders) {
							renderFolder(childrenEl, sf, depth + 1);
						}
						for (const sf of subDocs) {
							renderFile(childrenEl, sf, depth + 1);
						}
						if (subFiles.length === 0) {
							childrenEl.createEl('p', { text: '空文件夹', cls: 'sillot-dev-hint', attr: { style: `padding-left: ${(depth + 1) * 16 + 4}px` } });
						}
					} else {
						childrenEl.empty();
						childrenEl.createEl('p', { text: `❌ 加载失败: ${res?.error || '未知'}`, cls: 'sillot-dev-hint', attr: { style: `padding-left: ${(depth + 1) * 16 + 4}px` } });
					}
				}

				expanded = true;
				toggle.textContent = '▾';
				icon.textContent = '📂';
				if (childrenEl) childrenEl.style.display = '';
			};

			const doCollapse = () => {
				expanded = false;
				toggle.textContent = '▸';
				icon.textContent = '📁';
				if (childrenEl) childrenEl.style.display = 'none';
			};

			toggle.onclick = (e) => {
				e.stopPropagation();
				expanded ? doCollapse() : doExpand();
			};
			label.onclick = () => expanded ? doCollapse() : doExpand();
		};

		const renderFile = (container: HTMLElement, f: any, depth: number) => {
			const row = container.createDiv({ cls: 'sillot-dev-kdocs-tree-row sillot-dev-kdocs-tree-row--file' });
			row.style.paddingLeft = `${depth * 16 + 4}px`;

			row.createSpan({ cls: 'sillot-dev-kdocs-tree-toggle-spacer', text: ' ' });
			row.createSpan({ cls: 'sillot-dev-kdocs-tree-icon', text: this.getFileIcon(f.fileType) });
			const label = row.createSpan({ cls: 'sillot-dev-kdocs-tree-label', text: f.fileName || '未命名文件' });
			row.createSpan({ cls: 'sillot-dev-kdocs-tree-type', text: f.fileType });

			label.onclick = () => {
				this.callKDocsApi('ksdOpenFile', { url: f.fileId });
			};
		};

		const loadRoot = async () => {
			treeContainer.empty();
			treeContainer.createEl('p', { text: '⏳ 加载云文档列表...', cls: 'sillot-dev-hint' });

			const res = await loadDir();
			treeContainer.empty();
			if (res && res.success !== false && res.data) {
				const files = res.data.files || [];
				if (files.length === 0) {
					treeContainer.createEl('p', { text: '目录下没有文件', cls: 'sillot-dev-hint' });
					return;
				}
				const folders = files.filter((f: any) => f.fileType === '文件夹');
				const docs = files.filter((f: any) => f.fileType !== '文件夹');
				for (const f of folders) {
					renderFolder(treeContainer, f, 0);
				}
				for (const f of docs) {
					renderFile(treeContainer, f, 0);
				}
				if (res.data.nextOffset >= 0) {
					treeContainer.createDiv({ cls: 'sillot-dev-kdocs-tree-more', text: `还有更多文件 (偏移: ${res.data.nextOffset})` });
				}
			} else {
				treeContainer.createEl('p', { text: `❌ 加载失败: ${res?.error || '未知错误'}`, cls: 'sillot-dev-hint' });
			}
		};

		modal.open();
		loadRoot();
	}

	private getFileIcon(fileType: string): string {
		switch (fileType) {
			case '智能表格': return '📊';
			case 'WPS 表格': return '📈';
			case '多维表': return '📋';
			case '文档': return '📝';
			case '演示': return '📽️';
			case 'WPS 文字': return '📃';
			default: return '📄';
		}
	}

	private async callKDocsApi(action: string, data: any) {
		if (!this.plugin.syncManager) {
			new Notice('未配置 SyncManager');
			return;
		}
		const client = this.plugin.syncManager.client;
		const taskId = `kdocs-api-${Date.now()}`;
		this.plugin.taskTracker.startTask(taskId, `KSDrive.${action}...`);
		this.addLog('info', `KSDrive.${action}`, JSON.stringify(data));

		const resultEl = this.kdocsApiResultEl;
		if (resultEl) {
			resultEl.empty();
			resultEl.createEl('p', { text: `⏳ 调用 KSDrive.${action}...`, cls: 'sillot-dev-hint' });
		}

		const start = Date.now();
		try {
			const res = await client.call(action, data);
			const elapsed = Date.now() - start;
			this.plugin.taskTracker.endTask(taskId);
			this.addLog(res.success !== false ? 'info' : 'error', `KSDrive.${action} 响应 (${elapsed}ms)`, JSON.stringify(res).slice(0, 500));
			this.kdocsLastResult = { action, result: res, elapsed };

			if (resultEl) {
				resultEl.empty();
				await this.renderKDocsResult(resultEl, action, res, elapsed);
			}
		} catch (e) {
			this.plugin.taskTracker.endTask(taskId, 'failed', e.message);
			this.kdocsLastResult = { action, result: { success: false, error: e.message }, elapsed: Date.now() - start };
			this.addLog('error', `KSDrive.${action} 异常`, e.message);
			if (resultEl) {
				resultEl.empty();
				resultEl.createEl('p', { text: `❌ 请求异常: ${e.message}`, cls: 'sillot-dev-hint' });
			}
		}
	}

	private async renderKDocsResult(container: HTMLElement, action: string, result: any, elapsed: number) {
		const header = container.createDiv({ cls: 'sillot-dev-kdocs-result-header' });
		const ok = result.success !== false;
		header.createEl('span', { text: ok ? '✅' : '❌', cls: 'sillot-dev-kdocs-status' });
		header.createEl('span', { text: action, cls: 'sillot-dev-kdocs-action-name' });
		header.createEl('span', { text: `${elapsed}ms`, cls: 'sillot-dev-kdocs-elapsed' });

		if (result.error) {
			container.createDiv({ cls: 'sillot-dev-kdocs-error', text: `错误: ${result.error}` });
		}

		const data = result.data !== undefined ? result.data : result;
		if (data && typeof data === 'object') {
			if (action === 'ksdListFiles' && data.files) {
				this.renderKDocsFileList(container, data);
			} else if (action === 'ksdOpenFile' && data.opened) {
				this.renderKDocsFileObject(container, data);
			} else if (action === 'ksdCreateFile' && data.url) {
				this.renderKDocsCreatedFile(container, data);
			} else if (action === 'ksdGetOvcpDict' && data.records) {
				await this.renderKDocsOvcpDict(container, data);
			} else if (typeof data === 'string') {
				container.createDiv({ cls: 'sillot-dev-kdocs-data', text: data });
			} else {
				const pre = container.createEl('pre', { cls: 'sillot-dev-kdocs-json' });
				pre.textContent = JSON.stringify(data, null, 2);
			}
		} else if (data !== undefined) {
			container.createDiv({ cls: 'sillot-dev-kdocs-data', text: String(data) });
		}
	}

	private renderKDocsFileList(container: HTMLElement, data: any) {
		const files = data.files || [];
		const nextOffset = data.nextOffset;
		const info = container.createDiv({ cls: 'sillot-dev-kdocs-info' });
		info.createSpan({ text: `共 ${files.length} 个文件` });
		if (nextOffset >= 0) {
			info.createSpan({ text: ` | 下一页偏移: ${nextOffset}` });
		}

		if (files.length === 0) {
			container.createEl('p', { text: '目录下没有文件', cls: 'sillot-dev-hint' });
			return;
		}

		const table = container.createEl('table', { cls: 'sillot-dev-kdocs-table' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		for (const h of ['文件名', '类型', '文件ID', '创建时间', '修改时间']) {
			headRow.createEl('th', { text: h });
		}
		const tbody = table.createEl('tbody');
		for (const f of files) {
			const row = tbody.createEl('tr');
			row.createEl('td', { text: f.fileName || '-' });
			const typeCell = row.createEl('td', { text: f.fileType || '-' });
			if (f.fileType === '文件夹') {
				typeCell.addClass('sillot-dev-kdocs-type-folder');
			}
			row.createEl('td', { text: f.fileId ? `${f.fileId.slice(0, 12)}...` : '-' });
			row.createEl('td', { text: f.createTime ? new Date(f.createTime).toLocaleString() : '-' });
			row.createEl('td', { text: f.updateTime ? new Date(f.updateTime).toLocaleString() : '-' });
		}
	}

	private renderKDocsFileObject(container: HTMLElement, data: any) {
		const info = container.createDiv({ cls: 'sillot-dev-kdocs-info' });
		info.createSpan({ text: '✅ 文件已打开' });

		if (data.fileName) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `文件名: ${data.fileName}`, cls: 'sillot-dev-hint' });
		}
		if (data.filePath) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `路径: ${data.filePath}`, cls: 'sillot-dev-hint' });
		}
		if (data.appName) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `应用类型: ${data.appName}`, cls: 'sillot-dev-hint' });
		}
		if (data.sheetCount) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `工作表数量: ${data.sheetCount}`, cls: 'sillot-dev-hint' });
		}
		if (data.sheets && data.sheets.length > 0) {
			const sheetsDiv = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			sheetsDiv.createEl('p', { text: '工作表列表:', cls: 'sillot-dev-hint' });
			const list = sheetsDiv.createEl('ul', { cls: 'sillot-dev-kdocs-sheet-list' });
			for (const s of data.sheets) {
				const li = list.createEl('li');
				li.createSpan({ text: s.name });
				if (s.usedRange) li.createSpan({ text: ` (${s.usedRange})`, cls: 'sillot-dev-hint' });
			}
		}
		if (data.activeSheet) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `当前工作表: ${data.activeSheet}`, cls: 'sillot-dev-hint' });
		}
		if (data.usedRange) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `使用范围: ${data.usedRange.address} (行 ${data.usedRange.lastRow}, 列 ${data.usedRange.lastCol})`, cls: 'sillot-dev-hint' });
		}
		if (data.a1Text !== undefined) {
			const detail = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			detail.createEl('p', { text: `A1 单元格: ${data.a1Text}`, cls: 'sillot-dev-hint' });
		}

		const errors: string[] = [];
		if (data.a1Error) errors.push(`A1 读取失败: ${data.a1Error}`);
		if (data.activeSheetError) errors.push(`工作表访问失败: ${data.activeSheetError}`);
		if (data.sheetsError) errors.push(`工作表列表失败: ${data.sheetsError}`);
		if (data.appError) errors.push(`Application 访问失败: ${data.appError}`);
		if (data.usedRangeError) errors.push(`使用范围获取失败: ${data.usedRangeError}`);
		if (data.closeError) errors.push(`文件关闭失败: ${data.closeError}`);
		for (const err of errors) {
			container.createDiv({ cls: 'sillot-dev-kdocs-error', text: `⚠️ ${err}` });
		}

		const pre = container.createEl('pre', { cls: 'sillot-dev-kdocs-json' });
		pre.textContent = JSON.stringify(data, null, 2);
	}

	private renderKDocsCreatedFile(container: HTMLElement, data: any) {
		const info = container.createDiv({ cls: 'sillot-dev-kdocs-info' });
		info.createSpan({ text: '✅ 文件创建成功' });

		const urlEl = container.createDiv({ cls: 'sillot-dev-kdocs-data' });
		urlEl.createEl('a', {
			cls: 'external-link',
			attr: { href: data.url, target: '_blank' },
			text: data.url
		});
	}

	private async renderKDocsOvcpDict(container: HTMLElement, data: any) {
		const info = container.createDiv({ cls: 'sillot-dev-kdocs-info' });
		info.createSpan({ text: `📖 OVCP字典 - 视图 "${data.viewName}"` });

		if (data.noMatch && data.allSheetViews) {
			container.createDiv({ cls: 'sillot-dev-kdocs-error', text: `⚠️ 未找到名为 "${data.viewName}" 的视图` });

			const sheetsInfo = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			sheetsInfo.createEl('p', { text: '所有数据表和视图如下：', cls: 'sillot-dev-hint' });
			for (const s of data.allSheetViews) {
				const p = sheetsInfo.createEl('p', { cls: 'sillot-dev-hint' });
				p.createSpan({ text: `📊 ${s.sheetName}` });
				if (s.views.length === 0) {
					p.createSpan({ text: ' — 无视图' });
				} else {
					for (const v of s.views) {
						p.createSpan({ text: ` → 👁 ${v.name}` });
					}
				}
			}
		}

		if (data.sheets && data.sheets.length > 0) {
			const sheetsInfo = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			for (const s of data.sheets) {
				const p = sheetsInfo.createEl('p', { cls: 'sillot-dev-hint' });
				p.createSpan({ text: `📊 ${s.sheetName}` });
				for (const v of s.views) {
					p.createSpan({ text: ` → 👁 ${v.name}` });
					if (v.error) p.createSpan({ text: ` ❌ ${v.error}` });
				}
			}
		}

		const records = data.records || [];
		const countInfo = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
		countInfo.createEl('p', { text: `共 ${data.totalRecords} 条记录`, cls: 'sillot-dev-hint' });

		if (records.length === 0) {
			container.createEl('p', { text: '没有找到匹配的记录', cls: 'sillot-dev-hint' });
			return;
		}

		const viewGroups: Record<string, { sheetName: string; viewName: string; records: any[] }> = {};
		for (const r of records) {
			const sheetName = r._sheetName || 'unknown';
			const viewName = r._viewName || 'default';
			const key = `${sheetName}::${viewName}`;
			if (!viewGroups[key]) {
				viewGroups[key] = { sheetName, viewName, records: [] };
			}
			viewGroups[key].records.push(r);
		}

		const writtenFiles: string[] = [];
		const errors: string[] = [];

		const buildSection = (records: any[], firstCol: string, secondCol: string, allKeys: string[]): string => {
			const orderedKeys = [firstCol, secondCol, ...allKeys.filter(k => k !== firstCol && k !== secondCol)];
			const lines: string[] = [];
			for (const r of records) {
				const values = orderedKeys.map(k => {
					const val = r[k];
					return val !== undefined && val !== null ? String(val) : '';
				});
				if (!values[0]) continue;
				lines.push(values.join('\t'));
			}
			return lines.join('\n');
		};

		for (const [, group] of Object.entries(viewGroups)) {
			const allKeysSet = new Set<string>();
			for (const r of group.records) {
				for (const k of Object.keys(r)) {
					if (!k.startsWith('_')) allKeysSet.add(k);
				}
			}
			const allKeys = Array.from(allKeysSet);

			const hasBiaoMa = allKeys.includes('标码');
			const hasBianMa = allKeys.includes('编码');
			const hasTuanMa = allKeys.includes('彖码');
			const hasPinyin = allKeys.includes('【标准拼音】汉意');

			const firstCol = hasBiaoMa ? '标码' : allKeys[0];
			const secondCol = hasPinyin ? '【标准拼音】汉意' : (allKeys.length > 1 ? allKeys.find(k => k !== firstCol) || allKeys[1] : allKeys[0]);

			const sections: string[] = [];
			sections.push(buildSection(group.records, firstCol, secondCol, allKeys));

			if (hasBianMa) {
				sections.push(buildSection(group.records, '编码', secondCol, allKeys));
			}
			if (hasTuanMa) {
				sections.push(buildSection(group.records, '彖码', secondCol, allKeys));
			}

			const content = sections.join('\n\n\n');

			const fileName = `dict_${group.sheetName}.txt`;
			try {
				await this.app.vault.adapter.write(fileName, content);
				writtenFiles.push(fileName);
			} catch (e: any) {
				errors.push(`${fileName}: ${e.message}`);
			}
		}

		if (writtenFiles.length > 0) {
			const vcConfigPath = `${this.app.vault.configDir}/plugins/various-complements/data.json`;
			try {
				const exists = await this.app.vault.adapter.exists(vcConfigPath);
				if (exists) {
					const raw = await this.app.vault.adapter.read(vcConfigPath);
					let vcData: any;
					try {
						vcData = JSON.parse(raw);
					} catch {
						vcData = {};
					}
					if (typeof vcData !== 'object' || vcData === null) {
						vcData = {};
					}
					const currentPaths = typeof vcData.customDictionaryPaths === 'string'
						? vcData.customDictionaryPaths.split('\n').map((s: string) => s.trim()).filter(Boolean)
						: [];
					let changed = false;
					for (const f of writtenFiles) {
						if (!currentPaths.includes(f)) {
							currentPaths.push(f);
							changed = true;
						}
					}
					if (changed) {
						vcData.customDictionaryPaths = currentPaths.join('\n');
						await this.app.vault.adapter.write(vcConfigPath, JSON.stringify(vcData, null, 2));
					}
				}
			} catch {
			}

			const fileList = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			fileList.createEl('p', { text: `已写入 ${writtenFiles.length} 个文件：`, cls: 'sillot-dev-hint' });
			for (const f of writtenFiles) {
				const p = fileList.createEl('p', { cls: 'sillot-dev-hint' });
				p.createSpan({ text: `📄 ${f}` });
			}
		}

		if (errors.length > 0) {
			const errorList = container.createDiv({ cls: 'sillot-dev-kdocs-detail' });
			errorList.createEl('p', { text: '出错：', cls: 'sillot-dev-hint' });
			for (const e of errors) {
				errorList.createEl('p', { text: `❌ ${e}`, cls: 'sillot-dev-hint' });
			}
		}
	}

	private showKDocsOpenFileDialog() {
		const modal = new Modal(this.app);
		modal.titleEl.setText('打开云文档');
		modal.contentEl.createEl('p', { text: '输入金山文档分享链接或文件 ID：', cls: 'sillot-dev-hint' });

		let url = '';
		new Setting(modal.contentEl)
			.setName('文档链接')
			.setDesc('如 https://www.kdocs.cn/l/xxxxxxxxxxxx')
			.addText(text => text
				.setPlaceholder('https://www.kdocs.cn/l/...')
				.onChange(v => url = v));

		new Setting(modal.contentEl)
			.addButton(btn => btn
				.setButtonText('打开')
				.setCta()
				.onClick(() => {
					modal.close();
					if (url) this.callKDocsApi('ksdOpenFile', { url });
				}));
		modal.open();
	}

	private showKDocsCreateFileDialog() {
		const modal = new Modal(this.app);
		modal.titleEl.setText('创建云文档');

		let fileType = 'ET';
		let fileName = '';
		let dirUrl = '';
		let source = '';

		new Setting(modal.contentEl)
			.setName('文件类型')
			.setDesc('ET=表格, KSheet=智能表格, AP=智能文档, DB=多维表')
			.addDropdown(dd => dd
				.addOptions({ ET: 'ET (表格)', KSheet: 'KSheet (智能表格)', AP: 'AP (智能文档)', DB: 'DB (多维表)' })
				.setValue('ET')
				.onChange(v => fileType = v));

		new Setting(modal.contentEl)
			.setName('文件名')
			.addText(text => text
				.setPlaceholder('新文件名')
				.onChange(v => fileName = v));

		new Setting(modal.contentEl)
			.setName('目录链接 (可选)')
			.addText(text => text
				.setPlaceholder('https://www.kdocs.cn/mine/...')
				.onChange(v => dirUrl = v));

		new Setting(modal.contentEl)
			.setName('源文件链接 (可选，另存为)')
			.addText(text => text
				.setPlaceholder('https://www.kdocs.cn/l/...')
				.onChange(v => source = v));

		new Setting(modal.contentEl)
			.addButton(btn => btn
				.setButtonText('创建')
				.setCta()
				.onClick(() => {
					modal.close();
					const opts: any = { name: fileName || `新建${fileType}文件` };
					if (dirUrl) opts.dirUrl = dirUrl;
					if (source) opts.source = source;
					this.callKDocsApi('ksdCreateFile', { type: fileType, createOptions: opts });
				}));
		modal.open();
	}

	private showKDocsListDirDialog() {
		const modal = new Modal(this.app);
		modal.titleEl.setText('列出目录文件');

		let dirUrl = '';
		let offset = 0;
		let count = 30;
		let exts = '';

		new Setting(modal.contentEl)
			.setName('目录链接 (可选)')
			.setDesc('为空则列出"我的云文档"')
			.addText(text => text
				.setPlaceholder('https://www.kdocs.cn/mine/...')
				.onChange(v => dirUrl = v));

		new Setting(modal.contentEl)
			.setName('偏移量')
			.addText(text => text
				.setValue('0')
				.onChange(v => offset = parseInt(v) || 0));

		new Setting(modal.contentEl)
			.setName('每页数量')
			.addText(text => text
				.setValue('30')
				.onChange(v => count = parseInt(v) || 30));

		new Setting(modal.contentEl)
			.setName('文件类型 (可选)')
			.setDesc('逗号分隔，如 et,ksheet,db')
			.addText(text => text
				.setPlaceholder('et,ksheet')
				.onChange(v => exts = v));

		new Setting(modal.contentEl)
			.addButton(btn => btn
				.setButtonText('列出')
				.setCta()
				.onClick(() => {
					modal.close();
					const opts: any = { offset, count };
					if (dirUrl) opts.dirUrl = dirUrl;
					if (exts) opts.includeExts = exts.split(',').map(s => s.trim()).filter(Boolean);
					this.callKDocsApi('ksdListFiles', opts);
				}));
		modal.open();
	}

	private showKDocsOvcpDictDialog() {
		const modal = new Modal(this.app);
		modal.titleEl.setText('📖 获取OVCP字典');

		let url = '';
		let viewName = 'OVCP';

		new Setting(modal.contentEl)
			.setName('多维表链接')
			.setDesc('多维表格的链接（不是分享链接）')
			.addText(text => text
				.setPlaceholder('https://www.kdocs.cn/l/...')
				.onChange(v => url = v));

		new Setting(modal.contentEl)
			.setName('视图名称')
			.setDesc('要查找的视图名称，默认 OVCP')
			.addText(text => text
				.setValue('OVCP')
				.onChange(v => viewName = v || 'OVCP'));

		new Setting(modal.contentEl)
			.addButton(btn => btn
				.setButtonText('获取字典')
				.setCta()
				.onClick(() => {
					modal.close();
					this.callKDocsApi('ksdGetOvcpDict', { url, viewName });
				}));
		modal.open();
	}

	private renderTaskTrackerDemo(container: HTMLElement) {
		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: 'TaskTracker 测试' });

		const desc = card.createEl('p', { text: '模拟任务执行，观察底部面板最小化状态下的进度条和文字显示。', cls: 'sillot-dev-hint' });

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });

		actions.createEl('button', { text: '⏳ 不确定进度任务', cls: 'sillot-dev-btn' }).onclick = () => {
			const id = `demo-indeterminate-${Date.now()}`;
			this.plugin.taskTracker.startTask(id, '加载 Bridge 产物...');
			window.setTimeout(() => this.plugin.taskTracker.endTask(id), 6000);
			new Notice('已启动不确定进度任务 (6s)');
		};

		actions.createEl('button', { text: '📊 确定进度任务', cls: 'sillot-dev-btn' }).onclick = () => {
			const id = `demo-progress-${Date.now()}`;
			this.plugin.taskTracker.startTask(id, '打包文件中... 0%');
			let progress = 0;
			const interval = window.setInterval(() => {
				progress += Math.floor(Math.random() * 10) + 3;
				if (progress >= 100) {
					progress = 100;
					window.clearInterval(interval);
					this.plugin.taskTracker.updateTask(id, progress, '打包文件中... 100%');
					window.setTimeout(() => this.plugin.taskTracker.endTask(id), 1000);
				} else {
					this.plugin.taskTracker.updateTask(id, progress, `打包文件中... ${progress}%`);
				}
			}, 600);
			new Notice('已启动确定进度任务');
		};

		actions.createEl('button', { text: '📤 发布模拟', cls: 'sillot-dev-btn' }).onclick = () => {
			const id = `demo-publish-${Date.now()}`;
			this.plugin.taskTracker.startTask(id, '发布到 GitHub 中...');
			window.setTimeout(() => {
				this.plugin.taskTracker.updateTask(id, 30, '收集文件中... 30%');
			}, 1000);
			window.setTimeout(() => {
				this.plugin.taskTracker.updateTask(id, 60, '打包文件中... 60%');
			}, 3000);
			window.setTimeout(() => {
				this.plugin.taskTracker.updateTask(id, 90, '上传中... 90%');
			}, 5000);
			window.setTimeout(() => {
				this.plugin.taskTracker.updateTask(id, 100, '发布完成 100%');
				window.setTimeout(() => this.plugin.taskTracker.endTask(id), 1000);
			}, 7000);
			new Notice('已启动发布模拟 (7s)');
		};

		actions.createEl('button', { text: '🧹 清除所有任务', cls: 'sillot-dev-btn' }).onclick = () => {
			for (const task of this.plugin.taskTracker.getActiveTasks()) {
				this.plugin.taskTracker.endTask(task.id);
			}
			new Notice('已清除所有任务');
		};

		actions.createEl('button', { text: '🔀 多任务并行', cls: 'sillot-dev-btn' }).onclick = () => {
			const id1 = `demo-multi1-${Date.now()}`;
			const id2 = `demo-multi2-${Date.now()}`;
			const id3 = `demo-multi3-${Date.now()}`;
			this.plugin.taskTracker.startTask(id1, '同步文档中...');
			this.plugin.taskTracker.startTask(id2, '打包文件中... 0%');
			this.plugin.taskTracker.startTask(id3, '加载 Bridge 产物...');

			let progress = 0;
			const interval = window.setInterval(() => {
				progress += Math.floor(Math.random() * 10) + 3;
				if (progress >= 100) {
					progress = 100;
					window.clearInterval(interval);
					this.plugin.taskTracker.updateTask(id2, progress, '打包文件中... 100%');
					window.setTimeout(() => this.plugin.taskTracker.endTask(id2), 1000);
				} else {
					this.plugin.taskTracker.updateTask(id2, progress, `打包文件中... ${progress}%`);
				}
			}, 600);

			window.setTimeout(() => this.plugin.taskTracker.endTask(id1), 5000);
			window.setTimeout(() => this.plugin.taskTracker.endTask(id3), 8000);
			new Notice('已启动 3 个并行任务');
		};

		actions.createEl('button', { text: '🌐 模拟 GitHub 发布', cls: 'sillot-dev-btn' }).onclick = () => {
			this.runGithubPublishSimulation();
		};
	}

	private async runGithubPublishSimulation() {
		const id = `demo-gh-publish-${Date.now()}`;
		this.plugin.taskTracker.startTask(id, '准备 GitHub 发布...');

		await this.simulateDelay(1000);
		this.plugin.taskTracker.updateTask(id, 10, '验证仓库信息...');

		await this.simulateDelay(1500);
		this.plugin.taskTracker.updateTask(id, 20, '获取最新 commit...');

		await this.simulateDelay(1000);
		this.plugin.taskTracker.updateTask(id, 30, '收集变更文件 (3 个)...');

		await this.simulateDelay(2000);
		this.plugin.taskTracker.updateTask(id, 50, '打包文件中...');

		await this.simulateDelay(2000);
		this.plugin.taskTracker.updateTask(id, 70, '创建 Blob 对象...');

		await this.simulateDelay(1500);
		this.plugin.taskTracker.updateTask(id, 80, '创建 Tree...');

		await this.simulateDelay(1000);
		this.plugin.taskTracker.updateTask(id, 90, '创建 Commit...');

		await this.simulateDelay(1000);
		this.plugin.taskTracker.updateTask(id, 95, '更新 Ref...');

		await this.simulateDelay(800);
		this.plugin.taskTracker.updateTask(id, 100, 'GitHub 发布完成 ✓');
		this.addLog('info', 'GitHub 发布模拟', '模拟发布完成（无需令牌）');

		await this.simulateDelay(1000);
		this.plugin.taskTracker.endTask(id);
	}

	private simulateDelay(ms: number): Promise<void> {
		return new Promise(resolve => window.setTimeout(resolve, ms));
	}

	private renderCache(container: HTMLElement) {
		const cache = this.plugin.syncCache;

		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: `同步块缓存 (${cache.list.length} 条)` });

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🔄 从云端刷新', cls: 'sillot-dev-btn' }).onclick = async () => {
			if (!this.plugin.syncManager) return;
			try {
				const res = await this.plugin.syncManager.getPluginSyncList();
				if (res.success && res.data) {
					this.plugin.updateSyncListCache(res.data);
					new Notice(`已刷新 ${res.data.length} 条`);
					this.render();
				}
			} catch (e) {
				new Notice(`刷新失败: ${e.message}`);
			}
		};
		actions.createEl('button', { text: '🗑️ 清空', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = () => {
			this.plugin.syncCache = { list: [], content: {} };
			this.plugin.saveSettings();
			new Notice('缓存已清空');
			this.render();
		};
		actions.createEl('button', { text: '📋 导出 JSON', cls: 'sillot-dev-btn' }).onclick = () => {
			const json = JSON.stringify(cache, null, 2);
			navigator.clipboard.writeText(json);
			new Notice('已复制缓存 JSON');
		};

		if (cache.list.length === 0) {
			card.createEl('p', { text: '缓存为空', cls: 'sillot-dev-hint' });
			return;
		}

		const state = this.cachePagination.getState();
		const filtered = PaginationBar.filterBySearch(
			cache.list, state.searchQuery, state.searchColumns,
			(item, col) => {
				switch (col) {
					case 'sync_id': return item.sync_id || '';
					case 'sync_type': return item.sync_type || '';
					case 'description': return item.description || '';
					case 'category': return item.category || '';
					default: return '';
				}
			}
		);

		const { pageItems } = PaginationBar.paginate(filtered, state.currentPage, state.pageSize);

		const paginationContainer = card.createDiv({ cls: 'sillot-dev-pagination' });
		this.cachePagination.render(paginationContainer, filtered.length);

		const table = card.createEl('table', { cls: 'sillot-dev-table' });
		const thead = table.createEl('thead');
		thead.createEl('tr').innerHTML = '<th>ID</th><th>类型</th><th>描述</th><th>分类</th><th>内容长度</th><th>更新时间</th>';
		const tbody = table.createEl('tbody');
		for (const item of pageItems) {
			const row = tbody.createEl('tr');
			row.createEl('td', { text: item.sync_id });
			row.createEl('td', { text: item.sync_type });
			row.createEl('td', { text: (item.description || '-').substring(0, 20) });
			row.createEl('td', { text: item.category || '-' });
			row.createEl('td', { text: `${(item.sync_content || '').length}` });
			row.createEl('td', { text: item.updated_at ? new Date(item.updated_at).toLocaleString() : '-' });
		}
	}

	private renderBridge(container: HTMLElement) {
		const s = this.plugin.settings;
		const bridgeMgr = this.plugin.bridgeManager;
		const bridgeCss = this.plugin.bridgeCssInjector;
		const syntaxReg = this.plugin.syntaxRegistry;
		const assets = bridgeMgr.getAssets();

		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: 'Bridge 产物状态' });

		const statusList = card.createDiv({ cls: 'sillot-dev-status-list' });
		this.addStatusItem(statusList, 'Bridge 版本', assets.version?.version || '❌ 未加载', assets.version ? 'ok' : 'warn');
		this.addStatusItem(statusList, '构建时间', assets.version?.buildTime ? new Date(assets.version.buildTime).toLocaleString() : '未知', assets.version ? 'info' : 'warn');
		this.addStatusItem(statusList, '路径映射', assets.pathMap ? `✅ ${assets.pathMap.entries?.length || 0} 条` : '❌ 未加载', assets.pathMap ? 'ok' : 'warn');
		this.addStatusItem(statusList, '语法描述', assets.syntaxDescriptors ? `✅ ${assets.syntaxDescriptors.syntaxes?.length || 0} 个` : '❌ 未加载', assets.syntaxDescriptors ? 'ok' : 'warn');
		this.addStatusItem(statusList, '组件描述', assets.componentProps ? `✅ ${assets.componentProps.components?.length || 0} 个` : '❌ 未加载', assets.componentProps ? 'ok' : 'warn');
		this.addStatusItem(statusList, '作者数据', assets.authors ? `✅ ${Object.keys(assets.authors.authors).length} 位` : '❌ 未加载', assets.authors ? 'ok' : 'warn');
		this.addStatusItem(statusList, 'Bridge CSS', assets.bridgeCss ? `✅ ${(assets.bridgeCss.length / 1024).toFixed(1)} KB` : '❌ 未加载', assets.bridgeCss ? 'ok' : 'warn');
		this.addStatusItem(statusList, 'Bridge CSS 注入', bridgeCss.isInjected() ? '✅ 已注入' : '❌ 未注入', bridgeCss.isInjected() ? 'ok' : 'warn');
		this.addStatusItem(statusList, '语法处理器', syntaxReg ? '✅ 已注册' : '❌ 未注册', syntaxReg ? 'ok' : 'warn');

		const styleInjector = this.plugin.styleInjector;
		const cssContent = styleInjector?.getCSS() || '';
		this.addStatusItem(statusList, 'GitHub 样式 CSS', cssContent ? `✅ ${(cssContent.length / 1024).toFixed(1)} KB` : '❌ 未加载', cssContent ? 'ok' : 'warn');

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🔄 同步 Bridge 产物', cls: 'sillot-dev-btn' }).onclick = async () => {
			new Notice('正在同步 Bridge 产物...');
			this.addLog('info', '开始同步 Bridge 产物');
			try {
				await this.plugin.syncBridgeAssets();
				this.addLog('info', 'Bridge 产物同步成功');
				new Notice('Bridge 产物同步成功');
			} catch (e) {
				this.addLog('error', 'Bridge 产物同步失败', e.message);
				new Notice(`同步失败: ${e.message}`);
			}
			this.render();
		};
		actions.createEl('button', { text: '📡 从站点拉取', cls: 'sillot-dev-btn' }).onclick = async () => {
			if (!s.siteDomain) {
				new Notice('请先在设置中配置站点域名');
				return;
			}
			new Notice('正在从站点拉取 Bridge 产物...');
			this.addLog('info', `从站点拉取: ${s.siteDomain}`);
			try {
				await bridgeMgr.syncFromSite();
				this.plugin.onBridgeAssetsLoaded(bridgeMgr.getAssets());
				this.addLog('info', '站点 Bridge 拉取成功');
				new Notice('Bridge 产物拉取成功');
			} catch (e) {
				this.addLog('error', '站点 Bridge 拉取失败', e.message);
				new Notice(`拉取失败: ${e.message}`);
			}
			this.render();
		};
		actions.createEl('button', { text: '📁 从本地加载', cls: 'sillot-dev-btn' }).onclick = async () => {
			const bridgePath = this.plugin.getBridgeDistPath();
			if (!bridgePath) {
				new Notice('未配置本地 VuePress 站点路径');
				return;
			}
			this.addLog('info', `从本地加载: ${bridgePath}`);
			try {
				await bridgeMgr.syncFromLocal();
				this.plugin.onBridgeAssetsLoaded(bridgeMgr.getAssets());
				this.addLog('info', '本地 Bridge 加载成功');
				new Notice('Bridge 产物加载成功');
			} catch (e) {
				this.addLog('error', '本地 Bridge 加载失败', e.message);
				new Notice(`加载失败: ${e.message}`);
			}
			this.render();
		};
		actions.createEl('button', { text: '🧹 清除注入', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = () => {
			this.plugin.styleInjector.remove();
			this.plugin.bridgeCssInjector.remove();
			new Notice('已清除所有注入样式');
			this.render();
		};

		const cacheCard = container.createDiv({ cls: 'sillot-dev-card' });
		cacheCard.createEl('h5', { text: 'Bridge 缓存' });
		const cacheStatus = cacheCard.createDiv({ cls: 'sillot-dev-status-list' });
		const cacheTs = bridgeMgr.getCacheTimestamp();
		this.addStatusItem(cacheStatus, '缓存状态', cacheTs ? `✅ ${new Date(cacheTs).toLocaleString()}` : '❌ 无缓存', cacheTs ? 'ok' : 'warn');
		this.addStatusItem(cacheStatus, '缓存路径', '.obsidian/plugins/sillot/bridge-cache/', 'info');

		const cacheActions = cacheCard.createDiv({ cls: 'sillot-dev-actions' });
		cacheActions.createEl('button', { text: '💾 保存缓存', cls: 'sillot-dev-btn' }).onclick = async () => {
			await bridgeMgr.saveToCache();
			new Notice('Bridge 缓存已保存');
			this.render();
		};
		cacheActions.createEl('button', { text: '📂 从缓存加载', cls: 'sillot-dev-btn' }).onclick = async () => {
			const loaded = await bridgeMgr.loadFromCache();
			if (loaded) {
				this.plugin.onBridgeAssetsLoaded(bridgeMgr.getAssets());
				new Notice('从缓存加载成功');
			} else {
				new Notice('缓存不存在');
			}
			this.render();
		};
		cacheActions.createEl('button', { text: '🗑️ 清除缓存', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = async () => {
			await bridgeMgr.clearCache();
			new Notice('Bridge 缓存已清除');
			this.render();
		};

		const pathCard = container.createDiv({ cls: 'sillot-dev-card' });
		pathCard.createEl('h5', { text: '本地路径（可编辑，不持久化）' });
		const pathList = pathCard.createDiv({ cls: 'sillot-dev-status-list' });

		const vpRoot = s.localVuePressRoot || '';
		const sep = vpRoot.includes('\\') ? '\\' : '/';

		const localStylePath = vpRoot && s.stylesPath
			? `${vpRoot}${sep}${s.stylesPath.replace(/\//g, sep)}`
			: '';
		const bridgeDistPath = this.plugin.getBridgeDistPath();
		const vuepressConfigPath = vpRoot
			? `${vpRoot}${sep}${s.vuepressDocsDir.replace(/\//g, sep)}${sep}.vuepress`
			: '';
		const vuepressPluginsPath = vuepressConfigPath
			? `${vuepressConfigPath}${sep}plugins`
			: '';
		const vuepressComponentsPath = vuepressConfigPath
			? `${vuepressConfigPath}${sep}components`
			: '';

		const editablePaths: Record<string, string> = {
			'VuePress 站点根目录': vpRoot,
			'本地样式绝对路径': localStylePath,
			'Bridge 产物路径': bridgeDistPath,
			'VuePress 配置目录': vuepressConfigPath,
			'VuePress 插件目录': vuepressPluginsPath,
			'VuePress 组件目录': vuepressComponentsPath,
		};

		const pathInputs: Record<string, HTMLInputElement> = {};

		for (const [label, value] of Object.entries(editablePaths)) {
			const row = pathList.createDiv({ cls: 'sillot-dev-status-item' });
			row.createEl('span', { text: label, cls: 'sillot-dev-status-label' });
			const input = row.createEl('input', {
				cls: 'sillot-dev-path-input',
				attr: { type: 'text', value: value, placeholder: '未配置' },
			}) as HTMLInputElement;
			input.style.width = '100%';
			input.style.marginLeft = '8px';
			input.style.padding = '2px 6px';
			input.style.fontSize = '12px';
			input.style.fontFamily = 'monospace';
			input.style.border = '1px solid var(--background-modifier-border)';
			input.style.borderRadius = '4px';
			input.style.background = 'var(--background-primary)';
			input.style.color = 'var(--text-normal)';
			pathInputs[label] = input;
		}

		const pathActions = pathCard.createDiv({ cls: 'sillot-dev-actions' });
		pathActions.createEl('button', { text: '📋 复制全部路径', cls: 'sillot-dev-btn' }).onclick = () => {
			const lines = Object.entries(pathInputs).map(([label, input]) => `${label}: ${input.value || '空'}`);
			navigator.clipboard.writeText(lines.join('\n'));
			new Notice('已复制全部路径');
		};

		if (assets.pathMap?.entries?.length) {
			const pathMapCard = container.createDiv({ cls: 'sillot-dev-card' });
			pathMapCard.createEl('h5', { text: `路径映射 (${assets.pathMap.entries.length} 条)` });

			const pmState = this.pathMapPagination.getState();
			const pmFiltered = PaginationBar.filterBySearch(
				assets.pathMap.entries, pmState.searchQuery, pmState.searchColumns,
				(entry, col) => {
					switch (col) {
						case 'vuepressPath': return entry.vuepressPath || '';
						case 'sourceRelPath': return entry.sourceRelPath || '';
						case 'title': return entry.title || '';
						default: return '';
					}
				}
			);
			const { pageItems: pmItems } = PaginationBar.paginate(pmFiltered, pmState.currentPage, pmState.pageSize);

			const pmPagination = pathMapCard.createDiv({ cls: 'sillot-dev-pagination' });
			this.pathMapPagination.render(pmPagination, pmFiltered.length);

			const pmTable = pathMapCard.createEl('table', { cls: 'sillot-dev-table' });
			const thead = pmTable.createEl('thead');
			thead.createEl('tr').innerHTML = '<th>VuePress 路径</th><th>源文件路径</th><th>标题</th>';
			const tbody = pmTable.createEl('tbody');
			for (const entry of pmItems) {
				const row = tbody.createEl('tr');
				row.createEl('td', { text: entry.vuepressPath });
				row.createEl('td', { text: entry.sourceRelPath });
				row.createEl('td', { text: entry.title || '-' });
			}
		}

		if (assets.publishStatus?.entries) {
			const psCard = container.createDiv({ cls: 'sillot-dev-card' });
			const rawEntries = Object.entries(assets.publishStatus.entries);
			const withId = rawEntries.filter(([, e]) => e.publishId).length;
			const withoutId = rawEntries.length - withId;
			psCard.createEl('h5', { text: `发布状态 (${rawEntries.length} 条, ${withId} 有ID, ${withoutId} 无ID)` });

			if (withoutId > 0) {
				const warnEl = psCard.createDiv({ cls: 'sillot-dev-warning' });
				warnEl.textContent = `⚠️ ${withoutId} 个文件缺少发布ID，建议发布时自动生成`;
			}

			const psItems = [...rawEntries].sort((a, b) => {
				if (!a[1].publishId && b[1].publishId) return 1;
				if (a[1].publishId && !b[1].publishId) return -1;
				return 0;
			}).map(([filePath, entry]) => ({ filePath, ...entry }));

			const psState = this.publishStatusPagination.getState();
			const psFiltered = PaginationBar.filterBySearch(
				psItems, psState.searchQuery, psState.searchColumns,
				(item, col) => {
					switch (col) {
						case 'filePath': return item.filePath;
						case 'publishId': return item.publishId || '';
						default: return '';
					}
				}
			);
			const { pageItems: psPageItems } = PaginationBar.paginate(psFiltered, psState.currentPage, psState.pageSize);

			const psPagination = psCard.createDiv({ cls: 'sillot-dev-pagination' });
			this.publishStatusPagination.render(psPagination, psFiltered.length);

			const psTable = psCard.createEl('table', { cls: 'sillot-dev-table' });
			const psThead = psTable.createEl('thead');
			psThead.createEl('tr').innerHTML = '<th>源文件路径</th><th>发布ID</th><th>修改时间</th>';
			const psTbody = psTable.createEl('tbody');
			for (const item of psPageItems) {
				const row = psTbody.createEl('tr');
				row.createEl('td', { text: item.filePath });
				const idCell = row.createEl('td');
				if (item.publishId) {
					idCell.createEl('span', { text: item.publishId, cls: 'sillot-dev-publish-id' });
				} else {
					idCell.createEl('span', { text: '⚠️无', cls: 'sillot-dev-publish-id-missing' });
				}
				row.createEl('td', { text: new Date(item.mtime).toLocaleString() });
			}
		}

		if (assets.syntaxDescriptors?.syntaxes?.length) {
			const syntaxCard = container.createDiv({ cls: 'sillot-dev-card' });
			syntaxCard.createEl('h5', { text: `语法处理器 (${assets.syntaxDescriptors.syntaxes.length} 个)` });
			const synList = syntaxCard.createDiv({ cls: 'sillot-dev-status-list' });
			for (const syn of assets.syntaxDescriptors.syntaxes) {
				this.addStatusItem(synList, syn.id, syn.handler, 'info');
			}
		}

		if (assets.componentProps?.components?.length) {
			const compCard = container.createDiv({ cls: 'sillot-dev-card' });
			compCard.createEl('h5', { text: `组件降级 (${assets.componentProps.components.length} 个)` });
			const compList = compCard.createDiv({ cls: 'sillot-dev-status-list' });
			for (const comp of assets.componentProps.components) {
				const propNames = comp.props.map(p => p.name).join(', ') || '无属性';
				this.addStatusItem(compList, comp.name, `属性: ${propNames}`, 'info');
			}
		}

		const cssVarCard = container.createDiv({ cls: 'sillot-dev-card' });
		cssVarCard.createEl('h5', { text: 'CSS 变量检测' });
		const cssVarList = cssVarCard.createDiv({ cls: 'sillot-dev-status-list' });
		const testVars = [
			'--vp-c-brand-1', '--vp-c-brand-2',
			'--vp-c-bg', '--vp-c-bg-soft',
			'--vp-c-text-1', '--vp-c-text-2',
			'--vp-c-border', '--vp-c-divider',
		];
		for (const v of testVars) {
			const value = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
			this.addStatusItem(cssVarList, v, value || '❌ 未定义', value ? 'ok' : 'warn');
		}
	}

	private renderLogs(container: HTMLElement) {
		this.renderPanelLogs(container);
		this.renderPluginLogFile(container);
	}

	private renderPanelLogs(container: HTMLElement) {
		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: `运行日志 (${this.logs.length}/${this.maxLogs})` });

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🗑️ 清空', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = () => {
			this.logs = [];
			this.render();
		};
		actions.createEl('button', { text: '📋 复制全部', cls: 'sillot-dev-btn' }).onclick = () => {
			const text = this.logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${l.detail ? '\n  ' + l.detail : ''}`).join('\n');
			navigator.clipboard.writeText(text);
			new Notice('已复制运行日志');
		};

		if (this.logs.length === 0) {
			card.createEl('p', { text: '暂无日志', cls: 'sillot-dev-hint' });
			return;
		}

		const logContainer = card.createDiv({ cls: 'sillot-dev-log-container sillot-dev-log-selectable' });
		for (const log of [...this.logs].reverse()) {
			const entry = logContainer.createDiv({
				cls: `sillot-dev-log-entry sillot-dev-log-${log.level}`,
			});
			entry.createEl('span', { text: log.timestamp, cls: 'sillot-dev-log-time' });
			entry.createEl('span', { text: `[${log.level.toUpperCase()}]`, cls: `sillot-dev-log-level sillot-dev-log-level-${log.level}` });
			entry.createEl('span', { text: log.message, cls: 'sillot-dev-log-msg' });
			if (log.detail) {
				const detail = entry.createDiv({ cls: 'sillot-dev-log-detail' });
				detail.textContent = log.detail.length > 300 ? log.detail.substring(0, 300) + '...' : log.detail;
			}
		}
	}

	private async renderPluginLogFile(container: HTMLElement) {
		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: '插件日志文件' });

		this.logPath = this.plugin.settings.logFilePath || '.obsidian/plugins/sillot/log/sillot.log';
		const actions = card.createDiv({ cls: 'sillot-dev-actions' });

		actions.createEl('button', { text: '🔄 刷新', cls: 'sillot-dev-btn' }).onclick = () => {
			this.cachedLogContent = null;
			this.cachedLogLines = [];
			this.renderPluginLogFileContent(card);
		};
		actions.createEl('button', { text: '📋 复制', cls: 'sillot-dev-btn' }).onclick = async () => {
			try {
				const exists = await this.plugin.app.vault.adapter.exists(this.logPath);
				if (!exists) {
					new Notice('日志文件不存在');
					return;
				}
				const content = await this.plugin.app.vault.adapter.read(this.logPath);
				navigator.clipboard.writeText(content);
				new Notice('已复制插件日志');
			} catch (e) {
				new Notice(`读取失败: ${e.message}`);
			}
		};
		actions.createEl('button', { text: '🗑️ 删除', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = async () => {
			try {
				const exists = await this.plugin.app.vault.adapter.exists(this.logPath);
				if (!exists) {
					new Notice('日志文件不存在');
					return;
				}
				await this.plugin.app.vault.adapter.remove(this.logPath);
				this.cachedLogContent = null;
				this.cachedLogLines = [];
				new Notice('日志文件已删除');
				this.renderPluginLogFileContent(card);
			} catch (e) {
				new Notice(`删除失败: ${e.message}`);
			}
		};

		await this.renderPluginLogFileContent(card);
		this.renderTaskHistory(container);
	}

	private async renderPluginLogFileContent(card: HTMLElement) {
		const existingContent = card.querySelector('.sillot-dev-log-file-content');
		if (existingContent) existingContent.remove();

		const contentWrapper = card.createDiv({ cls: 'sillot-dev-log-file-content' });

		if (!this.cachedLogContent) {
			try {
				const exists = await this.plugin.app.vault.adapter.exists(this.logPath);
				if (exists) {
					this.cachedLogContent = await this.plugin.app.vault.adapter.read(this.logPath);
				}
			} catch {
				this.cachedLogContent = '';
			}
		}

		if (!this.cachedLogContent) {
			contentWrapper.createEl('p', { text: '日志文件为空或不存在', cls: 'sillot-dev-hint' });
			return;
		}

		if (this.cachedLogLines.length === 0) {
			this.cachedLogLines = this.cachedLogContent.split('\n').filter(l => l.length > 0);
		}

		const lineCount = this.cachedLogLines.length;
		const sizeKB = (new Blob([this.cachedLogContent]).size / 1024).toFixed(1);

		const filterBar = contentWrapper.createDiv({ cls: 'sillot-dev-log-filter-bar' });

		const filterLevels: { key: string; label: string; cls: string }[] = [
			{ key: 'error', label: 'ERROR', cls: 'sillot-dev-log-filter-error' },
			{ key: 'warn', label: 'WARN', cls: 'sillot-dev-log-filter-warn' },
			{ key: 'info', label: 'INFO', cls: 'sillot-dev-log-filter-info' },
			{ key: 'debug', label: 'DEBUG', cls: 'sillot-dev-log-filter-debug' },
			{ key: 'banner', label: 'BANNER', cls: 'sillot-dev-log-filter-banner' },
		];

		for (const fl of filterLevels) {
			const btn = filterBar.createEl('button', {
				text: fl.label,
				cls: `sillot-dev-log-filter-btn ${fl.cls}`,
			});
			if (this.pluginLogFilter.has(fl.key)) {
				btn.addClass('sillot-dev-log-filter-btn--active');
			}
			btn.onclick = () => {
				if (this.pluginLogFilter.has(fl.key)) {
					this.pluginLogFilter.delete(fl.key);
					btn.removeClass('sillot-dev-log-filter-btn--active');
				} else {
					this.pluginLogFilter.add(fl.key);
					btn.addClass('sillot-dev-log-filter-btn--active');
				}
				this.renderLogContentOnly();
			};
		}

		const filteredLines = this.cachedLogLines.filter(line => {
			const level = this.detectLogLevel(line);
			if (level) return this.pluginLogFilter.has(level);
			return this.pluginLogFilter.has('banner');
		});

		const displayLines = filteredLines.slice(-this.maxLogDisplayLines);
		const isTruncated = filteredLines.length > this.maxLogDisplayLines;

		const info = contentWrapper.createEl('p', { cls: 'sillot-dev-hint' });
		info.textContent = `${lineCount} 行, ${sizeKB} KB | 过滤后 ${filteredLines.length} 行 | 显示最新 ${displayLines.length} 行${isTruncated ? '（最早日志已隐藏）' : ''}`;

		const logContainer = contentWrapper.createDiv({ cls: 'sillot-dev-log-container sillot-dev-log-selectable sillot-dev-plugin-log-container' });
		logContainer.id = 'plugin-log-container';

		this.renderLogLines(logContainer, displayLines);

		const scrollActions = contentWrapper.createDiv({ cls: 'sillot-dev-actions' });
		scrollActions.createEl('button', { text: '⬆ 滚动到开头', cls: 'sillot-dev-btn' }).onclick = () => {
			logContainer.scrollTop = 0;
		};
		scrollActions.createEl('button', { text: '⬇ 滚动到末尾', cls: 'sillot-dev-btn' }).onclick = () => {
			logContainer.scrollTop = logContainer.scrollHeight;
		};
	}

	private renderLogContentOnly() {
		const logContainer = this.contentEl.querySelector('#plugin-log-container') as HTMLElement;
		if (!logContainer) return;

		const filteredLines = this.cachedLogLines.filter(line => {
			const level = this.detectLogLevel(line);
			if (level) return this.pluginLogFilter.has(level);
			return this.pluginLogFilter.has('banner');
		});

		const displayLines = filteredLines.slice(-this.maxLogDisplayLines);
		const isTruncated = filteredLines.length > this.maxLogDisplayLines;

		const info = this.contentEl.querySelector('.sillot-dev-log-file-content .sillot-dev-hint') as HTMLElement;
		if (info) {
			const lineCount = this.cachedLogLines.length;
			const sizeKB = this.cachedLogContent ? (new Blob([this.cachedLogContent]).size / 1024).toFixed(1) : '0';
			info.textContent = `${lineCount} 行, ${sizeKB} KB | 过滤后 ${filteredLines.length} 行 | 显示最新 ${displayLines.length} 行${isTruncated ? '（最早日志已隐藏）' : ''}`;
		}

		this.renderLogLines(logContainer, displayLines);
	}

	private renderLogLines(container: HTMLElement, lines: string[]) {
		container.empty();

		const fragment = document.createDocumentFragment();

		for (const line of lines) {
			const entry = document.createElement('div');
			entry.className = 'sillot-dev-plugin-log-line';
			const level = this.detectLogLevel(line);
			if (level) {
				entry.classList.add(`sillot-dev-plugin-log-${level}`);
			}
			entry.textContent = line;
			fragment.appendChild(entry);
		}

		container.appendChild(fragment);
	}

	private renderTaskHistory(container: HTMLElement) {
		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: '历史任务' });

		const history = this.plugin.taskTracker.getHistory();
		const actions = card.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🗑️ 清空', cls: 'sillot-dev-btn sillot-dev-btn--warn' }).onclick = () => {
			this.plugin.taskTracker.clearHistory();
			this.render();
		};

		if (history.length === 0) {
			card.createEl('p', { text: '暂无历史任务', cls: 'sillot-dev-hint' });
			return;
		}

		const table = card.createEl('table', { cls: 'sillot-dev-table' });
		const thead = table.createEl('thead');
		thead.createEl('tr').innerHTML = '<th>任务</th><th>结果</th><th>进度</th><th>开始时间</th><th>耗时</th><th>反馈</th>';
		const tbody = table.createEl('tbody');

		for (const entry of [...history].reverse()) {
			const row = tbody.createEl('tr');
			row.createEl('td', { text: entry.label, cls: 'sillot-dev-task-history-label' });

			const resultCell = row.createEl('td');
			const resultCfg: Record<string, { icon: string; cls: string }> = {
				success: { icon: '✅', cls: 'sillot-dev-task-result-success' },
				failed: { icon: '❌', cls: 'sillot-dev-task-result-failed' },
				cancelled: { icon: '🚫', cls: 'sillot-dev-task-result-cancelled' },
			};
			const cfg = resultCfg[entry.result] || resultCfg.cancelled;
			resultCell.createEl('span', { text: `${cfg.icon} ${entry.result}`, cls: cfg.cls });

			const progressCell = row.createEl('td');
			if (entry.progress >= 0) {
				progressCell.textContent = `${entry.progress}%`;
			} else {
				progressCell.textContent = '-';
			}

			row.createEl('td', { text: new Date(entry.startTime).toLocaleString() });

			const elapsed = entry.endTime - entry.startTime;
			const elapsedCell = row.createEl('td');
			if (elapsed < 1000) {
				elapsedCell.textContent = `${elapsed}ms`;
			} else if (elapsed < 60000) {
				elapsedCell.textContent = `${(elapsed / 1000).toFixed(1)}s`;
			} else {
				elapsedCell.textContent = `${Math.floor(elapsed / 60000)}m${Math.floor((elapsed % 60000) / 1000)}s`;
			}

			const feedbackCell = row.createEl('td', { cls: 'sillot-dev-task-feedback' });
			feedbackCell.textContent = entry.resultMessage ? (entry.resultMessage.length > 50 ? entry.resultMessage.substring(0, 50) + '...' : entry.resultMessage) : '-';
			if (entry.resultMessage) {
				feedbackCell.title = entry.resultMessage;
			}
		}
	}

	private detectLogLevel(line: string): 'debug' | 'info' | 'warn' | 'error' | null {
		const levelMatch = line.match(/\[(DEBUG|INFO|WARN|ERROR)\s*\]/i);
		if (levelMatch) {
			const level = levelMatch[1].toUpperCase();
			if (level === 'ERROR') return 'error';
			if (level === 'WARN') return 'warn';
			if (level === 'INFO') return 'info';
			if (level === 'DEBUG') return 'debug';
		}
		return null;
	}

	private renderVault(container: HTMLElement) {
		const files = this.plugin.app.vault.getMarkdownFiles();

		const card = container.createDiv({ cls: 'sillot-dev-card' });
		card.createEl('h5', { text: `Vault 文件 (${files.length} 个 Markdown)` });

		const actions = card.createDiv({ cls: 'sillot-dev-actions' });
		actions.createEl('button', { text: '🔄 刷新', cls: 'sillot-dev-btn' }).onclick = () => this.render();
		actions.createEl('button', { text: '📊 扫描同步块', cls: 'sillot-dev-btn' }).onclick = () => this.scanAllSyncBlocks(files);

		const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

		const state = this.vaultPagination.getState();
		const filtered = PaginationBar.filterBySearch(
			sortedFiles, state.searchQuery, state.searchColumns,
			(file, col) => {
				switch (col) {
					case 'path': return file.path;
					case 'size': return `${(file.stat.size / 1024).toFixed(1)}KB`;
					default: return '';
				}
			}
		);

		const { pageItems } = PaginationBar.paginate(filtered, state.currentPage, state.pageSize);

		const paginationContainer = card.createDiv({ cls: 'sillot-dev-pagination' });
		this.vaultPagination.render(paginationContainer, filtered.length);

		const table = card.createEl('table', { cls: 'sillot-dev-table' });
		const thead = table.createEl('thead');
		thead.createEl('tr').innerHTML = '<th>路径</th><th>大小</th><th>修改时间</th><th>同步块</th>';
		const tbody = table.createEl('tbody');

		for (const file of pageItems) {
			const row = tbody.createEl('tr');
			row.createEl('td', { text: file.path });
			row.createEl('td', { text: `${(file.stat.size / 1024).toFixed(1)}KB` });
			row.createEl('td', { text: new Date(file.stat.mtime).toLocaleString() });
			const syncCell = row.createEl('td', { text: '...', cls: 'sillot-dev-sync-count' });
			syncCell.dataset.filePath = file.path;
		}
	}

	private async scanAllSyncBlocks(files: TFile[]) {
		if (!this.plugin.syncManager) {
			new Notice('未配置 SyncManager');
			return;
		}
		const notice = new Notice('扫描中...', 0);
		let totalBlocks = 0;
		const syncMgr = this.plugin.syncManager;

		for (const file of files) {
			try {
				const content = await this.plugin.app.vault.read(file);
				const blocks = syncMgr.parseSyncBlocks(content, file.path);
				totalBlocks += blocks.length;

				const cell = this.contentEl.querySelector(`[data-file-path="${file.path}"]`);
				if (cell) {
					const docBlocks = blocks.filter(b => b.scope === 'document').length;
					const globalBlocks = blocks.filter(b => b.scope === 'global').length;
					cell.textContent = `${blocks.length} (G:${globalBlocks} D:${docBlocks})`;
				}
			} catch {}
		}

		notice.hide();
		new Notice(`扫描完成：${files.length} 个文件，${totalBlocks} 个同步块`);
		this.addLog('info', `Vault 扫描完成`, `${files.length} 文件, ${totalBlocks} 同步块`);
	}

	private addStatusItem(container: HTMLElement, label: string, value: string, status: 'ok' | 'error' | 'warn' | 'info') {
		const item = container.createDiv({ cls: 'sillot-dev-status-item' });
		item.createEl('span', { text: label, cls: 'sillot-dev-status-label' });
		const valueEl = item.createEl('span', { text: value, cls: `sillot-dev-status-value sillot-dev-status-${status}` });
		return valueEl;
	}

	addLog(level: 'info' | 'warn' | 'error', message: string, detail?: string) {
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		const timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${now.getMilliseconds().toString().padStart(3, '0')}`;

		this.logs.push({ timestamp, level, message, detail });
		if (this.logs.length > this.maxLogs) {
			this.logs = this.logs.slice(-this.maxLogs);
		}

		if (this.currentTab === 'logs') {
			this.render();
		}
	}

	private async checkAllNetwork(statusArea: HTMLElement) {
		statusArea.empty();
		statusArea.createEl('p', { text: '⏳ 正在检测...', cls: 'sillot-dev-hint' });

		const results: { service: string; ok: boolean; detail: string; elapsed: number }[] = [];

		const githubResult = await this.testGitHub();
		results.push(githubResult);

		const siteResult = await this.testSite();
		results.push(siteResult);

		const kdocsResult = await this.testKDocs();
		results.push(kdocsResult);

		statusArea.empty();
		for (const r of results) {
			this.addStatusItem(statusArea, r.service, `${r.ok ? '✅' : '❌'} ${r.detail} (${r.elapsed}ms)`, r.ok ? 'ok' : 'error');
		}

		this.addLog('info', '网络检测完成', results.map(r => `${r.service}: ${r.ok ? 'OK' : 'FAIL'} (${r.elapsed}ms)`).join(', '));
	}

	private async checkGitHub(statusArea: HTMLElement) {
		statusArea.empty();
		statusArea.createEl('p', { text: '⏳ 检测 GitHub...', cls: 'sillot-dev-hint' });
		const result = await this.testGitHub();
		statusArea.empty();
		this.addStatusItem(statusArea, 'GitHub API', `${result.ok ? '✅' : '❌'} ${result.detail} (${result.elapsed}ms)`, result.ok ? 'ok' : 'error');
	}

	private async checkSite(statusArea: HTMLElement) {
		statusArea.empty();
		statusArea.createEl('p', { text: '⏳ 检测站点...', cls: 'sillot-dev-hint' });
		const result = await this.testSite();
		statusArea.empty();
		this.addStatusItem(statusArea, '站点域名', `${result.ok ? '✅' : '❌'} ${result.detail} (${result.elapsed}ms)`, result.ok ? 'ok' : 'error');
	}

	private async checkKDocs(statusArea: HTMLElement) {
		statusArea.empty();
		statusArea.createEl('p', { text: '⏳ 检测 KDocs...', cls: 'sillot-dev-hint' });
		const result = await this.testKDocs();
		statusArea.empty();
		this.addStatusItem(statusArea, 'KDocs', `${result.ok ? '✅' : '❌'} ${result.detail} (${result.elapsed}ms)`, result.ok ? 'ok' : 'error');
	}

	private async testGitHub(): Promise<{ service: string; ok: boolean; detail: string; elapsed: number }> {
		const start = Date.now();
		try {
			const { requestUrl } = require('obsidian') as typeof import('obsidian');
			const res = await requestUrl({ url: 'https://api.github.com/zen', throw: false });
			return { service: 'GitHub API', ok: true, detail: '可访问', elapsed: Date.now() - start };
		} catch (e) {
			return { service: 'GitHub API', ok: false, detail: e.message, elapsed: Date.now() - start };
		}
	}

	private async testSite(): Promise<{ service: string; ok: boolean; detail: string; elapsed: number }> {
		const start = Date.now();
		try {
			const s = this.plugin.settings;
			const siteUrl = s.siteDomain || (s.githubRepo
				? `https://${s.githubRepo.split('/')[0]}.github.io/${s.githubRepo.split('/')[1] || ''}`
				: '');
			if (!siteUrl) {
				return { service: '站点域名', ok: false, detail: '未配置站点域名和仓库', elapsed: 0 };
			}
			const { requestUrl } = require('obsidian') as typeof import('obsidian');
			await requestUrl({ url: siteUrl, throw: false });
			return { service: '站点域名', ok: true, detail: siteUrl, elapsed: Date.now() - start };
		} catch (e) {
			return { service: '站点域名', ok: false, detail: e.message, elapsed: Date.now() - start };
		}
	}

	private async testKDocs(): Promise<{ service: string; ok: boolean; detail: string; elapsed: number }> {
		const start = Date.now();
		if (!this.plugin.syncManager) {
			return { service: 'KDocs', ok: false, detail: '未配置 SyncManager', elapsed: 0 };
		}
		try {
			const result = await this.plugin.syncManager.healthCheck();
			return { service: 'KDocs', ok: result.ok, detail: result.detail, elapsed: Date.now() - start };
		} catch (e) {
			return { service: 'KDocs', ok: false, detail: e.message, elapsed: Date.now() - start };
		}
	}

	private async runConnectionTest() {
		if (!this.plugin.syncManager) {
			new Notice('未配置 SyncManager');
			return;
		}
		new Notice('正在测试连接...', 2000);
		const start = Date.now();
		try {
			const result = await this.plugin.syncManager.healthCheck();
			const elapsed = Date.now() - start;
			this.addLog(result.ok ? 'info' : 'error', `连接测试 (${elapsed}ms)`, result.detail);
			new Notice(`${result.ok ? '✅' : '❌'} ${result.detail} (${elapsed}ms)`, 5000);
		} catch (e) {
			this.addLog('error', '连接测试异常', e.message);
			new Notice(`❌ 异常: ${e.message}`);
		}
	}

	private async parseCurrentDoc() {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('请先打开一个文档');
			return;
		}
		const content = await this.plugin.app.vault.read(activeFile);
		if (!this.plugin.syncManager) {
			new Notice('未配置 SyncManager');
			return;
		}
		const blocks = this.plugin.syncManager.parseSyncBlocks(content, activeFile.path);

		const detail = blocks.map(b => `[${b.scope}/${b.type}] ${b.syncId} (content=${b.content.length}chars, time=${b.localTime || '-'})`).join('\n');
		this.addLog('info', `解析文档: ${activeFile.path}`, `${blocks.length} 个同步块\n${detail || '无'}`);
		new Notice(`解析完成：${blocks.length} 个同步块`, 3000);
		this.render();
	}

	private async exportDiagnostics() {
		const s = this.plugin.settings;
		const cache = this.plugin.syncCache;
		const activeFile = this.plugin.app.workspace.getActiveFile();
		const vaultRoot = (this.plugin.app.vault.adapter as any).basePath || '';
		const pluginDir = vaultRoot ? `${vaultRoot}.obsidian${vaultRoot.endsWith('\\') ? '' : '\\'}plugins${vaultRoot.endsWith('\\') ? '' : '\\'}sillot` : '';

		const diag = {
			timestamp: new Date().toISOString(),
			plugin: {
				version: (this.plugin.app as any).plugins?.manifests?.['sillot']?.version || 'dev',
				isMobile: (this.plugin.app as any).isMobile || false,
				settings: {
					githubConfigured: !!s.githubToken && !!s.githubRepo,
					kdocsConfigured: !!s.kdocsWebhookUrl && !!s.airscriptToken,
					defaultBranch: s.defaultBranch,
					docSyncPanelState: s.docSyncPanelState,
					siteDomain: s.siteDomain || '未配置',
				},
			},
			paths: {
				vaultRoot: vaultRoot || 'N/A (mobile)',
				pluginDir: pluginDir || 'N/A (mobile)',
				configFile: pluginDir ? `${pluginDir}${vaultRoot.endsWith('\\') ? '' : '\\'}data.json` : 'N/A',
				activeFile: activeFile ? (vaultRoot ? `${vaultRoot}${activeFile.path}` : activeFile.path) : null,
				localVuePressRoot: s.localVuePressRoot || '未配置',
				siteDomain: s.siteDomain || '未配置',
			},
			cache: {
				listCount: cache.list.length,
				contentCount: Object.keys(cache.content).length,
			},
			activeFile: activeFile ? {
				path: activeFile.path,
				size: activeFile.stat.size,
				mtime: new Date(activeFile.stat.mtime).toISOString(),
			} : null,
			vault: {
				fileCount: this.plugin.app.vault.getMarkdownFiles().length,
			},
			logs: this.logs.slice(-20),
		};

		const json = JSON.stringify(diag, null, 2);
		await navigator.clipboard.writeText(json);
		new Notice('诊断信息已复制到剪贴板');
		this.addLog('info', '诊断信息已导出');
	}
}
