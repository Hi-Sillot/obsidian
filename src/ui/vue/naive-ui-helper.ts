import { createApp, type App as VueApp, h, ref, reactive, computed, onMounted, onUnmounted, watch, type Ref, RendererElement, RendererNode, VNode } from 'vue';
import { Notice } from 'obsidian';
import {
	NModal,
	NTabs,
	NTabPane,
	NSpace,
	NForm,
	NFormItem,
	NSelect,
	NInput,
	NInputGroup,
	NInputGroupLabel,
	NInputNumber,
	NSwitch,
	NDynamicInput,
	NButton,
	NAlert,
	NEmpty,
	NDivider,
	NProgress,
	NResult,
	NText,
	NSpin,
	NCard,
	NCollapse,
	NCollapseItem,
	NTag,
	NPopconfirm,
	NConfigProvider,
	NTree,
	darkTheme,
	lightTheme,
	type GlobalThemeOverrides,
	type TreeOption,
	NCheckbox,
	NList,
	NListItem,
} from 'naive-ui';
import type { ConfigType, VuePressConfigFile, AssetFile } from '../../sync/ConfigEditor';
import { detectConfigType, parseNavbarFile, serializeNavbarFile, type NavItem } from './config-parser';
import { PaginationBar } from '../PaginationBar';

export interface ConfigEditorAPI {
	fetchConfig: (type: ConfigType) => Promise<string | null>;
	fetchFileContent: (path: string) => Promise<string | null>;
	updateConfig: (type: ConfigType, content: string, options: any) => Promise<any>;
	updateFileFrontmatter: (path: string, updates: Record<string, any>, options: any) => Promise<any>;
	updateVuePressFile: (path: string, content: string, options: any) => Promise<any>;
	validateConfig: (type: ConfigType, content: string) => { valid: boolean; errors: string[] };
	getConfigPath: (type: ConfigType) => string;
	getConfigTitle: (type: ConfigType) => string;
	getConfigList: () => Promise<{ type: ConfigType; path: string; title: string }[]>;
	parseFrontmatter: (content: string) => { data: Record<string, any>; body: string } | null;
	validatePermalink: (permalink: string) => { valid: boolean; errors: string[] };
	fetchVuePressTree: () => Promise<VuePressConfigFile[]>;
	parseFriends: (content: string) => { friends: Array<{ name: string; link: string; avatar: string; desc: string }>; body: string };
	serializeFriends: (friends: Array<{ name: string; link: string; avatar: string; desc: string }>, originalBody: string) => string;
	fetchAssetList: (subPath?: string) => Promise<AssetFile[]>;
	uploadAsset: (fileName: string, contentBase64: string, subPath?: string, options?: any) => Promise<any>;
	renameAsset: (oldPath: string, newFileName: string, options?: any) => Promise<any>;
	deleteAsset: (filePath: string, options?: any) => Promise<any>;
	getAssetsDir: () => string;
}

export interface NaiveUIModalOptions {
	api: ConfigEditorAPI;
	pluginName: string;
	onClose: () => void;
	onSaved: () => void;
	container: HTMLElement;
	plugin?: any;
	configBundleUrl?: string;
	openPublishModal?: (onSubmit: (result: any) => void) => void;
	openPRCheckModal?: (prNumber: number, branch: string) => void;
}

