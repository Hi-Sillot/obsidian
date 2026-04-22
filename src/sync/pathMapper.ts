export class PathMapper {
	private vuepressRoot: string;
	private publishRootPath: string;

	constructor(config: { docsDir: string; publishRootPath?: string }) {
		this.vuepressRoot = config.docsDir;
		this.publishRootPath = (config.publishRootPath || '').replace(/^\/+|\/+$/g, '');
	}

	mapMarkdownPath(obsidianPath: string, customPath?: string): string {
		const effectiveRoot = customPath || this.publishRootPath;
		if (effectiveRoot) {
			return `${this.vuepressRoot}/${effectiveRoot}/${obsidianPath}`;
		}
		return `${this.vuepressRoot}/${obsidianPath}`;
	}

	mapAssetPath(obsidianAssetPath: string, customPath?: string): string {
		const filename = obsidianAssetPath.split('/').pop() || 'unknown';
		const effectiveRoot = customPath || this.publishRootPath;
		if (effectiveRoot) {
			return `${this.vuepressRoot}/${effectiveRoot}/.vuepress/public/images/${filename}`;
		}
		return `${this.vuepressRoot}/.vuepress/public/images/${filename}`;
	}
}
