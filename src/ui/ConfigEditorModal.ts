import { App, Modal } from 'obsidian';
import { ConfigEditor, type ConfigType } from '../sync/ConfigEditor';
import { GitHubApi } from '../sync/githubApi';
import { createConfigEditorModal } from './vue/naive-ui-helper';
import type VuePressPublisherPlugin from '../main';
import { PublishModal } from './PublishModal';
import { PRCheckModal } from './PRCheckModal';

export class ConfigEditorModal extends Modal {
	private plugin: VuePressPublisherPlugin;
	private vueApp: ReturnType<typeof createConfigEditorModal> | null = null;

	constructor(
		app: App,
		private pluginInstance: VuePressPublisherPlugin,
		private onSubmit: () => void
	) {
		super(app);
		this.plugin = pluginInstance;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// 设置 modal 容器宽度
		const modalEl = contentEl.closest('.modal') as HTMLElement | null;
		if (modalEl) {
			modalEl.classList.add('sillot-modal-80vw');
		}

		const api = new GitHubApi(this.plugin.settings.githubRepo, this.plugin.settings.githubToken);
		const configEditor = new ConfigEditor(api, this.plugin.settings.vuepressDocsDir, this.plugin.settings.siteDomain || '');

		const configBundle = this.plugin.bridgeManager?.getVuePressConfigBundle();
		if (configBundle) {
			configEditor.setConfigBundle(configBundle);
		}

		const assetMap = this.plugin.bridgeManager?.getAssetMap();
		if (assetMap) {
			configEditor.setAssetMap(assetMap);
		}

		// 获取当前配置包 URL（如果有的话）
		const currentSiteDomain = this.plugin.settings.siteDomain || '';
		const currentConfigBundleUrl = currentSiteDomain ? `${currentSiteDomain}/obsidian-bridge/vuepress-config-bundle.json` : '';

		this.vueApp = createConfigEditorModal({
			api: {
				fetchConfig: async (type: ConfigType) => {
					return configEditor.fetchConfig(type);
				},
				fetchFileContent: async (path: string) => {
					return configEditor.fetchFileContent(path);
				},
				updateConfig: async (type: ConfigType, content: string, options: any) => {
					return configEditor.updateConfig(type, content, options);
				},
				updateFileFrontmatter: async (path: string, updates: Record<string, any>, options: any) => {
					return configEditor.updateFileFrontmatter(path, updates, options);
				},
				validateConfig: (type: ConfigType, content: string) => {
					return configEditor.validateConfig(type, content);
				},
				getConfigPath: (type: ConfigType) => {
					return configEditor.getConfigPath(type);
				},
				getConfigTitle: (type: ConfigType) => {
					return configEditor.getConfigTitle(type);
				},
				getConfigList: async () => {
					return configEditor.getConfigList();
				},
				parseFrontmatter: (content: string) => {
					return configEditor.parseFrontmatter(content);
				},
				validatePermalink: (permalink: string) => {
					return configEditor.validatePermalink(permalink);
				},
				updateVuePressFile: async (path: string, content: string, options: any) => {
					return configEditor.updateVuePressFile(path, content, options);
				},
				fetchVuePressTree: async () => {
					return configEditor.fetchVuePressTree();
				},
				parseFriends: (content: string) => {
					return configEditor.parseFriends(content);
				},
				serializeFriends: (friends: Array<{ name: string; link: string; avatar: string; desc: string }>, originalBody: string) => {
					return configEditor.serializeFriends(friends, originalBody);
				},
				fetchAssetList: async (subPath?: string) => {
					return configEditor.fetchAssetList(subPath);
				},
				uploadAsset: async (fileName: string, contentBase64: string, subPath?: string, options?: any) => {
					return configEditor.uploadAsset(fileName, contentBase64, subPath, options);
				},
				renameAsset: async (oldPath: string, newFileName: string, options?: any) => {
					return configEditor.renameAsset(oldPath, newFileName, options);
				},
				deleteAsset: async (filePath: string, options?: any) => {
					return configEditor.deleteAsset(filePath, options);
				},
				getAssetsDir: () => {
					return configEditor.getAssetsDir();
				},
			},
			pluginName: this.plugin.manifest.name,
			onClose: () => {
				this.close();
			},
			onSaved: () => {
				this.onSubmit();
			},
			container: contentEl,
			plugin: this.plugin,
			configBundleUrl: currentConfigBundleUrl,
			openPublishModal: (onSubmit: any) => {
				const modal = new PublishModal(
					this.app,
					this.plugin.settings.defaultBranch,
					this.plugin.settings.publishBranchPrefix,
					this.plugin.settings.publishCreatePR,
					this.plugin.settings.publishRootPath,
					this.plugin.settings.recentPublishPaths || [],
					(result) => {
						onSubmit(result);
					}
				);
				modal.open();
			},
			openPRCheckModal: (prNumber: number, branch: string) => {
				const modal = new PRCheckModal(this.app, this.plugin, prNumber, branch);
				modal.open();
			},
		});
	}

	onClose() {
		if (this.vueApp) {
			this.vueApp.unmount();
			this.vueApp = null;
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}
