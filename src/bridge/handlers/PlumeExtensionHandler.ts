import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';
import { MarkdownRenderer } from 'obsidian';
import { FN_PH_DETECT, FN_PH_PREFIX, FN_PH_SUFFIX } from '../constants';

const SUPERSCRIPT_REGEX = /\^(.+?)\^/g;
const SUBSCRIPT_REGEX = /~(.+?)~/g;
const TOC_TEXT_REGEX = /\[\[TOC\]\]/i;
const HEADING_ANCHOR_REGEX = /\s*\{#([^}]+)\}\s*$/;

const FN_REF_REGEX = /\[\^(\S+?)\]/g;
const FN_REF_ESCAPED_REGEX = /\\\[\^(\S+?)\]/g;
const FN_DEF_LINE_REGEX = /^\s*\\?\[\^(\S+?)\]:\s*(.*)$/;
const FN_DEF_START_REGEX = /^\s*\\?\[\^(\S+?)\]:\s*$/;

const FN_DEF_PH_PREFIX = '<!--VP_FN_DEF:';
const FN_DEF_PH_SUFFIX = '-->';
const FN_DEF_PH_DETECT = /<!--VP_FN_DEF:(.+?)-->/g;

const ALIGN_CONTAINER_TYPES = new Set(['left', 'center', 'right']);

export class PlumeExtensionHandler extends BaseSyntaxHandler {
	public static readonly ALIGN_TYPES = ALIGN_CONTAINER_TYPES;

	private static deferredTimer: ReturnType<typeof setTimeout> | null = null;

	// 按文档路径存储脚注定义
	private static docFootnoteDefs = new Map<string, Map<string, string>>();

	static setCurrentDocument(sourcePath: string): void {
		// 切换文档时清理旧状态
	}

	/** 获取当前文档的脚注定义 */
	static getFootnoteDefs(sourcePath: string): Map<string, string> {
		return PlumeExtensionHandler.docFootnoteDefs.get(sourcePath) || new Map();
	}

	processInlineComponents(el: HTMLElement): void {
		this.processSuperscript(el);
		this.processSubscript(el);
		this.processTOC(el);
		this.processHeadingAnchors(el);

		// 转换脚注占位符为引用，并追加脚注区块
		this.convertObsidianFootnotes(el);
		
		this.enhanceTaskLists(el);
	}

	preprocessMarkdown(text: string, sourcePath: string): string {
		let processed = text;
		processed = this.preprocessFootnotes(processed, sourcePath);
		processed = this.preprocessSuperscript(processed);
		processed = this.preprocessSubscript(processed);
		return processed;
	}

	getSupportedContainerTypes(): Set<string> {
		return PlumeExtensionHandler.ALIGN_TYPES;
	}

	async buildAlignContainer(
		alignType: string,
		contentText: string,
		ctx: import('obsidian').MarkdownPostProcessorContext
	): Promise<HTMLElement | null> {
		if (!PlumeExtensionHandler.ALIGN_TYPES.has(alignType)) return null;

		const container = document.createElement('div');
		container.className = `vp-align vp-align--${alignType}`;

		const contentDiv = container.createDiv({ cls: 'vp-align-content' });
		if (contentText.trim()) {
			await MarkdownRenderer.render(
				this.plugin.app, contentText, contentDiv, ctx.sourcePath, this.plugin
			);
		}

		return container;
	 }

	hasPlumeExtension(text: string): boolean {
		if (TOC_TEXT_REGEX.test(text)) return true;
		if (this.hasPatternOutsideCode(text, SUPERSCRIPT_REGEX)) return true;
		if (this.hasPatternOutsideCode(text, SUBSCRIPT_REGEX)) return true;
		if (this.hasPatternOutsideCode(text, FN_REF_REGEX)) return true;
		if (this.hasPatternOutsideCode(text, FN_REF_ESCAPED_REGEX)) return true;
		if (FN_DEF_START_REGEX.test(text)) return true;
		if (HEADING_ANCHOR_REGEX.test(text)) return true;
		return false;
	}

	private hasPatternOutsideCode(text: string, pattern: RegExp): boolean {
		pattern.lastIndex = 0;
		let cleaned = text;
		cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
		cleaned = cleaned.replace(/`[^`\n]+`/g, '');
		pattern.lastIndex = 0;
		return pattern.test(cleaned);
	}

	/* ================================================================
	   脚注预处理 — 收集定义编码为 HTML 注释，替换引用为占位符
	   ================================================================ */

	private preprocessFootnotes(text: string, sourcePath: string): string {
		FN_REF_REGEX.lastIndex = 0;
		FN_REF_ESCAPED_REGEX.lastIndex = 0;
		const hasNormalRef = FN_REF_REGEX.test(text);
		FN_REF_REGEX.lastIndex = 0;
		const hasEscapedRef = FN_REF_ESCAPED_REGEX.test(text);
		FN_REF_ESCAPED_REGEX.lastIndex = 0;
		
		if (!hasNormalRef && !hasEscapedRef && !FN_DEF_START_REGEX.test(text) && !FN_DEF_LINE_REGEX.test(text)) {
			return text;
		}

		let processed = text;
		const lines = processed.split('\n');
		const filteredLines: string[] = [];
		const defOrder: string[] = [];
		const defMap = new Map<string, string>();
		
		for (const line of lines) {
			const defMatch = line.match(FN_DEF_LINE_REGEX);
			if (defMatch) {
				const id = defMatch[1];
				const defContent = defMatch[2].trim();
				if (defContent) {
					defOrder.push(id);
					defMap.set(id, defContent);
				}
			} else {
				filteredLines.push(line);
			}
		}
		
		// 存储到静态 Map，按文档路径隔离
		PlumeExtensionHandler.docFootnoteDefs.set(sourcePath, new Map(defMap));
		
		processed = filteredLines.join('\n');

		FN_REF_REGEX.lastIndex = 0;
		processed = processed.replace(FN_REF_REGEX, (_match, id) => {
			return `${FN_PH_PREFIX}${id}${FN_PH_SUFFIX}`;
		});

		FN_REF_ESCAPED_REGEX.lastIndex = 0;
		processed = processed.replace(FN_REF_ESCAPED_REGEX, '[^$1]');

		if (defOrder.length > 0) {
			const encoded = JSON.stringify({ order: defOrder, map: Object.fromEntries(defMap) });
			processed = processed + '\n' + FN_DEF_PH_PREFIX + encoded + FN_DEF_PH_SUFFIX;
		}

		return processed;
	}

	/* ================================================================
	   上角标 ^text^ — 双保险：预处理 <sup> + 后处理兜底
	   ================================================================ */

	private processSuperscript(el: HTMLElement): void {
		this.replaceTextNodes(el, SUPERSCRIPT_REGEX, (content) => {
			const sup = document.createElement('sup');
			sup.className = 'vp-sup';
			sup.textContent = content;
			return sup;
		}, ['SUP', 'PRE', 'CODE']);
	}

	private preprocessSuperscript(text: string): string {
		return text.replace(SUPERSCRIPT_REGEX,
			(_match, content) => `<sup class="vp-sup">${this.escapeHtml(content)}</sup>`
		);
	}

	/* ================================================================
	   下角标 ~text~
	   ================================================================ */

	private processSubscript(el: HTMLElement): void {
		this.replaceTextNodes(el, SUBSCRIPT_REGEX, (content) => {
			const sub = document.createElement('sub');
			sub.className = 'vp-sub';
			sub.textContent = content;
			return sub;
		}, ['SUB', 'PRE', 'CODE']);
	}

	private preprocessSubscript(text: string): string {
		return text.replace(SUBSCRIPT_REGEX,
			(_match, content) => `<sub class="vp-sub">${this.escapeHtml(content)}</sub>`
		);
	}

	/* ================================================================
	   目录表 [[TOC]] — 纯后处理，多策略匹配
	   
	   Obsidian 对 [[TOC]] 可能有多种渲染结果：
	   - 纯文本节点 [[TOC]]
	   - 损坏的 wikilink <a internal-link>
	   - 代码块内的 [[TOC]]（应跳过）
	   
	   策略：先检测当前段落的文本内容是否含 [[TOC]]，
	   若有则整体替换该段落为 TOC DOM。
	   ================================================================ */

	private processTOC(el: HTMLElement): void {
		// 跳过代码块容器
		if (el.closest('pre, code, .code-block, .sillot-code-enhanced')) return;

		// 策略 1：检测文本节点中的 [[TOC]]
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.closest('pre, code, .code-block, .sillot-code-enhanced')) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const tocTextNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (TOC_TEXT_REGEX.test(node.textContent || '')) {
				tocTextNodes.push(node);
			}
		}

		tocTextNodes.forEach(textNode => {
			const placeholder = document.createElement('div');
			placeholder.className = 'vp-toc-placeholder';
			textNode.parentNode?.replaceChild(placeholder, textNode);
			this.fillTOC(placeholder, el);
		});

		// 策略 2：处理损坏的 wikilink
		el.querySelectorAll<HTMLAnchorElement>('a.internal-link[href*="TOC" i]').forEach(link => {
			if (link.closest('pre, code, .code-block, .sillot-code-enhanced')) return;
			const placeholder = document.createElement('div');
			placeholder.className = 'vp-toc-placeholder';
			link.parentNode?.replaceChild(placeholder, link);
			this.fillTOC(placeholder, el);
		});
	}

	private fillTOC(tocEl: HTMLElement, rootEl: HTMLElement): void {
		tocEl.dataset.vpProcessed = 'true';

		const viewRoot = rootEl.closest('.markdown-preview-view')
			|| rootEl.closest('.markdown-rendered')
			|| rootEl.closest('.markdown-source-view')
			|| rootEl.closest('.view-content')
			|| rootEl.closest('.workspace-leaf-content')
			|| this.findAncestorWithHeadings(rootEl);

		if (!viewRoot) {
			tocEl.innerHTML = '<em class="vp-toc-error">TOC 仅在阅读视图中可用</em>';
			return;
		}

		const headings = viewRoot.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
		if (headings.length === 0) {
			tocEl.innerHTML = '<em class="vp-toc-empty">无标题</em>';
			return;
		}

		tocEl.appendChild(this.buildTOC(Array.from(headings)));
	}

	private findAncestorWithHeadings(el: HTMLElement): HTMLElement | null {
		let ancestor = el.parentElement;
		while (ancestor) {
			if (ancestor.querySelector('h1, h2, h3, h4, h5, h6')) {
				return ancestor;
			}
			ancestor = ancestor.parentElement;
		}
		return null;
	}

	private buildTOC(headings: HTMLElement[]): HTMLUListElement {
		const root = document.createElement('ul');
		root.className = 'vp-toc-list';

		const stack: { list: HTMLUListElement; level: number }[] = [{ list: root, level: 0 }];
		let prevLevel = 0;

		headings.forEach((heading) => {
			const level = parseInt(heading.tagName.charAt(1), 10);
			const id = heading.id || this.slugify(heading.textContent || '');
			const text = this.getHeadingTextWithoutAnchor(heading);

			while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();

			let currentList = stack[stack.length - 1].list;

			if (level > prevLevel && stack[stack.length - 1].level < level) {
				const nested = document.createElement('ul');
				nested.className = 'vp-toc-nested';
				const lastLi = currentList.lastElementChild;
				if (lastLi) lastLi.appendChild(nested);
				stack.push({ list: nested, level });
				currentList = nested;
			} else if (level < prevLevel) {
				currentList = stack[stack.length - 1].list;
			}

			const li = document.createElement('li');
			li.className = `vp-toc-item vp-toc-level-${level}`;

			const a = document.createElement('a');
			a.className = 'vp-toc-link';
			a.href = `#${id}`;
			a.textContent = text;
			a.addEventListener('click', (e) => {
				e.preventDefault();
				document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			});

			li.appendChild(a);
			currentList.appendChild(li);
			prevLevel = level;
		});

		return root;
	}

	private getHeadingTextWithoutAnchor(heading: HTMLElement): string {
		const anchor = heading.querySelector(':scope > .vp-heading-anchor');
		if (anchor) {
			anchor.remove();
			const t = heading.textContent?.trim() || '';
			heading.appendChild(anchor);
			return t;
		}
		return heading.textContent?.trim() || '';
	}

	/* ================================================================
	   标题锚点 {#anchor-id}
	   ================================================================ */

	private processHeadingAnchors(el: HTMLElement): void {
		el.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach(heading => {
			if (heading.dataset.vpAnchored === 'true') return;

			const rawText = this.collectHeadingRawText(heading);
			const m = rawText.match(HEADING_ANCHOR_REGEX);

			if (m) {
				const anchorId = m[1];
				heading.id = anchorId;
				heading.dataset.vpAnchored = 'true';
				this.stripAnchorText(heading);

				const a = document.createElement('a');
				a.className = 'vp-heading-anchor';
				a.href = `#${anchorId}`;
				a.setAttribute('aria-hidden', 'true');
				a.textContent = '#';
				heading.appendChild(a);
			} else if (!heading.id) {
				heading.id = this.slugify(heading.textContent || '');
			}
		});
	}

	private collectHeadingRawText(heading: HTMLElement): string {
		let s = '';
		for (const c of Array.from(heading.childNodes)) {
			if (c.nodeType === Node.TEXT_NODE) s += c.textContent || '';
			else if ((c as HTMLElement).classList?.contains('vp-heading-anchor')) continue;
			else s += c.textContent || '';
		}
		return s.trim();
	}

	private stripAnchorText(heading: HTMLElement): void {
		Array.from(heading.childNodes).forEach(c => {
			if (c.nodeType === Node.TEXT_NODE) {
				c.textContent = (c.textContent || '').replace(HEADING_ANCHOR_REGEX, '').trimEnd();
			}
		});
	}

	/* ================================================================
	   脚注后处理 — 转换 Obsidian 原生脚注为 VuePress Plume 格式
	   ================================================================ */

	/* ================================================================
	   脚注后处理 — 转换占位符为脚注引用，追加脚注区块
	   ================================================================ */

	/**
	 * 转换 Obsidian 原生脚注为 VuePress Plume 格式
	 */
	private convertObsidianFootnotes(el: HTMLElement): void {
		this.convertFootnotePlaceholders(el);
		this.hideObsidianFootnotes(el);
	}

	/**
	 * 转换占位符为脚注引用
	 * 预处理阶段将 [^id] 替换为 @@VP_FN:id@@ 特殊文本标记
	 * 脚注定义编码为 HTML 注释 <!--VP_FN_DEF:{"order":[...],"map":{...}}-->
	 * 后处理阶段从 DOM 中读取注释提取定义，遍历文本节点替换占位符为 <sup> 上标引用
	 */
	private convertFootnotePlaceholders(el: HTMLElement): void {
		const sourcePath = this.getSourcePath(el);
		const defMap = PlumeExtensionHandler.getFootnoteDefs(sourcePath);
		this.plugin.logger?.debug('Plume', 'convertFootnotePlaceholders', `sourcePath=${sourcePath}, defMapSize=${defMap.size}`);

		const refOrder: string[] = [];
		const idToNumber = new Map<string, number>();

		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
			acceptNode: (node: Node) => {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.closest('code, pre, .code-block, sup.vp-fn-ref')) {
					return NodeFilter.FILTER_REJECT;
				}
				const content = node.textContent || '';
				if (!FN_PH_DETECT.test(content)) {
					FN_PH_DETECT.lastIndex = 0;
					return NodeFilter.FILTER_SKIP;
				}
				FN_PH_DETECT.lastIndex = 0;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const textNodes: Text[] = [];
		let node: Node | null;
		while ((node = walker.nextNode())) {
			textNodes.push(node as Text);
		}

		for (const textNode of textNodes) {
			this.replaceFootnotePlaceholdersInTextNode(textNode, refOrder, idToNumber, defMap);
		}

		// 不再在文档正文中追加脚注定义区块，定义由面板脚注TAB负责渲染
	}

	/**
	 * 在文本节点中替换脚注占位符为 DOM 元素
	 */
	private replaceFootnotePlaceholdersInTextNode(textNode: Text, refOrder: string[], idToNumber: Map<string, number>, defMap: Map<string, string>): void {
		const text = textNode.textContent || '';
		const parts = text.split(FN_PH_DETECT);

		if (parts.length <= 1) return;

		const parent = textNode.parentNode;
		if (!parent) return;

		const fragment = document.createDocumentFragment();

		// 记录每个脚注ID的引用次数，用于生成 [1:1], [1:2] 格式
		const refCountPerId = new Map<string, number>();

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (i % 2 === 1) {
				const refId = part.trim();
				if (refId) {
					if (!idToNumber.has(refId)) {
						const num = refOrder.length + 1;
						refOrder.push(refId);
						idToNumber.set(refId, num);
					}
					// 计算当前是第几次引用同一个脚注
					const currentCount = (refCountPerId.get(refId) || 0) + 1;
					refCountPerId.set(refId, currentCount);
					const definition = defMap.get(refId);
					fragment.appendChild(this.buildFootnoteRef(refId, idToNumber, definition, currentCount));
				}
			} else if (part) {
				fragment.appendChild(document.createTextNode(part));
			}
		}

		parent.replaceChild(fragment, textNode);
	}

	/**
	 * 隐藏 Obsidian 原生的脚注区块
	 */
	private hideObsidianFootnotes(el: HTMLElement): void {
		el.querySelectorAll('div.footnotes, section.footnotes').forEach(fn => {
			(fn as HTMLElement).style.display = 'none';
		});
	}

	private getSourcePath(el: HTMLElement): string {
		return (el.closest('.markdown-preview-view') as HTMLElement | null)?.dataset.sourcePath
			|| (el.closest('.markdown-rendered') as HTMLElement | null)?.dataset.sourcePath
			|| '';
	}

	private buildFootnoteRef(refId: string, idToNumber: Map<string, number>, definition?: string, refIndex?: number): HTMLElement {
		const num = idToNumber.get(refId) || 1;
		const sup = document.createElement('sup');
		sup.className = 'vp-fn-ref';
		const link = document.createElement('a');
		link.href = `#fn-${refId}`;
		link.id = `fnref-${refId}`;
		// 相同脚注引用使用 [1][1:1][1:2] 格式
		link.textContent = refIndex && refIndex > 1 ? `[${num}:${refIndex}]` : `[${num}]`;
		
		// 点击显示脚注定义
		link.addEventListener('click', (e) => {
			e.preventDefault();
			if (!definition) return;
			
			// 移除已有的 popup
			document.querySelectorAll('.vp-fn-popup').forEach(p => p.remove());
			
			// 创建 popup
			const popup = document.createElement('div');
			popup.className = 'vp-fn-popup';
			popup.style.position = 'fixed';
			popup.style.zIndex = '10000';
			popup.style.maxWidth = '400px';
			popup.style.maxHeight = '300px';
			popup.style.overflow = 'auto';
			popup.style.padding = '12px';
			popup.style.borderRadius = '8px';
			popup.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
			popup.style.fontSize = '13px';
			popup.style.lineHeight = '1.5';
			
			// 定位
			const rect = link.getBoundingClientRect();
			popup.style.top = `${rect.bottom + 8}px`;
			popup.style.left = `${rect.left}px`;
			
			// 渲染定义内容
			MarkdownRenderer.render(
				this.plugin.app,
				definition,
				popup,
				this.getSourcePath(link),
				this.plugin
			);
			
			document.body.appendChild(popup);
			
			// 点击外部关闭
			const closePopup = (ev: MouseEvent) => {
				if (!popup.contains(ev.target as Node)) {
					popup.remove();
					document.removeEventListener('click', closePopup);
				}
			};
			setTimeout(() => document.addEventListener('click', closePopup), 0);
		});
		
		sup.appendChild(link);
		return sup;
	}

	private appendFootnoteSection(el: HTMLElement, defOrder: string[], defMap: Map<string, string>, idToNumber: Map<string, number>): void {
		const viewRoot = (el.closest('.markdown-preview-view')
			|| el.closest('.markdown-rendered')
			|| el.closest('.view-content')) as HTMLElement | null;
		
		if (!viewRoot) return;
		
		if (viewRoot.dataset.vpFootnotesAppended === 'true') return;
		viewRoot.dataset.vpFootnotesAppended = 'true';

		viewRoot.querySelectorAll('div.footnotes, section.footnotes').forEach(fn => fn.remove());
		viewRoot.querySelectorAll('section.vp-footnotes').forEach(fn => fn.remove());

		const section = document.createElement('section');
		section.className = 'vp-footnotes';
		section.setAttribute('role', 'doc-endnotes');

		const ol = document.createElement('ol');
		ol.className = 'vp-footnotes-list';

		const sourcePath = this.getSourcePath(el);

		defOrder.forEach((id) => {
			const num = idToNumber.get(id);
			if (!num) return;

			const definition = defMap.get(id);
			if (!definition) return;

			const li = document.createElement('li');
			li.className = 'vp-footnote-item';
			li.id = `fn-${id}`;

			const defDiv = document.createElement('div');
			defDiv.className = 'vp-footnote-def';
			
			MarkdownRenderer.render(
				this.plugin.app,
				definition,
				defDiv,
				sourcePath,
				this.plugin
			).then(() => {
				const paragraphs = defDiv.querySelectorAll('p');
				if (paragraphs.length === 1 && paragraphs[0].textContent === definition) {
					const frag = document.createDocumentFragment();
					while (paragraphs[0].firstChild) {
						frag.appendChild(paragraphs[0].firstChild);
					}
					defDiv.innerHTML = '';
					defDiv.appendChild(frag);
				}
			});

			const backLink = document.createElement('a');
			backLink.className = 'vp-footnote-backref';
			backLink.href = `#fnref-${id}`;
			backLink.setAttribute('aria-label', '返回引用处');
			backLink.textContent = '\u21A9';
			backLink.addEventListener('click', (e) => {
				e.preventDefault();
				document.getElementById(backLink.getAttribute('href')!.slice(1))
					?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			});

			li.appendChild(defDiv);
			li.appendChild(backLink);
			ol.appendChild(li);
		});

		section.appendChild(ol);
		viewRoot.appendChild(section);
	}

	/* ================================================================
	   任务列表 — checkbox 增强 + 兜底渲染
	   ================================================================ */

	private enhanceTaskLists(el: HTMLElement): void {
		const checkboxes = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
		if (checkboxes.length > 0) {
			checkboxes.forEach(cb => {
				cb.closest('li')?.classList.add('vp-task-item');
				cb.closest('p')?.classList.add('vp-task-p');
				cb.closest('ul')?.classList.add('vp-task-list');
			});
			return;
		}
		this.renderTaskListsFromText(el);
	}

	private renderTaskListsFromText(el: HTMLElement): void {
		const ulElements = el.querySelectorAll<HTMLUListElement>('ul');
		ulElements.forEach(ul => {
			const items = ul.querySelectorAll(':scope > li');
			let hasTaskItem = false;

			items.forEach(li => {
				const text = li.textContent || '';
				const m = text.match(/^\s*\[([ xX])\]\s+/);
				if (m) {
					hasTaskItem = true;
					const checked = m[1].toLowerCase() === 'x';
					const labelText = text.replace(/^\s*\[[ xX]\]\s+/, '').trim();

					const checkbox = document.createElement('input');
					checkbox.type = 'checkbox';
					checkbox.checked = checked;
					checkbox.className = 'task-list-item-checkbox';

					const label = document.createElement('label');
					label.className = 'vp-task-label';
					label.textContent = labelText;
					label.prepend(checkbox);

					li.classList.add('vp-task-item');
					li.innerHTML = '';
					li.appendChild(label);
				}
			});

			if (hasTaskItem) {
				ul.classList.add('vp-task-list');
			}
		});
	}

	/* ================================================================
	   通用：文本节点正则替换引擎
	   ================================================================ */

	private replaceTextNodes(
		el: HTMLElement,
		pattern: RegExp,
		factory: (content: string) => HTMLElement | null,
		skipTags: string[] = []
	): void {
		const skipSet = new Set(skipTags.map(t => t.toUpperCase()));

		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				const tag = node.parentElement?.tagName;
				if (tag && skipSet.has(tag)) return NodeFilter.FILTER_REJECT;
				if (skipTags.some(t => node.parentElement?.closest(t))) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const textNodes: Text[] = [];
		while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

		textNodes.forEach(textNode => {
			const text = textNode.textContent || '';
			pattern.lastIndex = 0;
			const matches = [...text.matchAll(pattern)];
			
			if (!matches.length) return;

			const frag = document.createDocumentFragment();
			let idx = 0;
			matches.forEach(m => {
				if (m.index == null) return;
				if (m.index > idx) frag.appendChild(document.createTextNode(text.slice(idx, m.index)));
				const elem = factory(m[1]);
				if (elem) frag.appendChild(elem);
				else frag.appendChild(document.createTextNode(m[0]));
				idx = m.index + m[0].length;
			});
			if (idx < text.length) frag.appendChild(document.createTextNode(text.slice(idx)));
			textNode.parentNode?.replaceChild(frag, textNode);
		});
	}

	/* ================================================================
	   工具函数
	   ================================================================ */

	private slugify(text: string): string {
		return text.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '-').replace(/^-+|-+$/g, '') || 'heading';
	}

	private escapeHtml(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	dispose(): void {
		document.querySelectorAll('.vp-toc-placeholder[data-vp-processed]').forEach(el => {
			el.removeAttribute('data-vp-processed');
		});
		document.querySelectorAll('[data-vp-anchored]').forEach(el => {
			el.removeAttribute('data-vp-anchored');
		});
		document.querySelectorAll('[data-vp-footnotes-appended]').forEach(el => {
			el.removeAttribute('data-vp-footnotes-appended');
		});
		if (PlumeExtensionHandler.deferredTimer) {
			clearTimeout(PlumeExtensionHandler.deferredTimer);
			PlumeExtensionHandler.deferredTimer = null;
		}
	}
}
