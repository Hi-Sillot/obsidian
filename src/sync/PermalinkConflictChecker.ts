import { App, TFile, MetadataCache, Vault, Modal, Setting } from 'obsidian';
import type { Logger } from '../utils/Logger';

const TAG = 'PermalinkConflict';

export interface PermalinkConflict {
	permalink: string;
	publishFile: TFile;
	conflictFiles: ConflictFileInfo[];
}

export interface ConflictFileInfo {
	filePath: string;
	permalink: string;
	isPublishDir: boolean;
}

export type ConflictResolution =
	| { action: 'overwrite' }
	| { action: 'rename'; newPermalink: string }
	| { action: 'remove-permalink' }
	| { action: 'skip' };

export class PermalinkConflictChecker {
	private app: App;
	private vault: Vault;
	private metadataCache: MetadataCache;
	private publishRootPath: string;
	private vuepressDocsDir: string;
	private localVuePressRoot: string;
	private logger: Logger | null;

	constructor(app: App, options: {
		publishRootPath: string;
		vuepressDocsDir: string;
		localVuePressRoot: string;
		logger?: Logger;
	}) {
		this.app = app;
		this.vault = app.vault;
		this.metadataCache = app.metadataCache;
		this.publishRootPath = (options.publishRootPath || '').replace(/^\/+|\/+$/g, '');
		this.vuepressDocsDir = options.vuepressDocsDir;
		this.localVuePressRoot = options.localVuePressRoot;
		this.logger = options.logger || null;
	}

	private extractPermalink(file: TFile): string | null {
		const cache = this.metadataCache.getFileCache(file);
		if (!cache?.frontmatter) return null;
		if (cache.frontmatter.permalink) {
			return String(cache.frontmatter.permalink);
		}
		return null;
	}

	private generatePermalink(file: TFile): string {
		const cache = this.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.permalink) {
			return String(cache.frontmatter.permalink);
		}
		const publishBase = this.publishRootPath
			? `/${this.publishRootPath}/`
			: '/';
		return `${publishBase}${file.path.replace(/\.md$/, '')}`;
	}

	async checkConflictsForFiles(files: TFile[]): Promise<PermalinkConflict[]> {
		const conflicts: PermalinkConflict[] = [];

		const existingPermalinks = await this.buildExistingPermalinkMap();

		for (const file of files) {
			const permalink = this.generatePermalink(file);
			const existing = existingPermalinks.get(permalink);

			if (existing && existing.length > 0) {
				const isSelfConflict = existing.some(e => {
					const mappedPath = this.mapToVuePressPath(file);
					return e.filePath === mappedPath;
				});

				if (!isSelfConflict) {
					conflicts.push({
						permalink,
						publishFile: file,
						conflictFiles: existing,
					});
				}
			}
		}

		this.logger?.info(TAG, `检查 ${files.length} 个文件，发现 ${conflicts.length} 个 permalink 冲突`);
		return conflicts;
	}

	private async buildExistingPermalinkMap(): Promise<Map<string, ConflictFileInfo[]>> {
		const map = new Map<string, ConflictFileInfo[]>();

		const vaultFiles = this.vault.getMarkdownFiles();
		for (const file of vaultFiles) {
			const permalink = this.extractPermalink(file);
			if (!permalink) continue;

			const vuepressPath = this.mapToVuePressPath(file);
			const isPublishDir = this.isInPublishDir(vuepressPath);

			const entries = map.get(permalink) || [];
			entries.push({
				filePath: vuepressPath,
				permalink,
				isPublishDir,
			});
			map.set(permalink, entries);
		}

		return map;
	}

	private mapToVuePressPath(file: TFile): string {
		if (this.publishRootPath) {
			return `${this.vuepressDocsDir}/${this.publishRootPath}/${file.path}`;
		}
		return `${this.vuepressDocsDir}/${file.path}`;
	}

	private isInPublishDir(vuepressPath: string): boolean {
		if (!this.publishRootPath) return false;
		const prefix = `${this.vuepressDocsDir}/${this.publishRootPath}/`;
		return vuepressPath.startsWith(prefix);
	}

	async resolveConflicts(conflicts: PermalinkConflict[]): Promise<Map<string, ConflictResolution>> {
		const resolutions = new Map<string, ConflictResolution>();

		if (conflicts.length === 0) return resolutions;

		for (const conflict of conflicts) {
			const resolution = await this.showConflictDialog(conflict);
			resolutions.set(conflict.permalink, resolution);
		}

		return resolutions;
	}

	private showConflictDialog(conflict: PermalinkConflict): Promise<ConflictResolution> {
		return new Promise((resolve) => {
			const modal = new PermalinkConflictModal(this.app, conflict, (resolution) => {
				resolve(resolution);
			});
			modal.open();
		});
	}

	applyResolutions(
		files: { path: string; content: string }[],
		resolutions: Map<string, ConflictResolution>,
		conflicts: PermalinkConflict[]
	): { path: string; content: string }[] {
		const result = [...files];

		for (const conflict of conflicts) {
			const resolution = resolutions.get(conflict.permalink);
			if (!resolution) continue;

			if (resolution.action === 'skip') {
				const targetPath = this.mapToVuePressPath(conflict.publishFile);
				const idx = result.findIndex(f => f.path === targetPath);
				if (idx !== -1) {
					result.splice(idx, 1);
					this.logger?.info(TAG, `跳过发布: ${conflict.publishFile.path} (permalink: ${conflict.permalink})`);
				}
			} else if (resolution.action === 'rename' || resolution.action === 'remove-permalink') {
				const targetPath = this.mapToVuePressPath(conflict.publishFile);
				const idx = result.findIndex(f => f.path === targetPath);
				if (idx !== -1) {
					try {
						let decoded = decodeURIComponent(escape(atob(result[idx].content)));
						if (resolution.action === 'rename') {
							decoded = decoded.replace(
								/^permalink:.*$/m,
								`permalink: ${resolution.newPermalink}`
							);
							this.logger?.info(TAG, `重命名 permalink: ${conflict.permalink} -> ${resolution.newPermalink}`);
						} else {
							const lines = decoded.split(/\r?\n/);
							if (lines[0] === '---') {
								const endIdx = lines.indexOf('---', 1);
								if (endIdx !== -1) {
									const newLines = [];
									for (let i = 0; i < lines.length; i++) {
										if (i > 0 && i < endIdx && lines[i].startsWith('permalink:')) continue;
										newLines.push(lines[i]);
									}
									decoded = newLines.join('\n');
									this.logger?.info(TAG, `去掉 permalink: ${conflict.publishFile.path} (原 permalink: ${conflict.permalink})`);
								}
							}
						}
						result[idx].content = btoa(unescape(encodeURIComponent(decoded)));
					} catch (e) {
						this.logger?.warn(TAG, `Base64 解码失败，跳过处理: ${targetPath}`, e.message);
					}
				}
			}
		}

		return result;
	}
}

