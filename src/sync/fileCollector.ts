import { TFile, Vault, parseLinktext, MetadataCache } from 'obsidian';

export class FileCollector {
	constructor(private vault: Vault, private metadataCache: MetadataCache) {}

	async collectForPublish(sourceFile: TFile): Promise<{ md: TFile; assets: TFile[] }> {
		const content = await this.vault.read(sourceFile);
		const assetFiles: TFile[] = [];
		const seen = new Set<string>();

		const wikiRegex = /!\[\[(.*?)\]\]/g;
		let match;
		while ((match = wikiRegex.exec(content)) !== null) {
			const linktext = match[1];
			const { path } = parseLinktext(linktext);
			const file = this.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && !seen.has(file.path)) {
				seen.add(file.path);
				assetFiles.push(file);
			}
		}

		const mdRegex = /!\[.*?\]\((.*?)\)/g;
		while ((match = mdRegex.exec(content)) !== null) {
			const relativePath = decodeURIComponent(match[1]);
			const file = this.vault.getAbstractFileByPath(relativePath);
			if (file instanceof TFile && !seen.has(file.path)) {
				seen.add(file.path);
				assetFiles.push(file);
			}
		}

		const linkRegex = /\[.*?\]\((.*?\.(pdf|docx?|xlsx?|pptx?|zip))\)/gi;
		while ((match = linkRegex.exec(content)) !== null) {
			const relativePath = decodeURIComponent(match[1]);
			const file = this.vault.getAbstractFileByPath(relativePath);
			if (file instanceof TFile && !seen.has(file.path)) {
				seen.add(file.path);
				assetFiles.push(file);
			}
		}

		return { md: sourceFile, assets: assetFiles };
	}
}
