import { TFile, Vault, parseLinktext, MetadataCache } from 'obsidian';

export interface CollectedAsset {
	file: TFile;
	/** 原始引用路径（如 ./image.png 或 ![[image.png]]） */
	originalRef: string;
	/** 引用类型 */
	refType: 'wiki' | 'relative' | 'absolute';
}

export interface CollectResult {
	md: TFile;
	/** 需要上传到 GitHub 的本地资源文件 */
	assets: CollectedAsset[];
	/** /assets/ 等站点级绝对路径引用（不需要从 vault 收集，站点已有） */
	siteAssetRefs: string[];
}

export class FileCollector {
	constructor(private vault: Vault, private metadataCache: MetadataCache) {}

	async collectForPublish(sourceFile: TFile): Promise<CollectResult> {
		const content = await this.vault.read(sourceFile);
		const assets: CollectedAsset[] = [];
		const siteAssetRefs: string[] = [];
		const seen = new Set<string>();

		// 源文件所在目录，用于解析相对路径
		const sourceDir = sourceFile.parent?.path || '';

		// 1. Wiki 图片链接 ![[image.png]]
		const wikiRegex = /!\[\[(.*?)\]\]/g;
		let match;
		while ((match = wikiRegex.exec(content)) !== null) {
			const linktext = match[1];
			const { path } = parseLinktext(linktext);
			const file = this.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && !seen.has(file.path)) {
				seen.add(file.path);
				assets.push({ file, originalRef: match[0], refType: 'wiki' });
			}
		}

		// 2. Markdown 图片链接 ![alt](path)
		const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		while ((match = mdRegex.exec(content)) !== null) {
			const rawPath = match[2].trim();

			// 跳过外部 URL
			if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) continue;

			// /assets/ 等站点级绝对路径：不需要从 vault 收集
			if (rawPath.startsWith('/')) {
				if (!siteAssetRefs.includes(rawPath)) {
					siteAssetRefs.push(rawPath);
				}
				continue;
			}

			// 将相对路径解析为相对于源文件目录的 vault 路径
			const resolvedPath = this.resolveRelativePath(sourceDir, decodeURIComponent(rawPath));
			const file = this.vault.getAbstractFileByPath(resolvedPath);
			if (file instanceof TFile && !seen.has(file.path)) {
				seen.add(file.path);
				assets.push({ file, originalRef: match[0], refType: 'relative' });
			}
		}

		// 3. 文档链接（PDF/Word 等）
		const linkRegex = /\[.*?\]\((.*?\.(pdf|docx?|xlsx?|pptx?|zip))\)/gi;
		while ((match = linkRegex.exec(content)) !== null) {
			const rawPath = match[1].trim();
			if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) continue;
			if (rawPath.startsWith('/')) continue;

			const resolvedPath = this.resolveRelativePath(sourceDir, decodeURIComponent(rawPath));
			const file = this.vault.getAbstractFileByPath(resolvedPath);
			if (file instanceof TFile && !seen.has(file.path)) {
				seen.add(file.path);
				assets.push({ file, originalRef: match[0], refType: 'relative' });
			}
		}

		return { md: sourceFile, assets, siteAssetRefs };
	}

	/**
	 * 将相对路径解析为相对于 baseDir 的 vault 绝对路径
	 * Markdown 标准中所有非绝对路径均相对于当前文件
	 */
	private resolveRelativePath(baseDir: string, relativePath: string): string {
		const baseParts = baseDir ? baseDir.split('/') : [];
		const relParts = relativePath.split('/');
		const parts = [...baseParts];

		for (const part of relParts) {
			if (part === '..') {
				parts.pop();
			} else if (part !== '.') {
				parts.push(part);
			}
		}

		return parts.join('/');
	}
}
