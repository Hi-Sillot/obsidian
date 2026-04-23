import {
	createApp,
	type App as VueApp,
	h,
	ref,
	reactive,
	computed,
	watch,
	onMounted,
	onUnmounted,
	nextTick,
	type Ref,
} from 'vue';
import {
	NConfigProvider,
	NTabs,
	NTabPane,
	NButton,
	NSpace,
	NTag,
	NText,
	NCard,
	NEmpty,
	NSpin,
	NProgress,
	NList,
	NListItem,
	NPopconfirm,
	NTooltip,
	NAvatar,
	NInput,
	NInputGroup,
	NSelect,
	NModal,
	NAlert,
	darkTheme,
	lightTheme,
	type GlobalThemeOverrides,
} from 'naive-ui';
import type { TFile } from 'obsidian';
import type {
	ParsedSyncBlock,
	PublishStatus,
	FilePublishInfo,
	DiffResult,
	DiffCompareSource,
	DiffLine,
} from '../../types';

const PANEL_CLASS = 'sillot-doc-sync-panel';

type PanelState = 'minimized' | 'default' | 'expanded';
type ActiveTab = 'sync' | 'publish' | 'components' | 'authors';
type PublishDisplayMode = 'default' | 'expanded';
type EditorMode = 'reading' | 'source' | 'live-preview';

interface ComponentInfo {
	tag: string;
	detail: string;
	line: number;
	ch: number;
}

interface AuthorInfo {
	name: string;
	slug: string;
	avatar?: string;
	verified?: boolean;
}

interface TaskInfo {
	id: string;
	label: string;
	progress: number;
	status: 'running' | 'success' | 'failed';
}

const STATUS_CONFIG: Record<PublishStatus, { icon: string; text: string; cls: string }> = {
	unpublished: { icon: '⚪', text: '未发布', cls: 'unpublished' },
	published: { icon: '🟢', text: '已发布', cls: 'published' },
	outdated: { icon: '🟡', text: '待更新', cls: 'outdated' },
};

export interface DocSyncPanelAPI {
	getPanelState: () => PanelState;
	setPanelState: (state: PanelState) => void;
	getActiveTab: () => ActiveTab;
	setActiveTab: (tab: ActiveTab) => void;
	getEditorMode: () => EditorMode;
	toggleEditorMode: () => void;
	getSyncBlocks: () => ParsedSyncBlock[];
	getPublishInfo: () => FilePublishInfo | null;
	getDiffResult: () => DiffResult | null;
	getPublishDisplayMode: () => PublishDisplayMode;
	setPublishDisplayMode: (mode: PublishDisplayMode) => void;
	getCompareSource: () => DiffCompareSource;
	setCompareSource: (source: DiffCompareSource) => void;
	getActiveTasks: () => TaskInfo[];
	getComponents: () => ComponentInfo[];
	getAuthors: () => AuthorInfo[];
	getCurrentFile: () => TFile | null;
	isDesktop: () => boolean;
	syncCurrentDoc: () => void;
	publishCurrentDoc: (target: 'local' | 'github') => void;
	moveDocument: () => void;
	editPublishId: () => void;
	generatePublishId: () => void;
	rollbackToPublishedVersion: () => void;
	copyDiffAsMarkdown: () => void;
	recomputeDiff: () => Promise<void>;
	removeAuthor: (index: number) => void;
	openAddAuthorModal: () => void;
	jumpToLine: (line: number, ch: number) => void;
	removeSyncBlock: (block: ParsedSyncBlock) => void;
	copySyncBlockContent: (content: string) => void;
	editSyncBlock: (block: ParsedSyncBlock) => void;
	refreshPanel: () => void;
	loadAvailableAuthors: () => Promise<AuthorInfo[]>;
	addAuthor: (author: AuthorInfo) => void;
}

