import { DocumentTreeService } from '../sync/DocumentTreeService';
import type { PullSource } from '../types';
import { renderVueComponent, destroyVueApp } from './vue/App';
import MobilePullDocumentModalVue from './vue/MobilePullDocumentModal.vue';

let mobilePullDocContainer: HTMLElement | null = null;

export function openMobilePullDocumentModal(
	documentTreeService: DocumentTreeService,
	config: {
		vaultRoot: string;
		githubRepo: string;
		githubBranch: string;
		siteDomain: string;
		docsDir: string;
	},
	app: any,
	onDownload: (cloudPath: string, localSavePath: string, source: PullSource) => Promise<void>
) {
	if (mobilePullDocContainer) {
		destroyVueApp();
		mobilePullDocContainer.remove();
		mobilePullDocContainer = null;
	}

	const container = renderVueComponent(
		MobilePullDocumentModalVue,
		{
			documentTreeService,
			vaultRoot: config.vaultRoot,
			githubRepo: config.githubRepo,
			githubBranch: config.githubBranch,
			siteDomain: config.siteDomain,
			docsDir: config.docsDir,
			onClose: () => {
				closeMobilePullDocumentModal();
			},
			onDownload: async (cloudPath: string, localSavePath: string, source: PullSource) => {
				const result = await documentTreeService.pullDocument({
					cloudPath,
					localSavePath,
					source,
				});
				if (result && result.success) {
					closeMobilePullDocumentModal();
				}
			},
			obsidianApp: app,
		}
	);

	mobilePullDocContainer = container;

	const appContainer = document.querySelector('.app-container');
	if (appContainer) {
		appContainer.before(container);
	} else {
		document.body.appendChild(container);
	}
}

export function closeMobilePullDocumentModal() {
	if (mobilePullDocContainer) {
		destroyVueApp();
		mobilePullDocContainer.remove();
		mobilePullDocContainer = null;
	}
}
