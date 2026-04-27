import { Vault, TFile, requestUrl } from 'obsidian';
import TurndownService from 'turndown';
import { GitHubApi } from './githubApi';
import { PathMapper } from './pathMapper';
import { AssetSyncService } from './assetSync';
import { convertToPlumeFormat } from './PlumeConverter';
import type { DocTreeNode, PullSource, PullDocumentRequest, PullDocumentResult, LocalExistenceResult } from '../types';
import type { PermalinkIndexData, PathMapData } from '../bridge/types';
import type { Logger } from '../utils/Logger';

export class DocumentTreeService {
	private vault: Vault;
	private githubApi: GitHubApi;
	private pathMapper: PathMapper;
	private assetSync: AssetSyncService;
	private logger: Logger | null;
	private permalinkIndex: PermalinkIndexData | null = null;
	private pathMap: PathMapData | null = null;
	private siteDomain: string = '';
	private docsDir: string = '';

	constructor(vault: Vault, githubApi: GitHubApi, pathMapper: PathMapper, logger?: Logger) {
		this.vault = vault;
		this.githubApi = githubApi;
		this.pathMapper = pathMapper;
		this.logger = logger || null;
		this.assetSync = new AssetSyncService(vault, githubApi, this.docsDir, logger);
	}

	setSiteIndex(options: {
		permalinkIndex: PermalinkIndexData | null;
		pathMap: PathMapData | null;
		siteDomain?: string;
		docsDir?: string;
	}): void {
		this.permalinkIndex = options.permalinkIndex;
		this.pathMap = options.pathMap;
		if (options.siteDomain !== undefined) this.siteDomain = options.siteDomain;
		if (options.docsDir !== undefined) this.docsDir = options.docsDir;
	}

	getPermalinkIndex(): PermalinkIndexData | null {
		return this.permalinkIndex;
	}

	getPathMap(): PathMapData | null {
		return this.pathMap;
	}

	async fetchDocTree(source: PullSource): Promise<DocTreeNode> {
		if (source.type === 'github') {
			return this.fetchFromGitHub(source);
		} else {
			return this.fetchFromSite(source);
		}
	}

	private async fetchFromGitHub(source: PullSource): Promise<DocTreeNode> {
		const docsDir = source.docsDir || 'docs';
		const branch = source.branch;

		try {
			const items = await this.githubApi.listDirectory(docsDir, branch);
			return this.buildTreeNode(docsDir, items);
		} catch (error) {
			this.logger?.error('DocumentTreeService', 'Failed to fetch from GitHub', (error as Error).message);
			return {
				path: docsDir,
				name: docsDir,
				type: 'directory',
				children: [],
			};
		}
	}

	private async fetchFromSite(source: PullSource): Promise<DocTreeNode> {
		const baseUrl = source.baseUrl.replace(/\/$/, '');
		const docsDir = source.docsDir || this.docsDir || '';

		// 优先使用本地缓存的 pathMap 构建文档树
		if (this.pathMap?.entries?.length) {
			return this.buildTreeFromPathMapEntries(this.pathMap.entries, docsDir || 'docs');
		}

		// 回退：从站点拉取 path-map.json
		try {
			const pathMapUrl = docsDir ? `${baseUrl}/${docsDir}/path-map.json` : `${baseUrl}/path-map.json`;
			const response = await requestUrl({ url: pathMapUrl });
			const pathMap = response.json;

			if (pathMap && typeof pathMap === 'object' && pathMap.entries) {
				return this.buildTreeFromPathMapEntries(pathMap.entries, docsDir || 'docs');
			}
		} catch (error) {
			this.logger?.error('DocumentTreeService', 'Failed to fetch path-map.json, falling back to GitHub', (error as Error).message);
		}

		if (baseUrl.includes('github.com')) {
			const parts = this.parseGitHubUrl(baseUrl);
			if (parts) {
				return this.fetchFromGitHub({
					type: 'github',
					baseUrl: `${parts.owner}/${parts.repo}`,
					branch: parts.branch,
					docsDir: docsDir,
				});
			}
		}

		return {
			path: docsDir || baseUrl,
			name: docsDir || baseUrl.split('/').pop() || baseUrl,
			type: 'directory',
			children: [],
		};
	}

