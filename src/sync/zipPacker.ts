import JSZip from 'jszip';
import { TFile, Vault } from 'obsidian';
import { PathMapper } from './pathMapper';
import type { CollectResult } from './fileCollector';

export class ZipPacker {
	constructor(private vault: Vault) {}

	async createZip(collected: CollectResult, pathMapper: PathMapper): Promise<Blob> {
		const zip = new JSZip();

		let mdContent = await this.vault.read(collected.md);

		// 转换图片引用：Wiki 链接 → 标准 Markdown 相对路径
		for (const asset of collected.assets) {
			if (asset.refType === 'wiki') {
				const relativeRef = pathMapper.getRelativeAssetRef(asset.file.path, collected.md.path);
				const altText = asset.file.basename;
				const mdImageRef = `![${altText}](${relativeRef})`;
				mdContent = mdContent.replace(asset.originalRef, mdImageRef);
			}
		}

		const mdTargetPath = pathMapper.mapMarkdownPath(collected.md.path);
		zip.file(mdTargetPath, mdContent);

		for (const asset of collected.assets) {
			const assetData = await this.vault.readBinary(asset.file);
			const assetTargetPath = pathMapper.mapAssetPathAlongsideMd(
				asset.file.path,
				collected.md.path
			);
			zip.file(assetTargetPath, assetData);
		}

		return zip.generateAsync({ type: 'blob' });
	}
}
