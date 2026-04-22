import { Plugin, Notice, TFile, Menu, MarkdownView, Modal, App, Setting, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';
import { VuePressPublisherSettingTab } from './setting-tab';
import { StyleInjector } from './preview/styleInjector';
import { registerSyncBlockRenderer } from './preview/syncBlockRenderer';
import { FileCollector } from './sync/fileCollector';

function formatSyncDateTime(date: Date = new Date()): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
import { PathMapper } from './sync/pathMapper';
import { GitHubApi } from './sync/githubApi';
import { SyncManager } from './sync/SyncManager';
import { PublishModal } from './ui/PublishModal';
import { DocSyncPanel } from './ui/DocSyncPanel';
import { PublishStatusChecker } from './sync/PublishStatusChecker';
import { BridgeManager } from './bridge/BridgeManager';
import { BridgeCssInjector } from './bridge/BridgeCssInjector';
import { SyntaxRegistry } from './bridge/SyntaxRegistry';
import { BiGraphService } from './bigraph/BiGraphService';
import type { BiGraphConfig } from './bigraph/types';
import { DEFAULT_BIGRAPH_CONFIG } from './bigraph/types';
import type { PluginSettings, PublishResult, SyncCache, SyncCacheEntry } from './types';
import { DEFAULT_SETTINGS } from './types';
import { Logger } from './utils/Logger';
import { TaskTracker } from './utils/TaskTracker';
import { PRCheckPoller } from './utils/PRCheckPoller';
import { StatusBarManager } from './ui/StatusBarManager';
import { ViewManager } from './ui/ViewManager';
import { VIEW_TYPE_PUBLISH } from './ui/PublishPanelView';
import { ConfigEditorModal } from './ui/ConfigEditorModal';
import { MoveDocumentModal } from './ui/MoveDocumentModal';
import { PublishPanelView } from './ui/PublishPanelView';
import { DocumentTreeService } from './sync/DocumentTreeService';
import { PullDocumentModal } from './ui/PullDocumentModal';

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
	statusBarManager: StatusBarManager;
	viewManager: ViewManager;
	documentTreeService: DocumentTreeService | null = null;

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

		this.statusBarManager = new StatusBarManager(this);
		this.statusBarManager.bindTracker(this.taskTracker, this.prCheckPoller);

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
			deployBranch: this.settings.deployBranch,
			onAssetsLoaded: (assets) => this.onBridgeAssetsLoaded(assets),
			logger: this.logger,
		});
		this.syntaxRegistry = new SyntaxRegistry(this);
		this.syntaxRegistry.registerAll();

		this.initSyncManager();
		this.initDocumentTreeService();

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
				this.viewManager.activatePublishPanel();
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
				this.viewManager.activateSyncView();
			},
		});

		this.addCommand({
			id: 'pull-from-cloud',
			name: '从云端拉取文档',
			callback: () => {
				this.openPullDocumentModal();
			},
		});

		this.addCommand({
			id: 'open-dev-panel',
			name: 'DevPanel: 开发调试面板',
			callback: () => {
				this.viewManager.activateDevPanel();
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
							const now = formatSyncDateTime();
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
							const now = formatSyncDateTime();
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
			this.viewManager.activatePublishPanel();
		});

		this.addRibbonIcon('refresh-cw', '同步管理', () => {
			this.viewManager.activateSyncView();
		});

		this.addRibbonIcon('download', '从云端拉取', () => {
			this.openPullDocumentModal();
		});

		this.viewManager = new ViewManager(this);
		this.viewManager.registerViews();

		this.initBiGraphService();
		this.initPublishStatusChecker();

		this.addCommand({
			id: 'open-bigraph',
			name: '打开站点图谱',
			callback: () => this.viewManager.activateBiGraphView(),
		});

		this.addCommand({
			id: 'open-bigraph-local',
			name: '打开当前文件局部图谱',
			callback: () => this.viewManager.activateBiGraphLocalView(),
		});

		this.addRibbonIcon('git-branch', '站点图谱', () => {
			this.viewManager.activateBiGraphView();
		});

		this.addCommand({
			id: 'edit-site-config',
			name: '编辑站点配置',
			callback: () => {
				if (!this.settings.githubToken || !this.settings.githubRepo) {
					new Notice('请先在插件设置中配置 GitHub Token 和仓库');
					return;
				}
				new ConfigEditorModal(this.app, this, () => {
					this.logger.info('Config', '站点配置已更新');
				}).open();
			},
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
		if (this.statusBarManager) {
			this.statusBarManager.destroy();
		}
		if (this.viewManager) {
			this.viewManager.detachAll();
		}
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

	initDocumentTreeService() {
		if (!this.settings.githubRepo || !this.settings.githubToken) {
			this.documentTreeService = null;
			this.logger.debug('DocumentTreeService', '未配置 GitHub，跳过初始化');
			return;
		}
		const githubApi = new GitHubApi(this.settings.githubRepo, this.settings.githubToken);
		const pathMapper = new PathMapper({ docsDir: this.settings.vuepressDocsDir, publishRootPath: this.settings.publishRootPath });
		this.documentTreeService = new DocumentTreeService(this.app.vault, githubApi, pathMapper);
		this.logger.info('DocumentTreeService', '已初始化');
	}

	openPullDocumentModal() {
		if (!this.documentTreeService) {
			new Notice('请先在插件设置中配置 GitHub Token 和仓库');
			return;
		}
		const vaultRoot = this.app.vault.getRoot().name;
		const modal = new PullDocumentModal(this.app, this.documentTreeService, {
			vaultRoot,
			githubRepo: this.settings.githubRepo,
			githubBranch: this.settings.defaultBranch,
			siteDomain: this.settings.siteDomain,
			docsDir: this.settings.vuepressDocsDir,
		});
		modal.open();
	}

	async loadVuePressStyles() {
		const { githubRepo, githubToken, stylesPath, defaultBranch } = this.settings;
		if (githubToken && githubRepo && stylesPath) {
			this.logger?.debug('Style', `加载样式: ${githubRepo}/${stylesPath}`);
			this.styleInjector.setGitHubApi(this.createGitHubApi());
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

		if (assets.inlineComponents) {
			this.syntaxRegistry.loadInlineComponents(assets.inlineComponents);
		}

		if (assets.pathMap?.entries && this.biGraphService) {
			this.biGraphService.updatePathMap(assets.pathMap.entries);
		}

		if (assets.pathMap?.entries && this.publishStatusChecker) {
			this.publishStatusChecker.updatePathMap(assets.pathMap.entries);
		}

		if (this.documentTreeService) {
			this.documentTreeService.setSiteIndex({
				permalinkIndex: assets.permalinkIndex || null,
				pathMap: assets.pathMap || null,
				siteDomain: this.settings.siteDomain,
				docsDir: this.settings.vuepressDocsDir,
			});
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

	addRecentPublishPath(path: string) {
		const normalized = path.replace(/^\/+|\/+$/, '');
		const recent = this.settings.recentPublishPaths || [];
		const filtered = recent.filter((p: string) => p !== normalized);
		filtered.unshift(normalized);
		this.settings.recentPublishPaths = filtered.slice(0, 10);
		this.saveSettings();
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

	async publishFile(file: TFile) {
		const { githubRepo, githubToken, vuepressDocsDir, defaultBranch, publishBranchPrefix, publishCreatePR } = this.settings;
		if (!githubToken || !githubRepo) {
			new Notice('请先在插件设置中配置 GitHub Token 和仓库');
			return;
		}

		this.logger.info('Publish', `开始发布: ${file.path}`);

		new PublishModal(this.app, defaultBranch, publishBranchPrefix, publishCreatePR, this.settings.publishRootPath, this.settings.recentPublishPaths, async (result: PublishResult) => {
			const taskId = `publish-file-${Date.now()}`;
			this.taskTracker.startTask(taskId, `发布 ${file.name}...`);
			const notice = new Notice('正在收集文件...', 0);

			try {
				const collector = new FileCollector(this.app.vault, this.app.metadataCache);
				const collected = await collector.collectForPublish(file);

				const mapper = new PathMapper({ docsDir: vuepressDocsDir, publishRootPath: this.settings.publishRootPath });

				const mdContent = await this.app.vault.read(collected.md);
				const mdTargetPath = mapper.mapMarkdownPath(collected.md.path, result.customPublishPath);
				const publishFiles: { path: string; content: string }[] = [
					{ path: mdTargetPath, content: btoa(unescape(encodeURIComponent(mdContent))) },
				];

				for (const asset of collected.assets) {
					const assetData = await this.app.vault.readBinary(asset);
					const assetTargetPath = mapper.mapAssetPath(asset.path, result.customPublishPath);
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
				if (result.customPublishPath) {
					this.addRecentPublishPath(result.customPublishPath);
				}
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