	private buildTreeNode(basePath: string, items: { name: string; path: string; type: 'file' | 'dir'; size: number; lastModified: string }[]): DocTreeNode {
		const sortedItems = [...items].sort((a, b) => {
			if (a.type === b.type) return a.name.localeCompare(b.name);
			return a.type === 'dir' ? -1 : 1;
		});

		return {
			path: basePath,
			name: basePath.split('/').pop() || basePath,
			type: 'directory',
			children: sortedItems.map(item => ({
				path: item.path,
				name: item.name,
				type: item.type === 'dir' ? 'directory' : 'file',
				lastModified: item.lastModified,
				size: item.size,
				children: item.type === 'dir' ? [] : undefined,
			})),
		};
	}

	private buildTreeFromPathMapEntries(entries: Array<{ vuepressPath: string; sourceRelPath: string; title: string }>, basePath: string): DocTreeNode {
		const nodeMap = new Map<string, DocTreeNode>();
		const root: DocTreeNode = {
			path: basePath,
			name: basePath.split('/').pop() || basePath,
			type: 'directory',
			children: [],
		};

		for (const entry of entries) {
			// 跳过没有 sourceRelPath 的条目（如标签页、归档页等自动生成的页面）
			if (!entry.sourceRelPath) continue;

			// sourceRelPath 是 vault 相对路径（如 col_doc/...），加 docsDir 前缀得到 GitHub 路径
			const githubPath = `${basePath}/${entry.sourceRelPath}`;
			const parts = githubPath.split('/');
			let currentPath = '';

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const isFile = i === parts.length - 1;
				currentPath = currentPath ? `${currentPath}/${part}` : part;

				if (!nodeMap.has(currentPath)) {
					const node: DocTreeNode = {
						path: currentPath,
						name: part,
						type: isFile ? 'file' : 'directory',
						children: isFile ? undefined : [],
					};
					// 文件节点：用 title 作为显示名
					if (isFile && entry.title) {
						node.name = entry.title;
					}
					nodeMap.set(currentPath, node);
				}
			}
		}

		nodeMap.forEach((node, path) => {
			const parentPath = path.substring(0, path.lastIndexOf('/'));
			const parent = parentPath ? nodeMap.get(parentPath) : null;

			if (parent && parent.children) {
				parent.children.push(node);
			} else if (!parentPath || !nodeMap.has(parentPath)) {
				root.children?.push(node);
			}
		});

		const sortChildren = (node: DocTreeNode): void => {
			if (node.children) {
				node.children.sort((a, b) => {
					if (a.type === b.type) return a.name.localeCompare(b.name);
					return a.type === 'directory' ? -1 : 1;
				});
				node.children.forEach(sortChildren);
			}
		};
		sortChildren(root);