function getObsidianTheme(): 'dark' | 'light' {
	return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

function createThemeOverrides(theme: 'dark' | 'light'): GlobalThemeOverrides {
	const s = getComputedStyle(document.body);
	const c = theme === 'dark' ? {
		primary: s.getPropertyValue('--interactive-accent').trim() || '#7C3AED',
		primaryHover: s.getPropertyValue('--interactive-hover').trim() || '#8B5CF6',
		bg: s.getPropertyValue('--background-secondary').trim() || '#1a1a1a',
		bgPrimary: s.getPropertyValue('--background-primary').trim() || '#11111b',
		border: s.getPropertyValue('--background-modifier-border').trim() || '#3a3a4a',
		text: s.getPropertyValue('--text-normal').trim() || '#cdd6f4',
		textMuted: s.getPropertyValue('--text-muted').trim() || '#a6adc8',
		textFaint: s.getPropertyValue('--text-faint').trim() || '#6c7086',
	} : {
		primary: s.getPropertyValue('--interactive-accent').trim() || '#7C3AED',
		primaryHover: s.getPropertyValue('--interactive-hover').trim() || '#6D28D9',
		bg: s.getPropertyValue('--background-secondary').trim() || '#ffffff',
		bgPrimary: s.getPropertyValue('--background-primary').trim() || '#f5f5f5',
		border: s.getPropertyValue('--background-modifier-border').trim() || '#e0e0e0',
		text: s.getPropertyValue('--text-normal').trim() || '#4a4a4a',
		textMuted: s.getPropertyValue('--text-muted').trim() || '#6a6a6a',
		textFaint: s.getPropertyValue('--text-faint').trim() || '#9a9a9a',
	};

	return {
		common: {
			primaryColor: c.primary,
			primaryColorHover: c.primaryHover,
			primaryColorPressed: c.primary,
			bodyColor: c.bgPrimary,
			cardColor: c.bg,
			popoverColor: c.bg,
			modalColor: c.bg,
			inputColor: c.bg,
			borderColor: c.border,
			dividerColor: c.border,
			textColorBase: c.text,
			textColor1: c.text,
			textColor2: c.textMuted,
			textColor3: c.textFaint,
			fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
			fontFamilyMono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
			borderRadius: '6px',
			fontSize: '12px',
		},
		Button: {
			heightTiny: '24px',
			heightSmall: '26px',
			heightMedium: '28px',
			fontSizeTiny: '11px',
			fontSizeSmall: '12px',
			fontSizeMedium: '12px',
		},
		Tabs: {
			tabTextColorLine: c.textMuted,
			tabTextColorActiveLine: c.text,
			tabTextColorHoverLine: c.primary,
			barColor: c.primary,
			tabGapSmallLine: '4px',
			tabGapMediumLine: '8px',
		},
		Tag: {
			heightTiny: '18px',
			heightSmall: '20px',
		},
		Card: {
			color: c.bg,
			borderColor: c.border,
		},
		Input: {
			color: c.bg,
			borderColor: c.border,
		},
		Progress: {
			railHeight: '4px',
		},
	};
}

function formatTimestamp(mtime: number | null): string {
	if (!mtime) return '-';
	const d = new Date(mtime);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createDocSyncPanelApp(
	container: HTMLElement,
	api: DocSyncPanelAPI
): { app: VueApp; unmount: () => void; forceUpdate: () => void } {
	const panelState = ref<PanelState>(api.getPanelState());
	const activeTab = ref<ActiveTab>(api.getActiveTab());
	const editorMode = ref<EditorMode>(api.getEditorMode());
	const syncBlocks = ref<ParsedSyncBlock[]>(api.getSyncBlocks());
	const publishInfo = ref<FilePublishInfo | null>(api.getPublishInfo());
	const diffResult = ref<DiffResult | null>(api.getDiffResult());
	const publishDisplayMode = ref<PublishDisplayMode>(api.getPublishDisplayMode());
	const compareSource = ref<DiffCompareSource>(api.getCompareSource());
	const activeTasks = ref<TaskInfo[]>(api.getActiveTasks());
	const components = ref<ComponentInfo[]>(api.getComponents());
	const authors = ref<AuthorInfo[]>(api.getAuthors());
	const currentFile = ref<TFile | null>(api.getCurrentFile());
	const isDesktop = ref(api.isDesktop());
	const currentTheme = ref<'dark' | 'light'>(getObsidianTheme());
	const themeOverrides = computed(() => createThemeOverrides(currentTheme.value));

	const showAddAuthorModal = ref(false);
	const availableAuthors = ref<AuthorInfo[]>([]);
	const loadingAuthors = ref(false);

	let themeObserver: MutationObserver | null = null;

	const forceUpdate = () => {
		panelState.value = api.getPanelState();
		activeTab.value = api.getActiveTab();
		editorMode.value = api.getEditorMode();
		syncBlocks.value = api.getSyncBlocks();
		publishInfo.value = api.getPublishInfo();
		diffResult.value = api.getDiffResult();
		publishDisplayMode.value = api.getPublishDisplayMode();
		compareSource.value = api.getCompareSource();
		activeTasks.value = api.getActiveTasks();
		components.value = api.getComponents();
		authors.value = api.getAuthors();
		currentFile.value = api.getCurrentFile();
		isDesktop.value = api.isDesktop();
	};

	const DocSyncPanelComponent = {
		setup() {
			onMounted(() => {
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
			});

			onUnmounted(() => {
				if (themeObserver) {
					themeObserver.disconnect();
					themeObserver = null;
				}
			});

			const onSetPanelState = (state: PanelState) => {
				panelState.value = state;
				api.setPanelState(state);
			};

			const onSetActiveTab = (tab: ActiveTab) => {
				activeTab.value = tab;
				api.setActiveTab(tab);
			};

			return () => {
				const theme = currentTheme.value === 'dark' ? darkTheme : lightTheme;

				return h(NConfigProvider, { theme, themeOverrides: themeOverrides.value }, {
					default: () => h('div', {
						class: [
							`${PANEL_CLASS}`,
							`${PANEL_CLASS}--${panelState.value}`,
							'sillot-naive-panel',
						],
					}, [
						panelState.value === 'minimized'
							? renderMinimized(panelState, editorMode, syncBlocks, publishInfo, diffResult, activeTasks, isDesktop, onSetPanelState, onSetActiveTab, api)
							: renderExpandedPanel(panelState, activeTab, editorMode, syncBlocks, publishInfo, diffResult, publishDisplayMode, compareSource, activeTasks, components, authors, currentFile, isDesktop, onSetPanelState, onSetActiveTab, api, showAddAuthorModal, availableAuthors, loadingAuthors),
					])
				});
			};
		},
	};

	const app = createApp(DocSyncPanelComponent);
	app.mount(container);

	return {
		app,
		unmount: () => {
			if (themeObserver) {
				themeObserver.disconnect();
				themeObserver = null;
			}
			app.unmount();
		},
		forceUpdate,
	};
}

function renderMinimized(
	panelState: Ref<PanelState>,
	editorMode: Ref<EditorMode>,
	syncBlocks: Ref<ParsedSyncBlock[]>,
	publishInfo: Ref<FilePublishInfo | null>,
	diffResult: Ref<DiffResult | null>,
	activeTasks: Ref<TaskInfo[]>,
	isDesktop: Ref<boolean>,
	onSetPanelState: (s: PanelState) => void,
	onSetActiveTab: (t: ActiveTab) => void,
	api: DocSyncPanelAPI,
) {
	const modeIcons: Record<EditorMode, { icon: string; text: string; title: string }> = {
		reading: { icon: '📖', text: '阅读', title: '阅读模式 - 点击切换' },
		source: { icon: '📝', text: '源码', title: '源码模式 - 点击切换' },
		'live-preview': { icon: '✏️', text: '预览', title: '实时预览 - 点击切换' },
	};

	const mode = modeIcons[editorMode.value];

	const renderPublishBadge = () => {
		const info = publishInfo.value;
		if (!info) return h(NTag, { size: 'small', type: 'default' }, { default: () => '📤…' });

		const localCfg = STATUS_CONFIG[info.localStatus];
		const siteCfg = STATUS_CONFIG[info.siteStatus];

		const children: any[] = [];
		if (isDesktop.value) {
			children.push(h('span', { class: `${PANEL_CLASS}-publish-status ${PANEL_CLASS}-publish-status--${localCfg.cls}` }, `本地${localCfg.icon}`));
		}
		children.push(h('span', { class: `${PANEL_CLASS}-publish-status ${PANEL_CLASS}-publish-status--${siteCfg.cls}` }, `站点${siteCfg.icon}`));

		if (diffResult.value && (diffResult.value.addedCount > 0 || diffResult.value.removedCount > 0)) {
			children.push(h('span', { class: `${PANEL_CLASS}-diff-summary` }, [
				h('span', { class: `${PANEL_CLASS}-diff-added` }, `+${diffResult.value.addedCount}`),
				' ',
				h('span', { class: `${PANEL_CLASS}-diff-removed` }, `-${diffResult.value.removedCount}`),
			]));
		}

		return h('div', {
			class: `${PANEL_CLASS}-minimized ${PANEL_CLASS}-publish-badge`,
			onClick: (e: Event) => { e.stopPropagation(); onSetActiveTab('publish'); onSetPanelState('default'); },
		}, children);
	};

	const renderTaskIndicator = () => {
		const tasks = activeTasks.value;
		if (tasks.length === 0) return null;

		const task = tasks[tasks.length - 1];
		return h('div', { class: `${PANEL_CLASS}-task-indicator` }, [
			h(NProgress, {
				type: 'line',
				percentage: task.progress < 0 ? 0 : Math.max(0, Math.min(100, task.progress)),
				indicatorPlacement: 'inside',
				status: task.progress < 0 ? 'default' : 'success',
				railColor: 'var(--background-modifier-border)',
			}),
			h('span', { class: `${PANEL_CLASS}-task-label`, title: task.label }, task.label),
		]);
	};

	return h('div', { class: `${PANEL_CLASS}-minimized-wrapper` }, [
		h(NTooltip, { trigger: 'hover' }, {
			trigger: () => h('div', {
				class: `${PANEL_CLASS}-minimized ${PANEL_CLASS}-mode-badge`,
				onClick: (e: Event) => { e.stopPropagation(); api.toggleEditorMode(); },
			}, [
				h('span', { class: `${PANEL_CLASS}-icon` }, mode.icon),
				h('span', { class: `${PANEL_CLASS}-mode-text` }, mode.text),
			]),
			default: () => mode.title,
		}),
		renderPublishBadge(),
		h(NTooltip, { trigger: 'hover' }, {
			trigger: () => h('div', {
				class: `${PANEL_CLASS}-minimized ${PANEL_CLASS}-sync-badge`,
				onClick: (e: Event) => { e.stopPropagation(); onSetActiveTab('sync'); onSetPanelState('default'); },
			}, [
				h('span', { class: `${PANEL_CLASS}-icon` }, '🔗'),
				h('span', { class: `${PANEL_CLASS}-count` }, `${syncBlocks.value.length}`),
			]),
			default: () => `同步块: ${syncBlocks.value.length}`,
		}),
		renderTaskIndicator(),
	]);
}

function renderExpandedPanel(
	panelState: Ref<PanelState>,
	activeTab: Ref<ActiveTab>,
	editorMode: Ref<EditorMode>,
	syncBlocks: Ref<ParsedSyncBlock[]>,
	publishInfo: Ref<FilePublishInfo | null>,
	diffResult: Ref<DiffResult | null>,
	publishDisplayMode: Ref<PublishDisplayMode>,
	compareSource: Ref<DiffCompareSource>,
	activeTasks: Ref<TaskInfo[]>,
	components: Ref<ComponentInfo[]>,
	authors: Ref<AuthorInfo[]>,
	currentFile: Ref<TFile | null>,
	isDesktop: Ref<boolean>,
	onSetPanelState: (s: PanelState) => void,
	onSetActiveTab: (t: ActiveTab) => void,
	api: DocSyncPanelAPI,
	showAddAuthorModal: Ref<boolean>,
	availableAuthors: Ref<AuthorInfo[]>,
	loadingAuthors: Ref<boolean>,
) {
	const controls = h('div', { class: `${PANEL_CLASS}-controls` }, [
		h(NButton, { size: 'tiny', quaternary: true, onClick: () => onSetPanelState('minimized') }, { default: () => '−' }),
		h(NButton, {
			size: 'tiny',
			quaternary: true,
			onClick: () => onSetPanelState(panelState.value === 'expanded' ? 'default' : 'expanded'),
		}, { default: () => panelState.value === 'expanded' ? '▭' : '□' }),
	]);

	const tabBar = h(NTabs, {
		value: activeTab.value,
		type: 'line',
		size: 'small',
		tabStyle: 'padding: 4px 8px; min-width: auto;',
		'onUpdate:value': (val: string) => onSetActiveTab(val as ActiveTab),
	}, {
		default: () => [
			h(NTabPane, { name: 'sync', tab: '🔗 同步' }),
			h(NTabPane, { name: 'publish', tab: '📤 发布' }),
			h(NTabPane, { name: 'components', tab: '🏷️ 组件' }),
			h(NTabPane, { name: 'authors', tab: '👤 作者' }),
		],
	});

	let tabContent: any;
	switch (activeTab.value) {
		case 'sync':
			tabContent = renderSyncTab(syncBlocks, panelState, api);
			break;
		case 'publish':
			tabContent = renderPublishTab(publishInfo, diffResult, publishDisplayMode, compareSource, isDesktop, api);
			break;
		case 'components':
			tabContent = renderComponentsTab(components, currentFile, api);
			break;
		case 'authors':
			tabContent = renderAuthorsTab(authors, currentFile, api, showAddAuthorModal, availableAuthors, loadingAuthors);
			break;
	}

	return [controls, tabBar, tabContent];
}

function renderSyncTab(
	syncBlocks: Ref<ParsedSyncBlock[]>,
	panelState: Ref<PanelState>,
	api: DocSyncPanelAPI,
) {
	const blocks = syncBlocks.value;

	return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
		h(NSpace, { justify: 'space-between', align: 'center', style: { marginBottom: '8px' } }, {
			default: () => [
				h(NText, { depth: 2 }, { default: () => `同步块 (${blocks.length})` }),
				h(NButton, { size: 'tiny', type: 'primary', onClick: () => api.syncCurrentDoc() }, { default: () => '同步' }),
			],
		}),
		blocks.length === 0
			? h(NEmpty, { description: '此文档无文档级同步块', size: 'small' })
			: h('div', { class: `${PANEL_CLASS}-sync-list` }, blocks.map((block, idx) =>
				h('div', { class: `${PANEL_CLASS}-sync-item`, key: idx }, [
					h(NSpace, { align: 'center', justify: 'space-between', wrap: false }, {
						default: () => [
							h(NSpace, { align: 'center', size: 6, wrap: false }, {
								default: () => [
									h(NTag, { size: 'small', type: 'info' }, { default: () => block.syncId }),
									h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => `${block.type} · ${block.localTime || '-'}` }),
								],
							}),
							h(NSpace, { size: 4 }, {
								default: () => [
									h(NButton, { size: 'tiny', quaternary: true, onClick: () => api.copySyncBlockContent(block.content) }, { default: () => '复制' }),
									h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => api.removeSyncBlock(block) }, { default: () => '删除' }),
									h(NButton, { size: 'tiny', quaternary: true, onClick: () => api.editSyncBlock(block) }, { default: () => '编辑' }),
								],
							}),
						],
					}),
					panelState.value === 'expanded' && block.content
						? h('div', {
							class: `${PANEL_CLASS}-detail-content`,
							style: { fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px', whiteSpace: 'pre-wrap' },
						}, block.content.length > 200 ? block.content.substring(0, 200) + '...' : block.content)
						: null,
				])
			)),
	]);
}

