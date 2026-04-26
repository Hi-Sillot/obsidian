import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';
import type { LabelEntry, BannerEntry } from '../../bridge/types';

export class InlineComponentHandler extends BaseSyntaxHandler {
	private labelMap: Record<string, LabelEntry> = {};
	private bannerMap: Record<string, BannerEntry> = {};
	private vscodeSvg: string = '';
	private cedossMap: Record<string, string> = {};

	constructor(plugin: VuePressPublisherPlugin) {
		super(plugin);
	}

	loadData(data: { labels: Record<string, LabelEntry>; banners: Record<string, BannerEntry>; vscodeSvg: string; cedossMap: Record<string, string> }) {
		this.labelMap = data.labels || {};
		this.bannerMap = data.banners || {};
		this.vscodeSvg = data.vscodeSvg || '';
		this.cedossMap = data.cedossMap || {};
	}

	preprocessMarkdown(text: string, _sourcePath: string): string {
		let result = text;

		result = result.replace(
			/<GithubLabel\s+(?:name|label)="([^"]+)"(?:\s+color="([^"]+)")?\s*\/?>/g,
			(_, name, color) => {
				return `\`GithubLabel:${name}${color ? ':' + color : ''}\``;
			}
		);

		result = result.replace(
			/<VSCodeSettingsLink\s+id="([^"]+)"\s*\/?>/g,
			(_, id) => {
				return `\`VSCodeSetting:${id}\``;
			}
		);

		result = result.replace(
			/<BannerTop(\w+)\s*\/?>/g,
			(_, type) => {
				return `\`BannerTop:${type}\``;
			}
		);

		result = result.replace(
			/<C\s+id="([^"]+)"(?:\s+error-mode="([^"]*)")?\s*\/?>/g,
			(_, id, errorMode) => {
				return `\`Cedoss:${id}${errorMode ? ':' + errorMode : ''}\``;
			}
		);

		return result;
	}

	preprocessCedossContainerMarkdown(text: string): string {
		return text.replace(
			/(\:{3,}\s*cedoss[\s\S]*?\:{3,})/g,
			(containerBlock) => {
				return containerBlock.replace(
					/\[\[([^\]]+)\]\]/g,
					(_, id) => {
						return `\`Cedoss:${id}\``;
					}
				);
			}
		);
	}

	processInlineComponents(el: HTMLElement): void {
		this.processGithubLabelTags(el);
		this.processVSCodeLinkTags(el);
		this.processGithubLabelInline(el);
		this.processVSCodeLinkInline(el);
		this.processBannerInline(el);
		this.processBannerArchived(el);
		this.processCedossInline(el);
	}

	private processGithubLabelTags(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && node.textContent.includes('<GithubLabel')) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /<GithubLabel\s+(?:name|label)="([^"]+)"(?:\s+(?:color)="([^"]+)")?\s*\/?>/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const name = match[1];
				const entry = this.labelMap[name];
				const span = document.createElement('span');
				span.className = 'sillot-github-label IssueLabel hx_IssueLabel IssueLabel--big lh-condensed js-label-link d-inline-block v-align-middle';
				span.textContent = entry?.fullName || name;
				span.dataset.name = name;
				if (entry?.color) {
					span.style.setProperty('--label-r', String(entry.color.r));
					span.style.setProperty('--label-g', String(entry.color.g));
					span.style.setProperty('--label-b', String(entry.color.b));
					span.style.setProperty('--label-h', String(entry.color.h));
					span.style.setProperty('--label-s', String(entry.color.s));
					span.style.setProperty('--label-l', String(entry.color.l));
				} else if (match[2]) {
					const hex = match[2];
					span.style.backgroundColor = hex;
					span.style.color = this.isLightColor(hex) ? '#1b1f23' : '#ffffff';
				}
				fragment.appendChild(span);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private processVSCodeLinkTags(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && node.textContent.includes('<VSCodeSettingsLink')) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /<VSCodeSettingsLink\s+id="([^"]+)"\s*\/?>/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const id = match[1];
				const anchor = document.createElement('a');
				anchor.className = 'sillot-vscode-link inline';
				anchor.href = `vscode://settings/${id}`;
				anchor.title = `在 VSCode 中打开 ${id} 设置`;

				const icon = anchor.createEl('span', { cls: 'vscode-icon' });
				icon.innerHTML = this.vscodeSvg;

				anchor.createEl('code', { text: id, cls: 'setting-id' });
				fragment.appendChild(anchor);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private processGithubLabelInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-github-label')) continue;
			const text = codeEl.textContent || '';
			const match = text.match(/^GithubLabel:(\w+)(?::([a-fA-F0-9]{6}))?$/);
			if (match) {
				const name = match[1];
				const explicitColor = match[2];
				const entry = this.labelMap[name];
				const span = document.createElement('span');
				span.className = 'sillot-github-label IssueLabel hx_IssueLabel IssueLabel--big lh-condensed js-label-link d-inline-block v-align-middle';
				span.textContent = entry?.fullName || name;
				span.dataset.name = name;
				if (entry?.color) {
					span.style.setProperty('--label-r', String(entry.color.r));
					span.style.setProperty('--label-g', String(entry.color.g));
					span.style.setProperty('--label-b', String(entry.color.b));
					span.style.setProperty('--label-h', String(entry.color.h));
					span.style.setProperty('--label-s', String(entry.color.s));
					span.style.setProperty('--label-l', String(entry.color.l));
				} else if (explicitColor) {
					const hex = `#${explicitColor}`;
					span.style.backgroundColor = hex;
					span.style.color = this.isLightColor(hex) ? '#1b1f23' : '#ffffff';
				}
				codeEl.replaceWith(span);
			}
		}
	}

	private processVSCodeLinkInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-vscode-link')) continue;
			const text = codeEl.textContent || '';
			const match = text.match(/^VSCodeSetting:(.+)$/);
			if (match) {
				const id = match[1];
				const anchor = document.createElement('a');
				anchor.className = 'sillot-vscode-link inline';
				anchor.href = `vscode://settings/${id}`;
				anchor.title = `在 VSCode 中打开 ${id} 设置`;

				const icon = anchor.createEl('span', { cls: 'vscode-icon' });
				icon.innerHTML = this.vscodeSvg;

				anchor.createEl('code', { text: id, cls: 'setting-id' });
				codeEl.replaceWith(anchor);
			}
		}
	}

	private processBannerInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-banner, .flash')) continue;
			const text = codeEl.textContent?.trim() || '';
			const match = text.match(/^BannerTop:(\w+)$/);
			if (match) {
				const type = match[1];
				const config = this.bannerMap[type];
				if (config) {
					const banner = document.createElement('div');
					banner.className = `sillot-banner ${config.flashCls}`;
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.innerHTML = `${config.iconHtml}<span class="split-w"></span>${config.text}`;
					banner.appendChild(content);
					codeEl.replaceWith(banner);
				} else {
					const banner = document.createElement('div');
					banner.className = 'sillot-banner flash flash-warn flash-full border-top-0 text-center text-bold py-2';
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.textContent = `📋 BannerTop: ${type}`;
					banner.appendChild(content);
					codeEl.replaceWith(banner);
				}
			}
		}
	}

	private processBannerArchived(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && /<BannerTop(\w+)\s*\/?>/.test(node.textContent)) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /<BannerTop(\w+)\s*\/?>/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const type = match[1];
				const config = this.bannerMap[type];
				const banner = document.createElement('div');
				if (config) {
					banner.className = `sillot-banner ${config.flashCls}`;
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.innerHTML = `${config.iconHtml}<span class="split-w"></span>${config.text}`;
					banner.appendChild(content);
				} else {
					banner.className = 'sillot-banner flash flash-warn flash-full border-top-0 text-center text-bold py-2';
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.textContent = `📋 BannerTop: ${type}`;
					banner.appendChild(content);
				}
				fragment.appendChild(banner);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private processCedossInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.const-value, .const-error')) continue;
			const text = codeEl.textContent?.trim() || '';
			const match = text.match(/^Cedoss:([^\s:]+)(?::(\w+))?$/);
			if (match) {
				const id = match[1];
				const errorMode = match[2] || 'verbose';
				const value = this.cedossMap[id];
				const span = document.createElement('span');
				if (value) {
					span.className = 'const-value const-value--linked';
					const link = document.createElement('a');
					link.className = 'const-link';
					link.href = `sillot://cedoss?id=${encodeURIComponent(id)}`;
					link.textContent = value;
					span.appendChild(link);
				} else {
					span.className = `const-error const-error--${errorMode}`;
					if (errorMode === 'icon') {
						span.innerHTML = '<span class="const-error__icon">⚠️</span>';
					} else {
						span.innerHTML = `<span class="const-error__icon">⚠️</span><span class="const-error__text">${id}</span>`;
					}
				}
				codeEl.replaceWith(span);
			}
		}
	}

	private isLightColor(hex: string): boolean {
		const c = hex.replace('#', '');
		const r = parseInt(c.substr(0, 2), 16);
		const g = parseInt(c.substr(2, 2), 16);
		const b = parseInt(c.substr(4, 2), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.6;
	}
}
