import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

interface CodeBlockMeta {
	lineNumbers?: number[];
	focusLines?: number;
	warning?: boolean;
	error?: boolean;
	diffAdd?: boolean;
	diffRemove?: boolean;
	wordHighlight?: string;
	folded?: boolean;
	showLineNumbers?: boolean | string;
}

export class CodeBlockEnhanceHandler extends BaseSyntaxHandler {
	// 匹配代码块标题行的行号语法：```js{4} 或 ```js{1,4,6-8}
	private static readonly LINE_NUMBERS_REGEX = /^(\w+)\{([\d,\-]+)\}$/;

	// 匹配 [!code xxx] 注释
	private static readonly CODE_COMMENT_REGEX = /\/\/\s*\[!code\s+(.+?)\]/g;

	// 匹配词高亮中的文本
	private static readonly WORD_HIGHLIGHT_REGEX = /word:(.+)/;

	processInlineComponents(el: HTMLElement): void {
		this.processCodeBlocks(el);
	}

	private processCodeBlocks(el: HTMLElement): void {
		const codeBlocks = el.querySelectorAll<HTMLPreElement>('pre');
		codeBlocks.forEach(pre => {
			this.enhanceCodeBlock(pre);
		});
	}

	private enhanceCodeBlock(pre: HTMLPreElement): void {
		const codeElement = pre.querySelector('code');
		if (!codeElement) return;

		const classList = Array.from(pre.classList);
		const langClass = classList.find(cls => cls.startsWith('language-'));
		const language = langClass ? langClass.replace('language-', '') : '';

		if (language === 'mermaid') {
			return;
		}

		// 解析元数据（从类名或 data 属性中提取）
		const meta = this.parseCodeBlockMeta(pre, language, classList);

		// 应用行号高亮
		if (meta.lineNumbers && meta.lineNumbers.length > 0) {
			this.applyLineHighlights(codeElement, meta.lineNumbers);
			pre.classList.add('sillot-code-has-highlights');
		}

		// 应用行内注释增强
		this.applyInlineComments(codeElement, meta);

		// 应用聚焦效果
		if (meta.focusLines !== undefined) {
			this.applyFocusEffect(pre, codeElement, meta.focusLines);
		}

		// 应用警告/错误样式
		if (meta.warning) pre.classList.add('sillot-code-warning');
		if (meta.error) pre.classList.add('sillot-code-error');

		// 应用折叠
		if (meta.folded) {
			this.applyFoldEffect(pre, codeElement);
		}

		// 添加增强标识
		pre.classList.add('sillot-code-enhanced');
	}

	private parseCodeBlockMeta(pre: HTMLPreElement, language: string, classList?: string[]): CodeBlockMeta {
		const meta: CodeBlockMeta = {};

		// 从类名解析行号信息 {4} 或 {1,4,6-8}
		const classes = classList || Array.from(pre.classList);
		for (const cls of classes) {
			const lineMatch = cls.match(CodeBlockEnhanceHandler.LINE_NUMBERS_REGEX);
			if (lineMatch) {
				meta.lineNumbers = this.parseLineNumberString(lineMatch[2]);
				break;
			}
		}

		// 解析代码内容获取行内注释
		const codeText = pre.textContent || '';
		const lines = codeText.split('\n');

		// 扫描每一行的注释
		lines.forEach((line, index) => {
			const commentMatch = line.match(CodeBlockEnhanceHandler.CODE_COMMENT_REGEX);
			if (!commentMatch) return;

			const directive = commentMatch[1].trim();

			switch (directive) {
				case 'focus':
					meta.focusLines = meta.focusLines ?? index + 1; // 默认聚焦当前行
					break;
				case '++':
				case 'diff-add':
					meta.diffAdd = true;
					break;
				case '--':
				case 'diff-remove':
					meta.diffRemove = true;
					break;
				case 'warning':
					meta.warning = true;
					break;
				case 'error':
					meta.error = true;
					break;
				default:
					// 检查是否是 focus:N 或 word:xxx 格式
					const focusMatch = directive.match(/^focus:(\d+)$/);
					if (focusMatch) {
						meta.focusLines = parseInt(focusMatch[1], 10);
						break;
					}

					const wordMatch = directive.match(CodeBlockEnhanceHandler.WORD_HIGHLIGHT_REGEX);
					if (wordMatch) {
						meta.wordHighlight = wordMatch[1];
						break;
					}
					break;
			}
		});

		return meta;
	}

