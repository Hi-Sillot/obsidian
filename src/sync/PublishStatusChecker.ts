import { App, TFile, Platform, requestUrl } from 'obsidian';
import type { FilePublishInfo, PublishStatus, DiffResult, DiffLine, DiffCompareSource } from '../types';
import type { PathMapEntry } from '../bridge/types';
import type { Logger } from '../utils/Logger';

const TAG = 'PublishStatus';

export class PublishStatusChecker {
	private app: App;
	private localVuePressRoot: string;
	private siteDomain: string;
	private vuepressDocsDir: string;
	private publishRootPath: string;
	private vaultSyncPaths: string[];
	private pathMapEntries: PathMapEntry[] = [];
	private logger: Logger | null;

	constructor(app: App, options: {
		localVuePressRoot: string;
		siteDomain: string;
		vuepressDocsDir: string;
		publishRootPath?: string;
		vaultSyncPaths?: string[];
		logger?: Logger;
	}) {
		this.app = app;
		this.localVuePressRoot = options.localVuePressRoot;
		this.siteDomain = options.siteDomain;
		this.vuepressDocsDir = options.vuepressDocsDir;
		this.publishRootPath = (options.publishRootPath || '').replace(/^\/+|\/+$/g, '');
		this.vaultSyncPaths = options.vaultSyncPaths || ['/'];
		this.logger = options.logger || null;
	}

	updateConfig(options: {
		localVuePressRoot?: string;
		siteDomain?: string;
		vuepressDocsDir?: string;
		publishRootPath?: string;
		vaultSyncPaths?: string[];
	}) {
		if (options.localVuePressRoot !== undefined) this.localVuePressRoot = options.localVuePressRoot;
		if (options.siteDomain !== undefined) this.siteDomain = options.siteDomain;
		if (options.vuepressDocsDir !== undefined) this.vuepressDocsDir = options.vuepressDocsDir;
		if (options.publishRootPath !== undefined) this.publishRootPath = options.publishRootPath.replace(/^\/+|\/+$/g, '');
		if (options.vaultSyncPaths !== undefined) this.vaultSyncPaths = options.vaultSyncPaths;
	}

	isFileInSyncPaths(file: TFile): boolean {
		if (this.vaultSyncPaths.includes('/')) return true;
		return this.vaultSyncPaths.some(p => {
			const normalized = p.replace(/^\/+/, '').replace(/\/+$/, '');
			if (!normalized) return true;
			return file.path === normalized || file.path.startsWith(normalized + '/');
		});
	}

	static normalizeSyncPath(p: string): string {
		return p.replace(/^\/+/, '').replace(/\/+$/, '');
	}

	updatePathMap(entries: PathMapEntry[]) {
		this.pathMapEntries = entries;
	}

	async checkFileStatus(file: TFile): Promise<FilePublishInfo> {
		const vuepressPath = this.resolveVuePressPath(file);
		const localStatus = Platform.isDesktop
			? await this.checkLocalStatus(file, vuepressPath)
			: 'unpublished' as PublishStatus;
		const siteStatus = await this.checkSiteStatus(file, vuepressPath);

		return {
			filePath: file.path,
			fileName: file.name,
			vuepressPath,
			localStatus,
			siteStatus,
			localMtime: file.stat.mtime,
			siteMtime: null,
		};
	}

	async checkMultipleFiles(files: TFile[]): Promise<FilePublishInfo[]> {
		const results: FilePublishInfo[] = [];
		for (const file of files) {
			try {
				const info = await this.checkFileStatus(file);
				results.push(info);
			} catch (e) {
				results.push({
					filePath: file.path,
					fileName: file.name,
					vuepressPath: null,
					localStatus: 'unpublished',
					siteStatus: 'unpublished',
					localMtime: file.stat.mtime,
					siteMtime: null,
				});
			}
		}
		return results;
	}

	private resolveVuePressPath(file: TFile): string | null {
		if (this.pathMapEntries.length > 0) {
			const entry = this.pathMapEntries.find(e => e.sourceRelPath === file.path);
			if (entry) return entry.vuepressPath;
		}
		if (this.publishRootPath) {
			return `${this.vuepressDocsDir}/${this.publishRootPath}/${file.path}`;
		}
		return `${this.vuepressDocsDir}/${file.path}`;
	}

	private async checkLocalStatus(file: TFile, vuepressPath: string | null): Promise<PublishStatus> {
		if (!this.localVuePressRoot || !vuepressPath) return 'unpublished';

		try {
			const { existsSync, statSync } = require('fs') as typeof import('fs');
			const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
			const targetPath = `${this.localVuePressRoot}${sep}${vuepressPath.replace(/\//g, sep)}`;

			if (!existsSync(targetPath)) return 'unpublished';

			const targetStat = statSync(targetPath);
			if (targetStat.mtimeMs >= file.stat.mtime) return 'published';
			return 'outdated';
		} catch {
			return 'unpublished';
		}
	}

	private async checkSiteStatus(file: TFile, vuepressPath: string | null): Promise<PublishStatus> {
		if (!this.siteDomain || !vuepressPath) return 'unpublished';

		try {
			const domain = this.siteDomain.replace(/\/+$/, '');
			const checkUrl = `${domain}/obsidian-bridge/publish-status.json`;

			const res = await requestUrl({
				url: checkUrl,
				throw: false,
				headers: { 'Cache-Control': 'no-cache' },
			});

			if (res.status !== 200 || !res.json) return 'unpublished';

			const statusMap = res.json as Record<string, { mtime: number }>;
			const entry = statusMap[vuepressPath];
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

		const vuepressPath = this.resolveVuePressPath(file);
		if (!vuepressPath) throw new Error('无法解析 VuePress 路径');

		const content = await this.app.vault.read(file);
		const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
		const targetPath = `${this.localVuePressRoot}${sep}${vuepressPath.replace(/\//g, sep)}`;

		try {
			const { writeFileSync, mkdirSync, existsSync } = require('fs') as typeof import('fs');
			const dir = targetPath.substring(0, targetPath.lastIndexOf(sep));
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(targetPath, content, 'utf-8');
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

	async getPublishedContent(file: TFile): Promise<string | null> {
		if (!Platform.isDesktop || !this.localVuePressRoot) return null;
		const vuepressPath = this.resolveVuePressPath(file);
		if (!vuepressPath) return null;

		try {
			const { existsSync, readFileSync } = require('fs') as typeof import('fs');
			const sep = this.localVuePressRoot.includes('\\') ? '\\' : '/';
			const targetPath = `${this.localVuePressRoot}${sep}${vuepressPath.replace(/\//g, sep)}`;
			if (!existsSync(targetPath)) return null;
			return readFileSync(targetPath, 'utf-8');
		} catch {
			return null;
		}
	}

	async getSitePublishedContent(file: TFile): Promise<string | null> {
		if (!this.siteDomain) return null;
		const vuepressPath = this.resolveVuePressPath(file);
		if (!vuepressPath) return null;

		try {
			const domain = this.siteDomain.replace(/\/+$/, '');
			const contentUrl = `${domain}/${vuepressPath.replace(/\.md$/, '.html')}`;

			const res = await requestUrl({
				url: contentUrl,
				throw: false,
				headers: { 'Cache-Control': 'no-cache' },
			});

			if (res.status !== 200 || !res.text) return null;

			return this.extractMarkdownFromHtml(res.text);
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

		const oldLines = publishedContent.split('\n');
		const newLines = localContent.split('\n');

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