function getObsidianTheme(): 'dark' | 'light' {
	return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

function getObsidianColors(theme: 'dark' | 'light'): Record<string, string> {
	const styles = getComputedStyle(document.body);
	if (theme === 'dark') {
		return {
			primaryColor: styles.getPropertyValue('--interactive-accent').trim() || '#7C3AED',
			primaryColorHover: styles.getPropertyValue('--interactive-hover').trim() || '#8B5CF6',
			primaryColorPressed: styles.getPropertyValue('--interactive-accent').trim() || '#6D28D9',
			primaryColorSuppl: styles.getPropertyValue('--interactive-accent').trim() || '#7C3AED',
			popoverColor: styles.getPropertyValue('--background-secondary').trim() || '#1a1a1a',
			bodyColor: styles.getPropertyValue('--background-primary').trim() || '#11111b',
			cardColor: styles.getPropertyValue('--background-secondary').trim() || '#1a1a1a',
			modalColor: styles.getPropertyValue('--background-secondary').trim() || '#1a1a1a',
			inputColor: styles.getPropertyValue('--background-secondary').trim() || '#1a1a1a',
			tableColor: styles.getPropertyValue('--background-secondary').trim() || '#1a1a1a',
			borderColor: styles.getPropertyValue('--background-modifier-border').trim() || '#3a3a4a',
			dividerColor: styles.getPropertyValue('--background-modifier-border').trim() || '#3a3a4a',
			textColorBase: styles.getPropertyValue('--text-normal').trim() || '#cdd6f4',
			textColor1: styles.getPropertyValue('--text-normal').trim() || '#cdd6f4',
			textColor2: styles.getPropertyValue('--text-muted').trim() || '#a6adc8',
			textColor3: styles.getPropertyValue('--text-faint').trim() || '#6c7086',
		};
	}
	return {
		primaryColor: styles.getPropertyValue('--interactive-accent').trim() || '#7C3AED',
		primaryColorHover: styles.getPropertyValue('--interactive-hover').trim() || '#6D28D9',
		primaryColorPressed: styles.getPropertyValue('--interactive-accent').trim() || '#5B21B6',
		primaryColorSuppl: styles.getPropertyValue('--interactive-accent').trim() || '#7C3AED',
		popoverColor: styles.getPropertyValue('--background-secondary').trim() || '#ffffff',
		bodyColor: styles.getPropertyValue('--background-primary').trim() || '#f5f5f5',
		cardColor: styles.getPropertyValue('--background-secondary').trim() || '#ffffff',
		modalColor: styles.getPropertyValue('--background-secondary').trim() || '#ffffff',
		inputColor: styles.getPropertyValue('--background-secondary').trim() || '#ffffff',
		tableColor: styles.getPropertyValue('--background-secondary').trim() || '#ffffff',
		borderColor: styles.getPropertyValue('--background-modifier-border').trim() || '#e0e0e0',
		dividerColor: styles.getPropertyValue('--background-modifier-border').trim() || '#e0e0e0',
		textColorBase: styles.getPropertyValue('--text-normal').trim() || '#4a4a4a',
		textColor1: styles.getPropertyValue('--text-normal').trim() || '#4a4a4a',
		textColor2: styles.getPropertyValue('--text-muted').trim() || '#6a6a6a',
		textColor3: styles.getPropertyValue('--text-faint').trim() || '#9a9a9a',
	};
}

function createThemeOverrides(theme: 'dark' | 'light'): GlobalThemeOverrides {
	const obsidianColors = getObsidianColors(theme);

	return {
		common: {
			fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
			fontFamilyMono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
			borderRadius: '8px',
			...obsidianColors,
		},
		Button: {
			colorPrimary: obsidianColors.primaryColor,
			colorHoverPrimary: obsidianColors.primaryColorHover,
			colorPressedPrimary: obsidianColors.primaryColorPressed,
			textColorPrimary: '#ffffff',
		},
		Card: {
			color: obsidianColors.cardColor,
			colorModal: obsidianColors.modalColor,
			borderColor: obsidianColors.borderColor,
		},
		Modal: {
			color: obsidianColors.modalColor,
		},
		Input: {
			color: obsidianColors.inputColor,
			colorFocus: obsidianColors.inputColor,
			borderColor: obsidianColors.borderColor,
			borderHover: obsidianColors.primaryColor,
			borderFocus: obsidianColors.primaryColor,
		},
		Form: {
			labelTextColor: obsidianColors.textColor2,
		},
		Tabs: {
			tabTextColorLine: obsidianColors.textColor2,
			tabTextColorActiveLine: obsidianColors.textColorBase,
			tabTextColorHoverLine: obsidianColors.primaryColor,
			barColor: obsidianColors.primaryColor,
		},
		Select: {
			peers: {
				InternalSelection: {
					color: obsidianColors.inputColor,
					border: `1px solid ${obsidianColors.borderColor}`,
					borderHover: obsidianColors.primaryColor,
					borderFocus: obsidianColors.primaryColor,
					textColor: obsidianColors.textColorBase,
				}
			}
		},
		Progress: {
			fill: obsidianColors.primaryColor,
		},
		Alert: {
			colorError: theme === 'dark' ? '#f5212d' : '#d03050',
		},
		Checkbox: {
			colorChecked: obsidianColors.primaryColor,
			borderChecked: obsidianColors.primaryColor,
		},
		List: {
			color: 'transparent',
		},
		// ListItem: {
		// 	color: 'transparent',
		// },
		Tree: {
			nodeColor: obsidianColors.textColorBase,
			nodeTextColor: obsidianColors.textColorBase,
		},
	};
}

function convertToTreeOptions(files: VuePressConfigFile[], prefix: string = ''): TreeOption[] {
	return files.map(file => {
		const fullPath = prefix ? `${prefix}/${file.name}` : file.name;
		return {
			key: fullPath,
			label: file.name,
			isLeaf: file.type === 'file',
			children: file.children ? convertToTreeOptions(file.children, fullPath) : undefined,
		};
	});
}

export function createConfigEditorModal(options: NaiveUIModalOptions): {
	app: VueApp;
	unmount: () => void;
} {
	const showModal = ref(true);
	const tabValue = ref('config');
	const selectedConfigType = ref('friends');
	const configContent = ref('');
	const currentConfigPath = ref('');
	const loading = ref(false);
	const validationErrors = ref<string[]>([]);
	
	// 配置包 URL 调试功能
	const configBundleUrl = ref('');
	const reloadingConfigBundle = ref(false);

	// Friends 可视化编辑器
	const friendsList = ref<Array<{ name: string; link: string; avatar: string; desc: string }>>([]);
	const showFriendsVisualEditor = ref(false);
	const friendsBody = ref('');
	const newFriendName = ref('');
	const newFriendLink = ref('');
	const newFriendAvatar = ref('');
	const newFriendDesc = ref('');

	const addFriend = () => {
		if (!newFriendName.value.trim()) return;
		friendsList.value.push({
			name: newFriendName.value.trim(),
			link: newFriendLink.value.trim() || '#',
			avatar: newFriendAvatar.value.trim() || '',
			desc: newFriendDesc.value.trim() || '',
		});
		newFriendName.value = '';
		newFriendLink.value = '';
		newFriendAvatar.value = '';
		newFriendDesc.value = '';
	};

	const removeFriend = (index: number) => {
		friendsList.value.splice(index, 1);
	};

	const convertFriendsToVisual = () => {
		const result = options.api.parseFriends(configContent.value);
		friendsList.value = result.friends;
		friendsBody.value = result.body;
		showFriendsVisualEditor.value = true;
	};

	const convertFriendsToRaw = () => {
		configContent.value = options.api.serializeFriends(friendsList.value, friendsBody.value);
		showFriendsVisualEditor.value = false;
	};

	const frontmatterFilePath = ref('');
	const frontmatterData = ref<Record<string, any> | null>(null);
	const loadingFrontmatter = ref(false);
	const fmValidationErrors = ref<string[]>([]);
	const newFmKey = ref('');
	const newFmValue = ref('');

	// 附件管理状态
	const assetsList = ref<AssetFile[]>([]);
	const assetsLoading = ref(false);
	const assetsErrors = ref<string[]>([]);
	const showAssetUpload = ref(false);
	const uploadFileName = ref('');
	const uploadFileData = ref('');
	const uploadLoading = ref(false);
	const showAssetRename = ref(false);
	const renameOldPath = ref('');
	const renameNewName = ref('');
	const renameLoading = ref(false);
	const showAssetDelete = ref(false);
	const deleteFilePath = ref('');
	const deleteFileName = ref('');
	const deleteLoading = ref(false);
	const currentAssetSubPath = ref('');
	const assetSearchQuery = ref('');
	const filteredAssetsList = computed(() => {
		const query = assetSearchQuery.value.trim();
		if (!query) return assetsList.value;
		return PaginationBar.filterBySearch(assetsList.value, query, ['name', 'path'], (item, col) => {
			return col === 'name' ? item.name : item.path;
		});
	});

	const createPR = ref(true);
	const saving = ref(false);
	const showProgress = ref(false);
	const progressPercent = ref(0);
	const progressMessage = ref('');

	const showResult = ref(false);
	const resultSuccess = ref(false);
	const prUrl = ref('');
	const prNumber = ref<number | null>(null);

	const configOptions = ref<{ label: string; value: string }[]>([]);

	const currentTheme = ref<'dark' | 'light'>(getObsidianTheme());
	const themeOverrides = computed(() => createThemeOverrides(currentTheme.value));

	const vuepressTree = ref<VuePressConfigFile[]>([]);
	const vuepressTreeOptions = ref<TreeOption[]>([]);
	const selectedVuepressFile = ref<string | null>(null);
	const vuepressFilePath = ref<string | null>(null);
	const vuepressFileContent = ref('');
	const vuepressEditingContent = ref('');
	const vuepressFileLoading = ref(false);
	const vuepressFileErrors = ref<string[]>([]);
	const vuepressDirty = ref(false);
	const vuepressFileCache = new Map<string, string>();
	const vuepressTreeCache = new Map<string, VuePressConfigFile[]>();

	const navbarItems = ref<NavItem[]>([]);
	const showVisualEditor = ref(false);
	const navbarNewText = ref('');
	const navbarNewLink = ref('');

	const isNavbarFile = computed(() => selectedVuepressFile.value === 'navbar.ts');

	const addNavbarItem = () => {
		if (!navbarNewText.value.trim()) return;
		navbarItems.value.push({
			text: navbarNewText.value.trim(),
			link: navbarNewLink.value.trim() || '#',
		});
		navbarNewText.value = '';
		navbarNewLink.value = '';
		vuepressDirty.value = true;
	};

	const addNavbarSubItem = (parentIndex: number) => {
		if (!navbarItems.value[parentIndex]?.items) {
			navbarItems.value[parentIndex].items = [];
		}
		if (!navbarNewText.value.trim()) return;
		navbarItems.value[parentIndex].items!.push({
			text: navbarNewText.value.trim(),
			link: navbarNewLink.value.trim() || '#',
		});
		navbarNewText.value = '';
		navbarNewLink.value = '';
		vuepressDirty.value = true;
	};

	const removeNavbarItem = (index: number, isSubItem: boolean = false, parentIndex?: number) => {
		if (isSubItem && parentIndex !== undefined) {
			navbarItems.value[parentIndex].items?.splice(index, 1);
		} else {
			navbarItems.value.splice(index, 1);
		}
		vuepressDirty.value = true;
	};

	const convertToVisual = () => {
		navbarItems.value = parseNavbarFile(vuepressEditingContent.value);
		showVisualEditor.value = true;
	};

	const convertToRaw = () => {
		vuepressEditingContent.value = serializeNavbarFile(navbarItems.value);
		showVisualEditor.value = false;
		vuepressDirty.value = true;
	};

	const toggleEditorMode = () => {
		if (isNavbarFile.value) {
			if (!showVisualEditor.value) {
				navbarItems.value = parseNavbarFile(vuepressEditingContent.value);
			}
			showVisualEditor.value = !showVisualEditor.value;
		}
	};

	const renderNavbarVisualEditor = () => {
		return h(NCard, { title: '导航菜单可视化编辑器', size: 'small' }, {
			default: () => [
				h(NCollapse, { bordered: false }, {
					default: () => navbarItems.value.map((item, index) =>
						h(NCollapseItem, {
							key: index,
							title: item.text || `菜单项 ${index + 1}`,
							name: String(index)
						}, {
							default: () => [
								h(NSpace, { vertical: true, size: 4 }, {
									default: () => item.items ? item.items.map((sub, subIndex) =>
										h(NSpace, { size: 8, key: subIndex }, {
											default: () => [
												h(NTag, { key: subIndex }, { default: () => sub.text }),
												h(NTag, { type: 'info', size: 'small' }, { default: () => sub.link }),
												h(NButton, {
													size: 'tiny',
													circle: true,
													type: 'error',
													onClick: () => removeNavbarItem(subIndex, true, index)
												}, { default: () => '×' })
											]
										})
									) : null
								}),
								h(NButton, {
									size: 'tiny',
									onClick: () => addNavbarSubItem(index)
								}, { default: () => '+ 添加子菜单' })
							]
						})
					)
				}),
				h(NSpace, { size: 8, style: { marginTop: '16px' } }, {
					default: () => [
						h(NInput, {
							value: navbarNewText.value,
							placeholder: '菜单文本',
							style: { width: '120px' },
							onUpdateValue: (val: string) => { navbarNewText.value = val; }
						}),
						h(NInput, {
							value: navbarNewLink.value,
							placeholder: '链接路径',
							style: { width: '200px' },
							onUpdateValue: (val: string) => { navbarNewLink.value = val; }
						}),
						h(NButton, { type: 'primary', onClick: addNavbarItem }, { default: () => '+ 添加' })
					]
				}),
				h(NSpace, { style: { marginTop: '12px' } }, {
					default: () => [
						h(NButton, { type: 'info', onClick: convertToRaw }, { default: () => '转换为源码' }),
						h(NButton, {
							style: { marginLeft: '8px' },
							onClick: () => removeNavbarItem(navbarItems.value.length - 1)
						}, { default: () => '删除最后一项' })
					]
				})
			]
		});
	};

	const modalTitle = computed(() => `编辑配置文件 - ${options.pluginName}`);

	const canSave = computed(() => {
		if (tabValue.value === 'config') {
			return configContent.value.trim().length > 0 && validationErrors.value.length === 0;
		} else if (tabValue.value === 'assets') {
			// 附件管理 TAB 不使用通用保存按钮
			return false;
		} else {
			return vuepressDirty.value && vuepressEditingContent.value.trim().length > 0 && vuepressFileErrors.value.length === 0;
		}
	});

	let themeObserver: MutationObserver | null = null;

	const init = async () => {
		// 设置默认配置包 URL
		if (options.configBundleUrl) {
			configBundleUrl.value = options.configBundleUrl;
		}
		
		const list = await options.api.getConfigList();
		configOptions.value = list.map(c => ({
			label: c.title,
			value: c.type,
		}));

		if (list.length > 0) {
			currentConfigPath.value = list[0].path;
			await loadConfig();
		}

		await loadVuePressTree();

		themeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.attributeName === 'class') {
					const newTheme = getObsidianTheme();
					if (newTheme !== currentTheme.value) {
						currentTheme.value = newTheme;
					}
				}
			}
		});
		themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	};

	const loadVuePressTree = async (forceRefresh = false) => {
		const cacheKey = 'vuepressTree';
		if (!forceRefresh && vuepressTreeCache.has(cacheKey)) {
			vuepressTree.value = vuepressTreeCache.get(cacheKey)!;
			vuepressTreeOptions.value = convertToTreeOptions(vuepressTree.value);
			return;
		}

		try {
			const tree = await options.api.fetchVuePressTree();
			vuepressTree.value = tree;
			vuepressTreeCache.set(cacheKey, tree);
			vuepressTreeOptions.value = convertToTreeOptions(tree);
		} catch {
			vuepressTree.value = [];
			vuepressTreeOptions.value = [];
		}
	};

	const onConfigTypeChange = async (value: string) => {
		selectedConfigType.value = value;
		currentConfigPath.value = options.api.getConfigPath(value as ConfigType);
		await loadConfig();
	};

	const onVuePressFileSelect = async (keys: string[]) => {
		if (keys.length === 0) return;
		const filePath = keys[0];
		if (!filePath || filePath.includes('/') && !filePath.endsWith('/')) {
			await loadVuePressFile(filePath);
		}
	};

	const loadVuePressFile = async (path: string) => {
		selectedVuepressFile.value = path;
		vuepressFileLoading.value = true;
		vuepressFileErrors.value = [];
		vuepressFilePath.value = null;

		try {
			const cached = vuepressFileCache.get(path);
			if (cached !== undefined) {
				vuepressFileContent.value = cached;
				vuepressEditingContent.value = cached;
				vuepressDirty.value = false;
				vuepressFileLoading.value = false;
				return;
			}

			const file = vuepressTree.value.find(f =>
				f.name === path || f.path === path || f.path.endsWith('/' + path)
			);

			if (file) {
				const content = await options.api.fetchFileContent(file.path);
				if (content !== null) {
					vuepressFileContent.value = content;
					vuepressEditingContent.value = content;
					vuepressFilePath.value = file.path;
					vuepressFileCache.set(path, content);
					vuepressFileErrors.value = [];
				} else {
					vuepressFileContent.value = '';
					vuepressEditingContent.value = '';
					vuepressFileErrors.value = [`无法加载 "${path}"，请确认配置包已构建`];
				}
			} else {
				vuepressFileContent.value = '';
				vuepressEditingContent.value = '';
				const availableFiles = vuepressTree.value.filter(f => f.type === 'file').map(f => `${f.name}(${f.path})`).join(', ');
				vuepressFileErrors.value = [`文件 "${path}" 不存在，可用文件: ${availableFiles}`];
			}
		} catch (error: any) {
			vuepressFileContent.value = '';
			vuepressEditingContent.value = '';
			vuepressFileErrors.value = [error.message || `加载文件失败`];
		} finally {
			vuepressFileLoading.value = false;
		}
	};

	const loadConfig = async () => {
		loading.value = true;
		validationErrors.value = [];
		showFriendsVisualEditor.value = false;

		try {
			const content = await options.api.fetchConfig(selectedConfigType.value as ConfigType);
			if (content !== null) {
				configContent.value = content;
				if (selectedConfigType.value === 'friends') {
					// 对于 friends，默认尝试解析为可视化编辑器
					convertFriendsToVisual();
				}
				const validation = options.api.validateConfig(selectedConfigType.value as ConfigType, configContent.value);
				validationErrors.value = validation.errors;
			} else {
				configContent.value = '';
				validationErrors.value = [`无法加载配置文件 "${selectedConfigType.value}"，可能文件不存在或网络错误`];
			}
		} catch (error: any) {
			configContent.value = '';
			validationErrors.value = [error.message || `加载配置文件 "${selectedConfigType.value}" 失败`];
		} finally {
			loading.value = false;
		}
	};

	const loadFrontmatter = async () => {
		if (!frontmatterFilePath.value.trim()) return;

		loadingFrontmatter.value = true;
		fmValidationErrors.value = [];
		frontmatterData.value = null;

		try {
			const content = await options.api.fetchFileContent(frontmatterFilePath.value);
			if (content === null) {
				fmValidationErrors.value = ['无法获取文件内容'];
				return;
			}

			const parsed = options.api.parseFrontmatter(content);
			if (!parsed) {
				fmValidationErrors.value = ['文件不包含有效的 Frontmatter'];
				return;
			}

			frontmatterData.value = { ...parsed.data };

			if (parsed.data.permalink) {
				const permValidation = options.api.validatePermalink(parsed.data.permalink);
				if (!permValidation.valid) {
					fmValidationErrors.value = permValidation.errors;
				}
			}
		} catch (error: any) {
			fmValidationErrors.value = [error.message];
		} finally {
			loadingFrontmatter.value = false;
		}
	};

	const addFrontmatterField = () => {
		if (!newFmKey.value.trim()) return;

		if (!frontmatterData.value) {
			frontmatterData.value = {};
		}

		frontmatterData.value[newFmKey.value.trim()] = newFmValue.value || '';
		newFmKey.value = '';
		newFmValue.value = '';
	};

	// 附件管理辅助函数
	const isImageFile = (name: string): boolean => {
		const ext = name.split('.').pop()?.toLowerCase() || '';
		return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);
	};

	const getFileExt = (name: string): string => {
		return name.split('.').pop()?.toUpperCase() || 'FILE';
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
	};

	const loadAssets = async () => {
		assetsLoading.value = true;
		assetsErrors.value = [];
		try {
			assetsList.value = await options.api.fetchAssetList(currentAssetSubPath.value);
		} catch (error: any) {
			assetsErrors.value = [error.message || '加载附件列表失败'];
		} finally {
			assetsLoading.value = false;
		}
	};

	const navigateToAssetDir = (dirName: string) => {
		currentAssetSubPath.value = currentAssetSubPath.value
			? `${currentAssetSubPath.value}/${dirName}`
			: dirName;
		loadAssets();
	};

	const navigateToAssetParent = () => {
		const parts = currentAssetSubPath.value.split('/');
		parts.pop();
		currentAssetSubPath.value = parts.join('/');
		loadAssets();
	};

	const startRenameAsset = (asset: AssetFile) => {
		renameOldPath.value = asset.path;
		renameNewName.value = asset.name;
		showAssetRename.value = true;
	};

	const doRenameAsset = async () => {
		if (!renameNewName.value.trim() || !renameOldPath.value) return;
		renameLoading.value = true;
		showProgress.value = true;
		progressPercent.value = 0;
		progressMessage.value = '准备重命名...';
		try {
			const result = await options.api.renameAsset(renameOldPath.value, renameNewName.value.trim(), {
				createPR: createPR.value,
				commitMessage: `重命名附件 via Sillot: ${renameOldPath.value} → ${renameNewName.value.trim()}`,
				onProgress: (percent: number, msg: string) => {
					progressPercent.value = percent;
					progressMessage.value = msg;
				},
			});
			showAssetRename.value = false;
			renameNewName.value = '';
			renameOldPath.value = '';
			handleResult(result);
		} catch (error: any) {
			assetsErrors.value = [error.message || '重命名失败'];
			showProgress.value = false;
		} finally {
			renameLoading.value = false;
		}
	};

	const startDeleteAsset = (asset: AssetFile) => {
		deleteFilePath.value = asset.path;
		deleteFileName.value = asset.name;
		showAssetDelete.value = true;
	};

	const doDeleteAsset = async () => {
		if (!deleteFilePath.value) return;
		deleteLoading.value = true;
		showProgress.value = true;
		progressPercent.value = 0;
		progressMessage.value = '准备删除...';
		try {
			const result = await options.api.deleteAsset(deleteFilePath.value, {
				createPR: createPR.value,
				commitMessage: `删除附件 via Sillot: ${deleteFilePath.value}`,
				onProgress: (percent: number, msg: string) => {
					progressPercent.value = percent;
					progressMessage.value = msg;
				},
			});
			showAssetDelete.value = false;
			deleteFilePath.value = '';
			deleteFileName.value = '';
			handleResult(result);
		} catch (error: any) {
			assetsErrors.value = [error.message || '删除失败'];
			showProgress.value = false;
		} finally {
			deleteLoading.value = false;
		}
	};

	const triggerFileInput = () => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '*/*';
		input.onchange = async (e: Event) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			// GitHub API 单文件大小限制 100MB
			const GITHUB_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
			if (file.size > GITHUB_FILE_SIZE_LIMIT) {
				const sizeMB = (file.size / 1024 / 1024).toFixed(1);
				new Notice(`文件大小 ${sizeMB}MB 超过 GitHub 限制 (100MB)`, 5000);
				return;
			}
			uploadFileName.value = file.name;
			const reader = new FileReader();
			reader.onload = () => {
				const arrayBuffer = reader.result as ArrayBuffer;
				const bytes = new Uint8Array(arrayBuffer);
				let binary = '';
				for (let i = 0; i < bytes.length; i++) {
					binary += String.fromCharCode(bytes[i]);
				}
				uploadFileData.value = btoa(binary);
			};
			reader.readAsArrayBuffer(file);
		};
		input.click();
	};

	const doUploadAsset = async () => {
		if (!uploadFileData.value || !uploadFileName.value.trim()) return;
		uploadLoading.value = true;
		showProgress.value = true;
		progressPercent.value = 0;
		progressMessage.value = '准备上传...';
		try {
			const result = await options.api.uploadAsset(uploadFileName.value.trim(), uploadFileData.value, currentAssetSubPath.value, {
				createPR: createPR.value,
				commitMessage: `上传附件 via Sillot: ${uploadFileName.value.trim()}`,
				onProgress: (percent: number, msg: string) => {
					progressPercent.value = percent;
					progressMessage.value = msg;
				},
			});
			showAssetUpload.value = false;
			uploadFileName.value = '';
			uploadFileData.value = '';
			handleResult(result);
		} catch (error: any) {
			assetsErrors.value = [error.message || '上传失败'];
			showProgress.value = false;
		} finally {
			uploadLoading.value = false;
		}
	};

	// 重新加载配置包
	const reloadConfigBundle = async () => {
		if (!configBundleUrl.value.trim()) {
			new Notice('请输入有效的配置包 URL');
			return;
		}
		
		reloadingConfigBundle.value = true;
		try {
			// 这里需要调用 BridgeManager 的重新加载方法
			// 暂时先显示提示信息
			new Notice(`配置包 URL 已更新为: ${configBundleUrl.value}`);
			
			// 重新加载 VuePress 树
			await loadVuePressTree(true);
			
			// 如果当前在 VuePress 标签页，重新加载当前文件
			if (tabValue.value === 'vuepress' && selectedVuepressFile.value) {
				await loadVuePressFile(selectedVuepressFile.value);
			}
			
			// 如果当前在配置文件标签页，重新加载当前配置
			if (tabValue.value === 'config') {
				await loadConfig();
			}
			
			new Notice('配置包重新加载完成');
		} catch (error: any) {
			new Notice(`重新加载配置包失败: ${error.message}`);
		} finally {
			reloadingConfigBundle.value = false;
		}
	};

	const onCancel = () => {
		showModal.value = false;
		showProgress.value = false;
		showResult.value = false;
		setTimeout(() => {
			options.onClose();
		}, 100);
	};

	const doSave = async (commitResult: any) => {
		saving.value = true;
		showProgress.value = true;
		progressPercent.value = 0;
		progressMessage.value = '准备保存...';

		try {
			if (tabValue.value === 'config') {
				const validation = options.api.validateConfig(selectedConfigType.value as ConfigType, configContent.value);
				if (!validation.valid) {
					validationErrors.value = validation.errors;
					showProgress.value = false;
					saving.value = false;
					return;
				}

				const result = await options.api.updateConfig(
					selectedConfigType.value as ConfigType,
					configContent.value,
					{
						createPR: commitResult.createPR,
						commitMessage: commitResult.commitMessage,
						baseBranch: commitResult.baseBranch,
						targetBranch: commitResult.branch,
						onProgress: (percent: number, msg: string) => {
							progressPercent.value = percent;
							progressMessage.value = msg;
						},
					}
				);

				handleResult(result);
			} else if (tabValue.value === 'assets') {
				// 附件管理 TAB 的操作由各自的按钮直接处理，不走通用保存流程
				showProgress.value = false;
				saving.value = false;
				return;
			} else {
				if (!vuepressFilePath.value) {
					showProgress.value = false;
					saving.value = false;
					return;
				}

				// 保存前把编辑状态同步到正式内容
				vuepressFileContent.value = vuepressEditingContent.value;
				// 同时更新缓存
				if (selectedVuepressFile.value) {
					vuepressFileCache.set(selectedVuepressFile.value, vuepressEditingContent.value);
				}

				const result = await options.api.updateVuePressFile(
					vuepressFilePath.value,
					vuepressFileContent.value,
					{
						createPR: commitResult.createPR,
						commitMessage: commitResult.commitMessage,
						baseBranch: commitResult.baseBranch,
						targetBranch: commitResult.branch,
						onProgress: (percent: number, msg: string) => {
							progressPercent.value = percent;
							progressMessage.value = msg;
						},
					}
				);

				handleResult(result);
				vuepressDirty.value = false;
			}
		} catch (error: any) {
			handleResult({ success: false, error: error.message });
		} finally {
			saving.value = false;
		}
	};

	const onSave = () => {
		if (options.openPublishModal) {
			options.openPublishModal((result: any) => {
				doSave(result);
			});
		} else {
			// 没有 openPublishModal，使用默认值
			doSave({
				createPR: createPR.value,
				commitMessage: `更新配置文件 via Sillot`,
				branch: '',
			});
		}
	};

	const handleResult = (result: any) => {
		showProgress.value = false;

		if (result.success) {
			resultSuccess.value = true;
			prUrl.value = result.prUrl || '';
			prNumber.value = result.prNumber || null;
			if (options.plugin && result.prNumber && result.branch) {
				// 启动 PR 轮询
				options.plugin.prCheckPoller.startPolling(
					String(result.prNumber),
					{
						prNumber: result.prNumber,
						branch: result.branch,
						headSha: result.commitSha,
						filePath: '',
						startedAt: Date.now(),
					},
					() => options.plugin.createGitHubApi(),
				);
				// 保存到 data
				options.plugin.savePRCheckPending();
				// 打开 PRCheckModal
				if (options.openPRCheckModal) {
					options.openPRCheckModal(result.prNumber, result.branch);
				}
			}
		} else {
			resultSuccess.value = false;
			prUrl.value = '';
			prNumber.value = null;
			if (tabValue.value === 'vuepress') {
				vuepressFileErrors.value = result.error ? [result.error] : [];
			} else if (tabValue.value === 'assets') {
				assetsErrors.value = result.error ? [result.error] : [];
			} else {
				validationErrors.value = result.error ? [result.error] : [];
			}
		}

		showResult.value = true;
	};

	const onResultClose = () => {
		showResult.value = false;
		if (resultSuccess.value) {
			if (tabValue.value === 'assets') {
				// 附件操作成功后不关闭配置编辑窗口，只刷新列表
				loadAssets();
			} else {
				options.onSaved();
				showModal.value = false;
				setTimeout(() => {
					options.onClose();
				}, 100);
			}
		}
	};

	const renderErrors = (errors: string[]) => {
		return h(NAlert, { type: 'error', title: `${errors.length} 个错误` }, {
			default: () => h(NList, {}, {
				default: () => errors.map((err, idx) => h(NListItem, { key: idx }, { default: () => err }))
			})
		});
	};

	const renderFriendsVisualEditor = () => {
		return h(NCard, { title: '友情链接可视化编辑器', size: 'small' }, {
			default: () => [
				h(NCollapse, { bordered: false }, {
					default: () => friendsList.value.map((friend, index) =>
						h(NCollapseItem, {
							key: index,
							title: friend.name || `友链 ${index + 1}`,
							name: String(index)
						}, {
							default: () => [
								h(NForm, { labelPlacement: 'left', labelWidth: 80 }, {
									default: () => [
										h(NFormItem, { label: '名称' }, {
											default: () => h(NInput, {
												value: friend.name,
												onUpdateValue: (val: string) => { friendsList.value[index].name = val; }
											})
										}),
										h(NFormItem, { label: '链接' }, {
											default: () => h(NInput, {
												value: friend.link,
												onUpdateValue: (val: string) => { friendsList.value[index].link = val; }
											})
										}),
										h(NFormItem, { label: '头像' }, {
											default: () => h(NInput, {
												value: friend.avatar,
												onUpdateValue: (val: string) => { friendsList.value[index].avatar = val; }
											})
										}),
										h(NFormItem, { label: '描述' }, {
											default: () => h(NInput, {
												value: friend.desc,
												type: 'textarea',
												rows: 2,
												onUpdateValue: (val: string) => { friendsList.value[index].desc = val; }
											})
										})
									]
								}),
								h(NButton, {
									size: 'tiny',
									type: 'error',
									onClick: () => removeFriend(index)
								}, { default: () => '删除此好友' })
							]
						})
					)
				}),
				h(NSpace, { vertical: true, style: { marginTop: '16px' } }, {
					default: () => [
						h(NText, { depth: 3 }, { default: () => '添加新友链' }),
						h(NSpace, { size: 8 }, {
							default: () => [
								h(NInput, {
									value: newFriendName.value,
									placeholder: '好友名称',
									style: { width: '150px' },
									onUpdateValue: (val: string) => { newFriendName.value = val; }
								}),
								h(NInput, {
									value: newFriendLink.value,
									placeholder: '链接',
									style: { width: '200px' },
									onUpdateValue: (val: string) => { newFriendLink.value = val; }
								}),
								h(NInput, {
									value: newFriendAvatar.value,
									placeholder: '头像链接',
									style: { width: '200px' },
									onUpdateValue: (val: string) => { newFriendAvatar.value = val; }
								})
							]
						}),
						h(NInput, {
							value: newFriendDesc.value,
							placeholder: '描述',
							style: { width: '100%' },
							onUpdateValue: (val: string) => { newFriendDesc.value = val; }
						}),
						h(NButton, { type: 'primary', style: { marginTop: '8px' }, onClick: addFriend }, { default: () => '+ 添加友链' })
					]
				}),
				h(NSpace, { style: { marginTop: '16px' } }, {
					default: () => [
						h(NButton, { type: 'info', onClick: convertFriendsToRaw }, { default: () => '转换为源码编辑器' })
					]
				})
			]
		});
	};

	const ConfigTab = {
		setup() {
			return () => {
				let editorContent;

				if (selectedConfigType.value === 'friends' && showFriendsVisualEditor.value) {
					const children: any[] = [renderFriendsVisualEditor()];
					if (validationErrors.value.length > 0) {
						children.push(renderErrors(validationErrors.value));
					}
					editorContent = h('div', { style: { width: '100%' } }, children);
				} else {
					const children: any[] = [
						h(NSpin, { show: loading.value }, {
							default: () => h(NInput, {
								value: configContent.value,
								type: 'textarea',
								placeholder: loading.value ? '加载中...' : '配置内容',
								rows: 12,
								disabled: loading.value,
								onUpdateValue: (val: string) => { configContent.value = val; }
							})
						})
					];

					if (selectedConfigType.value === 'friends' && !showFriendsVisualEditor.value) {
						children.push(h(NButton, {
							type: 'success',
							style: { marginTop: '8px' },
							onClick: convertFriendsToVisual
						}, { default: () => '转换为可视化编辑器' }));
					}

					if (validationErrors.value.length > 0) {
						children.push(renderErrors(validationErrors.value));
					}

					editorContent = h('div', { style: { width: '100%' } }, children);
				}

				return h(NSpace, { vertical: true, size: 16 }, {
					default: () => [
						h(NFormItem, { label: '配置文件', labelPlacement: 'left' }, {
							default: () => h(NSelect, {
								value: selectedConfigType.value,
								options: configOptions.value,
								placeholder: '选择配置文件',
								onUpdateValue: onConfigTypeChange
							})
						}),
						h(NInputGroup, {}, {
							default: () => [
								h(NInputGroupLabel, {}, { default: () => '文件路径' }),
								h(NInput, { value: currentConfigPath.value, readonly: true })
							]
						}),
						editorContent
					]
				});
			};
		}
	};

	const VuePressTab = {
		setup() {
			const fileOptions = computed(() =>
				vuepressTree.value
					.filter(f => f.type === 'file')
					.map(f => ({ label: f.name, value: f.name }))
			);

			return () => {
				// 渲染主体
				let editorContent;
				
				if (!selectedVuepressFile.value) {
					editorContent = h(NEmpty, { description: '从上方下拉菜单选择要编辑的配置文件' });
				} else if (showVisualEditor.value && isNavbarFile.value) {
					// 可视化编辑器
					const children: any[] = [];
					children.push(renderNavbarVisualEditor());
					
					if (vuepressFileErrors.value.length > 0) {
						children.push(renderErrors(vuepressFileErrors.value));
					}
					
					editorContent = h('div', { style: { width: '100%' } }, children);
				} else {
					// 源码编辑器
					const children: any[] = [];
					children.push(h(NSpin, { show: vuepressFileLoading.value }, {
						default: () => h(NInput, {
							value: vuepressEditingContent.value,
							type: 'textarea',
							placeholder: vuepressFileLoading.value ? '加载中...' : '配置内容',
							rows: 12,
							disabled: vuepressFileLoading.value || vuepressFileErrors.value.length > 0,
							onUpdateValue: (val: string) => { 
								vuepressEditingContent.value = val; 
								vuepressDirty.value = true;
							}
						})
					}));

					if (isNavbarFile.value && !showVisualEditor.value) {
						children.push(h(NButton, {
							type: 'success',
							style: { marginTop: '8px' },
							onClick: convertToVisual
						}, { default: () => '转换为可视化编辑器' }));
					}

					if (vuepressFileErrors.value.length > 0) {
						children.push(renderErrors(vuepressFileErrors.value));
					}

					editorContent = h('div', { style: { width: '100%' } }, children);
				}

				// 完整组件
				return h(NSpace, { vertical: true, size: 16, style: { width: '100%' } }, {
					default: () => [
						h(NSpace, { size: 12 }, {
							default: () => [
								h(NText, { depth: 3 }, { default: () => '选择文件:' }),
								h(NSelect, {
									value: selectedVuepressFile.value,
									options: fileOptions.value,
									placeholder: fileOptions.value.length === 0 ? '加载中...' : '选择配置文件',
									disabled: vuepressFileLoading.value,
									style: { width: '200px' },
									'onUpdate:value': async (val: string) => {
										selectedVuepressFile.value = val;
										await loadVuePressFile(val);
										showVisualEditor.value = false;
									}
								}),
								isNavbarFile.value ? h(NButton, {
									size: 'small',
									type: showVisualEditor.value ? 'warning' : 'primary',
									onClick: toggleEditorMode
								}, { default: () => showVisualEditor.value ? '编辑源码' : '可视化编辑' }) : null
							]
						}),
						vuepressFileLoading.value
							? h('div', { style: { display: 'flex', justifyContent: 'center', padding: '20px' } }, [
								h(NSpin, { size: 'large', description: '加载中...' })
							])
							: editorContent
					]
				});
			};
		}
	};

	const AssetsTab = {
		setup() {
			return () => h(NSpace, { vertical: true, size: 16 }, {
				default: () => [
					h(NSpace, { justify: 'space-between', align: 'center' }, {
						default: () => [
							h(NSpace, { align: 'center', size: 8 }, {
								default: () => [
									currentAssetSubPath.value
										? h(NButton, {
											size: 'small',
											quaternary: true,
											onClick: navigateToAssetParent
										}, { default: () => '⬆️ 上级目录' })
										: null,
									h(NText, { depth: 3 }, {
										default: () => currentAssetSubPath.value
											? `${options.api.getAssetsDir()}/${currentAssetSubPath.value}`
											: options.api.getAssetsDir()
									})
								]
							}),
							h(NSpace, { size: 8 }, {
								default: () => [
									h(NButton, {
										type: 'primary',
										size: 'small',
										loading: assetsLoading.value,
										onClick: loadAssets
									}, { default: () => '刷新列表' }),
									h(NButton, {
										type: 'success',
										size: 'small',
										onClick: () => { showAssetUpload.value = true; }
									}, { default: () => '上传附件' })
								]
							})
						]
					}),
					h(NInput, {
						value: assetSearchQuery.value,
						placeholder: '搜索附件（支持 || 和 && 组合）',
						clearable: true,
						size: 'small',
						onUpdateValue: (val: string) => { assetSearchQuery.value = val; }
					}),
					assetSearchQuery.value.trim() ? h(NText, { depth: 3, style: { fontSize: '12px' } }, {
						default: () => `匹配 ${filteredAssetsList.value.length} / ${assetsList.value.length} 个附件`
					}) : null,
					h(NSpin, { show: assetsLoading.value }, {
						default: () => filteredAssetsList.value.length > 0
							? h(NList, { bordered: true }, {
								default: () => filteredAssetsList.value.map((asset, index) =>
									h(NListItem, { key: index }, {
										default: () => h(NSpace, { align: 'center', justify: 'space-between', style: { width: '100%' } }, {
											default: () => [
												h(NSpace, { align: 'center', size: 12, style: { cursor: asset.type === 'dir' ? 'pointer' : 'default' }, ...(asset.type === 'dir' ? { onClick: () => navigateToAssetDir(asset.name) } : {}) }, {
													default: () => [
														asset.type === 'dir'
															? h(NTag, { size: 'small', type: 'warning' }, { default: () => '📁' })
															: isImageFile(asset.name)
																? h('img', {
																	src: asset.url,
																	alt: asset.name,
																	style: { maxWidth: '48px', maxHeight: '48px', borderRadius: '4px', objectFit: 'cover' },
																	onError: (e: Event) => { (e.target as HTMLImageElement).style.display = 'none'; }
																})
																: h(NTag, { size: 'small', type: 'info' }, { default: () => getFileExt(asset.name) }),
														h(NSpace, { vertical: true, size: 0 }, {
															default: () => [
																h(NText, {}, {
																	default: () => asset.type === 'dir' ? `${asset.name}/` : asset.name
																}),
																h(NText, { depth: 3, style: { fontSize: '12px' } }, {
																	default: () => asset.type === 'dir'
																		? '点击进入'
																		: `${formatFileSize(asset.size)} · ${asset.path}`
																})
															]
														})
													]
												}),
												asset.type === 'file' ? h(NSpace, { size: 4 }, {
													default: () => [
														asset.url ? h(NButton, {
															size: 'tiny',
															tag: 'a',
															href: asset.url,
															target: '_blank',
															type: 'info'
														}, { default: () => '预览' }) : h(NTag, { size: 'small', type: 'default' }, { default: () => '未部署' }),
														h(NButton, {
															size: 'tiny',
															type: 'warning',
															onClick: () => startRenameAsset(asset)
														}, { default: () => '重命名' }),
														h(NButton, {
															size: 'tiny',
															type: 'error',
															onClick: () => startDeleteAsset(asset)
														}, { default: () => '删除' })
													]
												}) : null
											]
										})
									})
								)
							})
							: h(NEmpty, { description: assetsList.value.length > 0 ? '没有匹配的附件' : '暂无附件，点击"刷新列表"或"上传附件"' })
					}),
					assetsErrors.value.length > 0 ? renderErrors(assetsErrors.value) : null,
					// 重命名弹窗
					h(NModal, {
						show: showAssetRename.value,
						preset: 'dialog',
						title: '重命名附件',
						positiveText: '确认',
						negativeText: '取消',
						loading: renameLoading.value,
						disabled: !renameNewName.value.trim(),
						onPositiveClick: () => { doRenameAsset(); return false; },
						onNegativeClick: () => { showAssetRename.value = false; renameNewName.value = ''; renameOldPath.value = ''; },
						onClose: () => { showAssetRename.value = false; renameNewName.value = ''; renameOldPath.value = ''; },
					}, {
						default: () => h(NSpace, { vertical: true, size: 12 }, {
							default: () => [
								h(NText, { depth: 3 }, { default: () => `原文件: ${renameOldPath.value}` }),
								h(NInput, {
									value: renameNewName.value,
									placeholder: '输入新文件名',
									onUpdateValue: (val: string) => { renameNewName.value = val; }
								})
							]
						})
					}),
					// 删除确认弹窗
					h(NModal, {
						show: showAssetDelete.value,
						preset: 'dialog',
						title: '删除附件',
						type: 'error',
						positiveText: '删除',
						negativeText: '取消',
						loading: deleteLoading.value,
						onPositiveClick: () => { doDeleteAsset(); return false; },
						onNegativeClick: () => { showAssetDelete.value = false; deleteFilePath.value = ''; deleteFileName.value = ''; },
						onClose: () => { showAssetDelete.value = false; deleteFilePath.value = ''; deleteFileName.value = ''; },
					}, {
						default: () => h(NSpace, { vertical: true, size: 12 }, {
							default: () => [
								h(NText, {}, { default: () => `确定要删除以下附件吗？此操作不可撤销。` }),
								h(NText, { depth: 3 }, { default: () => deleteFilePath.value }),
							]
						})
					}),
					// 上传弹窗
					h(NModal, {
						show: showAssetUpload.value,
						preset: 'dialog',
						title: '上传附件',
						positiveText: '上传',
						negativeText: '取消',
						loading: uploadLoading.value,
						disabled: !uploadFileData.value || !uploadFileName.value.trim(),
						onPositiveClick: () => { doUploadAsset(); return false; },
						onNegativeClick: () => { showAssetUpload.value = false; uploadFileName.value = ''; uploadFileData.value = ''; },
						onClose: () => { showAssetUpload.value = false; uploadFileName.value = ''; uploadFileData.value = ''; },
					}, {
						default: () => h(NSpace, { vertical: true, size: 12 }, {
							default: () => [
								h(NText, { depth: 3 }, {
									default: () => `上传到: ${options.api.getAssetsDir()}${currentAssetSubPath.value ? '/' + currentAssetSubPath.value : ''}`
								}),
								h(NButton, {
									type: 'primary',
									size: 'small',
									onClick: triggerFileInput
								}, { default: () => '选择文件' }),
								uploadFileData.value
									? h(NText, { depth: 3 }, { default: () => `已选择: ${uploadFileName.value}` })
									: h(NText, { depth: 3 }, { default: () => '请先选择要上传的文件' })
							]
						})
					})
				]
			});
		}
	};

	const MainModal = {
		setup() {
			onMounted(() => {
				init();
			});

			onUnmounted(() => {
				if (themeObserver) {
					themeObserver.disconnect();
					themeObserver = null;
				}
			});

			return () => h(NConfigProvider, {
				theme: currentTheme.value === 'dark' ? darkTheme : lightTheme,
				themeOverrides: themeOverrides.value
			}, {
				default: () => h('div', {
					style: { width: '100%', maxWidth: '1200px', margin: '0 auto' }
				}, [
					h(NCard, {
						title: modalTitle.value,
						segmented: { content: true, footer: true },
						style: { width: '100%' }
					}, {
						default: () => [
							// 配置包 URL 输入框
							h(NCard, { title: '配置包调试', size: 'small', style: { marginBottom: '16px' } }, {
								default: () => h(NSpace, { vertical: true, size: 8 }, {
									default: () => [
										h(NInputGroup, {}, {
											default: () => [
												h(NInputGroupLabel, { style: { width: '180px' } }, { default: () => 'vuepress-config-bundle.json URL:' }),
												h(NInput, {
													value: configBundleUrl.value,
													placeholder: 'https://example.com/obsidian-bridge/vuepress-config-bundle.json',
													onUpdateValue: (val: string) => { configBundleUrl.value = val; }
												}),
													h(NButton, {
													type: 'primary',
													size: 'small',
													loading: reloadingConfigBundle.value,
													onClick: reloadConfigBundle
												}, { default: () => reloadingConfigBundle.value ? '加载中...' : '重新加载' })
											]
										}),
										h(NText, { depth: 3, style: { fontSize: '12px' } }, {
											default: () => '修改此 URL 可调试不同环境的配置包，修改后点击"重新加载"生效'
										})
									]
								})
							}),
							h(NTabs, {
								value: tabValue.value,
								type: 'line',
								animated: true,
								'onUpdate:value': (val: string) => {
									tabValue.value = val as any;
									if (val === 'assets' && assetsList.value.length === 0) {
										loadAssets();
									}
								}
							}, {
								default: () => [
									h(NTabPane, {
										name: 'config',
										tab: '配置文件'
									}, {
										default: () => h(ConfigTab)
									}),
									h(NTabPane, {
										name: 'vuepress',
										tab: '.vuepress'
									}, {
										default: () => h(VuePressTab)
									}),
									h(NTabPane, {
										name: 'assets',
										tab: '附件管理'
									}, {
										default: () => h(AssetsTab)
									})
								]
							}),
							h(NDivider),
							h(NSpace, { justify: 'space-between' }, {
								default: () => [
									h(NCheckbox, {
										checked: createPR.value,
										onUpdateChecked: (val: boolean) => { createPR.value = val; }
									}, { default: () => '创建 Pull Request' }),
									h(NSpace, {}, {
										default: () => [
											h(NButton, { onClick: onCancel }, { default: () => '取消' }),
											h(NButton, {
												type: 'primary',
												loading: saving.value,
												disabled: !canSave.value,
												onClick: onSave
											}, { default: () => '保存' })
										]
									})
								]
							})
						]
					})
				])
			});
		}
	};

	const ProgressModal = {
		setup() {
			return () => h(NConfigProvider, {
				theme: currentTheme.value === 'dark' ? darkTheme : lightTheme,
				themeOverrides: themeOverrides.value
			}, {
				default: () => h(NModal, {
					show: showProgress.value,
					preset: 'card',
					title: '保存中...',
					closable: false,
					'mask-closable': false,
					style: { width: '400px' },
					'onUpdate:show': (val: boolean) => { showProgress.value = val; }
				}, {
					default: () => h(NSpace, { vertical: true, size: 12, align: 'center' }, {
						default: () => [
							h(NProgress, { type: 'line', percentage: progressPercent.value, status: 'success' }),
							h(NText, {}, { default: () => progressMessage.value })
						]
					})
				})
			});
		}
	};

	const ResultModal = {
		setup() {
			return () => h(NConfigProvider, {
				theme: currentTheme.value === 'dark' ? darkTheme : lightTheme,
				themeOverrides: themeOverrides.value
			}, {
				default: () => h(NModal, {
					show: showResult.value,
					preset: 'card',
					title: resultSuccess.value ? '保存成功' : '保存失败',
					style: { width: '400px' },
					'onUpdate:show': (val: boolean) => { showResult.value = val; }
				}, {
					default: () => h(NResult, {
						status: resultSuccess.value ? 'success' : 'error',
						title: resultSuccess.value ? '保存成功' : '保存失败'
					}, {
						footer: () => h(NSpace, { justify: 'center' }, {
							default: () => [
								resultSuccess.value && prUrl.value ? h(NButton, {
									tag: 'a',
									href: prUrl.value,
									target: '_blank'
								}, { default: () => `查看 PR #${prNumber.value}` }) : null,
								h(NButton, { onClick: onResultClose }, { default: () => '关闭' })
							]
						})
					})
				})
			});
		}
	};

	// 使用传入的容器！
	const container = options.container;
	container.className = 'sillot-naive-modal';
	container.innerHTML = '';

	const app = createApp({
		setup() {
			return () => h('div', {}, [h(MainModal), h(ProgressModal), h(ResultModal)]);
		}
	});

	app.mount(container);

	return {
		app,
		unmount: () => {
			if (themeObserver) {
				themeObserver.disconnect();
				themeObserver = null;
			}
			app.unmount();
			container.innerHTML = '';
		},
	};
}
