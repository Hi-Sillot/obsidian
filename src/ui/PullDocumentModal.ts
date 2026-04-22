import { App, Modal, Notice } from 'obsidian';
import { DocumentTreeService } from '../sync/DocumentTreeService';
import type { PullSource } from '../types';
import { createPullDocModal } from './vue/pull-doc-helper';

export class PullDocumentModal extends Modal {
	private documentTreeService: DocumentTreeService;
	private vaultRoot: string;
	private githubRepo: string;
	private githubBranch: string;
	private siteDomain: string;
	private docsDir: string;
	private vueApp: ReturnType<typeof createPullDocModal> | null = null;

	constructor(
		app: App,
		documentTreeService: DocumentTreeService,
		config: {
			vaultRoot: string;
			githubRepo: string;
			githubBranch: string;
			siteDomain: string;
			docsDir: string;
		}
	) {
		super(app);
		this.documentTreeService = documentTreeService;
		this.vaultRoot = config.vaultRoot;
		this.githubRepo = config.githubRepo;
		this.githubBranch = config.githubBranch;
		this.siteDomain = config.siteDomain;
		this.docsDir = config.docsDir;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// 设置 modal 容器宽度
		const modalEl = contentEl.closest('.modal') as HTMLElement | null;
		if (modalEl) {
			modalEl.classList.add('sillot-modal-80vw');
		}

		this.vueApp = createPullDocModal({
			container: contentEl,
			obsidianApp: this.app,
			documentTreeService: this.documentTreeService,
			vaultRoot: this.vaultRoot,
			githubRepo: this.githubRepo,
			githubBranch: this.githubBranch,
			siteDomain: this.siteDomain,
			docsDir: this.docsDir,
			onClose: () => {
				this.close();
			},
			onDownload: async (cloudPath: string, localSavePath: string, source: PullSource) => {
				const result = await this.documentTreeService.pullDocument({
					cloudPath,
					localSavePath,
					source,
				});
				if (result.success) {
					new Notice(result.message);
					this.close();
				} else {
					new Notice(`下载失败: ${result.message}`);
				}
			},
		});
	}

	onClose() {
		if (this.vueApp) {
			this.vueApp.unmount();
			this.vueApp = null;
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}
