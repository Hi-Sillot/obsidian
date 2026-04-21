export interface PluginSettings {
	githubToken: string;
	githubRepo: string;
	vuepressDocsDir: string;
	publishRootPath: string;
	stylesPath: string;
	kdocsWebhookUrl: string;
	airscriptToken: string;
	defaultBranch: string;
	docSyncPanelState: 'minimized' | 'default' | 'expanded';
	localVuePressRoot: string;
	siteDomain: string;
	vaultSyncPaths: string[];
	logLevel: 'debug' | 'info' | 'warn' | 'error' | 'none';
	logFilePath: string;
	publishCreatePR: boolean;
	publishBranchPrefix: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	githubToken: '',
	githubRepo: '',
	vuepressDocsDir: 'docs',
	publishRootPath: '',
	stylesPath: 'docs/.vuepress/styles/index.style',
	kdocsWebhookUrl: '',
	airscriptToken: '',
	defaultBranch: 'main',
	docSyncPanelState: 'default',
	localVuePressRoot: '',
	siteDomain: '',
	vaultSyncPaths: ['/'],
	logLevel: 'info',
	logFilePath: '.obsidian/plugins/sillot/log/sillot.log',
	publishCreatePR: true,
	publishBranchPrefix: 'publish/',
};

export interface PluginSyncInfo {
	sync_id: string;
	sync_type: 'inline' | 'codeblock';
	cloud_version_time: string;
	sync_content: string;
	description: string;
	category: string;
	updated_at: string;
}

export interface DocSyncInfo {
	cloud_version_time: string;
	local_version_time: string;
	block_content: string;
	sync_status: string;
	conflict_resolution: string;
}

export interface ParsedSyncBlock {
	syncId: string;
	content: string;
	localTime: string;
	type: 'inline' | 'codeblock';
	scope: 'global' | 'document';
	startPos: number;
	endPos: number;
	fullMatch: string;
}

export interface ContentItem {
	uuid: string;
	category: string;
	title: string;
	content: string;
	metadata: Record<string, any>;
	tags: string;
	url: string;
}

export interface SyncResult {
	synced: number;
	conflicts: number;
	details: string[];
}

export interface PublishResult {
	commitMessage: string;
	branch: string;
	createPR: boolean;
}

export interface KDocsResponse<T = any> {
	success: boolean;
	data?: T;
	error?: string;
	created?: string[];
	action?: string;
	cloud_version_time?: string;
	recordId?: string;
}

export interface SyncCacheEntry {
	sync_id: string;
	sync_type: 'inline' | 'codeblock';
	sync_content: string;
	description: string;
	category: string;
	updated_at: string;
	cloud_version_time: string;
}

export interface SyncCache {
	list: SyncCacheEntry[];
	content: Record<string, SyncCacheEntry>;
}

export type PublishStatus = 'unpublished' | 'published' | 'outdated';

export interface FilePublishInfo {
	filePath: string;
	fileName: string;
	vuepressPath: string | null;
	localStatus: PublishStatus;
	siteStatus: PublishStatus;
	localMtime: number | null;
	siteMtime: number | null;
}

export type DiffLineType = 'added' | 'removed' | 'unchanged';

export interface DiffLine {
	type: DiffLineType;
	content: string;
	oldLineNo: number | null;
	newLineNo: number | null;
}

export type DiffCompareSource = 'local' | 'site';

export interface DiffResult {
	lines: DiffLine[];
	addedCount: number;
	removedCount: number;
	unchangedCount: number;
	oldLineCount: number;
	newLineCount: number;
	compareSource: DiffCompareSource;
	publishedContent: string;
	fallback: boolean;
}