class PermalinkConflictModal extends Modal {
	private conflict: PermalinkConflict;
	private onResolve: (resolution: ConflictResolution) => void;
	private resolved = false;

	constructor(app: App, conflict: PermalinkConflict, onResolve: (resolution: ConflictResolution) => void) {
		super(app);
		this.conflict = conflict;
		this.onResolve = onResolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Permalink 冲突' });

		contentEl.createEl('p', {
			text: ` permalink "${this.conflict.permalink}" 已被以下文件使用：`,
			cls: 'sillot-conflict-desc',
		});

		const list = contentEl.createEl('ul', { cls: 'sillot-conflict-list' });
		for (const cf of this.conflict.conflictFiles) {
			const li = list.createEl('li');
			li.createEl('span', {
				text: cf.isPublishDir ? '[发布目录]' : '[正式目录]',
				cls: cf.isPublishDir ? 'sillot-tag-publish' : 'sillot-tag-official',
			});
			li.createEl('span', { text: ` ${cf.filePath}` });
		}

		contentEl.createEl('p', {
			text: `当前要发布的文件: ${this.conflict.publishFile.path}`,
			cls: 'sillot-conflict-current',
		});

		new Setting(contentEl)
			.setName('覆盖发布')
			.setDesc('保留当前文件的 permalink，覆盖已有文件')
			.addButton(btn => btn
				.setButtonText('覆盖')
				.setWarning()
				.onClick(() => { this.resolve({ action: 'overwrite' }); }));

		new Setting(contentEl)
			.setName('去掉 permalink 发布')
			.setDesc('发布时不包含 permalink，站点构建时会自动重新生成')
			.addButton(btn => btn
				.setButtonText('去掉 permalink')
				.onClick(() => { this.resolve({ action: 'remove-permalink' }); }));

		new Setting(contentEl)
			.setName('重命名 permalink')
			.setDesc('为当前文件自动生成新的 permalink')
			.addButton(btn => btn
				.setButtonText('重命名')
				.onClick(() => {
					const newPermalink = `${this.conflict.permalink.replace(/\/$/, '')}-${Date.now()}`;
					this.resolve({ action: 'rename', newPermalink });
				}));

		new Setting(contentEl)
			.setName('跳过此文件')
			.setDesc('不发布此文件，保留已有文件')
			.addButton(btn => btn
				.setButtonText('跳过')
				.onClick(() => { this.resolve({ action: 'skip' }); }));
	}

	private resolve(resolution: ConflictResolution) {
		if (this.resolved) return;
		this.resolved = true;
		this.onResolve(resolution);
		this.close();
	}

	onClose() {
		if (!this.resolved) {
			this.resolve({ action: 'skip' });
		}
		this.contentEl.empty();
	}
}
