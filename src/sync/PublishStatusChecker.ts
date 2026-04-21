import { App, TFile, Platform, requestUrl } from 'obsidian';
import type { FilePublishInfo, PublishStatus, DiffResult, DiffLine, DiffCompareSource } from '../types';
import type { PathMapEntry } from '../bridge/types';
import type { Logger } from '../utils/Logger';

const TAG = 'PublishStatus';

export function generatePublishId(): string {
	const now = new Date();
	const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
	const rand = Math.random().toString(36).substring(2, 8);
	return `pub_${ts}_${rand}`;
}

export function extractPublishIdFromContent(content: string): string | null {
	const lines = content.split(/\r?\n/);
	if (lines[0] !== '---') return null;
	const endIdx = lines.indexOf('---', 1);
	if (endIdx === -1) return null;

	for (let i = 1; i < endIdx; i++) {
		const line = lines[i];
		if (line.startsWith('publishId:') || line.startsWith('publishId :')) {
			const value = line.substring(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
			return value || null;
		}
	}
	return null;
}

export function setPublishIdInContent(content: string, publishId: string): string {
	const lines = content.split(/\r?\n/);
	if (lines[0] !== '---') {
		return `---\npublishId: ${publishId}\n---\n${content}`;
	}

	const endIdx = lines.indexOf('---', 1);
	if (endIdx === -1) {
		return `---\npublishId: ${publishId}\n---\n${content}`;
	}

	for (let i = 1; i < endIdx; i++) {
		if (lines[i].startsWith('publishId:') || lines[i].startsWith('publishId :')) {
			lines[i] = `publishId: ${publishId}`;
			return lines.join('\n');
		}
	}

	const newLines = [...lines.slice(0, endIdx), `publishId: ${publishId}`, ...lines.slice(endIdx)];
	return newLines.join('\n');
}

export class PublishStatusChecker {
	private app: App;
	private localVuePressRoot: string;
	private siteDomain: string;
	private vuepressDocsDir: string;
	private publishRootPath: string;
	private vaultSyncPaths: string[];
	private pathMapEntries: PathMapEntry[] = [];
	private logger: Logger | null;
	private githubRepo: string = '';
	private githubToken: string = '';
	private githubBranch: string = '';
	private publishIdIndex: Map<string, string> = new Map();
	private indexTimestamp: number = 0;
	private indexTTL = 300000;

	constructor(app: App, options: {
		localVuePressRoot: string;
		siteDomain: string;
		vuepressDocsDir: string;
		publishRootPath?: string;
		vaultSyncPaths?: string[];
		githubRepo?: string;
		githubToken?: string;
		githubBranch?: string;
		logger?: Logger;
	}) {
		this.app = app;
		this.localVuePressRoot = options.localVuePressRoot;
		this.siteDomain = options.siteDomain;
		this.vuepressDocsDir = options.vuepressDocsDir;
		this.publishRootPath = (options.publishRootPath || '').replace(/^\/+|\/+$/g, '');
		this.vaultSyncPaths = options.vaultSyncPaths || ['/'];
		this.githubRepo = options.githubRepo || '';
		this.githubToken = options.githubToken || '';
		this.githubBranch = options.githubBranch || '';
		this.logger = options.logger || null;
	}

	updateConfig(options: {
		localVuePressRoot?: string;
		siteDomain?: string;
		vuepressDocsDir?: string;
		publishRootPath?: string;
		vaultSyncPaths?: string[];
		githubRepo?: string;
		githubToken?: string;
		githubBranch?: string;
	}) {
		if (options.localVuePressRoot !== undefined) this.localVuePressRoot = options.localVuePressRoot;
		if (options.siteDomain !== undefined) this.siteDomain = options.siteDomain;
		if (options.vuepressDocsDir !== undefined) this.vuepressDocsDir = options.vuepressDocsDir;
		if (options.publishRootPath !== undefined) this.publishRootPath = options.publishRootPath.replace(/^\/+|\/+$/g, '');
		if (options.vaultSyncPaths !== undefined) this.vaultSyncPaths = options.vaultSyncPaths;
		if (options.githubRepo !== undefined) this.githubRepo = options.githubRepo;
		if (options.githubToken !== undefined) this.githubToken = options.githubToken;
		if (options.githubBranch !== undefined) this.githubBranch = options.githubBranch;
	}

	isFileInSyncPaths(file: TFile): boolean {
		if (this.vaultSyncPaths.includes('/')) return true;
		return this.vaultSyncPaths.some(p => {
			const normalized = p.replace(/^\/+/, '').replace(/\/+$/, '');
			if (!normalized) return true;
			return file.path === normalized || file.path.startsWith(normalized + '/');
		});
	}

	async getPublishId(file: TFile): Promise<string | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.publishId) {
			return String(cache.frontmatter.publishId);
		}
		const content = await this.app.vault.read(file);
		return extractPublishIdFromContent(content);
	}

	async ensurePublishId(file: TFile): Promise<string> {
		const existing = await this.getPublishId(file);
		if (existing) return existing;

		const newId = generatePublishId();
		const content = await this.app.vault.read(file);
		const updated = setPublishIdInContent(content, newId);
		await this.app.vault.modify(file, updated);
		this.logger?.info(TAG, `已为 ${file.path} 生成 publishId: ${newId}`);
		return newId;
	}

	async setPublishId(file: TFile, publishId: string): Promise<void> {
		const content = await this.app.vault.read(file);
		const updated = setPublishIdInContent(content, publishId);
		await this.app.vault.modify(file, updated);
		this.logger?.info(TAG, `已为 ${file.path} 设置 publishId: ${publishId}`);
	}

	static normalizeSyncPath(p: string): string {
		return p.replace(/^\/+/, '').replace(/\/+$/, '');
	}

	updatePathMap(entries: PathMapEntry[]) {
		this.pathMapEntries = entries;
		this.invalidatePublishIdIndex();
	}

	invalidatePublishIdIndex() {
		this.publishIdIndex = new Map();
		this.indexTimestamp = 0;
	}

	async checkFileStatus(file: TFile): Promise<FilePublishInfo> {
		const filePath = this.resolveFilePath(file);
		const urlPath = this.resolveUrlPath(file);
		const displayPath = urlPath || filePath;
		const publishId = await this.getPublishId(file);
		const localStatus = Platform.isDesktop
			? await this.checkLocalStatus(file, filePath, publishId)
			: 'unpublished' as PublishStatus;
		const siteStatus = await this.checkSiteStatus(file, publishId);

		return {
			filePath: file.path,
			fileName: file.name,
			vuepressPath: displayPath,
			publishId,
			localStatus,
			siteStatus,
			localMtime: file.stat.mtime,
			siteMtime: null,
		};
	}

	async checkMultipleFiles(files: TFile[]): Promise<FilePublishInfo[]> {
		const BATCH_SIZE = 5;
		const results: FilePublishInfo[] = [];

		for (let i = 0; i < files.length; i += BATCH_SIZE) {
			const batch = files.slice(i, i + BATCH_SIZE);
			const batchResults = await Promise.allSettled(
				batch.map(file => this.checkFileStatus(file))
			);

			for (let j = 0; j < batchResults.length; j++) {
				const result = batchResults[j];
				const file = batch[j];
				if (result.status === 'fulfilled') {
					results.push(result.value);
				} else {
					results.push({
						filePath: file.path,
						fileName: file.name,
						vuepressPath: null,
						publishId: null,
						localStatus: 'unpublished',
						siteStatus: 'unpublished',
						localMtime: file.stat.mtime,
						siteMtime: null,
					});
				}
			}
		}
		return results;
	}

	private resolveVuePressPath(file: TFile): string | null {
		return this.resolveUrlPath(file) || this.resolveFilePath(file);
	}

	private resolveFilePath(file: TFile): string | null {
		if (this.publishRootPath) {
			return `${this.vuepressDocsDir}/${this.publishRootPath}/${file.path}`;
		}
		return `${this.vuepressDocsDir}/${file.path}`;
	}

	private resolveSourceRelPath(file: TFile): string {
		if (this.publishRootPath) {
			return `${this.publishRootPath}/${file.path}`;
		}
		return file.path;
	}

	private resolveUrlPath(file: TFile): string | null {
		if (this.pathMapEntries.length > 0) {
			const lookupPaths = [file.path];
			if (this.publishRootPath) {
				lookupPaths.push(`${this.publishRootPath}/${file.path}`);
			}
			for (const lookup of lookupPaths) {
				const entry = this.pathMapEntries.find(e => e.sourceRelPath === lookup);
				if (entry) return entry.vuepressPath;
			}
		}
		return null;
	}

	async touchPublishedFile(file: TFile): Promise<void> {
		if (!Platform.isDesktop || !this.localVuePressRoot) return;

		const filePath = this.resolveFilePath(file);
		if (!filePath) return;

		try {
			const fs = require('fs/promises') as typeof import('fs/promises');
			const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
			const targetPath = `${this.localVuePressRoot}${sep}${filePath.replace(/\//g, sep)}`;

			try {
				await fs.access(targetPath);
				const now = new Date();
				await fs.utimes(targetPath, now, now);
				this.logger?.debug(TAG, `更新发布文件时间戳: ${targetPath}`);
			} catch {}
		} catch {}
	}

	private async checkLocalStatus(file: TFile, filePath: string | null, publishId: string | null): Promise<PublishStatus> {
		if (!this.localVuePressRoot) return 'unpublished';

		try {
			const fs = require('fs/promises') as typeof import('fs/promises');
			const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';

			if (publishId) {
				const matchedPath = await this.findLocalFileByPublishId(publishId, sep);
				if (matchedPath) {
					const targetStat = await fs.stat(matchedPath);
					if (targetStat.mtimeMs >= file.stat.mtime) return 'published';
					return 'outdated';
				}
			}

			if (!filePath) return 'unpublished';

			const targetPath = `${this.localVuePressRoot}${sep}${filePath.replace(/\//g, sep)}`;
			try {
				const targetStat = await fs.stat(targetPath);
				if (targetStat.mtimeMs >= file.stat.mtime) return 'published';
				return 'outdated';
			} catch {
				return 'unpublished';
			}
		} catch {
			return 'unpublished';
		}
	}

	private async findLocalFileByPublishId(publishId: string, sep: string): Promise<string | null> {
		if (this.publishIdIndex.has(publishId) && Date.now() - this.indexTimestamp < this.indexTTL) {
			const cached = this.publishIdIndex.get(publishId)!;
			try {
				const fs = require('fs/promises') as typeof import('fs/promises');
				await fs.access(cached);
				return cached;
			} catch {
				this.publishIdIndex.delete(publishId);
			}
		}

		await this.rebuildPublishIdIndex(sep);
		return this.publishIdIndex.get(publishId) || null;
	}

	private async rebuildPublishIdIndex(sep: string): Promise<void> {
		if (Date.now() - this.indexTimestamp < this.indexTTL) return;

		this.publishIdIndex = new Map();
		this.indexTimestamp = Date.now();

		try {
			const fs = require('fs/promises') as typeof import('fs/promises');
			const pathMod = require('path') as typeof import('path');

			const searchDirs = [this.publishRootPath, ''].filter(Boolean);
			for (const subDir of searchDirs) {
				const dirPath = subDir
					? `${this.localVuePressRoot}${sep}${this.vuepressDocsDir}${sep}${subDir.replace(/\//g, sep)}`
					: `${this.localVuePressRoot}${sep}${this.vuepressDocsDir}`;

				try {
					await fs.access(dirPath);
				} catch {
					continue;
				}

				await this.scanDirForPublishId(dirPath, fs, pathMod, 0);
			}
		} catch {}
	}

	private async scanDirForPublishId(
		dirPath: string,
		fs: typeof import('fs/promises'),
		pathMod: typeof import('path'),
		depth: number
	): Promise<void> {
		if (depth > 10) return;
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith('.')) continue;
				const fullPath = pathMod.join(dirPath, entry.name);
				if (entry.isDirectory()) {
					await this.scanDirForPublishId(fullPath, fs, pathMod, depth + 1);
				} else if (entry.name.endsWith('.md')) {
					try {
						const content = await fs.readFile(fullPath, 'utf-8');
						const id = extractPublishIdFromContent(content);
						if (id) {
							this.publishIdIndex.set(id, fullPath);
						}
					} catch {}
				}
			}
		} catch {}
	}

	private async checkSiteStatus(file: TFile, publishId: string | null): Promise<PublishStatus> {
		if (!this.siteDomain) return 'unpublished';

		try {
			const domain = this.siteDomain.replace(/\/+$/, '');
			const checkUrl = `${domain}/obsidian-bridge/publish-status.json`;

			const res = await requestUrl({
				url: checkUrl,
				throw: false,
				headers: { 'Cache-Control': 'no-cache' },
			});

			if (res.status !== 200 || !res.json) return 'unpublished';

			const data = res.json as {
				entries?: Record<string, { mtime: number; hash?: string; publishId?: string }>;
				publishIdIndex?: Record<string, string>;
			};
			const statusMap = data.entries;
			if (!statusMap || typeof statusMap !== 'object') return 'unpublished';

			let entry: { mtime: number; hash?: string; publishId?: string } | undefined;

			if (publishId && data.publishIdIndex) {
				const matchedPath = data.publishIdIndex[publishId];
				if (matchedPath) {
					entry = statusMap[matchedPath];
				}
			}

			if (!entry) {
				const sourceRelPath = this.resolveSourceRelPath(file);
				entry = statusMap[sourceRelPath];
			}

			if (!entry) return 'unpublished';

			if (entry.mtime >= file.stat.mtime) return 'published';
			return 'outdated';
		} catch {
			return 'unpublished';
		}
	}

	async publishToLocal(file: TFile): Promise<boolean> {
		if (!Platform.isDesktop || !this.localVuePressRoot) {
			throw new Error('本地发布仅支持桌面端且已配置本地 VuePress 项目路径');
		}

		const filePath = this.resolveFilePath(file);
		if (!filePath) throw new Error('无法解析文件路径');

		let content = await this.app.vault.read(file);
		const existingId = extractPublishIdFromContent(content);
		if (!existingId) {
			const newId = generatePublishId();
			content = setPublishIdInContent(content, newId);
			await this.app.vault.modify(file, content);
			this.logger?.info(TAG, `已为 ${file.path} 生成 publishId: ${newId}`);
		}

		const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
		const targetPath = `${this.localVuePressRoot}${sep}${filePath.replace(/\//g, sep)}`;

		try {
			const fs = require('fs/promises') as typeof import('fs/promises');
			const dir = targetPath.substring(0, targetPath.lastIndexOf(sep));
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(targetPath, content, 'utf-8');
			this.invalidatePublishIdIndex();
			this.logger?.info(TAG, `本地发布成功: ${targetPath}`);
			return true;
		} catch (e) {
			this.logger?.error(TAG, `本地发布失败: ${targetPath}`, e.message);
			throw e;
		}
	}

	async publishMultipleToLocal(files: TFile[]): Promise<{ success: number; failed: number }> {
		let success = 0;
		let failed = 0;
		for (const file of files) {
			try {
				await this.publishToLocal(file);
				success++;
			} catch {
				failed++;
			}
		}
		return { success, failed };
	}

	async publishMultipleToLocalWithModifier(
		files: TFile[],
		modifier: (file: TFile, content: string) => string
	): Promise<{ success: number; failed: number }> {
		let success = 0;
		let failed = 0;
		for (const file of files) {
			try {
				await this.publishToLocalWithModifier(file, modifier);
				success++;
			} catch {
				failed++;
			}
		}
		return { success, failed };
	}

	async publishToLocalWithModifier(
		file: TFile,
		modifier: (file: TFile, content: string) => string
	): Promise<boolean> {
		if (!Platform.isDesktop || !this.localVuePressRoot) {
			throw new Error('本地发布仅支持桌面端且已配置本地 VuePress 项目路径');
		}

		const filePath = this.resolveFilePath(file);
		if (!filePath) throw new Error('无法解析文件路径');

		let content = await this.app.vault.read(file);
		const existingId = extractPublishIdFromContent(content);
		if (!existingId) {
			const newId = generatePublishId();
			content = setPublishIdInContent(content, newId);
			await this.app.vault.modify(file, content);
			this.logger?.info(TAG, `已为 ${file.path} 生成 publishId: ${newId}`);
		}

		content = modifier(file, content);

		const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
		const targetPath = `${this.localVuePressRoot}${sep}${filePath.replace(/\//g, sep)}`;

		try {
			const fs = require('fs/promises') as typeof import('fs/promises');
			const dir = targetPath.substring(0, targetPath.lastIndexOf(sep));
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(targetPath, content, 'utf-8');
			this.invalidatePublishIdIndex();
			this.logger?.info(TAG, `本地发布成功: ${targetPath}`);
			return true;
		} catch (e) {
			this.logger?.error(TAG, `本地发布失败: ${targetPath}`, e.message);
			throw e;
		}
	}

	async getPublishedContent(file: TFile): Promise<string | null> {
		if (!Platform.isDesktop || !this.localVuePressRoot) return null;
		const filePath = this.resolveFilePath(file);
		if (!filePath) return null;

		try {
			const fs = require('fs/promises') as typeof import('fs/promises');
			const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
			const targetPath = `${this.localVuePressRoot}${sep}${filePath.replace(/\//g, sep)}`;
			return await fs.readFile(targetPath, 'utf-8');
		} catch {
			return null;
		}
	}

	async getSitePublishedContent(file: TFile): Promise<string | null> {
		const filePath = this.resolveFilePath(file);
		const urlPath = this.resolveUrlPath(file);

		if (this.githubRepo && this.githubToken && filePath) {
			const content = await this.getGitHubPublishedContent(filePath);
			if (content !== null) return content;
		}

		if (this.siteDomain && urlPath) {
			const content = await this.getHtmlPublishedContent(urlPath);
			if (content !== null) return content;
		}

		return null;
	}

	private async getGitHubPublishedContent(filePath: string): Promise<string | null> {
		if (!this.githubRepo || !this.githubToken) return null;

		const branch = this.githubBranch || 'main';

		try {
			const url = `https://api.github.com/repos/${this.githubRepo}/contents/${filePath}?ref=${branch}`;
			const res = await requestUrl({
				url,
				headers: {
					Authorization: `Bearer ${this.githubToken}`,
					Accept: 'application/vnd.github.v3.raw',
				},
				throw: false,
			});

			if (res.status === 200 && res.text) {
				this.logger?.debug(TAG, `从 GitHub 获取已发布内容: ${filePath}`);
				return res.text;
			}
		} catch (e) {
			this.logger?.warn(TAG, `GitHub 获取已发布内容失败: ${filePath}`, e.message);
		}

		return null;
	}

	private async getHtmlPublishedContent(urlPath: string): Promise<string | null> {
		if (!this.siteDomain) return null;

		try {
			const domain = this.siteDomain.replace(/\/+$/, '');
			const contentUrl = `${domain}${urlPath}`;

			const res = await requestUrl({
				url: contentUrl,
				throw: false,
				headers: { 'Cache-Control': 'no-cache' },
			});

			if (res.status !== 200 || !res.text) return null;

			const content = this.extractMarkdownFromHtml(res.text);
			if (content) {
				this.logger?.debug(TAG, `从站点 HTML 获取已发布内容: ${urlPath}`);
			}
			return content;
		} catch {
			return null;
		}
	}

	private extractMarkdownFromHtml(html: string): string | null {
		const marker = '<!-- obsidian-bridge-raw-start -->';
		const endMarker = '<!-- obsidian-bridge-raw-end -->';
		const startIdx = html.indexOf(marker);
		if (startIdx === -1) return null;
		const endIdx = html.indexOf(endMarker, startIdx);
		if (endIdx === -1) return null;
		const encoded = html.substring(startIdx + marker.length, endIdx).trim();
		try {
			return decodeURIComponent(atob(encoded));
		} catch {
			return null;
		}
	}

	async computeDiff(file: TFile, source?: DiffCompareSource): Promise<DiffResult | null> {
		this.logger?.debug(TAG, `计算diff: ${file.path}`, `source=${source || 'auto'}`);
		const localContent = await this.app.vault.read(file);
		let publishedContent: string | null = null;
		let compareSource: DiffCompareSource = source || 'local';
		let fallback = false;

		if (compareSource === 'site') {
			publishedContent = await this.getSitePublishedContent(file);
			if (publishedContent === null) {
				this.logger?.warn(TAG, `云端内容不可用，回退到本地: ${file.path}`);
				publishedContent = await this.getPublishedContent(file);
				if (publishedContent !== null) {
					compareSource = 'local';
					fallback = true;
				}
			}
		} else {
			publishedContent = await this.getPublishedContent(file);
			if (publishedContent === null) {
				this.logger?.warn(TAG, `本地内容不可用，回退到云端: ${file.path}`);
				publishedContent = await this.getSitePublishedContent(file);
				if (publishedContent !== null) {
					compareSource = 'site';
					fallback = true;
				}
			}
		}

		if (publishedContent === null) {
			this.logger?.warn(TAG, `无法获取对比内容: ${file.path}`);
			return null;
		}

		const oldLines = publishedContent.replace(/\r\n?/g, '\n').split('\n');
		const newLines = localContent.replace(/\r\n?/g, '\n').split('\n');

		const result = this.lcsDiff(oldLines, newLines);
		this.logger?.info(TAG, `diff计算完成: ${file.path}`, `source=${compareSource}, +${result.addedCount} -${result.removedCount}${fallback ? ' (fallback)' : ''}`);
		return {
			...result,
			compareSource,
			publishedContent,
			fallback,
		};
	}

	private lcsDiff(oldLines: string[], newLines: string[]): Omit<DiffResult, 'compareSource' | 'publishedContent' | 'fallback'> {
		const m = oldLines.length;
		const n = newLines.length;

		const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (oldLines[i - 1] === newLines[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1] + 1;
				} else {
					dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
				}
			}
		}

		const lines: DiffLine[] = [];
		let i = m, j = n;
		const stack: DiffLine[] = [];

		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
				stack.push({ type: 'unchanged', content: oldLines[i - 1], oldLineNo: i, newLineNo: j });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
				stack.push({ type: 'added', content: newLines[j - 1], oldLineNo: null, newLineNo: j });
				j--;
			} else {
				stack.push({ type: 'removed', content: oldLines[i - 1], oldLineNo: i, newLineNo: null });
				i--;
			}
		}

		for (let k = stack.length - 1; k >= 0; k--) {
			lines.push(stack[k]);
		}

		let addedCount = 0, removedCount = 0, unchangedCount = 0;
		for (const line of lines) {
			if (line.type === 'added') addedCount++;
			else if (line.type === 'removed') removedCount++;
			else unchangedCount++;
		}

		return {
			lines,
			addedCount,
			removedCount,
			unchangedCount,
			oldLineCount: m,
			newLineCount: n,
		};
	}
}
