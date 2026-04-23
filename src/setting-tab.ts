import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import VuePressPublisherPlugin from './main';
import { SyncPathTree } from './ui/SyncPathTree';
import { UpdateInstallModal } from './ui/UpdateInstallModal';
import type { PluginSettings } from './types';
import type { UpdateCheckResult } from './utils/UpdateChecker';

export class VuePressPublisherSettingTab extends PluginSettingTab {
	plugin: VuePressPublisherPlugin;
	private syncPathTree: SyncPathTree | null = null;

	constructor(app: App, plugin: VuePressPublisherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Sillot 插件设置' });

		const intro = containerEl.createDiv({ cls: 'sillot-settings-intro' });
		intro.createEl('p', {
			text: '本插件用于将 Obsidian 笔记发布到 VuePress 站点。支持自定义组件（如 GithubLabel、VSCodeSettingsLink 等）、视频嵌入、Cedoss 常量引用等扩展语法。'
		});

		const notice = intro.createDiv({ cls: 'sillot-settings-notice' });
		notice.createEl('strong', { text: '注意事项' });
		const ul = notice.createEl('ul');
		ul.createEl('li', {
			text: '自定义组件标签（如 <GithubLabel />）在 Obsidian 的 Live Preview（实时预览）编辑模式下会被折叠为近乎透明的元素，导致难以定位和编辑。建议在使用含自定义组件的笔记时，切换到 Source Mode（源码模式）进行编辑。'
		});
		ul.createEl('li', {
			text: '切换方式：点击编辑器右上角「切换阅读/编辑视图」按钮旁的下拉菜单，选择「源码模式」；或在「设置 → 编辑器 → 默认编辑模式」中全局设为「源码模式」。'
		});
		ul.createEl('li', {
			text: '发布时插件会自动处理所有自定义组件，无需手动转换格式。'
		});

		this.renderUpdateSection(containerEl);
		this.renderGitHubSection(containerEl);
		this.renderVuePressSection(containerEl);
		this.renderSyncSection(containerEl);
		this.renderPanelSection(containerEl);
		this.renderSyncPathsSection(containerEl);
		this.renderDevSection(containerEl);
	}

