import { requestUrl, Platform, App } from 'obsidian';
import type { BridgeAssets, BridgeVersion, PathMapData, SyntaxDescriptorsData, ComponentPropsData, AuthorsData, PermalinkIndexData, PublishStatusData } from './types';
import { DEFAULT_BRIDGE_ASSETS } from './types';
import type { Logger } from '../utils/Logger';

const TAG = 'Bridge';
const CACHE_DIR = '.obsidian/plugins/sillot/bridge-cache';

const BRIDGE_FILES = [
	'version.json',
	'path-map.json',
	'syntax-descriptors.json',
	'component-props.json',
	'authors.json',
	'bridge-vars.css',
	'permalink-index.json',
	'publish-status.json',
	'inline-components.json',
] as const;

type AssetKey = 'version' | 'pathMap' | 'syntaxDescriptors' | 'componentProps' | 'authors' | 'bridgeCss' | 'permalinkIndex' | 'publishStatus' | 'inlineComponents';

const ASSET_FILE_MAP: { file: string; key: AssetKey; isText: boolean }[] = [
	{ file: 'version.json', key: 'version', isText: false },
	{ file: 'path-map.json', key: 'pathMap', isText: false },
	{ file: 'syntax-descriptors.json', key: 'syntaxDescriptors', isText: false },
	{ file: 'component-props.json', key: 'componentProps', isText: false },
	{ file: 'authors.json', key: 'authors', isText: false },
	{ file: 'bridge-vars.css', key: 'bridgeCss', isText: true },
	{ file: 'permalink-index.json', key: 'permalinkIndex', isText: false },
	{ file: 'publish-status.json', key: 'publishStatus', isText: false },
	{ file: 'inline-components.json', key: 'inlineComponents', isText: false },
];

export class BridgeManager {
	private app: App;
	private assets: BridgeAssets = { ...DEFAULT_BRIDGE_ASSETS };
	private localBridgePath: string = '';
	private siteDomain: string = '';
	private githubRepo: string = '';
	private githubToken: string = '';
	private githubBranch: string = '';
	private onAssetsLoaded?: (assets: BridgeAssets) => void;
	private logger: Logger | null;
	private cacheTimestamp: number = 0;

	constructor(options: {
		app: App;
		localBridgePath?: string;
		siteDomain?: string;
		githubRepo?: string;
		githubToken?: string;
		githubBranch?: string;
		onAssetsLoaded?: (assets: BridgeAssets) => void;
		logger?: Logger;
	}) {
		this.app = options.app;
		this.localBridgePath = options.localBridgePath || '';
		this.siteDomain = options.siteDomain || '';
		this.githubRepo = options.githubRepo || '';
		this.githubToken = options.githubToken || '';
		this.githubBranch = options.githubBranch || '';
		this.onAssetsLoaded = options.onAssetsLoaded;
		this.logger = options.logger || null;
	}

	updateConfig(options: {
		localBridgePath?: string;
		siteDomain?: string;
		githubRepo?: string;
		githubToken?: string;
		githubBranch?: string;
	}) {
		if (options.localBridgePath !== undefined) this.localBridgePath = options.localBridgePath;
		if (options.siteDomain !== undefined) this.siteDomain = options.siteDomain;
		if (options.githubRepo !== undefined) this.githubRepo = options.githubRepo;
		if (options.githubToken !== undefined) this.githubToken = options.githubToken;
		if (options.githubBranch !== undefined) this.githubBranch = options.githubBranch;
	}

	getAssets(): BridgeAssets {
		return this.assets;
	}

	getCacheTimestamp(): number {
		return this.cacheTimestamp;
	}

	private async loadAssetsFromReader(
		readText: (file: string) => Promise<string | null>,
		requireVersion: boolean = true
	): Promise<void> {
		for (const { file, key, isText } of ASSET_FILE_MAP) {
			const text = await readText(file);
			if (text === null) {
				if (requireVersion && key === 'version') {
					throw new Error(`${file} 获取失败（可能返回了 HTML 而非 JSON，请检查配置）`);
				}
				continue;
			}
			(this.assets as any)[key] = isText ? text : JSON.parse(text);
		}
	}

	async loadFromCache(): Promise<boolean> {
		try {
			const adapter = this.app.vault.adapter;
			const versionPath = `${CACHE_DIR}/version.json`;
			if (!(await adapter.exists(versionPath))) {
				this.logger?.debug(TAG, '缓存不存在');
				return false;
			}

			await this.loadAssetsFromReader(async (file) => {
				const fullPath = `${CACHE_DIR}/${file}`;
				if (!(await adapter.exists(fullPath))) return null;
				return adapter.read(fullPath);
			}, false);

			const version = this.assets.version!;
			const tsPath = `${CACHE_DIR}/.cache-timestamp`;
			if (await adapter.exists(tsPath)) {
				this.cacheTimestamp = parseInt(await adapter.read(tsPath), 10) || 0;
			}

			this.logger?.info(TAG, '从缓存加载 Bridge 产物', `v${version.version}, paths=${this.assets.pathMap?.entries?.length || 0}`);
			this.onAssetsLoaded?.(this.assets);
			return true;
		} catch (e) {
			this.logger?.warn(TAG, '缓存加载失败', e.message);
			return false;
		}
	}

