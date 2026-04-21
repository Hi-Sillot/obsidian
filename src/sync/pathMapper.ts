export class PathMapper {
	private vuepressRoot: string;
	private publishRootPath: string;

	constructor(config: { docsDir: string; publishRootPath?: string }) {
		this.vuepressRoot = config.docsDir;
		this.publishRootPath = (config.publishRootPath || '').replace(/^\/+|\/+$/g, '');
	}

	mapMarkdownPath(obsidianPath: string): string {
		if (this.publishRootPath) {
			return `${this.vuepressRoot}/${this.publishRootPath}/${obsidianPath}`;
		}
		return `${this.vuepressRoot}/${obsidianPath}`;
	}

	mapAssetPath(obsidianAssetPath: string): string {
		const filename = obsidianAssetPath.split('/').pop() || 'unknown';
		if (this.publishRootPath) {
			return `${this.vuepressRoot}/${this.publishRootPath}/.vuepress/public/images/${filename}`;
		}
		return `${this.vuepressRoot}/.vuepress/public/images/${filename}`;
	}
}
