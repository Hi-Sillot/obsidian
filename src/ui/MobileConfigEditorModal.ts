import { App } from 'obsidian';
import { ConfigEditor, type ConfigType } from '../sync/ConfigEditor';
import { GitHubApi } from '../sync/githubApi';
import type VuePressPublisherPlugin from '../main';
import { renderVueComponent, unmountVueComponent } from './vue/App';
import MobileConfigEditorModalVue from './vue/MobileConfigEditorModal.vue';
import { PRCheckModal } from './PRCheckModal';

export interface ConfigEditorAPI {
	fetchConfig: (type: ConfigType) => Promise<string | null>;
	fetchFileContent: (path: string) => Promise<string>;
	updateConfig: (type: ConfigType, content: string, options?: any) => Promise<{ success: boolean; prUrl?: string; prNumber?: number; branch?: string; commitSha?: string; error?: string }>;
	updateVuePressFile: (path: string, content: string, options?: any) => Promise<{ success: boolean; prUrl?: string; prNumber?: number; branch?: string; commitSha?: string; error?: string }>;
	updateFileFrontmatter: (path: string, updates: Record<string, any>, options?: any) => Promise<{ success: boolean }>;
	validateConfig: (type: ConfigType, content: string) => { valid: boolean; errors: string[] };
	getConfigPath: (type: ConfigType) => string;
	getConfigTitle: (type: ConfigType) => string;
	getConfigList: () => Promise<Array<{ type: string; path: string; title: string }>>;
	parseFrontmatter: (content: string) => Record<string, any>;
	validatePermalink: (permalink: string) => boolean;
	fetchVuePressTree: () => Promise<Array<{ path: string; name: string; type: 'file' | 'dir' }>>;
	fetchVuePressFiles: () => Promise<Array<{ path: string; name: string; type: 'file' | 'dir' }>>;
}

export function openMobileConfigEditorModal(
	app: App,
	plugin: VuePressPublisherPlugin,
	onSubmit: () => void
): void {
	const container = document.createElement('div');
	container.className = 'sillot-mobile-modal-container';

	const appContainer = document.querySelector('.app-container');
	if (appContainer) {
		appContainer.before(container);
	} else {
		document.body.appendChild(container);
	}

	const api = new GitHubApi(plugin.settings.githubRepo, plugin.settings.githubToken);
	const configEditor = new ConfigEditor(api, plugin.settings.vuepressDocsDir, plugin.settings.siteDomain || '');

	const configBundle = plugin.bridgeManager?.getVuePressConfigBundle();
	if (configBundle) {
		configEditor.setConfigBundle(configBundle);
	}

	const assetMap = plugin.bridgeManager?.getAssetMap();
	if (assetMap) {
		configEditor.setAssetMap(assetMap);
	}

	const apiImpl: ConfigEditorAPI = {
		fetchConfig: async (type: ConfigType) => {
			return configEditor.fetchConfig(type);
		},
		fetchFileContent: async (path: string) => {
			const result = await configEditor.fetchFileContent(path);
			return result ?? '';
		},
		updateConfig: async (type: ConfigType, content: string, options?: any) => {
			return configEditor.updateConfig(type, content, options);
		},
		updateVuePressFile: async (path: string, content: string, options?: any) => {
			return configEditor.updateVuePressFile(path, content, options);
		},
		updateFileFrontmatter: async (path: string, updates: Record<string, any>, options?: any) => {
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
			const result = configEditor.parseFrontmatter(content);
			return result?.data || {};
		},
		validatePermalink: (permalink: string) => {
			const result = configEditor.validatePermalink(permalink);
			return result.valid;
		},
		fetchVuePressTree: async () => {
			return configEditor.fetchVuePressTree();
		},
		fetchVuePressFiles: async () => {
			return configEditor.fetchVuePressFiles();
		},
	};

	const close = () => {
		unmountVueComponent(container);
		container.remove();
	};

	renderVueComponent(MobileConfigEditorModalVue, {
		api: apiImpl,
		pluginName: plugin.manifest.name,
		visible: true,
		openPRCheckModal: (prNumber: number, branch: string) => {
			const modal = new PRCheckModal(app, plugin, prNumber, branch);
			modal.open();
		},
		prCheckPoller: plugin.prCheckPoller,
		gitHubApi: new GitHubApi(plugin.settings.githubRepo, plugin.settings.githubToken),
		onClose: close,
		onSaved: () => {
			onSubmit();
			close();
		},
	}, container);
}