	async saveToCache(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(CACHE_DIR))) {
				await adapter.mkdir(CACHE_DIR);
			}

			for (const { file, key, isText } of ASSET_FILE_MAP) {
				const value = (this.assets as any)[key];
				if (value) {
					const content = isText ? value : JSON.stringify(value, null, 2);
					await adapter.write(`${CACHE_DIR}/${file}`, content);
				}
			}

			this.cacheTimestamp = Date.now();
			await adapter.write(`${CACHE_DIR}/.cache-timestamp`, `${this.cacheTimestamp}`);

			this.logger?.info(TAG, 'Bridge 产物已缓存到 vault');
		} catch (e) {
			this.logger?.warn(TAG, '缓存保存失败', e.message);
		}
	}

	async clearCache(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (await adapter.exists(CACHE_DIR)) {
				const files = await adapter.list(CACHE_DIR);
				for (const file of files.files) {
					await adapter.remove(file);
				}
				this.cacheTimestamp = 0;
				this.logger?.info(TAG, 'Bridge 缓存已清除');
			}
		} catch (e) {
			this.logger?.warn(TAG, '缓存清除失败', e.message);
		}
	}

	async syncFromLocal(): Promise<BridgeAssets> {
		if (Platform.isMobile || !this.localBridgePath) {
			throw new Error('本地 Bridge 拉取仅支持桌面端且已配置本地路径');
		}

		const sep = this.localBridgePath.includes('\\') ? '\\' : '/';
		const basePath = this.localBridgePath.replace(/[\\/]$/, '');

		this.logger?.info(TAG, `从本地加载 Bridge 产物: ${basePath}`);

		try {
			const { readFileSync, existsSync } = require('fs') as typeof import('fs');

			await this.loadAssetsFromReader((file) => {
				const fullPath = `${basePath}${sep}${file}`;
				if (!existsSync(fullPath)) return Promise.resolve(null);
				return Promise.resolve(readFileSync(fullPath, 'utf-8'));
			});

			this.logger?.info(TAG, '本地 Bridge 加载成功', `v${this.assets.version?.version}, paths=${this.assets.pathMap?.entries?.length || 0}, syntaxes=${this.assets.syntaxDescriptors?.syntaxes?.length || 0}, authors=${Object.keys(this.assets.authors?.authors || {}).length}`);

			await this.saveToCache();
			this.onAssetsLoaded?.(this.assets);
			return this.assets;
		} catch (e) {
			this.logger?.error(TAG, `本地 Bridge 加载失败`, e.message);
			throw e;
		}
	}

	async syncFromSite(): Promise<BridgeAssets> {
		if (!this.siteDomain) {
			throw new Error('未配置站点域名');
		}

		const baseUrl = this.siteDomain.replace(/\/+$/, '');
		const bridgeBase = `${baseUrl}/obsidian-bridge`;

		this.logger?.info(TAG, `从站点加载 Bridge 产物: ${bridgeBase}`);

		try {
			await this.loadAssetsFromReader(async (file) => {
				const url = `${bridgeBase}/${file}`;
				if (file.endsWith('.css')) {
					return this.fetchText(url, 'text/css');
				}
				return this.fetchJsonText(url);
			});

			this.logger?.info(TAG, '站点 Bridge 加载成功', `v${this.assets.version?.version}, paths=${this.assets.pathMap?.entries?.length || 0}, syntaxes=${this.assets.syntaxDescriptors?.syntaxes?.length || 0}, authors=${Object.keys(this.assets.authors?.authors || {}).length}`);

			await this.saveToCache();
			this.onAssetsLoaded?.(this.assets);
			return this.assets;
		} catch (e) {
			this.logger?.error(TAG, `站点 Bridge 加载失败`, e.message);
			throw e;
		}
	}

	private async fetchJsonText(url: string): Promise<string | null> {
		try {
			const res = await requestUrl({ url, throw: false });
			if (res.status !== 200) return null;

			const contentType = res.headers?.['content-type'] || '';
			if (contentType.includes('text/html')) {
				this.logger?.warn(TAG, `${url} 返回了 HTML 而非 JSON，可能是 SPA fallback`);
				return null;
			}

			if (typeof res.json !== 'object' || res.json === null) {
				this.logger?.warn(TAG, `${url} 响应不是有效的 JSON 对象`);
				return null;
			}

			return res.text;
		} catch (e) {
			this.logger?.warn(TAG, `获取 ${url} 失败`, e.message);
			return null;
		}
	}

	private async fetchJson<T>(url: string): Promise<T | null> {
		const text = await this.fetchJsonText(url);
		return text ? JSON.parse(text) as T : null;
	}

	private async fetchText(url: string, expectedType?: string): Promise<string | null> {
		try {
			const res = await requestUrl({ url, throw: false });
			if (res.status !== 200) return null;

			if (expectedType) {
				const contentType = res.headers?.['content-type'] || '';
				if (contentType.includes('text/html')) {
					this.logger?.warn(TAG, `${url} 返回了 HTML 而非 ${expectedType}，可能是 SPA fallback`);
					return null;
				}
			}

			return res.text;
		} catch (e) {
			this.logger?.warn(TAG, `获取 ${url} 失败`, e.message);
			return null;
		}
	}

	async sync(): Promise<BridgeAssets> {
		if (!Platform.isMobile && this.localBridgePath) {
			try {
				return await this.syncFromLocal();
			} catch (e) {
				this.logger?.warn(TAG, `本地加载失败，回退到 GitHub 加载`, e.message);
			}
		}

		if (this.githubRepo && this.githubToken) {
			try {
				return await this.syncFromGitHub();
			} catch (e) {
				this.logger?.warn(TAG, `GitHub 加载失败，回退到站点加载`, e.message);
			}
		}

		if (this.siteDomain) {
			try {
				return await this.syncFromSite();
			} catch (e) {
				this.logger?.warn(TAG, `站点加载失败，回退到缓存`, e.message);
			}
		}

		const loaded = await this.loadFromCache();
		if (loaded) {
			return this.assets;
		}

		throw new Error('未配置本地 Bridge 路径、GitHub 仓库或站点域名，且无缓存');
	}

	async syncFromGitHub(): Promise<BridgeAssets> {
		if (!this.githubRepo || !this.githubToken) {
			throw new Error('未配置 GitHub 仓库或 Token');
		}

		const branch = this.githubBranch || 'main';
		const bridgePath = 'docs/.vuepress/dist/obsidian-bridge';

		this.logger?.info(TAG, `从 GitHub 加载 Bridge 产物: ${this.githubRepo}:${branch}/${bridgePath}`);

		try {
			await this.loadAssetsFromReader((file) => {
				return this.fetchGitHubFile(`${bridgePath}/${file}`, branch);
			});

			this.logger?.info(TAG, 'GitHub Bridge 加载成功', `v${this.assets.version?.version}, paths=${this.assets.pathMap?.entries?.length || 0}`);

			await this.saveToCache();
			this.onAssetsLoaded?.(this.assets);
			return this.assets;
		} catch (e) {
			this.logger?.error(TAG, `GitHub Bridge 加载失败`, e.message);
			throw e;
		}
	}

	private async fetchGitHubFile(path: string, branch: string): Promise<string | null> {
		const url = `https://api.github.com/repos/${this.githubRepo}/contents/${path}?ref=${branch}`;

		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await requestUrl({
					url,
					headers: {
						Authorization: `Bearer ${this.githubToken}`,
						Accept: 'application/vnd.github.v3.raw',
					},
					throw: false,
				});

				if (res.status === 200) return res.text;
				if (res.status === 404) return null;
				if (res.status === 401 || res.status === 403) {
					throw new Error(`GitHub API 认证失败 (HTTP ${res.status})`);
				}

				if (attempt < 2) {
					const delay = Math.pow(2, attempt) * 1000;
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			} catch (e: any) {
				if (e?.status === 401 || e?.status === 403) throw e;
				if (attempt < 2) {
					const delay = Math.pow(2, attempt) * 1000;
					await new Promise(resolve => setTimeout(resolve, delay));
				} else {
					this.logger?.warn(TAG, `GitHub 获取 ${path} 失败`, e.message);
					return null;
				}
			}
		}

		return null;
	}

	getVuePressDirectories(): string[] {
		if (!this.assets.pathMap?.entries) return [];
		const dirs = new Set<string>();
		for (const entry of this.assets.pathMap.entries) {
			dirs.add(entry.vuepressPath);
		}
		return Array.from(dirs).sort();
	}

	findVuePressPath(sourceRelPath: string): string | null {
		if (!this.assets.pathMap?.entries) return null;
		const entry = this.assets.pathMap.entries.find(e => e.sourceRelPath === sourceRelPath);
		return entry?.vuepressPath || null;
	}

	findSourceRelPath(vuepressPath: string): string | null {
		if (!this.assets.pathMap?.entries) return null;
		const entry = this.assets.pathMap.entries.find(e => e.vuepressPath === vuepressPath);
		return entry?.sourceRelPath || null;
	}
}
