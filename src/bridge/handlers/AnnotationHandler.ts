import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

const PH_L = '\u200B\u200B\u200B';
const PH_R = '\u200C\u200C\u200C';
const PH_DETECT = /[\u200B]{3}([^\u200B\u200C]+)[\u200C]{3}/;
const PH_SPLIT = /([\u200B]{3}[^\u200B\u200C]+[\u200C]{3})/g;
const INLINE_REGEX = /\[\+([^\]]+)\]/g;

export class AnnotationHandler extends BaseSyntaxHandler {
	private static readonly DEF_START_REGEX = /^\[\+\s*([^\]]+)\s*\]:\s*$/;
	private static readonly DEF_INLINE_REGEX = /^\[\+\s*([^\]]+)\s*\]:\s*(.+)$/;
	private static readonly INDENT_REGEX = /^(\s{2,}|\t)(.+)$/;

	private static annotationMap: Map<string, string[]> = new Map();
	private static deferredTimer: ReturnType<typeof setTimeout> | null = null;

	static invalidateFileScan(_path: string): void {}
	static clearAllScans(): void {}
	static isFileScanned(_path: string): boolean { return true; }
	static preScanDefinitions(_text: string, _filePath: string): void {}

	async processInlineComponents(el: HTMLElement): Promise<void> {
		if (!el.innerHTML.includes(PH_L) && !el.innerHTML.includes(PH_R)) {
			return;
		}
		this.processAnnotationPlaceholders(el);
		this.scheduleDeferredProcessing(el);
	}

	preprocessMarkdown(text: string): string {
		return this.collectAndReplace(text);
	}

	private collectAndReplace(text: string): string {
		if (!INLINE_REGEX.test(text) && !AnnotationHandler.DEF_START_REGEX.test(text) && !AnnotationHandler.DEF_INLINE_REGEX.test(text)) {
			return text;
		}
		INLINE_REGEX.lastIndex = 0;

		const codeBlocks: string[] = [];
		let protectedText = text;

		protectedText = protectedText.replace(/```[\s\S]*?```/g, (match) => {
			codeBlocks.push(match);
			return `\x00CB${codeBlocks.length - 1}\x00`;
		});
		protectedText = protectedText.replace(/`[^`]+`/g, (match) => {
			codeBlocks.push(match);
			return `\x00CB${codeBlocks.length - 1}\x00`;
		});

		const lines = protectedText.split('\n');
		const processedLines: string[] = [];
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];

			if (/^\x00CB\d+\x00$/.test(line.trim())) {
				processedLines.push(line);
				i++;
				continue;
			}

			const inlineMatch = line.match(AnnotationHandler.DEF_INLINE_REGEX);
			if (inlineMatch) {
				AnnotationHandler.addAnnotation(inlineMatch[1].trim(), inlineMatch[2].trim());
				processedLines.push('');
				i++;
				continue;
			}

			const multiLineMatch = line.match(AnnotationHandler.DEF_START_REGEX);
			if (multiLineMatch) {
				const label = multiLineMatch[1].trim();
				const contentLines: string[] = [];
				i++;
				while (i < lines.length) {
					const indentMatch = lines[i].match(AnnotationHandler.INDENT_REGEX);
					if (indentMatch) {
						contentLines.push(indentMatch[2]);
						i++;
					} else if (lines[i].trim() === '' && i + 1 < lines.length && AnnotationHandler.INDENT_REGEX.test(lines[i + 1])) {
						i++;
					} else {
						break;
					}
				}
				if (contentLines.length > 0) {
					AnnotationHandler.addAnnotation(label, contentLines.join('\n'));
				}
				processedLines.push('');
				continue;
			}

			processedLines.push(line);
			i++;
		}

		let result = processedLines.join('\n');

		result = result.replace(INLINE_REGEX, (_match, label: string) => {
			return `${PH_L}${label.trim()}${PH_R}`;
		});

		result = result.replace(/\x00CB(\d+)\x00/g, (_match, indexStr) => {
			return codeBlocks[parseInt(indexStr)];
		});

		return result;
	}

	private processAnnotationPlaceholders(root: HTMLElement): void {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node: Text) => {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.closest('code, pre, .code-block, .sillot-annotation')) {
					return NodeFilter.FILTER_REJECT;
				}
				const content = node.textContent || '';
				if (!PH_DETECT.test(content)) {
					PH_DETECT.lastIndex = 0;
					return NodeFilter.FILTER_SKIP;
				}
				PH_DETECT.lastIndex = 0;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const textNodes: Text[] = [];
		let node: Node | null;
		while ((node = walker.nextNode())) {
			textNodes.push(node as Text);
		}

		for (const textNode of textNodes) {
			this.replacePlaceholdersInTextNode(textNode);
		}
	}

	private replacePlaceholdersInTextNode(textNode: Text): void {
		const text = textNode.textContent || '';
		const parts = text.split(PH_SPLIT);

		if (parts.length <= 1) return;

		const parent = textNode.parentNode;
		if (!parent) return;

		const fragment = document.createDocumentFragment();

		for (const part of parts) {
			const match = part.match(PH_DETECT);
			if (match) {
				const label = match[1].trim();
				const definitions = AnnotationHandler.annotationMap.get(label);

				if (definitions && definitions.length > 0) {
					const span = document.createElement('span');
					span.className = 'sillot-annotation sillot-annotation--interactive';
					this.createInteractiveAnnotation(span, label, definitions);
					fragment.appendChild(span);
				} else {
					const span = document.createElement('span');
					span.className = 'sillot-annotation sillot-annotation--pending';
					span.dataset.label = label;
					span.textContent = `[+${label}]`;
					fragment.appendChild(span);
				}
			} else if (part) {
				fragment.appendChild(document.createTextNode(part));
			}
		}

		parent.replaceChild(fragment, textNode);
	}

	private scheduleDeferredProcessing(el: HTMLElement): void {
		if (AnnotationHandler.deferredTimer) {
			clearTimeout(AnnotationHandler.deferredTimer);
		}
		AnnotationHandler.deferredTimer = setTimeout(() => {
			AnnotationHandler.deferredTimer = null;
			this.processDeferredAnnotations(el);
		}, 100);
	}

	private processDeferredAnnotations(root: HTMLElement): void {
		const pending = root.querySelectorAll<HTMLElement>('.sillot-annotation--pending');
		if (pending.length === 0) return;

		pending.forEach(span => {
			if (span.closest('code, pre, .code-block')) {
				const textNode = document.createTextNode(span.textContent || '');
				span.parentNode?.replaceChild(textNode, span);
				return;
			}

			const label = span.dataset.label || '';
			const definitions = AnnotationHandler.annotationMap.get(label);
			if (!definitions || definitions.length === 0) return;

			this.createInteractiveAnnotation(span, label, definitions);
		});
	}

	private createInteractiveAnnotation(
		container: HTMLElement,
		label: string,
		definitions: string[]
	): void {
		container.className = 'sillot-annotation sillot-annotation--interactive';
		container.innerHTML = '';
		container.dataset.label = label;

		const trigger = document.createElement('span');
		trigger.className = 'sillot-annotation__trigger';
		trigger.textContent = `[+${label}]`;

		const popup = document.createElement('div');
		popup.className = 'sillot-annotation__popup';

		if (definitions.length === 1) {
			popup.innerHTML = this.renderMarkdownContent(definitions[0]);
		} else {
			const list = document.createElement('ul');
			list.className = 'sillot-annotation__list';

			definitions.forEach(def => {
				const item = document.createElement('li');
				item.className = 'sillot-annotation__item';
				item.innerHTML = this.renderMarkdownContent(def);
				list.appendChild(item);
			});

			popup.appendChild(list);
		}

		container.appendChild(trigger);
		container.appendChild(popup);

		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();

			const isOpen = container.classList.toggle('sillot-annotation--open');

			if (isOpen) {
				document.querySelectorAll('.sillot-annotation--open').forEach(el => {
					if (el !== container) {
						el.classList.remove('sillot-annotation--open');
					}
				});
			}
		});

		document.addEventListener('click', () => {
			container.classList.remove('sillot-annotation--open');
		});
	}

	private static addAnnotation(label: string, content: string): void {
		const existing = AnnotationHandler.annotationMap.get(label) || [];
		if (!existing.includes(content)) {
			existing.push(content);
			AnnotationHandler.annotationMap.set(label, existing);
		}
	}

	private renderMarkdownContent(content: string): string {
		let html = content;
		html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
		html = html.replace(/`(.+?)`/g, '<code>$1</code>');
		html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
		return html.replace(/\n/g, '<br>');
	}

	dispose(): void {
		if (AnnotationHandler.deferredTimer) {
			clearTimeout(AnnotationHandler.deferredTimer);
			AnnotationHandler.deferredTimer = null;
		}
		AnnotationHandler.annotationMap.clear();
	}
}