function renderPublishTab(
	publishInfo: Ref<FilePublishInfo | null>,
	diffResult: Ref<DiffResult | null>,
	publishDisplayMode: Ref<PublishDisplayMode>,
	compareSource: Ref<DiffCompareSource>,
	isDesktop: Ref<boolean>,
	api: DocSyncPanelAPI,
) {
	const info = publishInfo.value;

	const header = h(NSpace, { justify: 'space-between', align: 'center', style: { marginBottom: '8px' } }, {
		default: () => [
			h(NText, { depth: 2 }, { default: () => '📤 发布情况' }),
			h(NSpace, { size: 4 }, {
				default: () => [
					isDesktop.value ? h(NButton, { size: 'tiny', onClick: () => api.publishCurrentDoc('local') }, { default: () => '发布到本地' }) : null,
					h(NButton, { size: 'tiny', type: 'primary', onClick: () => api.publishCurrentDoc('github') }, { default: () => '发布到 GitHub' }),
					h(NButton, {
						size: 'tiny',
						quaternary: true,
						onClick: () => {
							const newMode = publishDisplayMode.value === 'expanded' ? 'default' : 'expanded';
							publishDisplayMode.value = newMode;
							api.setPublishDisplayMode(newMode);
						},
					}, { default: () => publishDisplayMode.value === 'expanded' ? '▴' : '▾' }),
				],
			}),
		],
	});

	if (!info) {
		return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
			header,
			h(NEmpty, { description: '发布状态不可用', size: 'small' }),
		]);
	}

	const localCfg = STATUS_CONFIG[info.localStatus];
	const siteCfg = STATUS_CONFIG[info.siteStatus];

	const statusRows: any[] = [];

	if (isDesktop.value) {
		statusRows.push(
			h('tr', {}, [
				h('td', { class: `${PANEL_CLASS}-publish-info-label` }, '本地'),
				h('td', {}, [
					h(NTag, { size: 'small', type: localCfg.cls === 'published' ? 'success' : localCfg.cls === 'outdated' ? 'warning' : 'default' }, {
						default: () => `${localCfg.icon} ${localCfg.text}`,
					}),
					info.localMtime ? h(NText, { depth: 3, style: { fontSize: '11px', marginLeft: '6px' } }, { default: () => formatTimestamp(info.localMtime) }) : null,
				]),
			])
		);
	}

	statusRows.push(
		h('tr', {}, [
			h('td', { class: `${PANEL_CLASS}-publish-info-label` }, '站点'),
			h('td', {}, [
				h(NTag, { size: 'small', type: siteCfg.cls === 'published' ? 'success' : siteCfg.cls === 'outdated' ? 'warning' : 'default' }, {
					default: () => `${siteCfg.icon} ${siteCfg.text}`,
				}),
				info.siteMtime ? h(NText, { depth: 3, style: { fontSize: '11px', marginLeft: '6px' } }, { default: () => formatTimestamp(info.siteMtime) }) : null,
			]),
		])
	);

	if (info.vuepressPath) {
		statusRows.push(
			h('tr', {}, [
				h('td', { class: `${PANEL_CLASS}-publish-info-label` }, '路径'),
				h('td', {}, [
					h(NText, { style: { fontSize: '11px' } }, { default: () => info.vuepressPath }),
					h(NButton, { size: 'tiny', quaternary: true, onClick: () => api.moveDocument() }, { default: () => '✏️' }),
				]),
			])
		);
	}

	statusRows.push(
		h('tr', {}, [
			h('td', { class: `${PANEL_CLASS}-publish-info-label` }, '发布ID'),
			h('td', {}, info.publishId
				? [
					h(NText, { code: true, style: { fontSize: '11px' } }, { default: () => info.publishId }),
					h(NButton, { size: 'tiny', quaternary: true, onClick: () => api.editPublishId() }, { default: () => '✏️' }),
				]
				: [
					h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => '⚠️ 无发布ID' }),
					h(NButton, { size: 'tiny', type: 'primary', onClick: () => api.generatePublishId() }, { default: () => '生成' }),
				]
			),
		])
	);

	const diff = diffResult.value;
	if (diff && (diff.addedCount > 0 || diff.removedCount > 0)) {
		statusRows.push(
			h('tr', {}, [
				h('td', { class: `${PANEL_CLASS}-publish-info-label` }, '差异'),
				h('td', {}, [
					h(NSpace, { size: 8, align: 'center' }, {
						default: () => [
							h(NTag, { size: 'small', type: 'success' }, { default: () => `+${diff.addedCount}` }),
							h(NTag, { size: 'small', type: 'error' }, { default: () => `-${diff.removedCount}` }),
							h(NTag, { size: 'small', type: 'default' }, { default: () => `~${diff.unchangedCount}` }),
						],
					}),
				]),
			])
		);
	}

	const infoTable = h('table', { class: `${PANEL_CLASS}-publish-info-table` }, [
		h('tbody', {}, statusRows),
	]);

	let diffSection: any = null;
	if (publishDisplayMode.value === 'expanded') {
		diffSection = renderDiffSection(diffResult, compareSource, isDesktop, api);
	}

	return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
		header,
		infoTable,
		diffSection,
	]);
}

