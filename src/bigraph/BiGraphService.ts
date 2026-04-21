import { App, TFile, MetadataCache, Vault } from 'obsidian';
import type { BiGraphData, BiGraphNode, BiGraphLink, BiGraphConfig } from './types';
import type { PathMapEntry } from '../bridge/types';
import type { Logger } from '../utils/Logger';

const TAG = 'BiGraph';

export class BiGraphService {
	private app: App;
	private config: BiGraphConfig;
	private pathMapEntries: PathMapEntry[] = [];
	private vaultPathMap: Map<string, string> = new Map();
	private cachedData: BiGraphData | null = null;
	private cacheTimestamp: number = 0;
	private cacheTTL = 60000;
	private logger: Logger | null;

	constructor(app: App, config: BiGraphConfig, logger?: Logger) {
		this.app = app;
		this.config = config;
		this.logger = logger || null;
	}

	updateConfig(config: Partial<BiGraphConfig>) {
		this.config = { ...this.config, ...config };
		this.invalidateCache();
	}

	updatePathMap(entries: PathMapEntry[]) {
		this.pathMapEntries = entries;
		this.vaultPathMap = new Map(entries.map(e => [e.sourceRelPath, e.vuepressPath]));
		this.invalidateCache();
	}

	invalidateCache() {
		this.cachedData = null;
		this.cacheTimestamp = 0;
	}

	async getGlobalGraph(): Promise<BiGraphData> {
		if (this.cachedData && Date.now() - this.cacheTimestamp < this.cacheTTL) {
			return this.cachedData;
		}

		this.logger?.info(TAG, '开始构建全局图谱数据');
		const startTime = Date.now();

		try {
			const data = this.buildGraphData();
			this.cachedData = data;
			this.cacheTimestamp = Date.now();

			const elapsed = Date.now() - startTime;
			this.logger?.info(TAG, `全局图谱构建完成`, `nodes=${data.nodes.length}, links=${data.links.length}, ${elapsed}ms`);

			return data;
		} catch (error) {
			this.logger?.error(TAG, '构建全局图谱失败', error.message);
			return { nodes: [], links: [] };
		}
	}

	async getLocalGraph(currentFilePath: string, depth?: number): Promise<BiGraphData> {
		const maxDeep = depth || this.config.localGraphDeep;
		const globalData = await this.getGlobalGraph();

		const rootNode = globalData.nodes.find(n => n.filePathRelative === currentFilePath);
		if (!rootNode) {
			return { nodes: [], links: [] };
		}

		const visited = new Set<string>();
		const queue: { id: string; d: number }[] = [{ id: rootNode.id, d: 0 }];
		const localNodeIds = new Set<string>();

		while (queue.length > 0) {
			const { id, d } = queue.shift()!;
			if (d > maxDeep || visited.has(id)) continue;
			visited.add(id);
			localNodeIds.add(id);

			const node = globalData.nodes.find(n => n.id === id);
			if (!node) continue;

			for (const outId of node.outlink) {
				if (!visited.has(outId) && d + 1 <= maxDeep) {
					queue.push({ id: outId, d: d + 1 });
				}
			}
			for (const backId of node.backlink) {
				if (!visited.has(backId) && d + 1 <= maxDeep) {
					queue.push({ id: backId, d: d + 1 });
				}
			}
		}

		const localNodes = globalData.nodes.filter(n => localNodeIds.has(n.id));
		const localLinks = globalData.links.filter(l => {
			const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
			const targetId = typeof l.target === 'string' ? l.target : l.target.id;
			return localNodeIds.has(sourceId) && localNodeIds.has(targetId);
		});

		return { nodes: localNodes, links: localLinks };
	}

	private buildGraphData(): BiGraphData {
		const graph: BiGraphData = { nodes: [], links: [] };
		const linkSet = new Set<string>();
		const nodeMap = new Map<string, BiGraphNode>();

		const vaultFiles = this.app.vault.getMarkdownFiles();
		const permalinkMap = this.buildPermalinkMap(vaultFiles);

		for (const [permalink, fileInfo] of permalinkMap.entries()) {
			const node: BiGraphNode = {
				id: permalink,
				title: fileInfo.title,
				filePathRelative: fileInfo.filePath,
				permalink: permalink,
				siteUrl: this.buildSiteUrl(permalink),
				outlink: [],
				backlink: [],
				linkCount: 0,
				isIsolated: false,
			};
			nodeMap.set(permalink, node);
			graph.nodes.push(node);
		}

		for (const [permalink, fileInfo] of permalinkMap.entries()) {
			const sourceNode = nodeMap.get(permalink);
			if (!sourceNode) continue;

			for (const targetPath of fileInfo.outlinks) {
				const targetPermalink = this.resolvePermalink(targetPath, permalinkMap);
				if (!targetPermalink || targetPermalink === permalink) continue;

				const targetNode = nodeMap.get(targetPermalink);
				if (!targetNode) continue;

				if (!sourceNode.outlink.includes(targetPermalink)) {
					sourceNode.outlink.push(targetPermalink);
				}
				if (!targetNode.backlink.includes(permalink)) {
					targetNode.backlink.push(permalink);
				}

				const linkKey = `${permalink}->${targetPermalink}`;
				if (!linkSet.has(linkKey)) {
					linkSet.add(linkKey);
					graph.links.push({ source: permalink, target: targetPermalink });
				}
			}
		}

		for (const node of graph.nodes) {
			node.linkCount = node.outlink.length + node.backlink.length;
			node.isIsolated = node.linkCount === 0;
		}

		return graph;
	}

	private buildPermalinkMap(files: TFile[]): Map<string, {
		title: string;
		filePath: string;
		outlinks: string[];
	}> {
		const map = new Map<string, {
			title: string;
			filePath: string;
			outlinks: string[];
		}>();

		const vaultPathMap = this.vaultPathMap;

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			const title = cache.frontmatter?.title || cache.headings?.[0]?.heading || file.basename;
			const filePath = file.path;

			let permalink: string | null = null;

			if (vaultPathMap.has(filePath)) {
				permalink = vaultPathMap.get(filePath)!;
			} else if (cache.frontmatter?.permalink) {
				permalink = String(cache.frontmatter.permalink);
			} else {
				permalink = '/' + filePath.replace(/\.md$/, '');
			}

			if (!permalink) continue;

			const outlinks: string[] = [];
			if (cache.links) {
				for (const link of cache.links) {
					if (link.link && !link.link.startsWith('http') && !link.link.startsWith('#')) {
						outlinks.push(link.link);
					}
				}
			}

			map.set(permalink, { title, filePath, outlinks });
		}

		return map;
	}

	private resolvePermalink(targetPath: string, permalinkMap: Map<string, any>): string | null {
		if (permalinkMap.has(targetPath)) return targetPath;

		let cleanPath = targetPath.replace(/\.md$/, '').replace(/#.*$/, '');

		for (const [permalink] of permalinkMap) {
			if (permalink.endsWith(cleanPath) || permalink.endsWith('/' + cleanPath)) {
				return permalink;
			}
		}

		if (this.vaultPathMap.has(cleanPath)) return this.vaultPathMap.get(cleanPath)!;
		if (this.vaultPathMap.has(cleanPath + '.md')) return this.vaultPathMap.get(cleanPath + '.md')!;

		return null;
	}

	private buildSiteUrl(permalink: string): string {
		if (!this.config.siteDomain) return permalink;
		const domain = this.config.siteDomain.replace(/\/+$/, '');
		const path = permalink.startsWith('/') ? permalink : '/' + permalink;
		return `${domain}${path}`;
	}
}
