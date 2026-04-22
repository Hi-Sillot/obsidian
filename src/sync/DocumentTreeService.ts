import { Vault, TFile, requestUrl } from 'obsidian';
import { GitHubApi } from './githubApi';
import { PathMapper } from './pathMapper';
import type { DocTreeNode, PullSource, PullDocumentRequest, PullDocumentResult, LocalExistenceResult } from '../types';
import type { PermalinkIndexData, PathMapData } from '../bridge/types';

export class DocumentTreeService {
	private vault: Vault;
	private githubApi: GitHubApi;
	private pathMapper: PathMapper;
	private permalinkIndex: PermalinkIndexData | null = null;
	private pathMap: PathMapData | null = null;
	private siteDomain: string = '';
	private docsDir: string = '';

	constructor(vault: Vault, githubApi: GitHubApi, pathMapper: PathMapper) {
		this.vault = vault;
		this.githubApi = githubApi;
		this.pathMapper = pathMapper;
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
			console.error('[DocumentTreeService] Failed to fetch from GitHub:', error);
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
			console.error('[DocumentTreeService] Failed to fetch path-map.json, falling back to GitHub:', error);
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
		if (source.type === 'github') {
			const branch = source.branch;
			const items = await this.githubApi.listDirectory(path, branch);
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
			const children = this.findChildrenInPathMap(path);
			if (children.length > 0) return children;
		}

		// 回退到 GitHub API
		if (this.githubApi) {
			const branch = source.branch || 'main';
			try {
				const items = await this.githubApi.listDirectory(path, branch);
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
			} catch {
				return [];
			}
		}

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

				// permalinkIndex 未命中：回退为 site 类型
				return {
					path: '',
					source: {
						type: 'site',
						baseUrl: `${urlObj.protocol}//${urlObj.host}`,
						docsDir: urlObj.pathname.replace(/^\/|\/$/g, ''),
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
				console.error('[DocumentTreeService] Failed to preview from site:', error);
			}
		}

		return null;
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
		const content = await this.previewDocument(request.cloudPath, request.source);

		if (content === null) {
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

			return {
				success: true,
				cloudPath: request.cloudPath,
				localPath: localPath,
				existed: existence.exists,
				message: existence.exists ? '文档已更新' : '文档已下载',
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
		// cloudPath 是 GitHub 路径（如 docs/col_doc/...），本地 vault 路径需要去掉 docsDir 前缀
		const docsDir = this.docsDir || 'docs';
		if (cloudPath.startsWith(docsDir + '/')) {
			return cloudPath.substring(docsDir.length + 1);
		}
		return cloudPath;
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
