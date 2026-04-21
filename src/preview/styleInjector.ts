import { GitHubApi } from '../sync/githubApi';

export class StyleInjector {
	private customCss: string = '';
	private styleEl: HTMLStyleElement | null = null;

	async loadStylesFromGitHub(repo: string, token: string, stylePath: string, branch: string): Promise<void> {
		try {
			const api = new GitHubApi(repo, token);
			const content = await api.getFileContent(stylePath, branch);
			if (content) {
				this.customCss = content;
			}
		} catch (error) {
			console.error('[StyleInjector] Failed to load VuePress styles:', error.message);
		}
	}

	loadStylesFromText(css: string): void {
		this.customCss = css;
	}

	inject(): void {
		this.remove();
		if (!this.customCss) return;
		this.styleEl = document.createElement('style');
		this.styleEl.id = 'vuepress-publisher-styles';
		this.styleEl.textContent = this.customCss;
		document.head.appendChild(this.styleEl);
	}

	remove(): void {
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
	}

	getCSS(): string {
		return this.customCss;
	}
}
