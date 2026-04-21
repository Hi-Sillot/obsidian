import JSZip from 'jszip';
import { TFile, Vault } from 'obsidian';
import { PathMapper } from './pathMapper';

export class ZipPacker {
	constructor(private vault: Vault) {}

	async createZip(files: { md: TFile; assets: TFile[] }, pathMapper: PathMapper): Promise<Blob> {
		const zip = new JSZip();

		const mdContent = await this.vault.read(files.md);
		const mdTargetPath = pathMapper.mapMarkdownPath(files.md.path);
		zip.file(mdTargetPath, mdContent);

		for (const asset of files.assets) {
			const assetData = await this.vault.readBinary(asset);
			const assetTargetPath = pathMapper.mapAssetPath(asset.path);
			zip.file(assetTargetPath, assetData);
		}

		return zip.generateAsync({ type: 'blob' });
	}
}
