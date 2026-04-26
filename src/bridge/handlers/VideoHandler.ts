import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

export class VideoHandler extends BaseSyntaxHandler {
	preprocessMarkdown(text: string, _sourcePath: string): string {
		let result = this.preprocessVideoTabsMarkdown(text);
		result = this.preprocessVideoInlineMarkdown(result);
		return result;
	}

	processInlineComponents(el: HTMLElement): void {
		this.processVideoTabsInline(el);
		this.processVideoInline(el);
		this.processVideoEmbeds(el);
	}

	private preprocessVideoTabsMarkdown(text: string): string {
		return text.replace(
			/<!--\s*sillot-video-tabs\s+([\s\S]*?)-->/g,
			(_, attrs) => {
				const ap = attrs.match(/ap="([^"]+)"/)?.[1];
				const ac = attrs.match(/ac="([^"]+)"/)?.[1];
				const bb = attrs.match(/bb="([^"]+)"/)?.[1];
				const active = attrs.match(/active="([^"]+)"/)?.[1] || '';

				const parts: string[] = [];
				if (ap) parts.push(`ap:${ap}`);
				if (ac) parts.push(`ac:${ac}`);
				if (bb) parts.push(`bb:${bb}`);
				if (active) parts.push(`active:${active}`);

				return parts.length >= 2 ? `\`VideoTabs:${parts.join('|')}\`` : '';
			}
		);
	}

	private preprocessVideoInlineMarkdown(text: string): string {
		let result = text;

		result = result.replace(
			/@\[bilibili(?:\s+p(\d+))?([^\]]*)\]\(([^)]+)\)/g,
			(_, page, info, source) => {
				const ids = source.trim().split(/\s+/);
				const bvid = ids.find((id: string) => id.startsWith('BV'));
				const height = info.match(/height="([^"]+)"/)?.[1] || '';
				const p = page || '';
				return `\`Bilibili:${bvid || source.trim()}:${p}${height ? ':' + height : ''}\``;
			}
		);

		result = result.replace(
			/@\[acfun([^\]]*)\]\(([^)]+)\)/g,
			(_, info, id) => {
				const height = info.match(/height="([^"]+)"/)?.[1] || '';
				return `\`AcFun:${id.trim()}${height ? ':' + height : ''}\``;
			}
		);

		result = result.replace(
			/@\[artPlayer([^\]]*)\]\(([^)]+)\)/g,
			(_, info, url) => {
				const height = info.match(/height="([^"]+)"/)?.[1] || '';
				return `\`ArtPlayer:${url.trim()}${height ? ':' + height : ''}\``;
			}
		);

		return result;
	}

	private processVideoTabsInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-video-tabs')) continue;
			const text = codeEl.textContent?.trim() || '';
			const match = text.match(/^VideoTabs:(.+)$/);
			if (match) {
				const data = match[1];
				const parts = data.split('|');
				let ap = '';
				let ac = '';
				let bb = '';
				let active = '';
				for (const part of parts) {
					if (part.startsWith('ap:')) ap = part.slice(3);
					else if (part.startsWith('ac:')) ac = part.slice(3);
					else if (part.startsWith('bb:')) bb = part.slice(3);
					else if (part.startsWith('active:')) active = part.slice(7);
				}

				const container = document.createElement('div');
				container.className = 'sillot-video-tabs';

				const nav = container.createDiv({ cls: 'sillot-video-tabs-nav' });
				const contentDiv = container.createDiv({ cls: 'sillot-video-tabs-content' });

				const tabs: Array<{ label: string; el: HTMLElement }> = [];

				if (ap) {
					const tabBtn = nav.createEl('button', { text: 'ArtPlayer', cls: 'sillot-video-tab-btn' });
					const tabContent = contentDiv.createDiv({ cls: 'sillot-video-tab-pane' });
					const wrapper = tabContent.createDiv({ cls: 'sillot-video-embed' });
					wrapper.createEl('video', {
						cls: 'sillot-artplayer-video',
						attr: { src: ap, controls: '', preload: 'metadata' },
					});
					tabs.push({ label: 'ArtPlayer', el: tabContent });
					tabBtn.onclick = () => this.switchVideoTab(tabs, 'ArtPlayer', nav, contentDiv);
				}

				if (ac) {
					const acIds = ac.split(',').map(s => s.trim()).filter(Boolean);
					for (const acId of acIds) {
						const label = `AcFun ${acId}`;
						const tabBtn = nav.createEl('button', { text: label, cls: 'sillot-video-tab-btn' });
						const tabContent = contentDiv.createDiv({ cls: 'sillot-video-tab-pane' });
						const wrapper = tabContent.createDiv({ cls: 'sillot-video-embed' });
						wrapper.createEl('iframe', {
							attr: {
								src: `https://www.acfun.cn/player/${acId}`,
								scrolling: 'no', border: '0', frameborder: 'no', framespacing: '0',
								allowfullscreen: 'true',
								allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
							},
						});
						tabs.push({ label, el: tabContent });
						tabBtn.onclick = () => this.switchVideoTab(tabs, label, nav, contentDiv);
					}
				}

				if (bb) {
					const bbIds = bb.split(',').map(s => s.trim()).filter(Boolean);
					for (const bbId of bbIds) {
						const label = `Bilibili ${bbId}`;
						const tabBtn = nav.createEl('button', { text: label, cls: 'sillot-video-tab-btn' });
						const tabContent = contentDiv.createDiv({ cls: 'sillot-video-tab-pane' });
						const wrapper = tabContent.createDiv({ cls: 'sillot-video-embed' });
						wrapper.createEl('iframe', {
							attr: {
								src: `https://player.bilibili.com/player.html?bvid=${bbId}&high_quality=1`,
								scrolling: 'no', border: '0', frameborder: 'no', framespacing: '0',
								allowfullscreen: 'true',
								allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
							},
						});
						tabs.push({ label, el: tabContent });
						tabBtn.onclick = () => this.switchVideoTab(tabs, label, nav, contentDiv);
					}
				}

				const activeLabel = active.toLowerCase();
				let activated = false;
				for (const tab of tabs) {
					if (tab.label.toLowerCase().includes(activeLabel)) {
						tab.el.classList.add('sillot-video-tab-pane--active');
						activated = true;
						break;
					}
				}
				if (!activated && tabs.length > 0) {
					tabs[0].el.classList.add('sillot-video-tab-pane--active');
				}

				const btns = nav.querySelectorAll('.sillot-video-tab-btn');
				let btnActivated = false;
				btns.forEach((btn) => {
					const btnText = btn.textContent?.toLowerCase() || '';
					if (btnText.includes(activeLabel)) {
						btn.classList.add('sillot-video-tab-btn--active');
						btnActivated = true;
					}
				});
				if (!btnActivated && btns.length > 0) {
					btns[0].classList.add('sillot-video-tab-btn--active');
				}

				codeEl.replaceWith(container);
			}
		}
	}

	private processVideoInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-video-tabs, .sillot-video-embed')) continue;
			const text = codeEl.textContent?.trim() || '';

			let replaced = false;

			const bilibiliMatch = text.match(/^Bilibili:([^:]+)(?::(\d+))?(?::(.+))?$/);
			if (bilibiliMatch) {
				const bvid = bilibiliMatch[1];
				const page = bilibiliMatch[2];
				const height = bilibiliMatch[3];
				const params = new URLSearchParams();
				params.set('bvid', bvid);
				params.set('high_quality', '1');
				params.set('autoplay', '0');
				if (page) params.set('p', page);
				const wrapper = document.createElement('div');
				wrapper.className = 'sillot-video-embed';
				const iframe = wrapper.createEl('iframe', {
					attr: {
						src: `https://player.bilibili.com/player.html?${params.toString()}`,
						title: 'Bilibili',
						scrolling: 'no', border: '0', frameborder: 'no', framespacing: '0',
						allowfullscreen: 'true',
						allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
					},
				});
				if (height) iframe.style.height = height;
				codeEl.replaceWith(wrapper);
				replaced = true;
			}

			if (!replaced) {
				const acfunMatch = text.match(/^AcFun:([^:]+)(?::(.+))?$/);
				if (acfunMatch) {
					const acId = acfunMatch[1];
					const height = acfunMatch[2];
					const wrapper = document.createElement('div');
					wrapper.className = 'sillot-video-embed';
					const iframe = wrapper.createEl('iframe', {
						attr: {
							src: `https://www.acfun.cn/player/${acId}`,
							title: 'AcFun',
							scrolling: 'no', border: '0', frameborder: 'no', framespacing: '0',
							allowfullscreen: 'true',
							allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
						},
					});
					if (height) iframe.style.height = height;
					codeEl.replaceWith(wrapper);
					replaced = true;
				}
			}

			if (!replaced) {
				const artMatch = text.match(/^ArtPlayer:(.+?)(?::(.+))?$/);
				if (artMatch) {
					const url = artMatch[1];
					const height = artMatch[2];
					const wrapper = document.createElement('div');
					wrapper.className = 'sillot-video-embed';
					const video = wrapper.createEl('video', {
						cls: 'sillot-artplayer-video',
						attr: { src: url, controls: '', preload: 'metadata' },
					});
					if (height) video.style.height = height;
					codeEl.replaceWith(wrapper);
					replaced = true;
				}
			}
		}
	}

	private processVideoEmbeds(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && node.textContent.includes('@[bilibili]')) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /@\[bilibili\]\(([^)]+)\)/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const bvid = match[1];
				const wrapper = document.createElement('div');
				wrapper.className = 'sillot-video-embed';
				const iframe = wrapper.createEl('iframe', {
					attr: {
						src: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1`,
						scrolling: 'no', border: '0', frameborder: 'no', framespacing: '0',
						allowfullscreen: 'true',
					},
				});
				iframe.style.width = '100%';
				iframe.style.aspectRatio = '16/9';
				iframe.style.borderRadius = '6px';
				fragment.appendChild(wrapper);

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

	private switchVideoTab(
		tabs: Array<{ label: string; el: HTMLElement }>,
		activeLabel: string,
		nav: HTMLElement,
		contentDiv: HTMLElement
	) {
		const btns = nav.querySelectorAll('.sillot-video-tab-btn');
		btns.forEach(btn => btn.classList.remove('sillot-video-tab-btn--active'));
		const panes = contentDiv.querySelectorAll('.sillot-video-tab-pane');
		panes.forEach(pane => pane.classList.remove('sillot-video-tab-pane--active'));

		for (let i = 0; i < tabs.length; i++) {
			if (tabs[i].label === activeLabel) {
				tabs[i].el.classList.add('sillot-video-tab-pane--active');
				btns[i]?.classList.add('sillot-video-tab-btn--active');
				break;
			}
		}
	}
}
