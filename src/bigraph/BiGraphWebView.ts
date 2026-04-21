import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type VuePressPublisherPlugin from '../main';

export const VIEW_TYPE_BIGRAPH_WEB = 'sillot-bigraph-web';

export class BiGraphWebView extends ItemView {
	plugin: VuePressPublisherPlugin;
	private iframe: HTMLIFrameElement | null = null;
	private currentUrl: string = '';
	private navBar: HTMLElement | null = null;
	private urlInput: HTMLInputElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VuePressPublisherPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_BIGRAPH_WEB; }
	getDisplayText() { return '站点预览'; }
	getIcon() { return 'globe'; }

	async onOpen() {
		this.render();
	}

	async onLoadUrl(url: string) {
		const fullUrl = this.resolveUrl(url);
		this.currentUrl = fullUrl;
		if (this.urlInput) {
			this.urlInput.value = fullUrl;
		}
		if (this.iframe) {
			this.iframe.src = fullUrl;
		}
	}

	private resolveUrl(url: string): string {
		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}
		const domain = this.plugin.settings.siteDomain?.replace(/\/+$/, '') || '';
		if (!domain) {
			new Notice('未配置站点域名，请在设置中填写 siteDomain');
			return url.startsWith('/') ? url : '/' + url;
		}
		const path = url.startsWith('/') ? url : '/' + url;
		return `${domain}${path}`;
	}

	private render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('sillot-bigraph-web-view');

		this.navBar = container.createDiv({ cls: 'sillot-bigraph-web-nav' });

		const backBtn = this.navBar.createEl('button', { cls: 'sillot-panel-close-btn sillot-panel-close-btn--icon', attr: { title: '后退' } });
		backBtn.innerHTML = '←';
		backBtn.onclick = () => {
			try { this.iframe?.contentWindow?.history.back(); } catch {}
		};

		const forwardBtn = this.navBar.createEl('button', { cls: 'sillot-panel-close-btn sillot-panel-close-btn--icon', attr: { title: '前进' } });
		forwardBtn.innerHTML = '→';
		forwardBtn.onclick = () => {
			try { this.iframe?.contentWindow?.history.forward(); } catch {}
		};

		const refreshBtn = this.navBar.createEl('button', { cls: 'sillot-panel-close-btn sillot-panel-close-btn--icon', attr: { title: '刷新' } });
		refreshBtn.innerHTML = '↻';
		refreshBtn.onclick = () => {
			if (this.iframe) {
				this.iframe.src = this.iframe.src;
			}
		};

		this.urlInput = this.navBar.createEl('input', {
			cls: 'sillot-bigraph-web-url',
			attr: { type: 'text', placeholder: '输入 URL 或路径...' },
		}) as HTMLInputElement;

		if (this.currentUrl) {
			this.urlInput.value = this.currentUrl;
		}

		const goBtn = this.navBar.createEl('button', { cls: 'sillot-panel-close-btn', text: '前往' });
		goBtn.onclick = () => {
			const url = this.urlInput?.value.trim();
			if (url) {
				this.onLoadUrl(url);
			}
		};

		this.urlInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				const url = this.urlInput?.value.trim();
				if (url) {
					this.onLoadUrl(url);
				}
			}
		});

		const openExtBtn = this.navBar.createEl('button', { cls: 'sillot-panel-close-btn sillot-panel-close-btn--icon', attr: { title: '在浏览器中打开' } });
		openExtBtn.innerHTML = '⤴';
		openExtBtn.onclick = () => {
			if (this.currentUrl) {
				try {
					(window as any).require('electron').shell.openExternal(this.currentUrl);
				} catch {
					window.open(this.currentUrl, '_blank');
				}
			}
		};

		const closeBtn = this.navBar.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭预览' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => {
			this.leaf.detach();
		};

		const iframeContainer = container.createDiv({ cls: 'sillot-bigraph-web-iframe-container' });

		this.iframe = iframeContainer.createEl('iframe', {
			cls: 'sillot-bigraph-web-iframe',
			attr: {
				sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
				allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
			},
		}) as HTMLIFrameElement;

		if (this.currentUrl) {
			this.iframe.src = this.currentUrl;
		}
	}

	async onClose() {
		this.iframe = null;
		this.navBar = null;
		this.urlInput = null;
	}
}