	private parseLineNumberString(lineStr: string): number[] {
		const numbers: number[] = [];
		const parts = lineStr.split(',');

		for (const part of parts) {
			const trimmed = part.trim();
			if (trimmed.includes('-')) {
				// 范围语法：6-8
				const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));
				if (!isNaN(start) && !isNaN(end)) {
					for (let i = start; i <= end; i++) {
						numbers.push(i);
					}
				}
			} else {
				// 单个数字
				const num = parseInt(trimmed, 10);
				if (!isNaN(num)) {
					numbers.push(num);
				}
			}
		}

		return numbers.sort((a, b) => a - b);
	}

	private applyLineHighlights(codeEl: HTMLElement, lineNumbers: number[]): void {
		// 将代码按行分割并包装
		const html = codeEl.innerHTML;
		const lines = html.split('\n');

		const highlightedLines = new Set(lineNumbers);

		const processedLines = lines.map((line, index) => {
			const lineNumber = index + 1;
			if (highlightedLines.has(lineNumber)) {
				return `<span class="sillot-line-highlighted">${line}</span>`;
			}
			return line;
		});

		codeEl.innerHTML = processedLines.join('\n');
		codeEl.classList.add('sillot-code-line-highlighted');
	}

	private applyInlineComments(codeEl: HTMLElement, meta: CodeBlockMeta): void {
		let html = codeEl.innerHTML;

		// 替换差异标记注释
		html = html.replace(
			/\/\/\s*\[!code\s*\+\+\]/g,
			'<span class="sillot-diff-marker sillot-diff-add">+</span>'
		);
		html = html.replace(
			/\/\/\s*\[!code\s*--]/g,
			'<span class="sillot-diff-marker sillot-diff-remove">-</span>'
		);

		// 移除其他指令注释（保持代码整洁）
		html = html.replace(/\/\/\s*\[!code\s+[^\]]+\]/g, '');

		// 如果有词高亮，应用它
		if (meta.wordHighlight) {
			html = this.applyWordHighlight(html, meta.wordHighlight);
		}

		codeEl.innerHTML = html;

		// 为包含差异标记的行添加样式
		if (meta.diffAdd || meta.diffRemove) {
			codeEl.classList.add('sillot-code-with-diffs');
		}
	}

	private applyWordHighlight(html: string, word: string): string {
		// 转义特殊字符用于正则
		const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(${escapedWord})`, 'gi');

		return html.replace(regex, '<mark class="sillot-word-highlight">$1</mark>');
	}

	private applyFocusEffect(pre: HTMLPreElement, codeEl: HTMLElement, focusLines?: number): void {
		// 添加聚焦容器类
		pre.classList.add('sillot-code-focus');

		// 如果指定了聚焦范围，只显示相关行
		if (focusLines && focusLines > 0) {
			const lines = codeEl.innerHTML.split('\n');
			const totalLines = lines.length;

			// 计算可见范围（聚焦行前后各 N 行）
			const visibleStart = Math.max(0, focusLines - focusLines - 1);
			const visibleEnd = Math.min(totalLines, focusLines + focusLines);

			const focusedLines = lines.map((line, index) => {
				const lineNumber = index + 1;
				const isFocused = lineNumber >= visibleStart && lineNumber <= visibleEnd;

				return `<span class="${isFocused ? '' : 'sillot-line-blurred'}">${line}</span>`;
			});

			codeEl.innerHTML = focusedLines.join('\n');
		} else {
			// 简单聚焦：模糊所有非高亮行
			const lines = codeEl.innerHTML.split('\n');
			const blurredLines = lines.map((line, index) => {
				const isHighlighted = line.includes('sillot-line-highlighted');
				return `<span class="${isHighlighted ? '' : 'sillot-line-blurred'}">${line}</span>`;
			});

			codeEl.innerHTML = blurredLines.join('\n');
		}
	}

	private applyFoldEffect(pre: HTMLPreElement, codeEl: HTMLElement): void {
		// 创建折叠容器
		const wrapper = document.createElement('div');
		wrapper.className = 'sillot-code-fold-wrapper';

		// 创建折叠按钮
		const toggleBtn = document.createElement('button');
		toggleBtn.className = 'sillot-code-fold-toggle';
		toggleBtn.textContent = '展开代码 ▼';
		toggleBtn.type = 'button';

		// 折叠代码区域
		const contentDiv = document.createElement('div');
		contentDiv.className = 'sillot-code-fold-content';
		contentDiv.style.display = 'none'; // 默认折叠

		// 将原始代码移到折叠区域
		contentDiv.appendChild(codeEl.cloneNode(true));

		// 切换事件
		toggleBtn.addEventListener('click', () => {
			const isExpanded = contentDiv.style.display !== 'none';
			contentDiv.style.display = isExpanded ? 'none' : 'block';
			toggleBtn.textContent = isExpanded ? '展开代码 ▼' : '收起代码 ▲';
			pre.classList.toggle('sillot-code-expanded', !isExpanded);
		});

		// 组装结构
		wrapper.appendChild(toggleBtn);
		wrapper.appendChild(contentDiv);

		// 替换原始内容
		pre.innerHTML = '';
		pre.appendChild(wrapper);
		pre.classList.add('sillot-code-folded');
	}
}
