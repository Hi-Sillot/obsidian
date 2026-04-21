import { Plugin, Notice, TFile, Menu, MarkdownView, Modal, App, Setting, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';
import { VuePressPublisherSettingTab } from './setting-tab';
import { StyleInjector } from './preview/styleInjector';
import { registerSyncBlockRenderer } from './preview/syncBlockRenderer';
import { FileCollector } from './sync/fileCollector';
import { PathMapper } from './sync/pathMapper';
import { GitHubApi } from './sync/githubApi';
import { SyncManager } from './sync/SyncManager';
import { PublishModal } from './ui/PublishModal';
import { PluginSyncView, VIEW_TYPE_PLUGIN_SYNC } from './ui/PluginSyncView';
import { DevPanelView, VIEW_TYPE_DEV_PANEL } from './ui/DevPanelView';
import { DocSyncPanel } from './ui/DocSyncPanel';
import { PublishPanelView, VIEW_TYPE_PUBLISH } from './ui/PublishPanelView';
import { PublishStatusChecker } from './sync/PublishStatusChecker';
import { BridgeManager } from './bridge/BridgeManager';
import { BridgeCssInjector } from './bridge/BridgeCssInjector';
import { SyntaxRegistry } from './bridge/SyntaxRegistry';
import { BiGraphView, VIEW_TYPE_BIGRAPH } from './bigraph/BiGraphView';
import { BiGraphWebView, VIEW_TYPE_BIGRAPH_WEB } from './bigraph/BiGraphWebView';
import { BiGraphService } from './bigraph/BiGraphService';
import type { BiGraphConfig } from './bigraph/types';
import { DEFAULT_BIGRAPH_CONFIG } from './bigraph/types';
import type { PluginSettings, PublishResult, SyncCache, SyncCacheEntry } from './types';
import { DEFAULT_SETTINGS } from './types';
import { Logger } from './utils/Logger';
import { TaskTracker } from './utils/TaskTracker';
import { PRCheckPoller } from './utils/PRCheckPoller';

export default class VuePressPublisherPlugin extends Plugin {
	settings: PluginSettings;
	styleInjector: StyleInjector;
	syncManager: SyncManager | null = null;
	syncCache: SyncCache = { list: [], content: {} };
	private docSyncPanel: DocSyncPanel | null = null;
	bridgeManager: BridgeManager;
	bridgeCssInjector: BridgeCssInjector;
	syntaxRegistry: SyntaxRegistry;
	biGraphService: BiGraphService | null = null;
	publishStatusChecker: PublishStatusChecker | null = null;
	logger: Logger;
	taskTracker: TaskTracker;
	prCheckPoller: PRCheckPoller;

	async onload() {
		const loadData = await this.loadData() || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadData);
		this.syncCache = loadData.syncCache || { list: [], content: {} };

		this.logger = new Logger(this.app, () => this.settings);
		this.logger.banner(this.manifest.version);
		this.logger.info('Plugin', '插件加载开始');

		this.taskTracker = new TaskTracker();
		this.prCheckPoller = new PRCheckPoller(this.logger);

		const savedResults = loadData.prCheckResults;
		if (Array.isArray(savedResults) && savedResults.length > 0) {
			this.prCheckPoller.restoreResults(savedResults);
		}
		const savedPending = loadData.prCheckPending;
		if (Array.isArray(savedPending) && savedPending.length > 0) {
			this.prCheckPoller.restoreFromData(savedPending, () => this.createGitHubApi());
		}
		this.prCheckPoller.onChange(() => this.savePRCheckPending());

		const statusBarItem = this.addStatusBarItem();
		statusBarItem.addClass('sillot-task-statusbar');
		statusBarItem.style.display = 'none';
		const statusBarIcon = statusBarItem.createSpan({ cls: 'sillot-task-statusbar-icon', text: '⏳' });
		const statusBarCount = statusBarItem.createSpan({ cls: 'sillot-task-statusbar-count' });
		const statusBarText = statusBarItem.createSpan({ cls: 'sillot-task-statusbar-text', text: '' });

		let statusBarPopup: HTMLElement | null = null;
		const closePopup = () => {
			if (statusBarPopup) {
				statusBarPopup.remove();
				statusBarPopup = null;
			}
		};
		const showTaskPopup = () => {
			closePopup();
			const tasks = this.taskTracker.getActiveTasks();
			const pendingChecks = this.prCheckPoller.getPendingForPersistence();
			const allResults = this.prCheckPoller.getAllResults();
			const hasContent = tasks.length > 0 || pendingChecks.length > 0;
			if (!hasContent) return;

			statusBarPopup = document.body.createDiv({ cls: 'sillot-task-statusbar-popup' });
			const rect = statusBarItem.getBoundingClientRect();
			statusBarPopup.style.position = 'fixed';
			statusBarPopup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
			statusBarPopup.style.right = `${window.innerWidth - rect.right}px`;

			const header = statusBarPopup.createDiv({ cls: 'sillot-task-statusbar-popup-header' });
			const headerParts: string[] = [];
			if (tasks.length > 0) headerParts.push(`${tasks.length} 任务`);
			if (pendingChecks.length > 0) headerParts.push(`${pendingChecks.length} PR检查`);
			header.createSpan({ text: headerParts.join(' · ') });
			const closeBtn = header.createEl('button', { text: '✕', cls: 'sillot-task-statusbar-popup-close' });
			closeBtn.onclick = (e) => { e.stopPropagation(); closePopup(); };

			for (const t of tasks) {
				const row = statusBarPopup.createDiv({ cls: 'sillot-task-statusbar-popup-row' });
				const bar = row.createDiv({ cls: 'sillot-task-statusbar-popup-bar' });
				const fill = bar.createDiv({ cls: 'sillot-task-statusbar-popup-fill' });
				if (t.progress < 0) {
					bar.addClass('sillot-task-statusbar-popup-bar--indeterminate');
				} else {
					fill.style.width = `${Math.max(0, Math.min(100, t.progress))}%`;
				}
				row.createDiv({ cls: 'sillot-task-statusbar-popup-label', text: t.label }).title = t.label;
			}

			for (const info of pendingChecks) {
				const result = allResults.get(String(info.prNumber));
				const status = result?.status || 'pending';
				const icon = status === 'pending' ? '⏳' : status === 'success' ? '✅' : status === 'warning' ? '⚠️' : status === 'failure' ? '❌' : '🔌';
				const row = statusBarPopup.createDiv({ cls: 'sillot-task-statusbar-popup-row sillot-task-statusbar-popup-prcheck' });
				row.createSpan({ text: icon, cls: 'sillot-task-statusbar-popup-prcheck-icon' });
				const label = row.createDiv({ cls: 'sillot-task-statusbar-popup-label', text: `PR #${info.prNumber} ${status === 'pending' ? '构建检查中...' : '检查完成'}` });
				label.title = `分支: ${info.branch}`;

				if (status !== 'pending') {
					row.addClass('sillot-task-statusbar-popup-prcheck--done');
					row.onclick = () => {
						closePopup();
						const { PRCheckModal } = require('./ui/PRCheckModal');
						const modal = new PRCheckModal(this.app, this, info.prNumber, info.branch);
						modal.open();
					};
				}
			}

			const onClickOutside = (e: MouseEvent) => {
				if (statusBarPopup && !statusBarPopup.contains(e.target as Node) && e.target !== statusBarItem) {
					closePopup();
					document.removeEventListener('click', onClickOutside);
				}
			};
			setTimeout(() => document.addEventListener('click', onClickOutside), 0);
		};

		statusBarItem.onclick = () => {
			if (statusBarPopup) {
				closePopup();
			} else {
				showTaskPopup();
			}
		};

		const updateStatusBar = () => {
			const tasks = this.taskTracker.getActiveTasks();
			const pendingChecks = this.prCheckPoller.getPendingForPersistence();
			const hasActive = tasks.length > 0 || pendingChecks.length > 0;
			if (!hasActive) {
				statusBarItem.style.display = 'none';
				closePopup();
			} else {
				statusBarItem.style.display = '';
				const parts: string[] = [];
				if (tasks.length > 0) {
					const latest = tasks[tasks.length - 1];
					parts.push(latest.label);
				}
				if (pendingChecks.length > 0) {
					parts.push(`${pendingChecks.length}个PR检查中`);
				}
				statusBarText.textContent = parts.join(' · ');
				if (tasks.length > 1 || pendingChecks.length > 0) {
					statusBarCount.textContent = `${tasks.length + pendingChecks.length}`;
					statusBarCount.style.display = 'inline';
				} else {
					statusBarCount.style.display = 'none';
				}
				statusBarItem.title = [
					...tasks.map(t => t.label),
					...pendingChecks.map(p => `PR #${p.prNumber} 构建检查中`),
				].join('\n');
				if (statusBarPopup) showTaskPopup();
			}
		};
		this.taskTracker.onChange(updateStatusBar);
		this.prCheckPoller.onChange(() => updateStatusBar());

		if (this.settings.clearTaskHistoryOnStartup) {
			this.taskTracker.clearHistory();
		}
		this.styleInjector = new StyleInjector();
		this.bridgeCssInjector = new BridgeCssInjector();
		this.bridgeManager = new BridgeManager({
			app: this.app,
			localBridgePath: this.getBridgeDistPath(),
			siteDomain: this.settings.siteDomain,
			githubRepo: this.settings.githubRepo,
			githubToken: this.settings.githubToken,
			githubBranch: this.settings.defaultBranch,
			onAssetsLoaded: (assets) => this.onBridgeAssetsLoaded(assets),
			logger: this.logger,
		});
		this.syntaxRegistry = new SyntaxRegistry(this);
		this.syntaxRegistry.registerAll();

		this.initSyncManager();

		await Promise.all([
			this.loadVuePressStyles(),
			this.initBridgeAssets(),
		]);

		this.logger.info('Plugin', '插件加载完成');

		this.registerMarkdownPostProcessor((element) => {
			element.classList.add('vuepress-preview');
		});

		registerSyncBlockRenderer(this);

		const docSyncPanel = new DocSyncPanel(this);
		docSyncPanel.register();
		this.docSyncPanel = docSyncPanel;

		this.addCommand({
			id: 'publish-current-note',
			name: '发布当前笔记到 VuePress',
			checkCallback: (checking) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return false;
				if (!checking) {
					this.publishFile(activeFile);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'open-publish-panel',
			name: '打开发布管理面板',
			callback: () => {
				this.activatePublishPanel();
			},
		});

		this.addCommand({
			id: 'sync-current-note',
			name: '同步当前笔记',
			checkCallback: (checking) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return false;
				if (!checking) {
					this.syncFile(activeFile);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'sync-all-notes',
			name: '同步所有笔记',
			callback: () => {
				this.syncAllFiles();
			},
		});

		this.addCommand({
			id: 'load-vuepress-styles',
			name: '加载 VuePress 样式',
			callback: () => {
				this.loadVuePressStyles();
			},
		});

		this.addCommand({
			id: 'sync-bridge-assets',
			name: '同步 Bridge 产物',
			callback: () => {
				this.syncBridgeAssets();
			},
		});

		this.addCommand({
			id: 'open-sync-manager',
			name: '打开同步管理面板',
			callback: () => {
				this.activateSyncView();
			},
		});

		this.addCommand({
			id: 'open-dev-panel',
			name: 'DevPanel: 开发调试面板',
			callback: () => {
				this.activateDevPanel();
			},
		});

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (!(view instanceof MarkdownView)) return;
				menu.addItem((item) => {
					item.setTitle('Sillot: 插入行内同步模板')
						.setIcon('sync')
						.onClick(async () => {
							const syncId = await this.promptSyncId();
							if (!syncId) return;
							const now = new SyncManager('', '', this.app.vault).formatDateTime();
							const template = `\`sync:${syncId} Lv=${now}{}\``;
							const cursor = editor.getCursor();
							editor.replaceRange(template, cursor);
							const bracePos = template.lastIndexOf('{}');
							editor.setCursor({ line: cursor.line, ch: cursor.ch + bracePos + 1 });
						});
				});
				menu.addItem((item) => {
					item.setTitle('Sillot: 插入块级同步模板')
						.setIcon('blocks')
						.onClick(async () => {
							const syncId = await this.promptSyncId();
							if (!syncId) return;
							const now = new SyncManager('', '', this.app.vault).formatDateTime();
							const template = `\`\`\`sync-block\n${syncId} Lv=${now}\n\`\`\``;
							const cursor = editor.getCursor();
							editor.replaceRange(template, cursor);
							const lines = template.split('\n');
							editor.setCursor({ line: cursor.line + lines.length - 1, ch: 0 });
						});
				});
			})
		);

		this.addRibbonIcon('upload-cloud', '发布管理', () => {
			this.activatePublishPanel();
		});

		this.addRibbonIcon('refresh-cw', '同步管理', () => {
			this.activateSyncView();
		});

		this.registerView(VIEW_TYPE_PLUGIN_SYNC, (leaf) => {
			return new PluginSyncView(leaf, this);
		});

		this.registerView(VIEW_TYPE_DEV_PANEL, (leaf) => {
			return new DevPanelView(leaf, this);
		});

		this.registerView(VIEW_TYPE_BIGRAPH, (leaf) => {
			return new BiGraphView(leaf, this);
		});

		this.registerView(VIEW_TYPE_BIGRAPH_WEB, (leaf) => {
			return new BiGraphWebView(leaf, this);
		});

		this.registerView(VIEW_TYPE_PUBLISH, (leaf) => {
			return new PublishPanelView(leaf, this);
		});

		this.initBiGraphService();
		this.initPublishStatusChecker();

		this.addCommand({
			id: 'open-bigraph',
			name: '打开站点图谱',
			callback: () => this.activateBiGraphView(),
		});

		this.addCommand({
			id: 'open-bigraph-local',
			name: '打开当前文件局部图谱',
			callback: () => this.activateBiGraphLocalView(),
		});

		this.addRibbonIcon('git-branch', '站点图谱', () => {
			this.activateBiGraphView();
		});

		this.addSettingTab(new VuePressPublisherSettingTab(this.app, this));
	}

	onunload() {
		this.logger.info('Plugin', '插件卸载');
		this.prCheckPoller.stopAll();
		this.logger.flush();
		this.styleInjector.remove();
		this.bridgeCssInjector.remove();
		if (this.docSyncPanel) {
			this.docSyncPanel.destroy();
			this.docSyncPanel = null;
		}
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_PLUGIN_SYNC);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DEV_PANEL);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_BIGRAPH);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_PUBLISH);
	}

	initSyncManager() {
		if (this.settings.kdocsWebhookUrl && this.settings.airscriptToken) {
			this.syncManager = new SyncManager(this.settings.kdocsWebhookUrl, this.settings.airscriptToken, this.app.vault, this.logger);
			this.syncManager.onCacheUpdate = (entry) => this.updateSyncContentCache(entry);
			this.logger.info('SyncManager', '已初始化');
		} else {
			this.syncManager = null;
			this.logger.debug('SyncManager', '未配置，跳过初始化');
		}
	}

	async loadVuePressStyles() {
		const { githubRepo, githubToken, stylesPath, defaultBranch } = this.settings;
		if (githubToken && githubRepo && stylesPath) {
			this.logger?.debug('Style', `加载样式: ${githubRepo}/${stylesPath}`);
			await this.styleInjector.loadStylesFromGitHub(githubRepo, githubToken, stylesPath, defaultBranch);
			this.styleInjector.inject();
			this.logger?.info('Style', 'VuePress 样式加载并注入成功');
		}
	}

	getBridgeDistPath(): string {
		const vpRoot = this.settings.localVuePressRoot || '';
		if (!vpRoot) return '';
		const sep = vpRoot.includes('\\') ? '\\' : '/';
		return `${vpRoot}${sep}${this.settings.vuepressDocsDir.replace(/\//g, sep)}${sep}.vuepress${sep}dist${sep}obsidian-bridge`;
	}

	async syncBridgeAssets() {
		await this.bridgeManager.loadFromCache();

		try {
			const assets = await this.bridgeManager.sync();
			this.onBridgeAssetsLoaded(assets);
			this.logger.info('Bridge', 'Bridge 产物同步成功');
		} catch (e) {
			this.logger.warn('Bridge', 'Bridge 产物同步失败（非致命）', e.message);
		}
	}

	async initBridgeAssets() {
		const cacheLoaded = await this.bridgeManager.loadFromCache();
		if (cacheLoaded) {
			this.onBridgeAssetsLoaded(this.bridgeManager.getAssets());
			this.logger.info('Bridge', '从缓存恢复 Bridge 产物');
		}

		this.bridgeManager.sync().then((assets) => {
			this.onBridgeAssetsLoaded(assets);
			this.logger.info('Bridge', 'Bridge 产物同步成功');
		}).catch((e) => {
			if (!cacheLoaded) {
				this.logger.warn('Bridge', 'Bridge 产物同步失败（非致命）', e.message);
			}
		});
	}

	onBridgeAssetsLoaded(assets: any) {
		if (assets.bridgeCss) {
			this.bridgeCssInjector.loadFromText(assets.bridgeCss);
			this.bridgeCssInjector.inject();
		}

		if (assets.syntaxDescriptors?.syntaxes && assets.componentProps?.components) {
			this.syntaxRegistry.loadFromDescriptors(
				assets.syntaxDescriptors.syntaxes,
				assets.componentProps.components,
			);
		}

		if (assets.pathMap?.entries && this.biGraphService) {
			this.biGraphService.updatePathMap(assets.pathMap.entries);
		}

		if (assets.pathMap?.entries && this.publishStatusChecker) {
			this.publishStatusChecker.updatePathMap(assets.pathMap.entries);
		}
	}

	initBiGraphService() {
		const config: BiGraphConfig = {
			...DEFAULT_BIGRAPH_CONFIG,
			siteDomain: this.settings.siteDomain || '',
		};
		this.biGraphService = new BiGraphService(this.app, config, this.logger);

		const assets = this.bridgeManager.getAssets();
		if (assets.pathMap?.entries) {
			this.biGraphService.updatePathMap(assets.pathMap.entries);
		}
	}

	initPublishStatusChecker() {
		this.publishStatusChecker = new PublishStatusChecker(this.app, {
			localVuePressRoot: this.settings.localVuePressRoot,
			siteDomain: this.settings.siteDomain,
			vuepressDocsDir: this.settings.vuepressDocsDir,
			publishRootPath: this.settings.publishRootPath,
			vaultSyncPaths: this.settings.vaultSyncPaths,
			githubRepo: this.settings.githubRepo,
			githubToken: this.settings.githubToken,
			githubBranch: this.settings.defaultBranch,
			logger: this.logger,
		});

		const assets = this.bridgeManager.getAssets();
		if (assets.pathMap?.entries) {
			this.publishStatusChecker.updatePathMap(assets.pathMap.entries);
		}
	}

	refreshPublishPanel() {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PUBLISH)[0];
		if (leaf && leaf.view instanceof PublishPanelView) {
			leaf.view.refreshStatus();
		}
	}

	refreshDocSyncPanel() {
		if (this.docSyncPanel) {
			this.docSyncPanel.update();
		}
	}

	cleanVaultSyncPaths() {
		const paths = this.settings.vaultSyncPaths;
		if (paths.includes('/')) return;

		const validPaths: string[] = [];
		for (const p of paths) {
			const normalized = p.replace(/^\/+/, '').replace(/\/+$/, '');
			if (!normalized) {
				validPaths.push('/');
				continue;
			}
			const exists = this.app.vault.getAbstractFileByPath(normalized);
			if (exists) {
				validPaths.push(p);
			}
		}

		if (validPaths.length !== paths.length) {
			this.settings.vaultSyncPaths = validPaths;
			this.saveSettings();
			if (this.publishStatusChecker) {
				this.publishStatusChecker.updateConfig({ vaultSyncPaths: validPaths });
			}
		}
	}

	ensureFileInSyncPaths(file: TFile) {
		const paths = this.settings.vaultSyncPaths;
		if (paths.includes('/')) return;

		const checker = this.publishStatusChecker;
		if (checker && checker.isFileInSyncPaths(file)) return;

		const filePath = file.path;
		if (paths.includes(filePath)) return;

		const updated = [...paths, filePath];
		this.settings.vaultSyncPaths = updated;
		this.saveSettings();
		if (this.publishStatusChecker) {
			this.publishStatusChecker.updateConfig({ vaultSyncPaths: updated });
		}
	}

	async activatePublishPanel() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_PUBLISH)[0] || null;
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_PUBLISH, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateBiGraphView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_BIGRAPH)[0] || null;
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_BIGRAPH, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateBiGraphLocalView() {
		await this.activateBiGraphView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_BIGRAPH)[0];
		if (leaf && leaf.view instanceof BiGraphView) {
			leaf.view.focusCurrentFile();
		}
	}

	async openSitePreview(url: string) {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_BIGRAPH_WEB)[0] || null;
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_BIGRAPH_WEB, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
			const view = leaf.view as BiGraphWebView;
			await view.onLoadUrl(url);
		}
	}

	async publishFile(file: TFile) {
		const { githubRepo, githubToken, vuepressDocsDir, defaultBranch, publishBranchPrefix, publishCreatePR } = this.settings;
		if (!githubToken || !githubRepo) {
			new Notice('请先在插件设置中配置 GitHub Token 和仓库');
			return;
		}

		this.logger.info('Publish', `开始发布: ${file.path}`);

		new PublishModal(this.app, defaultBranch, publishBranchPrefix, publishCreatePR, async (result: PublishResult) => {
			const taskId = `publish-file-${Date.now()}`;
			this.taskTracker.startTask(taskId, `发布 ${file.name}...`);
			const notice = new Notice('正在收集文件...', 0);

			try {
				const collector = new FileCollector(this.app.vault, this.app.metadataCache);
				const collected = await collector.collectForPublish(file);

				const mapper = new PathMapper({ docsDir: vuepressDocsDir, publishRootPath: this.settings.publishRootPath });

				const mdContent = await this.app.vault.read(collected.md);
				const mdTargetPath = mapper.mapMarkdownPath(collected.md.path);
				const publishFiles: { path: string; content: string }[] = [
					{ path: mdTargetPath, content: btoa(unescape(encodeURIComponent(mdContent))) },
				];

				for (const asset of collected.assets) {
					const assetData = await this.app.vault.readBinary(asset);
					const assetTargetPath = mapper.mapAssetPath(asset.path);
					let binary = '';
					const bytes = new Uint8Array(assetData);
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]);
					}
					publishFiles.push({ path: assetTargetPath, content: btoa(binary) });
				}

				this.taskTracker.updateTask(taskId, 10, `上传 ${file.name} 到 GitHub...`);
				notice.setMessage('正在上传到 GitHub...');
				const api = new GitHubApi(githubRepo, githubToken);
				const publishResult = await api.publishFiles(publishFiles, {
					commitMessage: result.commitMessage,
					baseBranch: defaultBranch,
					targetBranch: result.branch,
					createPR: result.createPR,
					onProgress: (percent, msg) => {
						this.taskTracker.updateTask(taskId, percent, msg);
					},
				});

				if (this.syncManager) {
					try {
						await this.syncManager.client.insertPublishRecord({
							file_name: file.name,
							target_branch: result.branch,
							status: 'success',
							vuepress_path: mapper.mapMarkdownPath(file.path),
						});
					} catch {}
				}

				notice.hide();
				if (publishResult.prUrl && publishResult.prNumber) {
					this.logger.info('Publish', `发布成功: ${file.path}`, `branch=${result.branch}, PR=${publishResult.prUrl}`);
					this.taskTracker.updateTask(taskId, 90, `PR #${publishResult.prNumber} 已创建，等待构建检查...`);
					this.prCheckPoller.startPolling(
						String(publishResult.prNumber),
						{
							prNumber: publishResult.prNumber,
							branch: publishResult.branch,
							headSha: publishResult.commitSha,
							filePath: file.path,
							startedAt: Date.now(),
						},
						() => this.createGitHubApi(),
					);
					this.savePRCheckPending();

					const prNumber = publishResult.prNumber;
					const unsubscribe = this.prCheckPoller.onChange((checkResult) => {
						if (!checkResult) return;
						if (checkResult.prNumber !== prNumber) return;
						if (checkResult.status === 'pending') {
							this.taskTracker.updateTask(taskId, 92, `PR #${prNumber} 构建检查中...`);
							return;
						}
						unsubscribe();

						if (checkResult.status === 'success') {
							this.taskTracker.endTask(taskId, 'success', `PR #${prNumber} 构建通过`);
						} else if (checkResult.status === 'warning') {
							this.taskTracker.endTask(taskId, 'success', `PR #${prNumber} 构建有警告`);
						} else {
							this.taskTracker.endTask(taskId, 'failed', `PR #${prNumber} 构建失败`);
						}

						const { PRCheckModal } = require('./ui/PRCheckModal');
						const modal = new PRCheckModal(this.app, this, prNumber, checkResult.branch);
						modal.open();
					});

					new Notice(`已创建 PR #${publishResult.prNumber}，正在等待构建检查...`);
				} else {
					new Notice('已发布！GitHub Actions 将自动构建站点。');
					this.logger.info('Publish', `发布成功: ${file.path}`, `branch=${result.branch}, commit=${publishResult.commitSha}`);
					this.taskTracker.endTask(taskId, 'success');
				}
				this.ensureFileInSyncPaths(file);
				this.cleanVaultSyncPaths();
				this.refreshDocSyncPanel();
				this.refreshPublishPanel();
			} catch (error) {
				notice.hide();
				new Notice(`发布失败：${error.message}`);
				this.logger.error('Publish', `发布失败: ${file.path}`, error.message);

				if (this.syncManager) {
					try {
						await this.syncManager.client.insertPublishRecord({
							file_name: file.name,
							target_branch: result.branch,
							status: 'failed',
							error_message: error.message,
						});
					} catch {}
				}
				this.taskTracker.endTask(taskId, 'failed', error.message);
			}
		}).open();
	}

	async syncFile(file: TFile) {
		if (!this.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		this.logger.info('Sync', `开始同步: ${file.path}`);
		const taskId = `sync-file-${Date.now()}`;
		this.taskTracker.startTask(taskId, `同步 ${file.name}...`);
		const notice = new Notice('同步中...', 0);
		try {
			const result = await this.syncManager.syncFile(file);
			notice.hide();
			this.logger.info('Sync', `同步完成: ${file.path}`, `synced=${result.synced}, conflicts=${result.conflicts}`);
			new Notice(`同步完成：${result.synced} 项，冲突 ${result.conflicts} 项`);
			this.taskTracker.endTask(taskId, 'success');
		} catch (error) {
			notice.hide();
			this.logger.error('Sync', `同步失败: ${file.path}`, error.message);
			new Notice(`同步失败：${error.message}`);
			this.taskTracker.endTask(taskId, 'failed', error.message);
		}
	}

	async syncAllFiles() {
		if (!this.syncManager) {
			new Notice('请先配置金山文档 Webhook URL');
			return;
		}
		this.logger.info('Sync', '开始同步所有笔记');
		const files = this.app.vault.getMarkdownFiles();
		const taskId = `sync-all-${Date.now()}`;
		this.taskTracker.startTask(taskId, '同步所有笔记...');
		const notice = new Notice('同步所有笔记中...', 0);
		let totalSynced = 0;
		let totalConflicts = 0;
		for (const file of files) {
			try {
				const result = await this.syncManager.syncFile(file);
				totalSynced += result.synced;
				totalConflicts += result.conflicts;
				this.taskTracker.updateTask(taskId, -1, `同步中 (${totalSynced} 项已完成)...`);
			} catch {}
		}
		this.taskTracker.endTask(taskId, 'success');
		this.logger.info('Sync', `全部同步完成`, `synced=${totalSynced}, conflicts=${totalConflicts}`);
		new Notice(`全部同步完成：${totalSynced} 项，冲突 ${totalConflicts} 项`);
	}

	async activateSyncView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_PLUGIN_SYNC)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_PLUGIN_SYNC, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateDevPanel() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DEV_PANEL)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_DEV_PANEL, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const data = await this.loadData() || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.syncCache = data.syncCache || { list: [], content: {} };
	}

	async saveSettings() {
		await this.saveData({ ...this.settings, syncCache: this.syncCache });
		this.initSyncManager();
	}

	createGitHubApi(): GitHubApi | null {
		if (!this.settings.githubToken || !this.settings.githubRepo) return null;
		return new GitHubApi(this.settings.githubRepo, this.settings.githubToken);
	}

	async savePRCheckPending() {
		const data = await this.loadData() || {};
		data.prCheckPending = this.prCheckPoller.getPendingForPersistence();
		data.prCheckResults = this.prCheckPoller.getResultsForPersistence();
		await this.saveData(data);
	}

	updateSyncListCache(list: SyncCacheEntry[]) {
		this.syncCache.list = list;
		for (const item of list) {
			this.syncCache.content[item.sync_id] = item;
		}
		this.saveData({ ...this.settings, syncCache: this.syncCache });
	}

	updateSyncContentCache(entry: SyncCacheEntry) {
		this.syncCache.content[entry.sync_id] = entry;
		const idx = this.syncCache.list.findIndex(i => i.sync_id === entry.sync_id);
		if (idx >= 0) {
			this.syncCache.list[idx] = entry;
		}
		this.saveData({ ...this.settings, syncCache: this.syncCache });
	}

	promptSyncId(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new SyncIdPromptModal(this.app, resolve);
			modal.open();
		});
	}
}

class SyncIdPromptModal extends Modal {
	private syncId = '';
	private resolve: (value: string | null) => void;

	constructor(app: App, resolve: (value: string | null) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: '输入同步块 ID' });

		new Setting(contentEl)
			.setName('Sync ID')
			.setDesc('文档级同步块标识符，如 my-section')
			.addText(text => text
				.setPlaceholder('例如 my-section')
				.onChange(v => this.syncId = v)
				.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						const id = this.syncId.trim();
						this.close();
						this.resolve(id || null);
					}
				}));

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('确定')
				.setCta()
				.onClick(() => {
					const id = this.syncId.trim();
					this.close();
					this.resolve(id || null);
				}))
			.addButton(btn => btn
				.setButtonText('取消')
				.onClick(() => {
					this.close();
					this.resolve(null);
				}));
	}

	onClose() {
		this.contentEl.empty();
	}
}
