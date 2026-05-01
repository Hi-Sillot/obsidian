export class PathMapper {
	private vuepressRoot: string;
	private publishRootPath: string;

	constructor(config: { docsDir: string; publishRootPath?: string }) {
		this.vuepressRoot = config.docsDir;
		this.publishRootPath = (config.publishRootPath || '').replace(/^\/+|\/+$/g, '');
	}

	/**
	 * 映射 markdown 文件到 GitHub 仓库路径
	 * 结果如 docs/col_doc/xxx.md 或 docs/{publishRootPath}/col_doc/xxx.md
	 */
	mapMarkdownPath(obsidianPath: string, customPath?: string): string {
		const effectiveRoot = customPath || this.publishRootPath;
		if (effectiveRoot) {
			return `${this.vuepressRoot}/${effectiveRoot}/${obsidianPath}`;
		}
		return `${this.vuepressRoot}/${obsidianPath}`;
	}

	/**
	 * 映射资源文件到 GitHub 仓库路径（与 markdown 保持相对目录结构）
	 *
	 * 策略：将资源文件放在与 markdown 相同的目录下，
	 * 这样 markdown 中的相对路径引用（如 ./image.png）可以保持不变。
	 *
	 * @param assetVaultPath 资源在 vault 中的路径（如 col_doc/2_releaseNotes/VSCode/image.png）
	 * @param mdVaultPath markdown 在 vault 中的路径（如 col_doc/2_releaseNotes/VSCode/1_66.md）
	 * @param customPath 自定义发布子路径
	 * @returns GitHub 仓库中的目标路径
	 */
	mapAssetPathAlongsideMd(assetVaultPath: string, mdVaultPath: string, customPath?: string): string {
		const effectiveRoot = customPath || this.publishRootPath;

		// 计算资源相对于 markdown 的路径
		const mdDir = mdVaultPath.substring(0, mdVaultPath.lastIndexOf('/'));
		const assetFileName = assetVaultPath.split('/').pop() || 'unknown';

		let assetRelPath: string;
		if (assetVaultPath.startsWith(mdDir + '/')) {
			// 资源在 markdown 同目录或子目录下
			assetRelPath = assetVaultPath.substring(mdDir.length + 1);
		} else {
			// 资源在其他目录，放到 markdown 同目录下
			assetRelPath = assetFileName;
		}

		const mdDirInRepo = effectiveRoot
			? `${this.vuepressRoot}/${effectiveRoot}/${mdDir}`
			: `${this.vuepressRoot}/${mdDir}`;

		return `${mdDirInRepo}/${assetRelPath}`;
	}

	/**
	 * 计算从 markdown 文件到资源文件的相对路径（用于更新 markdown 中的引用）
	 *
	 * @param assetVaultPath 资源在 vault 中的路径
	 * @param mdVaultPath markdown 在 vault 中的路径
	 * @returns 相对路径字符串（如 ./image.png 或 ../assets/image.png）
	 */
	getRelativeAssetRef(assetVaultPath: string, mdVaultPath: string): string {
		const mdDir = mdVaultPath.substring(0, mdVaultPath.lastIndexOf('/'));

		if (assetVaultPath.startsWith(mdDir + '/')) {
			return './' + assetVaultPath.substring(mdDir.length + 1);
		}

		// 计算相对路径
		const mdParts = mdDir.split('/');
		const assetParts = assetVaultPath.split('/');

		// 找到公共前缀
		let commonLen = 0;
		while (
			commonLen < mdParts.length &&
			commonLen < assetParts.length &&
			mdParts[commonLen] === assetParts[commonLen]
		) {
			commonLen++;
		}

		const upLevels = mdParts.length - commonLen;
		const downPath = assetParts.slice(commonLen).join('/');

		if (upLevels === 0) {
			return './' + downPath;
		}

		return '../'.repeat(upLevels) + downPath;
	}

	/**
	 * @deprecated 使用 mapAssetPathAlongsideMd 替代
	 */
	mapAssetPath(obsidianAssetPath: string, customPath?: string): string {
		const filename = obsidianAssetPath.split('/').pop() || 'unknown';
		const effectiveRoot = customPath || this.publishRootPath;
		if (effectiveRoot) {
			return `${this.vuepressRoot}/${effectiveRoot}/.vuepress/public/images/${filename}`;
		}
		return `${this.vuepressRoot}/.vuepress/public/images/${filename}`;
	}
}
