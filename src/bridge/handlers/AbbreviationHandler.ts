import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

export class AbbreviationHandler extends BaseSyntaxHandler {
	private static readonly ABBR_DEF_REGEX = /^\*\[([^\]]+)\]:\s*(.+)$/;
	private static readonly PLACEHOLDER_CLASS = 'sillot-abbr-def';

	private abbreviationMap: Map<string, string> = new Map();

	async processInlineComponents(el: HTMLElement): Promise<void> {
		this.processAbbreviationsInDOM(el);
	}

	preprocessMarkdown(text: string): string {
		return this.collectAndReplaceAbbreviations(text);
	}

	/**
	 * 收集缩写词定义并替换为占位符
	 * 定义语法：*[HTML]: Hyper Text Markup Language
	 */
	private collectAndReplaceAbbreviations(text: string): string {
		const lines = text.split('\n');
		const processedLines: string[] = [];

		for (const line of lines) {
			const match = line.match(AbbreviationHandler.ABBR_DEF_REGEX);

			if (match) {
				const abbr = match[1].trim();
				const definition = match[2].trim();
				this.abbreviationMap.set(abbr, definition);
				processedLines.push('');
			} else {
				processedLines.push(line);
			}
		}

		return processedLines.join('\n');
	}

	/**
	 * 在 DOM 中处理缩写词替换
	 * 遍历文本节点，将匹配的缩写词替换为 <abbr> 元素
	 */
	private processAbbreviationsInDOM(el: HTMLElement): void {
		if (this.abbreviationMap.size === 0) return;

		const walker = document.createTreeWalker(
			el,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: (node) => {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					const tag = parent.tagName;
					if (['ABBR', 'CODE', 'PRE', 'SCRIPT', 'STYLE'].includes(tag)) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_ACCEPT;
				}
			}
		);

		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			textNodes.push(walker.currentNode as Text);
		}

		textNodes.forEach(textNode => {
			this.replaceAbbreviationsInTextNode(textNode);
		});
	}

	/**
	 * 在单个文本节点中替换缩写词
	 */
	private replaceAbbreviationsInTextNode(textNode: Text): void {
		const text = textNode.textContent || '';
		if (!text.trim()) return;

		let modified = false;
		const parts: (string | HTMLElement)[] = [];
		let lastIndex = 0;

		const sortedAbbrs = Array.from(this.abbreviationMap.entries())
			.sort((a, b) => b[0].length - a[0].length);

		for (const [abbr, definition] of sortedAbbrs) {
			const regex = new RegExp(`(?<![\\w])${this.escapeRegex(abbr)}(?![\\w])`, 'g');
			let match;

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					parts.push(text.slice(lastIndex, match.index));
				}

				const abbrEl = this.createAbbrElement(abbr, definition);
				parts.push(abbrEl);
				lastIndex = match.index + abbr.length;
				modified = true;
			}
		}

		if (modified && lastIndex < text.length) {
			parts.push(text.slice(lastIndex));
		}

		if (modified) {
			const fragment = document.createDocumentFragment();
			parts.forEach(part => {
				if (typeof part === 'string') {
					fragment.appendChild(document.createTextNode(part));
				} else {
					fragment.appendChild(part);
				}
			});
			textNode.parentNode?.replaceChild(fragment, textNode);
		}
	}

	/**
	 * 创建 <abbr> 元素
	 */
	private createAbbrElement(text: string, title: string): HTMLElement {
		const abbr = document.createElement('abbr');
		abbr.className = 'sillot-abbr';
		abbr.textContent = text;
		abbr.title = title;
		return abbr;
	}

	/**
	 * 转义正则表达式特殊字符
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	dispose(): void {
		this.abbreviationMap.clear();
	}
}