function renderDiffSection(
	diffResult: Ref<DiffResult | null>,
	compareSource: Ref<DiffCompareSource>,
	isDesktop: Ref<boolean>,
	api: DocSyncPanelAPI,
) {
	const diff = diffResult.value;
	if (!diff) {
		return h(NEmpty, { description: '差异信息不可用', size: 'small' });
	}

	const hasLocal = isDesktop.value;
	const hasSite = true;

	const diffHeader = h(NSpace, { justify: 'space-between', align: 'center', style: { marginBottom: '6px' } }, {
		default: () => [
			h(NSpace, { align: 'center', size: 8 }, {
				default: () => [
					h(NText, { strong: true, style: { fontSize: '12px' } }, { default: () => '差异对比' }),
					hasLocal && hasSite
						? h(NSelect, {
							size: 'tiny',
							value: compareSource.value,
							options: [
								{ label: '对比: 本地', value: 'local' },
								{ label: '对比: 云端', value: 'site' },
							],
							style: { width: '120px' },
							'onUpdate:value': async (val: DiffCompareSource) => {
								compareSource.value = val;
								api.setCompareSource(val);
								await api.recomputeDiff();
							},
						})
						: h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => `(对比: ${compareSource.value === 'local' ? '本地' : '云端'})` }),
				],
			}),
			h(NSpace, { size: 4 }, {
				default: () => [
					h(NButton, { size: 'tiny', quaternary: true, onClick: () => api.copyDiffAsMarkdown() }, { default: () => '复制 Diff' }),
					(diff.addedCount > 0 || diff.removedCount > 0)
						? h(NPopconfirm, { onPositiveClick: () => api.rollbackToPublishedVersion() }, {
							trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => '回滚' }),
							default: () => `确认用${diff.compareSource === 'local' ? '本地' : '云端'}版本覆盖当前文档？`,
						})
						: null,
				],
			}),
		],
	});

	const statsBar = h(NSpace, { size: 8, align: 'center', style: { marginBottom: '6px' } }, {
		default: () => [
			h(NTag, { size: 'small', type: 'success' }, { default: () => `+${diff.addedCount} 新增` }),
			h(NTag, { size: 'small', type: 'error' }, { default: () => `-${diff.removedCount} 删除` }),
			h(NTag, { size: 'small' }, { default: () => `~${diff.unchangedCount} 未变` }),
			diff.fallback ? h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => '⚠ 已回退对比源' }) : null,
		],
	});

	const contextRadius = 3;
	const showLines = computeVisibleDiffLines(diff, contextRadius);

	const diffBody = h('div', { class: `${PANEL_CLASS}-diff-body` }, () => {
		const lines: any[] = [];
		let lastShown = -1;
		for (let i = 0; i < diff.lines.length; i++) {
			if (!showLines.has(i)) continue;
			if (lastShown >= 0 && i - lastShown > 1) {
				lines.push(h('div', { class: `${PANEL_CLASS}-diff-sep`, key: `sep-${i}` }, '⋯'));
			}
			lastShown = i;

			const line = diff.lines[i];
			const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
			lines.push(h('div', {
				key: i,
				class: `${PANEL_CLASS}-diff-line ${PANEL_CLASS}-diff-line--${line.type}`,
			}, [
				h('div', { class: `${PANEL_CLASS}-diff-line-no` }, [
					h('span', {}, line.oldLineNo != null ? String(line.oldLineNo) : ''),
					h('span', {}, line.newLineNo != null ? String(line.newLineNo) : ''),
				]),
				h('div', { class: `${PANEL_CLASS}-diff-line-content` }, `${prefix} ${line.content}`),
			]));
		}
		return lines;
	});

	return h('div', { class: `${PANEL_CLASS}-diff-section`, style: { marginTop: '8px' } }, [
		diffHeader,
		statsBar,
		diffBody,
	]);
}