		return root;
	}

	async loadChildren(path: string, source: PullSource): Promise<DocTreeNode[]> {
		console.log('[DocumentTreeService] loadChildren 调用:', { path, sourceType: source.type, source });
		
		if (source.type === 'github') {
			const branch = source.branch;
			console.log('[DocumentTreeService] 使用 GitHub API 加载:', { path, branch });
			const items = await this.githubApi.listDirectory(path, branch);
			console.log('[DocumentTreeService] GitHub API 返回:', { count: items.length, items });
			return items.map(item => ({
				path: item.path,
				name: item.name,
				type: (item.type === 'dir' ? 'directory' : 'file') as 'file' | 'directory',
				lastModified: item.lastModified,
				size: item.size,
				children: item.type === 'dir' ? [] : undefined,
			})).sort((a, b) => {
				if (a.type === b.type) return a.name.localeCompare(b.name);
				return a.type === 'directory' ? -1 : 1;
			});
		}

		// site 类型：从本地缓存的 pathMap 中查找子节点
		if (source.type === 'site' && this.pathMap?.entries?.length) {
			console.log('[DocumentTreeService] 使用 pathMap 加载:', { path });
			const children = this.findChildrenInPathMap(path);
			console.log('[DocumentTreeService] pathMap 返回:', { count: children.length, children });
			if (children.length > 0) return children;
		}

		// 回退到 GitHub API
		if (this.githubApi) {
			const branch = source.branch || 'main';
			console.log('[DocumentTreeService] 回退到 GitHub API:', { path, branch });
			try {
				const items = await this.githubApi.listDirectory(path, branch);
				console.log('[DocumentTreeService] 回退 GitHub API 返回:', { count: items.length, items });
				return items.map(item => ({
					path: item.path,
					name: item.name,
					type: (item.type === 'dir' ? 'directory' : 'file') as 'file' | 'directory',
					lastModified: item.lastModified,
					size: item.size,
					children: item.type === 'dir' ? [] : undefined,
				})).sort((a, b) => {
					if (a.type === b.type) return a.name.localeCompare(b.name);
					return a.type === 'directory' ? -1 : 1;
				});
			} catch (error) {
				console.error('[DocumentTreeService] 回退 GitHub API 失败:', error);
				return [];
			}
		}

		console.warn('[DocumentTreeService] 无法加载子节点，返回空数组');
		return [];
	}

	// 从 pathMap 中查找指定路径的直接子节点
	private findChildrenInPathMap(parentPath: string): DocTreeNode[] {
		if (!this.pathMap?.entries) return [];

		const docsDir = this.docsDir || 'docs';
		// parentPath 是 GitHub 路径（如 docs/col_doc），需要去掉 docsDir 前缀来匹配 sourceRelPath
		const sourceParentPath = parentPath.startsWith(docsDir + '/')
			? parentPath.substring(docsDir.length + 1)
			: parentPath;

		const children: DocTreeNode[] = [];
		const seenPaths = new Set<string>();

		for (const entry of this.pathMap.entries) {
			if (!entry.sourceRelPath) continue;

			// 检查 sourceRelPath 是否是 sourceParentPath 的直接子项
			if (!entry.sourceRelPath.startsWith(sourceParentPath + '/')) continue;

			const relativePath = entry.sourceRelPath.substring(sourceParentPath.length + 1);
			const firstPart = relativePath.split('/')[0];
			const isFile = !relativePath.includes('/');
			// 构造 GitHub 路径（带 docsDir 前缀）
			const fullPath = `${parentPath}/${firstPart}`;

			if (seenPaths.has(fullPath)) continue;
			seenPaths.add(fullPath);

			children.push({
				path: fullPath,
				name: isFile && entry.title ? entry.title : firstPart,
				type: isFile ? 'file' : 'directory',
				children: isFile ? undefined : [],
			});
		}

		return children.sort((a, b) => {
			if (a.type === b.type) return a.name.localeCompare(b.name);
			return a.type === 'directory' ? -1 : 1;
		});
	}

	parseUrl(url: string): { path: string; source: PullSource; title?: string } | null {
		// GitHub blob URL
		const githubBlobMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/i);
		if (githubBlobMatch) {
			const [, owner, repo, branch, ...pathParts] = githubBlobMatch;
			return {
				path: pathParts.join('/'),
				source: {
					type: 'github',
					baseUrl: `${owner}/${repo}`,
					branch: branch,
				},
			};
		}

		// GitHub raw URL
		const githubRawMatch = url.match(/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/(?:refs\/heads\/)?([^\/]+)\/(.+)/i);
		if (githubRawMatch) {
			const [, owner, repo, branch, ...pathParts] = githubRawMatch;
			return {
				path: pathParts.join('/'),
				source: {
					type: 'github',
					baseUrl: `${owner}/${repo}`,
					branch: branch,
				},
			};
		}

		// 站点 URL：利用 permalinkIndex 反查
		if (url.includes('://')) {
			try {
				const urlObj = new URL(url);
				const hostname = urlObj.hostname;

				// GitHub 仓库首页
				if (hostname === 'github.com') {
					const pathMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\/|$)/);
					if (pathMatch) {
						return {
							path: '',
							source: {
								type: 'github',
								baseUrl: `${pathMatch[1]}/${pathMatch[2]}`,
								branch: 'main',
							},
						};
					}
				}

				// 排除 GitHub 域名
				if (hostname.includes('github.com') || hostname.includes('raw.githubusercontent.com')) {
					return null;
				}

				// 站点 URL：提取 permalink 并查 permalinkIndex
				const permalink = urlObj.pathname.replace(/\/+$/, '') || '/';
				const normalizedPermalink = permalink.endsWith('/') ? permalink : permalink + '/';

				// 尝试精确匹配（带尾斜杠和不带尾斜杠）
				if (this.permalinkIndex?.entries?.length) {
					const entry = this.permalinkIndex.entries.find(e =>
						e.permalink === normalizedPermalink || e.permalink === permalink
					);
					if (entry && entry.filePath) {
						// filePath 是 sourceRelPath（vault 相对路径），需要加 docsDir 前缀得到 GitHub 路径
						const docsDir = this.docsDir || 'docs';
						const cloudPath = `${docsDir}/${entry.filePath}`;
						return {
							path: cloudPath,
							source: {
								type: 'github',
								baseUrl: this.githubApi.getRepo(),
								branch: 'main',
								docsDir: docsDir,
							},
							title: entry.title,
						};
					}
				}

				// permalinkIndex 未命中：作为外部 URL 处理（直接 fetch）
				return {
					path: url, // 使用完整 URL 作为路径
					source: {
						type: 'url',
						baseUrl: `${urlObj.protocol}//${urlObj.host}`,
					},
				};
			} catch {
				return null;
			}
		}

		return null;
	}

	private parseGitHubUrl(url: string): { owner: string; repo: string; branch: string } | null {
		const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
		if (!match) return null;
		return {
			owner: match[1],
			repo: match[2],
			branch: 'main',
		};
	}

	async previewDocument(path: string, source: PullSource): Promise<string | null> {
		if (source.type === 'github') {
			return this.githubApi.getFileContent(path, source.branch);
		}

		if (source.type === 'site') {
			// site 类型：尝试通过 GitHub API 获取原始内容
			// 先尝试用 docsDir + path 构造 GitHub 路径
			if (this.githubApi) {
				const docsDir = source.docsDir || this.docsDir || 'docs';
				let githubPath = path;
				if (!path.startsWith(docsDir + '/')) {
					githubPath = `${docsDir}/${path}`;
				}
				try {
					const content = await this.githubApi.getFileContent(githubPath, source.branch || 'main');
					if (content !== null) return content;
				} catch {
					// GitHub 获取失败，继续尝试站点方式
				}
			}

			// 回退：通过站点 permalink 获取页面内容
			try {
				const baseUrl = source.baseUrl.replace(/\/$/, '');
				// 尝试通过 permalinkIndex 查找 permalink
				if (this.permalinkIndex?.entries?.length) {
					const docsDir = source.docsDir || this.docsDir || 'docs';
					const sourceRelPath = path.startsWith(docsDir + '/') ? path.substring(docsDir.length + 1) : path;
					const entry = this.permalinkIndex.entries.find(e => e.filePath === sourceRelPath);
					if (entry?.permalink) {
						const previewUrl = `${baseUrl}${entry.permalink}`;
						const response = await requestUrl({ url: previewUrl });
						return response.text;
					}
				}
			} catch (error) {
				this.logger?.error('DocumentTreeService', 'Failed to preview from site', (error as Error).message);
			}
		}

		// url 类型：直接 fetch 外部 URL 获取内容
		if (source.type === 'url' && path.startsWith('http')) {
			try {
				this.logger?.debug('DocumentTreeService', 'Fetching external URL', path);
				const response = await requestUrl({ url: path });
				const htmlContent = response.text;

				// 如果是 HTML 页面，尝试提取主要内容
				if (path.includes('.html') || htmlContent.trimStart().toLowerCase().startsWith('<!doctype') || htmlContent.trimStart().toLowerCase().startsWith('<html')) {
					return this.extractContentFromHtml(htmlContent, path);
				}

				// 否则直接返回（可能是 Markdown 或纯文本）
				return htmlContent;
			} catch (error) {
				this.logger?.error('DocumentTreeService', 'Failed to fetch external URL', (error as Error).message);
				throw new Error(`无法获取外部 URL 内容: ${path}`);
			}
		}

		return null;
	}

	/**
	 * 使用 Turndown 将 HTML 转换为 Markdown
	 * 专业级转换，保留格式、代码块、表格等结构
	 */
	private extractContentFromHtml(html: string, url: string): string {
		try {
			// 第一步：提取正文内容（过滤导航、侧边栏、页脚等）
			const mainContent = this.extractMainContent(html);

			if (!mainContent) {
				this.logger?.warn('DocumentTreeService', 'No main content found in HTML');
				return this.fallbackExtractText(html);
			}

			const turndownService = new TurndownService({
				headingStyle: 'atx',        // 使用 # 标题格式
				hr: '---',                   // 水平线
				bulletListMarker: '-',       // 列表标记
				codeBlockStyle: 'fenced',    // 代码块使用围栏
				fence: '```',                // 围栏字符
				emDelimiter: '*',            // 斜体
				strongDelimiter: '**',       // 粗体
				linkStyle: 'inlined',        // 链接内联
				linkReferenceStyle: 'full',  // 链接引用完整
			});

			// 自定义规则：处理代码块（保留语言标识）
			turndownService.addRule('codeBlock', {
				filter: function (node) {
					return (
						node.nodeName === 'PRE' &&
						node.firstChild?.nodeName === 'CODE'
					);
				},
				replacement: function (content, node) {
					const codeNode = node.firstChild as HTMLElement;
					const language = codeNode.className.match(/language-(\w+)/)?.[1] || '';
					return '\n\n```' + language + '\n' + content.trim() + '\n```\n\n';
				}
			});

			// 自定义规则：处理行内代码
			turndownService.addRule('inlineCode', {
				filter: function (node) {
					return (
						node.nodeName === 'CODE' &&
						node.parentNode?.nodeName !== 'PRE'
					);
				},
				replacement: function (content) {
					return '`' + content + '`';
				}
			});

			// 执行转换（只转换正文部分）
			const markdown = turndownService.turndown(mainContent);

			// 后处理清理
			let cleaned = markdown;

			// 移除多余空行（超过2个连续空行）
			cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

			// 去除首尾空白
			cleaned = cleaned.trim();

			console.log(`[DocumentTreeService] Extracted ${mainContent.length} chars of main content, converted to ${cleaned.length} Markdown (${url})`);

			return cleaned;
		} catch (error) {
			console.error('[DocumentTreeService] Turndown conversion failed:', error);

			// 回退到简单的文本提取
			return this.fallbackExtractText(html);
		}
	}

	/**
	 * 从完整 HTML 页面中提取正文内容区域
	 *
	 * 过滤掉：导航栏、侧边栏、页脚、广告、评论等非正文内容
	 *
	 * 优先级：
	 * 1. <main> 标签
	 * 2. <article> 标签
	 * 3. 常见的 content 容器 (#content, .content, .main-content, article 等)
	 * 4. 移除非内容区域后的剩余内容
	 */
	private extractMainContent(html: string): string | null {
		let content = html;

		// 第一步：移除已知的非内容区域（按优先级从高到低）

		// 1.1 移除 <head> 及其内容
		content = content.replace(/<head[\s\S]*?<\/head>/gi, '');

		// 1.2 移除导航相关元素
		const navPatterns = [
			/<nav[\s\S]*?<\/nav>/gi,
			/<[^>]*(?:id|class)=(?:["'][^"']*["'])*?\b(?:nav|navigation|navbar|menu|header-nav|top-nav|main-nav|sidebar-nav)\b[^>]*>[\s\S]*?<\/[^>]+>/gi,
			/<div[^>]*(?:id|class)=(?:["'][^"']*["'])*?\b(?:navbar|nav-bar|navigation|topbar|menubar|breadcrumb|breadcrumbs|pagination|pager|page-nav)\b[^>]*>[\s\S]*?<\/div>/gi,
		];
		for (const pattern of navPatterns) {
			content = content.replace(pattern, '');
		}

		// 1.3 移除侧边栏
		const sidebarPatterns = [
			/<aside[\s\S]*?<\/aside>/gi,
			/<div[^>]*(?:id|class)=(?:["'][^"']*["'])*?\b(?:sidebar|side-bar|side-panel|toc|table-of-contents|outline|right-sidebar|left-sidebar)\b[^>]*>[\s\S]*?<\/div>/gi,
		];
		for (const pattern of sidebarPatterns) {
			content = content.replace(pattern, '');
		}

		// 1.4 移除页头和页脚
		const headerFooterPatterns = [
			/<header[\s\S]*?<\/header>/gi,
			/<footer[\s\S]*?<\/footer>/gi,
			/<div[^>]*(?:id|class)=(?:["'][^"']*["'])*?\b(?:site-header|site-footer|page-header|page-footer|global-header|global-footer|colophon|copyright|footnote|footnotes)\b[^>]*>[\s\S]*?<\/div>/gi,
		];
		for (const pattern of headerFooterPatterns) {
			content = content.replace(pattern, '');
		}

		// 1.5 移除其他非内容区域
		const otherPatterns = [
			/<script[\s\S]*?<\/script>/gi,
			/<style[\s\S]*?<\/style>/gi,
			/<link\b[^>]*\/?>/gi,
			/<meta\b[^>]*\/?>/gi,
			/<!--[\s\S]*?-->/g,
			/<noscript[\s\S]*?<\/noscript>/gi,
			/<iframe[\s\S]*?<\/iframe>/gi,
			/<form[\s\S]*?<\/form>/gi,
			/<div[^>]*(?:id|class)=(?:["'][^"']*["'])*?\b(?:ad|advert|advertisement|banner|promo|promotion|popup|modal|dialog|overlay|cookie|consent|newsletter|subscribe|social-share|share-buttons|related-posts|recommended|comments|comment|disqus|feedback|search-box|search-form)\b[^>]*>[\s\S]*?<\/div>/gi,
		];
		for (const pattern of otherPatterns) {
			content = content.replace(pattern, '');
		}

		// 第二步：尝试提取正文容器

		// 2.1 尝试 <main> 标签
		const mainMatch = content.match(/<main[\s\S]*?<\/main>/i);
		if (mainMatch && mainMatch[0].length > 100) {
			this.logger?.debug('DocumentTreeService', 'Found <main> element for content extraction', `${mainMatch[0].length} chars`);
			return mainMatch[0];
		}

		// 2.2 尝试 <article> 标签
		const articleMatch = content.match(/<article[\s\S]*?<\/article>/i);
		if (articleMatch && articleMatch[0].length > 100) {
			this.logger?.debug('DocumentTreeService', 'Found <article> element for content extraction', `${articleMatch[0].length} chars`);
			return articleMatch[0];
		}

		// 2.3 尝试常见的内容容器 ID/Class
		const contentContainerPatterns = [
			/<div[^>]+id=(["'])(?:content|main-content|main_content|post-content|article-content|entry-content|body-content|page-content|text-content|document|readme|doc-body|markdown-body|vp-doc|theme-default-content)\1[^>]*>[\s\S]*?<\/div>/i,
			/<div[^>]+class=(["'][^"']*\b(?:content|main-content|post-content|entry-content|article-body|page-body|doc-content|text-body|markdown-body|article|post|entry|documentation|readme)\b[^"']*\1)[^>]*>[\s\S]*?<\/div>/i,
			/<section[^>]*(?:id|class)=(?:["'][^"']*["'])*?\b(?:content|main|article|post|entry|body)\b[^>]*>[\s\S]*?<\/section>/i,
		];

		for (const pattern of contentContainerPatterns) {
			const match = content.match(pattern);
			if (match && match[0].length > 100) {
				this.logger?.debug('DocumentTreeService', 'Found content container', `${match[0].length} chars`);
				return match[0];
			}
		}

		// 第三步：如果没有找到明确的容器，使用剩余内容
		// 但确保至少有一些实质性的文本内容

		// 计算剩余内容的纯文本长度
		const textOnly = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

		if (textOnly.length < 50) {
			this.logger?.warn('DocumentTreeService', 'Remaining content too short after cleanup', `${textOnly.length} chars`);
			return null; // 内容太少，可能提取失败
		}

		this.logger?.debug('DocumentTreeService', 'Using remaining content after cleanup', `${textOnly.length} chars of text`);
		return content;
	}

	/**
	 * 简单的回退方案：提取纯文本（当 Turndown 失败时）
	 */
	private fallbackExtractText(html: string): string {
		let text = html;

		// 移除 script 和 style
		text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
		text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

		// 移除所有标签
		text = text.replace(/<[^>]+>/g, '');

		// 解码实体
		text = text.replace(/&nbsp;/g, ' ');
		text = text.replace(/&amp;/g, '&');
		text = text.replace(/&lt;/g, '<');
		text = text.replace(/&gt;/g, '>');

		return text.trim();
	}

	async checkLocalExistence(cloudPath: string): Promise<LocalExistenceResult> {
		const possiblePaths = this.getPossibleLocalPaths(cloudPath);

		for (const localPath of possiblePaths) {
			const file = this.vault.getAbstractFileByPath(localPath);
			if (file instanceof TFile) {
				return {
					exists: true,
					localPath: localPath,
					localMtime: file.stat.mtime,
				};
			}
		}

		return {
			exists: false,
			localPath: possiblePaths[0] || null,
			localMtime: null,
		};
	}

	private getPossibleLocalPaths(cloudPath: string): string[] {
		const paths: string[] = [];
		const fileName = cloudPath.split('/').pop() || '';
		const nameWithoutExt = fileName.replace(/\.(md|markdown)$/i, '');

		if (cloudPath.includes('/')) {
			paths.push(cloudPath);
			// cloudPath 可能带 docsDir 前缀（如 docs/col_doc/...），本地路径需要去掉
			const docsDir = this.docsDir || 'docs';
			if (cloudPath.startsWith(docsDir + '/')) {
				const localPath = cloudPath.substring(docsDir.length + 1);
				if (localPath.includes('/')) {
					paths.push(localPath);
				}
			}
		}
		paths.push(fileName);
		paths.push(nameWithoutExt);

		return paths;
	}

	async pullDocument(request: PullDocumentRequest): Promise<PullDocumentResult> {
		const rawContent = await this.previewDocument(request.cloudPath, request.source);

		if (rawContent === null) {
			return {
				success: false,
				cloudPath: request.cloudPath,
				localPath: request.localSavePath,
				existed: false,
				message: '无法获取文档内容',
			};
		}

		const existence = await this.checkLocalExistence(request.cloudPath);
		const localPath = request.localSavePath || existence.localPath;

		if (!localPath) {
			return {
				success: false,
				cloudPath: request.cloudPath,
				localPath: '',
				existed: false,
				message: '无法确定本地保存路径',
			};
		}

		try {
			// 转换为 VuePress Plume 格式（添加/规范化 frontmatter）
			const { content, frontmatter, converted } = convertToPlumeFormat(rawContent, {
				cloudPath: request.cloudPath,
				source: request.source,
			});

			let conversionMessage = '';
			if (converted) {
				conversionMessage = `（已转换为 VuePress Plume 格式，标题: ${frontmatter.title}）`;
				this.logger?.debug('DocumentTreeService', 'Converted to Plume format', `path=${request.cloudPath}, title=${frontmatter.title}, permalink=${frontmatter.permalink}`);
			}

			// 确保中间目录存在
			const dirPath = localPath.substring(0, localPath.lastIndexOf('/'));
			if (dirPath) {
				await this.ensureFolder(dirPath);
			}

			const existingFile = this.vault.getAbstractFileByPath(localPath);
			if (existingFile instanceof TFile) {
				await this.vault.modify(existingFile, content);
			} else {
				await this.vault.create(localPath, content);
			}

			// 同步文档中引用的图片资源
			let assetMessage = '';
			try {
				await this.assetSync.loadMD5Cache();
				const assetResult = await this.assetSync.syncAssetsForDocument(
					content,
					request.cloudPath,
					localPath,
					request.source.branch
				);

				if (assetResult.totalAssets > 0) {
					assetMessage = `，已同步 ${assetResult.syncedAssets}/${assetResult.totalAssets} 张图片`;
					if (assetResult.failedAssets.length > 0) {
						assetMessage += `（${assetResult.failedAssets.length} 张失败）`;
					}
				}
			} catch (error) {
				this.logger?.warn('DocumentTreeService', 'Asset sync failed (non-critical)', (error as Error).message);
				assetMessage = '（图片同步跳过）';
			}

			return {
				success: true,
				cloudPath: request.cloudPath,
				localPath: localPath,
				existed: existence.exists,
				message: `${existence.exists ? '文档已更新' : '文档已下载'}${conversionMessage}${assetMessage}`,
			};
		} catch (error) {
			return {
				success: false,
				cloudPath: request.cloudPath,
				localPath: localPath,
				existed: existence.exists,
				message: `保存失败: ${error instanceof Error ? error.message : '未知错误'}`,
			};
		}
	}

	analyzeSavePath(cloudPath: string, _vaultRoot: string): string {
		// 如果是外部 URL（http/https），从 URL 中提取有意义的文件名和路径
		if (cloudPath.startsWith('http://') || cloudPath.startsWith('https://')) {
			return this.extractSavePathFromUrl(cloudPath);
		}

		// cloudPath 是 GitHub 路径（如 docs/col_doc/...），本地 vault 路径需要去掉 docsDir 前缀
		const docsDir = this.docsDir || 'docs';
		if (cloudPath.startsWith(docsDir + '/')) {
			return cloudPath.substring(docsDir.length + 1);
		}
		return cloudPath;
	}

	/**
	 * 从外部 URL 中提取合理的本地保存路径
	 *
	 * 示例:
	 * https://luhaifeng666.github.io/obsidian-plugin-docs-zh/zh2.0/examples/insert-link.html
	 * → external/luhaifeng666.github.io/examples/insert-link.md
	 */
	private extractSavePathFromUrl(url: string): string {
		try {
			const urlObj = new URL(url);
			const hostname = urlObj.hostname; // luhaifeng666.github.io
			const pathname = urlObj.pathname; // /obsidian-plugin-docs-zh/zh2.0/examples/insert-link.html

			// 去除开头的斜杠，分割路径
			const pathParts = pathname.replace(/^\//, '').split('/');

			// 过滤掉常见的无意义路径段（如版本号、语言代码等）
			const meaningfulParts = pathParts.filter(part => {
				if (!part || part === '.') return false;
				// 保留文件名和有意义的目录名
				return true;
			});

			// 获取文件名（最后一个部分）
			let fileName = meaningfulParts[meaningfulParts.length - 1] || 'untitled';

			// 移除扩展名，统一为 .md
			fileName = fileName.replace(/\.(html?|aspx?|php|jsp)$/i, '.md');
			if (!fileName.endsWith('.md')) {
				fileName += '.md';
			}

			// 构建目录结构：external/{hostname}/{中间路径}/
			// 去除前几个可能的"无意义"段（如项目名、版本号）
			const dirParts = meaningfulParts.slice(0, -1); // 去除文件名

			// 智能过滤目录：保留最后 2-3 层有意义的目录
			let filteredDirs: string[];
			if (dirParts.length <= 2) {
				filteredDirs = dirParts;
			} else if (dirParts.length <= 4) {
				// 去除第一段（通常是项目名）
				filteredDirs = dirParts.slice(1);
			} else {
				// 去除前两段（项目名 + 主要分类）
				filteredDirs = dirParts.slice(2);
			}

			// 组合最终路径
			const savePath = ['external', hostname, ...filteredDirs, fileName].join('/');

			this.logger?.debug('DocumentTreeService', 'URL → 本地路径', `${url} → ${savePath}`);

			return savePath;
		} catch (error) {
			this.logger?.error('DocumentTreeService', 'Failed to parse URL for save path', (error as Error).message);
			// 回退到简单处理
			const fallbackName = url.split('/').pop()?.replace(/\.(html?|aspx?)$/i, '.md') || 'untitled.md';
			return `external/${fallbackName}`;
		}
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		// 递归确保文件夹存在
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
