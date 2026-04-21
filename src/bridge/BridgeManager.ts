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
] as const;

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

	async loadFromCache(): Promise<boolean> {
		try {
			const adapter = this.app.vault.adapter;
			const versionPath = `${CACHE_DIR}/version.json`;
			if (!(await adapter.exists(versionPath))) {
				this.logger?.debug(TAG, '缓存不存在');
				return false;
			}

			const version = JSON.parse(await adapter.read(versionPath)) as BridgeVersion;
			this.assets.version = version;

			const pathMapPath = `${CACHE_DIR}/path-map.json`;
			if (await adapter.exists(pathMapPath)) {
				this.assets.pathMap = JSON.parse(await adapter.read(pathMapPath)) as PathMapData;
			}

			const syntaxPath = `${CACHE_DIR}/syntax-descriptors.json`;
			if (await adapter.exists(syntaxPath)) {
				this.assets.syntaxDescriptors = JSON.parse(await adapter.read(syntaxPath)) as SyntaxDescriptorsData;
			}

			const componentPath = `${CACHE_DIR}/component-props.json`;
			if (await adapter.exists(componentPath)) {
				this.assets.componentProps = JSON.parse(await adapter.read(componentPath)) as ComponentPropsData;
			}

			const authorsPath = `${CACHE_DIR}/authors.json`;
			if (await adapter.exists(authorsPath)) {
				this.assets.authors = JSON.parse(await adapter.read(authorsPath)) as AuthorsData;
			}

			const cssPath = `${CACHE_DIR}/bridge-vars.css`;
			if (await adapter.exists(cssPath)) {
				this.assets.bridgeCss = await adapter.read(cssPath);
			}

			const permalinkIndexPath = `${CACHE_DIR}/permalink-index.json`;
			if (await adapter.exists(permalinkIndexPath)) {
				this.assets.permalinkIndex = JSON.parse(await adapter.read(permalinkIndexPath)) as PermalinkIndexData;
			}

			const publishStatusPath = `${CACHE_DIR}/publish-status.json`;
			if (await adapter.exists(publishStatusPath)) {
				this.assets.publishStatus = JSON.parse(await adapter.read(publishStatusPath)) as PublishStatusData;
			}

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

			if (this.assets.version) {
				await adapter.write(`${CACHE_DIR}/version.json`, JSON.stringify(this.assets.version, null, 2));
			}
			if (this.assets.pathMap) {
				await adapter.write(`${CACHE_DIR}/path-map.json`, JSON.stringify(this.assets.pathMap, null, 2));
			}
			if (this.assets.syntaxDescriptors) {
				await adapter.write(`${CACHE_DIR}/syntax-descriptors.json`, JSON.stringify(this.assets.syntaxDescriptors, null, 2));
			}
			if (this.assets.componentProps) {
				await adapter.write(`${CACHE_DIR}/component-props.json`, JSON.stringify(this.assets.componentProps, null, 2));
			}
			if (this.assets.authors) {
				await adapter.write(`${CACHE_DIR}/authors.json`, JSON.stringify(this.assets.authors, null, 2));
			}
			if (this.assets.bridgeCss) {
				await adapter.write(`${CACHE_DIR}/bridge-vars.css`, this.assets.bridgeCss);
			}
			if (this.assets.permalinkIndex) {
				await adapter.write(`${CACHE_DIR}/permalink-index.json`, JSON.stringify(this.assets.permalinkIndex, null, 2));
			}
			if (this.assets.publishStatus) {
				await adapter.write(`${CACHE_DIR}/publish-status.json`, JSON.stringify(this.assets.publishStatus, null, 2));
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

			const versionPath = `${basePath}${sep}version.json`;
			if (!existsSync(versionPath)) {
				throw new Error(`Bridge 产物不存在: ${versionPath}`);
			}

			this.assets.version = JSON.parse(readFileSync(versionPath, 'utf-8')) as BridgeVersion;

			const pathMapPath = `${basePath}${sep}path-map.json`;
			if (existsSync(pathMapPath)) {
				this.assets.pathMap = JSON.parse(readFileSync(pathMapPath, 'utf-8')) as PathMapData;
			}

			const syntaxPath = `${basePath}${sep}syntax-descriptors.json`;
			if (existsSync(syntaxPath)) {
				this.assets.syntaxDescriptors = JSON.parse(readFileSync(syntaxPath, 'utf-8')) as SyntaxDescriptorsData;
			}

			const componentPath = `${basePath}${sep}component-props.json`;
			if (existsSync(componentPath)) {
				this.assets.componentProps = JSON.parse(readFileSync(componentPath, 'utf-8')) as ComponentPropsData;
			}

			const authorsPath = `${basePath}${sep}authors.json`;
			if (existsSync(authorsPath)) {
				this.assets.authors = JSON.parse(readFileSync(authorsPath, 'utf-8')) as AuthorsData;
			}

			const cssPath = `${basePath}${sep}bridge-vars.css`;
			if (existsSync(cssPath)) {
				this.assets.bridgeCss = readFileSync(cssPath, 'utf-8');
			}

			const permalinkIndexPath = `${basePath}${sep}permalink-index.json`;
			if (existsSync(permalinkIndexPath)) {
				this.assets.permalinkIndex = JSON.parse(readFileSync(permalinkIndexPath, 'utf-8')) as PermalinkIndexData;
			}

			const publishStatusPath = `${basePath}${sep}publish-status.json`;
			if (existsSync(publishStatusPath)) {
				this.assets.publishStatus = JSON.parse(readFileSync(publishStatusPath, 'utf-8')) as PublishStatusData;
			}

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
			const versionRes = await this.fetchJson<BridgeVersion>(`${bridgeBase}/version.json`);
			if (!versionRes) {
				throw new Error('version.json 获取失败（可能返回了 HTML 而非 JSON，请检查站点域名和部署配置）');
			}
			this.assets.version = versionRes;

			const pathMapRes = await this.fetchJson<PathMapData>(`${bridgeBase}/path-map.json`);
			if (pathMapRes) {
				this.assets.pathMap = pathMapRes;
			}

			const syntaxRes = await this.fetchJson<SyntaxDescriptorsData>(`${bridgeBase}/syntax-descriptors.json`);
			if (syntaxRes) {
				this.assets.syntaxDescriptors = syntaxRes;
			}

			const componentRes = await this.fetchJson<ComponentPropsData>(`${bridgeBase}/component-props.json`);
			if (componentRes) {
				this.assets.componentProps = componentRes;
			}

			const authorsRes = await this.fetchJson<AuthorsData>(`${bridgeBase}/authors.json`);
			if (authorsRes) {
				this.assets.authors = authorsRes;
			}

			const cssRes = await this.fetchText(`${bridgeBase}/bridge-vars.css`, 'text/css');
			if (cssRes) {
				this.assets.bridgeCss = cssRes;
			}

			const permalinkIndexRes = await this.fetchJson<any>(`${bridgeBase}/permalink-index.json`);
			if (permalinkIndexRes) {
				this.assets.permalinkIndex = permalinkIndexRes;
			}

			const publishStatusRes = await this.fetchJson<PublishStatusData>(`${bridgeBase}/publish-status.json`);
			if (publishStatusRes) {
				this.assets.publishStatus = publishStatusRes;
			}

			this.logger?.info(TAG, '站点 Bridge 加载成功', `v${this.assets.version?.version}, paths=${this.assets.pathMap?.entries?.length || 0}, syntaxes=${this.assets.syntaxDescriptors?.syntaxes?.length || 0}, authors=${Object.keys(this.assets.authors?.authors || {}).length}`);

			await this.saveToCache();
			this.onAssetsLoaded?.(this.assets);
			return this.assets;
		} catch (e) {
			this.logger?.error(TAG, `站点 Bridge 加载失败`, e.message);
			throw e;
		}
	}

	private async fetchJson<T>(url: string): Promise<T | null> {
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

			return res.json as T;
		} catch (e) {
			this.logger?.warn(TAG, `获取 ${url} 失败`, e.message);
			return null;
		}
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
			const versionText = await this.fetchGitHubFile(`${bridgePath}/version.json`, branch);
			if (!versionText) {
				throw new Error('GitHub 上未找到 version.json，可能尚未构建部署');
			}
			this.assets.version = JSON.parse(versionText) as BridgeVersion;

			const pathMapText = await this.fetchGitHubFile(`${bridgePath}/path-map.json`, branch);
			if (pathMapText) {
				this.assets.pathMap = JSON.parse(pathMapText) as PathMapData;
			}

			const syntaxText = await this.fetchGitHubFile(`${bridgePath}/syntax-descriptors.json`, branch);
			if (syntaxText) {
				this.assets.syntaxDescriptors = JSON.parse(syntaxText) as SyntaxDescriptorsData;
			}

			const componentText = await this.fetchGitHubFile(`${bridgePath}/component-props.json`, branch);
			if (componentText) {
				this.assets.componentProps = JSON.parse(componentText) as ComponentPropsData;
			}

			const authorsText = await this.fetchGitHubFile(`${bridgePath}/authors.json`, branch);
			if (authorsText) {
				this.assets.authors = JSON.parse(authorsText) as AuthorsData;
			}

			const cssText = await this.fetchGitHubFile(`${bridgePath}/bridge-vars.css`, branch);
			if (cssText) {
				this.assets.bridgeCss = cssText;
			}

			const permalinkIndexText = await this.fetchGitHubFile(`${bridgePath}/permalink-index.json`, branch);
			if (permalinkIndexText) {
				this.assets.permalinkIndex = JSON.parse(permalinkIndexText) as PermalinkIndexData;
			}

			const publishStatusText = await this.fetchGitHubFile(`${bridgePath}/publish-status.json`, branch);
			if (publishStatusText) {
				this.assets.publishStatus = JSON.parse(publishStatusText) as PublishStatusData;
			}

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