function computeVisibleDiffLines(diff: DiffResult, contextRadius: number): Set<number> {
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

function renderComponentsTab(
	components: Ref<ComponentInfo[]>,
	currentFile: Ref<TFile | null>,
	api: DocSyncPanelAPI,
) {
	const comps = components.value;

	if (!currentFile.value) {
		return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
			h(NEmpty, { description: '无当前文档', size: 'small' }),
		]);
	}

	return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
		h(NSpace, { justify: 'space-between', align: 'center', style: { marginBottom: '8px' } }, {
			default: () => [
				h(NText, { depth: 2 }, { default: () => `自定义组件 (${comps.length})` }),
			],
		}),
		comps.length === 0
			? h(NEmpty, { description: '此文档未使用自定义组件', size: 'small' })
			: h(NList, { bordered: false, size: 'small' }, {
				default: () => comps.map((comp, idx) =>
					h(NListItem, { key: idx, style: { padding: '4px 0' } }, {
						default: () => h(NSpace, { align: 'center', justify: 'space-between', wrap: false }, {
							default: () => [
								h(NSpace, { align: 'center', size: 6, wrap: false }, {
									default: () => [
										h(NTag, { size: 'small', type: 'info' }, { default: () => comp.tag }),
										comp.detail ? h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => comp.detail }) : null,
									],
								}),
								h(NSpace, { align: 'center', size: 4 }, {
									default: () => [
										h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => `第 ${comp.line + 1} 行` }),
										h(NButton, { size: 'tiny', quaternary: true, onClick: () => api.jumpToLine(comp.line, comp.ch) }, { default: () => '跳转' }),
									],
								}),
							],
						}),
					})
				),
			}),
	]);
}

