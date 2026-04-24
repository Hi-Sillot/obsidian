import { Vault, TFile, requestUrl } from 'obsidian';
import { GitHubApi } from './githubApi';

export interface AssetReference {
	originalPath: string; // Markdown 中的原始路径（如 ./Develocity.webp）
	resolvedPath: string; // 解析后的完整路径（如 col_doc/1_developNotes/Android/Develocity.webp）
	type: 'relative' | 'absolute' | 'wiki';
}

export interface SyncedAsset {
	localPath: string;
	remotePath: string;
	md5: string;
	lastSynced: number;
	size: number;
}

export interface AssetSyncResult {
	success: boolean;
	totalAssets: number;
	syncedAssets: number;
	failedAssets: string[];
	assets: SyncedAsset[];
}

interface MD5Cache {
	[remotePath: string]: {
		md5: string;
		lastSynced: number;
	};
}

const IMAGE_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
	'avif', 'tiff', 'tif', 'psd', 'raw', 'heic', 'heif',
]);

export class AssetSyncService {
	private vault: Vault;
	private githubApi: GitHubApi;
	private docsDir: string;
	private md5Cache: MD5Cache = {};
	private cacheFilePath = '.sillot/asset-md5-cache.json';

	constructor(vault: Vault, githubApi: GitHubApi, docsDir: string = 'docs') {
		this.vault = vault;
		this.githubApi = githubApi;
		this.docsDir = docsDir;
	}

	async loadMD5Cache(): Promise<void> {
		try {
			const cacheFile = this.vault.getAbstractFileByPath(this.cacheFilePath);
			if (cacheFile instanceof TFile) {
				const content = await this.vault.read(cacheFile);
				this.md5Cache = JSON.parse(content);
				console.log('[AssetSync] Loaded MD5 cache:', Object.keys(this.md5Cache).length, 'entries');
			}
		} catch (error) {
			console.warn('[AssetSync] Failed to load MD5 cache:', error);
			this.md5Cache = {};
		}
	}

	async saveMD5Cache(): Promise<void> {
		try {
			await this.ensureFolder('.sillot');
			const cacheFile = this.vault.getAbstractFileByPath(this.cacheFilePath);
			const content = JSON.stringify(this.md5Cache, null, 2);

			if (cacheFile instanceof TFile) {
				await this.vault.modify(cacheFile, content);
			} else {
				await this.vault.create(this.cacheFilePath, content);
			}
			console.log('[AssetSync] Saved MD5 cache');
		} catch (error) {
			console.error('[AssetSync] Failed to save MD5 cache:', error);
		}
	}

	parseImageLinks(markdownContent: string): AssetReference[] {
		const assets: AssetReference[] = [];
		const seen = new Set<string>();

		// 匹配标准 Markdown 图片语法 ![alt](path)
		const standardRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		let match;
		while ((match = standardRegex.exec(markdownContent)) !== null) {
			const originalPath = match[2].trim();
			if (this.isImageAsset(originalPath) && !seen.has(originalPath)) {
				seen.add(originalPath);
				assets.push({
					originalPath,
					resolvedPath: '', // 将在后续填充
					type: originalPath.startsWith('/') ? 'absolute' : 'relative',
				});
			}
		}

		// 匹配 Wiki 链接语法 ![[path]]
		const wikiRegex = /!\[\[([^\]]+)\]\]/g;
		while ((match = wikiRegex.exec(markdownContent)) !== null) {
			const originalPath = match[1].trim();
			if (this.isImageAsset(originalPath) && !seen.has(originalPath)) {
				seen.add(originalPath);
				assets.push({
					originalPath,
					resolvedPath: '',
					type: 'wiki',
				});
			}
		}

