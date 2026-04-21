import { requestUrl, Platform, App } from 'obsidian';
import type { BridgeAssets, BridgeVersion, PathMapData, SyntaxDescriptorsData, ComponentPropsData, AuthorsData } from './types';
import { DEFAULT_BRIDGE_ASSETS } from './types';
import type { Logger } from '../utils/Logger';

const TAG = 'Bridge';
const CACHE_DIR = '.obsidian/plugins/sillot/bridge-cache';

export class BridgeManager {
	private app: App;
	private assets: BridgeAssets = { ...DEFAULT_BRIDGE_ASSETS };
	private localBridgePath: string = '';
	private siteDomain: string = '';
	private onAssetsLoaded?: (assets: BridgeAssets) => void;
	private logger: Logger | null;
	private cacheTimestamp: number = 0;

	constructor(options: {
		app: App;
		localBridgePath?: string;
		siteDomain?: string;
		onAssetsLoaded?: (assets: BridgeAssets) => void;
		logger?: Logger;
	}) {
		this.app = options.app;
		this.localBridgePath = options.localBridgePath || '';
		this.siteDomain = options.siteDomain || '';
		this.onAssetsLoaded = options.onAssetsLoaded;
		this.logger = options.logger || null;
	}

	updateConfig(localBridgePath: string, siteDomain: string) {
		this.localBridgePath = localBridgePath;
		this.siteDomain = siteDomain;
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
			const versionRes = await requestUrl({ url: `${bridgeBase}/version.json`, throw: false });
			if (versionRes.status !== 200) {
				throw new Error(`version.json 返回 HTTP ${versionRes.status}`);
			}
			this.assets.version = versionRes.json as BridgeVersion;

			const pathMapRes = await requestUrl({ url: `${bridgeBase}/path-map.json`, throw: false });
			if (pathMapRes.status === 200) {
				this.assets.pathMap = pathMapRes.json as PathMapData;
			}

			const syntaxRes = await requestUrl({ url: `${bridgeBase}/syntax-descriptors.json`, throw: false });
			if (syntaxRes.status === 200) {
				this.assets.syntaxDescriptors = syntaxRes.json as SyntaxDescriptorsData;
			}

			const componentRes = await requestUrl({ url: `${bridgeBase}/component-props.json`, throw: false });
			if (componentRes.status === 200) {
				this.assets.componentProps = componentRes.json as ComponentPropsData;
			}

			const authorsRes = await requestUrl({ url: `${bridgeBase}/authors.json`, throw: false });
			if (authorsRes.status === 200) {
				this.assets.authors = authorsRes.json as AuthorsData;
			}

			const cssRes = await requestUrl({ url: `${bridgeBase}/bridge-vars.css`, throw: false });
			if (cssRes.status === 200) {
				this.assets.bridgeCss = cssRes.text;
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

	async sync(): Promise<BridgeAssets> {
		if (!Platform.isMobile && this.localBridgePath) {
			try {
				return await this.syncFromLocal();
			} catch (e) {
				this.logger?.warn(TAG, `本地加载失败，回退到站点加载`, e.message);
			}
		}

		if (this.siteDomain) {
			return await this.syncFromSite();
		}

		const loaded = await this.loadFromCache();
		if (loaded) {
			return this.assets;
		}

		throw new Error('未配置本地 Bridge 路径或站点域名，且无缓存');
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