	private renderUpdateSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '更新' });

		const versionEl = containerEl.createDiv({ cls: 'sillot-version-info' });
		versionEl.createSpan({ text: '当前版本: ' });
		versionEl.createEl('strong', { text: this.plugin.manifest.version });

		const updateChannelSetting = new Setting(containerEl)
			.setName('更新渠道')
			.setDesc('选择插件更新检查的来源')
			.addDropdown(dropdown => dropdown
				.addOption('github', 'GitHub')
				.addOption('github-dev', 'GitHub Dev (预发布)')
				.addOption('local', '本地')
				.setValue(this.plugin.settings.updateChannel)
				.onChange(async (value: string) => {
					this.plugin.settings.updateChannel = value as 'github' | 'github-dev' | 'local';
					await this.plugin.saveSettings();
					this.plugin.updateChecker.updateConfig({ updateChannel: value as 'github' | 'github-dev' | 'local' });
				}));

		const updateRepoSetting = new Setting(containerEl)
			.setName('更新仓库')
			.setDesc('GitHub 仓库地址，格式：owner/repo')
			.addText(text => text
				.setPlaceholder('Hi-Sillot/obsidian')
				.setValue(this.plugin.settings.updateRepo)
				.onChange(async (value) => {
					this.plugin.settings.updateRepo = value;
					await this.plugin.saveSettings();
					this.plugin.updateChecker.updateConfig({ updateRepo: value });
				}));

		new Setting(containerEl)
			.setName('检查更新')
			.setDesc('')
			.addButton(button => {
				let checking = false;
				button.setButtonText('检查更新');
				button.setCta();
				button.onClick(async () => {
					if (checking) return;
					checking = true;
					button.setDisabled(true);
					button.setButtonText('检查中...');

					try {
						if (this.plugin.settings.updateChannel === 'local') {
							const input = document.createElement('input');
							input.type = 'file';
							input.accept = '.zip,.js,.json';
							input.onchange = async () => {
								const file = input.files?.[0];
								if (!file) return;

								const fileName = file.name;
								const isZip = fileName.endsWith('.zip');
								const isJs = fileName.endsWith('.js');
								const isJson = fileName.endsWith('.json');

								try {
									if (isZip) {
										const arrayBuffer = await file.arrayBuffer();
										const jszip = await import('jszip');
										const zip = await jszip.loadAsync(arrayBuffer);
										const entries: { name: string; file: any }[] = [];
										zip.forEach((path, fileEntry) => {
											if (!fileEntry.dir) entries.push({ name: path, file: fileEntry });
										});

										const mainJsEntry = entries.find(e => e.name === 'main.js');
										const manifestEntry = entries.find(e => e.name === 'manifest.json');
										const mainCssEntry = entries.find(e => e.name === 'main.css');
										const stylesEntry = entries.find(e => e.name.startsWith('styles/') && e.name.endsWith('.css'));
										const bridgeCacheEntries = entries.filter(e => e.name.startsWith('bridge-cache/'));

										if (mainJsEntry || manifestEntry || mainCssEntry || stylesEntry || bridgeCacheEntries.length > 0) {
											const installModal = new UpdateInstallModal(this.app, this.plugin, arrayBuffer);
											installModal.setOnClose(() => {
												new Notice('插件更新已安装，请重启 Obsidian', 5000);
											});
											installModal.open();
										} else {
											new Notice(`未在压缩包中找到有效的插件文件`, 4000);
										}
									} else if (isJs || isJson) {
										const text = await file.text();
										if (isJson) {
											try {
												JSON.parse(text);
												new Notice(`已读取 ${fileName}，包含有效的 JSON 配置。`, 3000);
											} catch {
												new Notice(`${fileName} 不是有效的 JSON 文件。`, 3000);
											}
										} else {
											new Notice(`已读取 ${fileName}（${(text.length / 1024).toFixed(1)} KB），请手动替换插件文件。`, 4000);
										}
									} else {
										new Notice('不支持的文件格式，请选择 .zip、.js 或 .json 文件。', 3000);
									}
								} catch (err: any) {
									new Notice(`读取文件失败: ${err.message}`, 4000);
								}
							};
							input.click();
						} else {
							const result = await this.plugin.updateChecker.checkForUpdates();
							this.plugin.settings.lastCheckTime = Date.now();
							await this.plugin.saveSettings();

							if (result.error) {
								new Notice(`检查更新失败: ${result.error}`, 4000);
							} else if (result.hasUpdate) {
								new Notice(`发现新版本 ${result.latestVersion}！点击查看发布页。`, 6000);
							} else {
								new Notice(`当前版本 ${result.currentVersion} 已是最新`, 3000);
							}
						}
					} catch (err: any) {
						new Notice(`检查更新失败: ${err.message}`, 4000);
					} finally {
						checking = false;
						button.setDisabled(false);
						button.setButtonText('检查更新');
					}
				});
			});

		if (this.plugin.settings.lastCheckTime) {
			const lastCheckEl = containerEl.createDiv({ cls: 'sillot-last-check' });
			const date = new Date(this.plugin.settings.lastCheckTime);
			lastCheckEl.createSpan({ text: `上次检查: ${date.toLocaleString()}` });
		}

		this.renderPackPluginSection(containerEl);
	}

	private renderGitHubSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'GitHub' });

		new Setting(containerEl)
			.setName('个人访问令牌')
			.setDesc((() => {
				const f = document.createDocumentFragment();
				f.appendText('用于向 GitHub 仓库推送发布内容，需要 repo 权限。');
				f.createEl('br');
				f.appendText('创建令牌：');
				f.createEl('a', {
					cls: 'external-link',
					attr: { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank' },
					text: 'https://github.com/settings/personal-access-tokens/new'
				});
				return f;
			})())
			.addText(text => {
				text
					.setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
					.setValue(this.plugin.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.githubToken = value;
						await this.plugin.saveSettings();
						this.plugin.bridgeManager.updateConfig({ githubToken: value });
						if (this.plugin.publishStatusChecker) {
							this.plugin.publishStatusChecker.updateConfig({ githubToken: value });
						}
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('仓库地址')
			.setDesc('格式：owner/repo，如 Hi-Sillot/obsidian')
			.addText(text => text
				.setPlaceholder('owner/repo')
				.setValue(this.plugin.settings.githubRepo)
				.onChange(async (value) => {
					this.plugin.settings.githubRepo = value;
					await this.plugin.saveSettings();
					this.plugin.bridgeManager.updateConfig({ githubRepo: value });
					if (this.plugin.publishStatusChecker) {
						this.plugin.publishStatusChecker.updateConfig({ githubRepo: value });
					}
				}));

		new Setting(containerEl)
			.setName('默认分支')
			.setDesc('推送发布内容时使用的基准分支')
			.addText(text => text
				.setPlaceholder('main')
				.setValue(this.plugin.settings.defaultBranch)
				.onChange(async (value) => {
					this.plugin.settings.defaultBranch = value;
					await this.plugin.saveSettings();
					this.plugin.bridgeManager.updateConfig({ githubBranch: value });
					if (this.plugin.publishStatusChecker) {
						this.plugin.publishStatusChecker.updateConfig({ githubBranch: value });
					}
				}));

		new Setting(containerEl)
			.setName('创建 Pull Request')
			.setDesc('开启后发布时创建新分支并提交 PR，关闭则直接推送到基准分支')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.publishCreatePR)
				.onChange(async (value) => {
					this.plugin.settings.publishCreatePR = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('发布分支前缀')
			.setDesc('创建 PR 时生成的新分支名前缀，如 publish/ 会生成 publish/20260421-1430')
			.addText(text => text
				.setPlaceholder('publish/')
				.setValue(this.plugin.settings.publishBranchPrefix)
				.onChange(async (value) => {
					this.plugin.settings.publishBranchPrefix = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('启动时清空任务历史')
			.setDesc('每次启动插件时自动清空历史任务记录（默认开启）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.clearTaskHistoryOnStartup)
				.onChange(async (value) => {
					this.plugin.settings.clearTaskHistoryOnStartup = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderVuePressSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'VuePress 站点' });

		new Setting(containerEl)
			.setName('文档目录')
			.setDesc('VuePress 项目中存放 Markdown 文档的目录，相对于仓库根目录')
			.addText(text => text
				.setPlaceholder('docs')
				.setValue(this.plugin.settings.vuepressDocsDir)
				.onChange(async (value) => {
					this.plugin.settings.vuepressDocsDir = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('发布子路径')
			.setDesc('基于文档目录的子路径，用于自定义发布内容的存放位置。留空则直接发布到文档目录下。例如填 notes 则文件发布到 docs/notes/ 下')
			.addText(text => text
				.setPlaceholder('notes')
				.setValue(this.plugin.settings.publishRootPath)
				.onChange(async (value) => {
					this.plugin.settings.publishRootPath = value;
					await this.plugin.saveSettings();
					if (this.plugin.publishStatusChecker) {
						this.plugin.publishStatusChecker.updateConfig({ publishRootPath: value });
					}
					this.plugin.refreshPublishPanel();
					this.plugin.refreshDocSyncPanel();
				}));

		new Setting(containerEl)
			.setName('本地项目路径')
			.setDesc('VuePress 站点在本地的绝对路径，用于本地发布和 Diff 对比（仅桌面端）')
			.addText(text => text
				.setPlaceholder('a:\\Github\\trae\\sillot\\plume')
				.setValue(this.plugin.settings.localVuePressRoot)
				.onChange(async (value) => {
					this.plugin.settings.localVuePressRoot = value;
					await this.plugin.saveSettings();
					if (this.plugin.publishStatusChecker) {
						this.plugin.publishStatusChecker.updateConfig({ localVuePressRoot: value });
					}
					this.plugin.bridgeManager.updateConfig({ localBridgePath: this.plugin.getBridgeDistPath() });
					this.plugin.refreshPublishPanel();
					this.plugin.refreshDocSyncPanel();
				}));

		new Setting(containerEl)
			.setName('站点域名')
			.setDesc('VuePress 站点的线上地址，用于拉取 path-map.json 等 Bridge 产物和检查线上发布状态')
			.addText(text => text
				.setPlaceholder('https://your-site.github.io/repo')
				.setValue(this.plugin.settings.siteDomain)
				.onChange(async (value) => {
					this.plugin.settings.siteDomain = value;
					await this.plugin.saveSettings();
					if (this.plugin.publishStatusChecker) {
						this.plugin.publishStatusChecker.updateConfig({ siteDomain: value });
					}
					this.plugin.bridgeManager.updateConfig({ siteDomain: value });
					this.plugin.refreshPublishPanel();
					this.plugin.refreshDocSyncPanel();
				}));

		new Setting(containerEl)
			.setName('发布分支')
			.setDesc('GitHub 仓库中存放构建后站点的分支（如 gh-pages），用于拉取 Bridge 产物')
			.addText(text => text
				.setPlaceholder('gh-pages')
				.setValue(this.plugin.settings.deployBranch || '')
				.onChange(async (value) => {
					this.plugin.settings.deployBranch = value;
					await this.plugin.saveSettings();
					this.plugin.bridgeManager.updateConfig({ deployBranch: value });
				}));
	}

	private renderSyncSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '金山文档同步' });

		new Setting(containerEl)
			.setName('Webhook 地址')
			.setDesc('金山文档 AirScript Webhook URL，用于文档级同步')
			.addText(text => text
				.setPlaceholder('https://www.kdocs.cn/api/v3/office/copy/...')
				.setValue(this.plugin.settings.kdocsWebhookUrl)
				.onChange(async (value) => {
					this.plugin.settings.kdocsWebhookUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('认证令牌')
			.setDesc('AirScript Webhook 认证令牌')
			.addText(text => {
				text
					.setPlaceholder('your-token')
					.setValue(this.plugin.settings.airscriptToken)
					.onChange(async (value) => {
						this.plugin.settings.airscriptToken = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});
	}

	private renderPanelSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '面板与显示' });

		new Setting(containerEl)
			.setName('文档同步面板形态')
			.setDesc('文档底部同步面板的默认显示形态，可在面板内随时切换')
			.addDropdown(dropdown => dropdown
				.addOption('minimized', '最小化（仅图标+数量）')
				.addOption('default', '默认（紧凑表格）')
				.addOption('expanded', '展开（详细+操作）')
				.setValue(this.plugin.settings.docSyncPanelState)
				.onChange(async (value: string) => {
					this.plugin.settings.docSyncPanelState = value as 'minimized' | 'default' | 'expanded';
					await this.plugin.saveSettings();
				}));
	}

	private renderSyncPathsSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '仓库同步路径' });
		containerEl.createEl('p', {
			text: '勾选需要参与同步/发布的文件夹和文档。默认为全选（整个仓库）。取消勾选的路径将不参与发布状态检查和同步。发布后会自动清理已不存在的路径。',
			cls: 'setting-item-description',
		});

		const treeContainer = containerEl.createDiv({ cls: 'sillot-sync-paths-container' });
		this.syncPathTree = new SyncPathTree(treeContainer, this.app, {
			onSelectionChange: async (selectedPaths) => {
				this.plugin.settings.vaultSyncPaths = selectedPaths;
				await this.plugin.saveSettings();
				if (this.plugin.publishStatusChecker) {
					this.plugin.publishStatusChecker.updateConfig({ vaultSyncPaths: selectedPaths });
				}
				this.plugin.refreshPublishPanel();
				this.plugin.refreshDocSyncPanel();
			},
		});
		this.syncPathTree.buildTree(this.plugin.settings.vaultSyncPaths);
	}

	private renderDevSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '开发者选项' });

		new Setting(containerEl)
			.setName('日志级别')
			.setDesc('控制插件日志输出的最低级别，低于此级别的日志将被忽略')
			.addDropdown(dropdown => dropdown
				.addOption('debug', 'Debug（全部）')
				.addOption('info', 'Info')
				.addOption('warn', 'Warn（仅警告和错误）')
				.addOption('error', 'Error（仅错误）')
				.addOption('none', 'None（关闭日志）')
				.setValue(this.plugin.settings.logLevel)
				.onChange(async (value: string) => {
					this.plugin.settings.logLevel = value as PluginSettings['logLevel'];
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('日志文件路径')
			.setDesc('插件日志文件的存储路径，相对于 Vault 根目录')
			.addText(text => text
				.setPlaceholder('.obsidian/plugins/sillot/log/sillot.log')
				.setValue(this.plugin.settings.logFilePath)
				.onChange(async (value) => {
					this.plugin.settings.logFilePath = value;
					await this.plugin.saveSettings();
				}));
	}

	private renderPackPluginSection(containerEl: HTMLElement) {
		if (Platform.isMobile) return;

		containerEl.createEl('h3', { text: '打包插件' });

		let versionInputEl: HTMLInputElement | null = null;
		new Setting(containerEl)
			.setName('自定义版本号')
			.setDesc('留空则使用当前版本号（当前：' + this.plugin.manifest.version + '）')
			.addText(text => {
				text.inputEl.classList.add('sillot-pack-version-input');
				text.inputEl.placeholder = this.plugin.manifest.version;
				versionInputEl = text.inputEl;
			});

		let attachConfigToggle = false;
		new Setting(containerEl)
			.setName('附加插件配置')
			.setDesc('附加插件配置 JSON 文件')
			.addToggle(toggle => toggle
				.setValue(false)
				.onChange(async (value) => {
					attachConfigToggle = value;
				}));

		let attachDataToggle = false;
		new Setting(containerEl)
			.setName('附加插件数据')
			.setDesc('附加 bridge-cache 等插件数据文件夹')
			.addToggle(toggle => toggle
				.setValue(false)
				.onChange(async (value) => {
					attachDataToggle = value;
				}));

		new Setting(containerEl)
			.setName('打包插件')
			.setDesc('')
			.addButton(button => {
				let packing = false;
				button.setButtonText('打包插件');
				button.setCta();
				button.onClick(async () => {
					if (packing) return;
					packing = true;
					button.setDisabled(true);
					button.setButtonText('打包中...');

					try {
						const version = versionInputEl?.value?.trim() || this.plugin.manifest.version;

						const manifest = {
							...this.plugin.manifest,
							version
						};

						const pluginDir = '.obsidian/plugins/sillot/';
						const cacheDir = pluginDir + 'bridge-cache/';

						const JSZip = (await import('jszip')).default;
						const zip = new JSZip();

						zip.file('manifest.json', JSON.stringify(manifest, null, 2));

						const mainJsContent = await this.app.vault.adapter.read(pluginDir + 'main.js');
						zip.file('main.js', mainJsContent);

						try {
							const mainCssContent = await this.app.vault.adapter.read(pluginDir + 'main.css');
							zip.file('main.css', mainCssContent);
						} catch { }

						try {
							const stylesContent = await this.app.vault.adapter.read(pluginDir + 'styles/styles.css');
							zip.file('styles/styles.css', stylesContent);
						} catch { }

						if (attachConfigToggle) {
							const configData = await this.plugin.loadData();
							zip.file('data.json', JSON.stringify(configData, null, 2));
						}

						if (attachDataToggle) {
							try {
								if (await this.app.vault.adapter.exists(cacheDir)) {
									const result = await this.app.vault.adapter.list(cacheDir);
									const files = result.files || [];
									for (const file of files) {
										const content = await this.app.vault.adapter.read(file);
										zip.file('bridge-cache/' + file.replace(cacheDir, ''), content);
									}
								}
							} catch (err) {
								console.error('Failed to attach bridge-cache:', err);
							}
						}

						const blob = await zip.generateAsync({ type: 'blob' });
						const url = URL.createObjectURL(blob);
						const a = document.createElement('a');
						a.href = url;
						a.download = `sillot-${version}.zip`;
						a.click();
						URL.revokeObjectURL(url);

						new Notice(`插件包已生成: sillot-${version}.zip`, 4000);
					} catch (err: any) {
						new Notice(`打包失败: ${err.message}`, 4000);
					} finally {
						packing = false;
						button.setDisabled(false);
						button.setButtonText('打包插件');
					}
				});
			});
	}

	hide() {
		this.syncPathTree = null;
		super.hide();
	}
}