		return assets;
	}

	resolveAssetPath(asset: AssetReference, documentCloudPath: string, documentLocalPath: string): string {
		const docDir = documentCloudPath.substring(0, documentCloudPath.lastIndexOf('/'));
		const localDocDir = documentLocalPath.substring(0, documentLocalPath.lastIndexOf('/'));

		switch (asset.type) {
			case 'relative':
				// 相对路径：基于文档所在目录解析
				if (asset.originalPath.startsWith('./') || asset.originalPath.startsWith('../')) {
					const resolved = this.resolveRelativePath(docDir, asset.originalPath);
					asset.resolvedPath = resolved;
					// 返回本地路径
					return this.resolveRelativePath(localDocDir, asset.originalPath);
				} else {
					// 简单相对路径（如 Develocity.webp）
					asset.resolvedPath = `${docDir}/${asset.originalPath}`;
					return `${localDocDir}/${asset.originalPath}`;
				}

			case 'absolute':
				// 绝对路径（以 / 开头）：基于 docsDir 解析
				asset.resolvedPath = `${this.docsDir}${asset.originalPath}`;
				return asset.originalPath.substring(1); // 去掉开头的 /

			case 'wiki':
				// Wiki 链接：直接使用
				asset.resolvedPath = `${docDir}/${asset.originalPath}`;
				return `${localDocDir}/${asset.originalPath}`;

			default:
				return asset.originalPath;
		}
	}

	private resolveRelativePath(basePath: string, relativePath: string): string {
		const baseParts = basePath.split('/');
		const relParts = relativePath.split('/');

		for (const part of relParts) {
			if (part === '..') {
				baseParts.pop();
			} else if (part !== '.' && part !== '') {
				baseParts.push(part);
			}
		}

		return baseParts.join('/');
	}

	private isImageAsset(path: string): boolean {
		// 排除外部 URL
		if (path.startsWith('http://') || path.startsWith('https://')) return false;

		// 提取扩展名
		const ext = path.split('.').pop()?.toLowerCase();
		return ext ? IMAGE_EXTENSIONS.has(ext) : false;
	}

	async syncAssetsForDocument(
		markdownContent: string,
		documentCloudPath: string,
		documentLocalPath: string,
		branch?: string
	): Promise<AssetSyncResult> {
		console.log(`[AssetSync] Starting sync for document: ${documentCloudPath}`);

		// 1. 解析图片链接
		const assetRefs = this.parseImageLinks(markdownContent);
		console.log(`[AssetSync] Found ${assetRefs.length} image references`);

		if (assetRefs.length === 0) {
			return { success: true, totalAssets: 0, syncedAssets: 0, failedAssets: [], assets: [] };
		}

		// 2. 解析每个资源的路径
		const assetsToSync: Array<{ ref: AssetReference; localPath: string }> = [];
		for (const ref of assetRefs) {
			const localPath = this.resolveAssetPath(ref, documentCloudPath, documentLocalPath);
			assetsToSync.push({ ref, localPath });
		}

		// 3. 下载并保存资源
		const syncedAssets: SyncedAsset[] = [];
		const failedAssets: string[] = [];

		for (const { ref, localPath } of assetsToSync) {
			try {
				const result = await this.downloadAndSaveAsset(ref.resolvedPath, localPath, branch);
				if (result) {
					syncedAssets.push(result);
					console.log(`[AssetSync] ✓ Synced: ${ref.originalPath} → ${localPath}`);
				} else {
					failedAssets.push(ref.originalPath);
					console.warn(`[AssetSync] ✗ Failed: ${ref.originalPath}`);
				}
			} catch (error) {
				failedAssets.push(ref.originalPath);
				console.error(`[AssetSync] Error syncing ${ref.originalPath}:`, error);
			}
		}

		// 4. 保存 MD5 缓存
		await this.saveMD5Cache();

		return {
			success: failedAssets.length === 0,
			totalAssets: assetsToSync.length,
			syncedAssets: syncedAssets.length,
			failedAssets,
			assets: syncedAssets,
		};
	}

	private async downloadAndSaveAsset(
		remotePath: string,
		localPath: string,
		branch?: string
	): Promise<SyncedAsset | null> {
		// 从 GitHub API 下载二进制文件
		const arrayBuffer = await this.githubApi.getFileBinary(remotePath, branch);
		if (!arrayBuffer) {
			console.error(`[AssetSync] Failed to download: ${remotePath}`);
			return null;
		}

		// 计算 MD5 哈希
		const md5 = await this.calculateMD5(arrayBuffer);

		// 检查是否需要更新（比较缓存中的 MD5）
		const cached = this.md5Cache[remotePath];
		if (cached && cached.md5 === md5) {
			console.log(`[AssetSync] Asset unchanged (MD5 match): ${remotePath}`);
			// 即使没有变化，也返回信息，但标记为已同步
			return {
				localPath,
				remotePath,
				md5,
				lastSynced: cached.lastSynced,
				size: arrayBuffer.byteLength,
			};
		}

		// 确保目录存在
		const dirPath = localPath.substring(0, localPath.lastIndexOf('/'));
		if (dirPath) {
			await this.ensureFolder(dirPath);
		}

		// 保存文件到 vault
		try {
			const existingFile = this.vault.getAbstractFileByPath(localPath);
			if (existingFile instanceof TFile) {
				// 使用二进制方式修改文件
				await this.vault.modifyBinary(existingFile, arrayBuffer);
			} else {
				await this.vault.createBinary(localPath, arrayBuffer);
			}

			// 更新 MD5 缓存
			const now = Date.now();
			this.md5Cache[remotePath] = {
				md5,
				lastSynced: now,
			};

			return {
				localPath,
				remotePath,
				md5,
				lastSynced: now,
				size: arrayBuffer.byteLength,
			};
		} catch (error) {
			console.error(`[AssetSync] Failed to save file ${localPath}:`, error);
			return null;
		}
	}

	private async calculateMD5(arrayBuffer: ArrayBuffer): Promise<string> {
		// 使用 Web Crypto API 计算 MD5 哈希的简化版本（实际使用 SHA-256）
		// 注意：Web Crypto API 不直接支持 MD5，这里使用 SHA-256 作为替代
		// 如果需要真正的 MD5，可以引入第三方库如 spark-md5
		try {
			const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
			return `sha256-${hashHex}`;
		} catch (error) {
			// 回退：使用简单的长度+时间戳作为标识
			console.warn('[AssetSync] SHA-256 calculation failed, using fallback:', error);
			return `fallback-${arrayBuffer.byteLength}-${Date.now()}`;
		}
	}

	async checkForChanges(remotePath: string, branch?: string): Promise<boolean> {
		// 检查远程文件是否有变化
		const arrayBuffer = await this.githubApi.getFileBinary(remotePath, branch);
		if (!arrayBuffer) return false;

		const currentMD5 = await this.calculateMD5(arrayBuffer);
		const cached = this.md5Cache[remotePath];

		return !cached || cached.md5 !== currentMD5;
	}

	getCachedMD5(remotePath: string): string | null {
		return this.md5Cache[remotePath]?.md5 || null;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const parts = folderPath.split('/');
		let currentPath = '';
		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const existing = this.vault.getAbstractFileByPath(currentPath);
			if (!existing) {
				await this.vault.createFolder(currentPath);
			}
		}
	}
}
