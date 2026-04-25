import { MarkdownRenderer } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

const TAG = 'CardHandler';

interface CardAttrs {
	title: string;
	icon: string;
}

export class CardHandler extends BaseSyntaxHandler {
	static readonly CARD_TYPES = new Set(['card', 'card-grid']);

	async buildContainer(
		containerType: string,
		title: string,
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement | null> {
		this.plugin.logger?.debug(TAG, `buildContainer type=${containerType}, title="${title}", contentLen=${contentText.length}`);

		if (containerType === 'card') {
			const attrs = this.parseCardAttrs(title);
			this.plugin.logger?.debug(TAG, `card attrs: title="${attrs.title}", icon="${attrs.icon}"`);
			return this.buildCard(attrs, contentText, ctx);
		}
		if (containerType === 'card-grid') {
			return this.buildCardGrid(contentText, ctx);
		}
		return null;
	}

	private parseCardAttrs(titleLine: string): CardAttrs {
		const attrs: CardAttrs = { title: '', icon: '' };
		if (!titleLine) return attrs;

		const titleMatch = titleLine.match(/title="([^"]*)"/);
		if (titleMatch) {
			attrs.title = titleMatch[1];
		}

		const iconMatch = titleLine.match(/icon="([^"]*)"/);
		if (iconMatch) {
			attrs.icon = iconMatch[1];
		}

		return attrs;
	}

	private async buildCard(
		attrs: CardAttrs,
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const card = document.createElement('div');
		card.className = 'vp-card';

		if (attrs.title || attrs.icon) {
			const header = card.createDiv({ cls: 'vp-card-header' });

			if (attrs.icon) {
				const iconEl = header.createDiv({ cls: 'vp-card-icon' });
				await this.renderIcon(iconEl, attrs.icon);
			}

			if (attrs.title) {
				header.createEl('p', { text: attrs.title, cls: 'vp-card-title' });
			}
		}

		const content = card.createDiv({ cls: 'vp-card-content' });
		if (contentText.trim()) {
			await MarkdownRenderer.render(
				this.plugin.app, contentText, content, ctx.sourcePath, this.plugin
			);
		}

		return card;
	}

	private async buildCardGrid(
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const grid = document.createElement('div');
		grid.className = 'vp-card-grid';

		this.plugin.logger?.debug(TAG, `card-grid raw content:\n${contentText}`);

		const cards = this.parseNestedCards(contentText);
		this.plugin.logger?.debug(TAG, `card-grid parsed ${cards.length} cards`);

		for (const cardData of cards) {
			this.plugin.logger?.debug(TAG, `  card: title="${cardData.attrs.title}", icon="${cardData.attrs.icon}", contentLen=${cardData.content.length}`);
			const card = await this.buildCard(cardData.attrs, cardData.content, ctx);
			grid.appendChild(card);
		}

		if (cards.length === 0 && contentText.trim()) {
			this.plugin.logger?.debug(TAG, 'card-grid: no cards parsed, using fallback render');
			const fallback = grid.createDiv({ cls: 'vp-card-grid-fallback' });
			await MarkdownRenderer.render(
				this.plugin.app, contentText, fallback, ctx.sourcePath, this.plugin
			);
		}

		return grid;
	}

	private parseNestedCards(text: string): { attrs: CardAttrs; content: string }[] {
		const cards: { attrs: CardAttrs; content: string }[] = [];
		const lines = text.split('\n');
		let currentAttrs: CardAttrs | null = null;
		let currentLines: string[] = [];
		let depth = 0;

		const flushCard = () => {
			if (currentAttrs) {
				cards.push({
					attrs: currentAttrs,
					content: currentLines.join('\n').trim(),
				});
			}
			currentAttrs = null;
			currentLines = [];
		};

		for (const line of lines) {
			const trimmed = line.trim();
			const cardOpenMatch = trimmed.match(/^:{3,}\s*card(?:\s+(.*))?$/);
			const closeMatch = trimmed.match(/^:{3,}\s*$/);

			if (cardOpenMatch && depth === 0) {
				flushCard();
				currentAttrs = this.parseCardAttrs(cardOpenMatch[1] || '');
				depth = 1;
				continue;
			}

			if (closeMatch && depth > 0) {
				depth--;
				if (depth === 0) {
					continue;
				}
			}

			if (depth > 0) {
				const innerOpen = trimmed.match(/^:{3,}\s*\w/);
				if (innerOpen) {
					depth++;
				}
				currentLines.push(line);
			} else {
				currentLines.push(line);
			}
		}

		flushCard();
		return cards;
	}

	private async renderIcon(container: HTMLElement, icon: string): Promise<void> {
		const isUrl = /^(https?:\/\/|\/)/.test(icon);

		if (isUrl) {
			const img = container.createEl('img', {
				cls: 'vp-card-icon-img',
				attr: { src: icon, alt: 'card icon', loading: 'lazy' },
			});
			img.onerror = () => {
				img.remove();
				container.createEl('span', { text: '📌', cls: 'vp-card-icon-fallback' });
			};
			return;
		}

		if (icon.includes(':')) {
			const [prefix, name] = icon.split(':');
			if (prefix && name) {
				const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg`;
				try {
					const resp = await fetch(svgUrl);
					if (resp.ok) {
						const svgText = await resp.text();
						if (svgText.startsWith('<svg')) {
							container.innerHTML = svgText;
							const svg = container.querySelector('svg');
							if (svg) {
								svg.classList.add('vp-card-icon-svg');
								svg.setAttribute('width', '1.2em');
								svg.setAttribute('height', '1.2em');
							}
							return;
						}
					}
				} catch {
					// 网络不可用时回退
				}
			}
		}

		container.createEl('span', { text: icon, cls: 'vp-card-icon-text' });
	}
}