function renderAuthorsTab(
	authors: Ref<AuthorInfo[]>,
	currentFile: Ref<TFile | null>,
	api: DocSyncPanelAPI,
	showAddAuthorModal: Ref<boolean>,
	availableAuthors: Ref<AuthorInfo[]>,
	loadingAuthors: Ref<boolean>,
) {
	const authorList = authors.value;

	if (!currentFile.value) {
		return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
			h(NEmpty, { description: '无当前文档', size: 'small' }),
		]);
	}

	const canAddAuthor = true;

	const openAddModal = async () => {
		showAddAuthorModal.value = true;
		loadingAuthors.value = true;
		try {
			const list = await api.loadAvailableAuthors();
			const currentSlugs = new Set(authorList.map(a => a.slug));
			availableAuthors.value = list.filter(a => !currentSlugs.has(a.slug));
		} catch {
			availableAuthors.value = [];
		} finally {
			loadingAuthors.value = false;
		}
	};

	const addAuthorModal = h(NModal, {
		show: showAddAuthorModal.value,
		preset: 'card',
		title: '添加作者',
		style: { width: '400px' },
		'onUpdate:show': (val: boolean) => { showAddAuthorModal.value = val; },
	}, {
		default: () => loadingAuthors.value
			? h(NSpin, { size: 'small' })
			: availableAuthors.value.length === 0
				? h(NEmpty, { description: '没有可添加的作者', size: 'small' })
				: h(NList, { bordered: false, size: 'small' }, {
					default: () => availableAuthors.value.map((author, idx) =>
						h(NListItem, { key: idx, style: { padding: '4px 0' } }, {
							default: () => h(NSpace, { align: 'center', justify: 'space-between', wrap: false }, {
								default: () => [
									h(NSpace, { align: 'center', size: 8 }, {
										default: () => [
											h(NAvatar, { size: 'small', src: author.avatar, round: true }, { default: () => author.name.charAt(0) }),
											h(NSpace, { vertical: true, size: 0 }, {
												default: () => [
													h(NText, {}, { default: () => author.name }),
													h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => `@${author.slug}` }),
												],
											}),
										],
									}),
									h(NButton, {
										size: 'tiny',
										type: 'primary',
										onClick: () => {
											api.addAuthor(author);
											showAddAuthorModal.value = false;
										},
									}, { default: () => '添加' }),
								],
							}),
						})
					),
				}),
	});

	return h('div', { class: `${PANEL_CLASS}-tab-content` }, [
		h(NSpace, { justify: 'space-between', align: 'center', style: { marginBottom: '8px' } }, {
			default: () => [
				h(NText, { depth: 2 }, { default: () => `作者 (${authorList.length})` }),
				canAddAuthor ? h(NButton, { size: 'tiny', type: 'primary', onClick: openAddModal }, { default: () => '+ 添加' }) : null,
			],
		}),
		authorList.length === 0
			? h(NEmpty, { description: '此文档未设置作者', size: 'small' })
			: h(NList, { bordered: false, size: 'small' }, {
				default: () => authorList.map((author, idx) =>
					h(NListItem, { key: idx, style: { padding: '4px 0' } }, {
						default: () => h(NSpace, { align: 'center', justify: 'space-between', wrap: false }, {
							default: () => [
								h(NSpace, { align: 'center', size: 8 }, {
									default: () => [
										h(NAvatar, { size: 'small', src: author.avatar, round: true }, { default: () => author.name.charAt(0) }),
										h(NSpace, { vertical: true, size: 0 }, {
											default: () => [
												h(NSpace, { align: 'center', size: 4 }, {
													default: () => [
														h(NText, {}, { default: () => author.name }),
														author.verified ? h(NTag, { size: 'tiny', type: 'success', bordered: false }, { default: () => '✓' }) : null,
													],
												}),
												h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => `@${author.slug}` }),
											],
										}),
									],
								}),
								h(NPopconfirm, { onPositiveClick: () => api.removeAuthor(idx) }, {
									trigger: () => h(NButton, { size: 'tiny', type: 'error', quaternary: true }, { default: () => '删除' }),
									default: () => `确认删除作者 ${author.name}？`,
								}),
							],
						}),
					})
				),
			}),
		addAuthorModal,
	]);
}
