import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

interface ParsedImageInfo {
	alt: string;
	url: string;
	width?: string;
	height?: string;
	isPercentage?: boolean;
}

interface FigureItem {
	type: 'text' | 'image';
	alt?: string;
	url?: string;
	content?: string;
	width?: string;
	height?: string;
	isPercentage?: boolean;
}

export class ImageEnhanceHandler extends BaseSyntaxHandler {
	private static readonly FIGURE_REGEX = /!\[([^\]]*)\]\(([^)]+?)\s*(=\S*?)?\)/g;
	private static readonly SIZE_REGEX = /^=(\d*)(x)?(\d*)%?$/;

	processInlineComponents(el: HTMLElement): void {
		this.processAllImages(el);
	}

	private processAllImages(el: HTMLElement): void {
		this.processParagraphImages(el);
		this.processStandaloneImages(el);
		this.processContainerImages(el);
	}

	private processParagraphImages(el: HTMLElement): void {
		const paragraphs = el.querySelectorAll('p');
		paragraphs.forEach(p => {
			const text = p.textContent || '';
			if (!ImageEnhanceHandler.FIGURE_REGEX.test(text)) return;

			const html = p.innerHTML;
			if (!this.containsImageSyntax(html)) return;

			this.convertToFigure(p);
		});
	}

	private containsImageSyntax(html: string): boolean {
		return /!\[/.test(html);
	}

	private processStandaloneImages(el: HTMLElement): void {
		const standaloneImages = el.querySelectorAll<HTMLImageElement>(':scope > img, :scope > a > img');
		standaloneImages.forEach(img => {
			if (img.parentElement?.tagName === 'P') return;
			if (img.parentElement?.tagName === 'A' && img.parentElement.parentElement?.tagName === 'P') return;
			if (img.closest('figure')) return;

			this.enhanceSingleImage(img);
		});
	}

	private processContainerImages(el: HTMLElement): void {
		const containers = ['li', 'blockquote', 'td', 'th', 'details', 'summary'];

		containers.forEach(tag => {
			const elements = el.querySelectorAll<HTMLImageElement>(`${tag} img`);
			elements.forEach(img => {
				if (img.closest('figure')) return;
				if (img.parentElement?.tagName === 'FIGURE') return;

				this.enhanceSingleImage(img);
			});
		});
	}

	private convertToFigure(paragraph: HTMLElement): void {
		const originalHTML = paragraph.innerHTML;
		const figures: FigureItem[] = [];
		let lastIndex = 0;

		const regex = new RegExp(ImageEnhanceHandler.FIGURE_REGEX.source, 'g');
		let match: RegExpExecArray | null;

		while ((match = regex.exec(originalHTML)) !== null) {
			const [, alt, url, sizeStr] = match;

			if (match.index > lastIndex) {
				const beforeText = originalHTML.slice(lastIndex, match.index).trim();
				if (beforeText) {
					figures.push({ type: 'text', content: beforeText });
				}
			}

			const sizeInfo = this.parseSize(sizeStr);
			figures.push({
				type: 'image',
				alt,
				url,
				...sizeInfo,
			});

			lastIndex = regex.lastIndex;
		}

		if (lastIndex < originalHTML.length) {
			const afterText = originalHTML.slice(lastIndex).trim();
			if (afterText && !/^<br\s*\/?>$/i.test(afterText)) {
				figures.push({ type: 'text', content: afterText });
			}
		}

		if (figures.length === 0) return;

		paragraph.empty();

		figures.forEach(item => {
			if (item.type === 'text') {
				const textEl = document.createElement('span');
				textEl.innerHTML = item.content || '';
				paragraph.appendChild(textEl);
			} else if (item.type === 'image') {
				const figure = this.createFigureElement(item as ParsedImageInfo & { type: string });
				paragraph.appendChild(figure);
			}
		});

		if (paragraph.children.length === 1 && paragraph.firstElementChild?.tagName === 'FIGURE') {
			paragraph.replaceWith(paragraph.firstElementChild);
		}
	}

	private parseSize(sizeStr?: string): { width?: string; height?: string; isPercentage?: boolean } {
		if (!sizeStr) return {};

		const cleanSize = sizeStr.trim().replace(/^=/, '');
		const match = cleanSize.match(ImageEnhanceHandler.SIZE_REGEX);

		if (!match) return {};

		const [, widthStr, , heightStr] = match;
		const isPercentage = cleanSize.endsWith('%');

		return {
			width: widthStr ? `${widthStr}${isPercentage ? '%' : 'px'}` : undefined,
			height: heightStr ? `${heightStr}px` : undefined,
			isPercentage,
		};
	}

	private createFigureElement(info: ParsedImageInfo & { type: string }): HTMLElement {
		const figure = document.createElement('figure');
		figure.className = 'sillot-figure';

		const img = document.createElement('img');
		img.src = info.url;
		img.alt = info.alt;
		img.setAttribute('loading', 'lazy');

		if (info.width) {
			img.style.width = info.width;
		}
		if (info.height) {
			img.style.height = info.height;
		}
		if (info.isPercentage) {
			figure.classList.add('sillot-figure--responsive');
		}

		figure.appendChild(img);

		if (info.alt && info.alt.trim()) {
			const figcaption = document.createElement('figcaption');
			figcaption.className = 'sillot-figure__caption';
			figcaption.textContent = info.alt;
			figure.appendChild(figcaption);
		}

		return figure;
	}

	private enhanceSingleImage(img: HTMLImageElement): void {
		const parent = img.parentElement;
		if (!parent) return;

		const alt = img.getAttribute('alt') || '';

		const figure = document.createElement('figure');
		figure.className = 'sillot-figure sillot-figure--standalone';

		const newImg = img.cloneNode(true) as HTMLImageElement;
		newImg.setAttribute('loading', 'lazy');

		const existingWidth = img.getAttribute('width');
		const existingHeight = img.getAttribute('height');

		if (existingWidth) {
			newImg.style.width = typeof existingWidth === 'string' && existingWidth.endsWith('%')
				? existingWidth
				: `${existingWidth}px`;
		}
		if (existingHeight) {
			newImg.style.height = `${existingHeight}px`;
		}

		figure.appendChild(newImg);

		if (alt && alt.trim()) {
			const figcaption = document.createElement('figcaption');
			figcaption.className = 'sillot-figure__caption';
			figcaption.textContent = alt;
			figure.appendChild(figcaption);
		}

		parent.replaceChild(figure, img);
	}
}
