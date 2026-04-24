import { MarkdownRenderer } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

interface ContainerConfig {
	type: string;
	title?: string;
	attrs?: Record<string, string>;
}

export class SpecialContainerHandler extends BaseSyntaxHandler {
	private static readonly SPECIAL_CONTAINERS = new Set([
		'demo-wrapper',
		'npm-to',
		'repl',
		'codepen',
		'codesandbox',
		'replit',
		'table-enhanced',
	]);

	processInlineComponents(el: HTMLElement): void {
		this.processDemoWrappers(el);
		this.processNpmToContainers(el);
		this.processTableEnhanced(el);
	}

	/**
	 * 处理 demo-wrapper 容器
	 * 语法：:::: demo-wrapper title="标题" ::::
	 */
	private processDemoWrappers(el: HTMLElement): void {
		const wrappers = el.querySelectorAll<HTMLElement>('.sillot-custom-demo-wrapper');

		wrappers.forEach(wrapper => {
			if (wrapper.dataset.processed) return;
			wrapper.dataset.processed = 'true';

			this.enhanceDemoWrapper(wrapper);
		});
	}

	/**
	 * 增强 demo-wrapper 容器样式和功能
	 */
	private enhanceDemoWrapper(wrapper: HTMLElement): void {
		const title = wrapper.dataset.title || 'Demo';

		// 添加标题栏
		const header = document.createElement('div');
		header.className = 'sillot-demo-header';
		header.innerHTML = `
			<span class="sillot-demo-title">${this.escapeHtml(title)}</span>
			<div class="sillot-demo-actions">
				<button class="sillot-demo-btn sillot-demo-copy" title="复制代码">📋</button>
				<button class="sillot-demo-btn sillot-demo-toggle" title="展开/折叠">▼</button>
			</div>
		`;
		wrapper.insertBefore(header, wrapper.firstChild);

		// 添加内容区域
		const content = wrapper.querySelector('.sillot-custom-container-content');
		if (content) {
			content.className = 'sillot-demo-content';
		}

		// 绑定复制按钮事件
		const copyBtn = header.querySelector('.sillot-demo-copy');
		if (copyBtn) {
			copyBtn.addEventListener('click', () => {
				const codeBlock = wrapper.querySelector('pre code, pre, code');
				if (codeBlock) {
					navigator.clipboard.writeText(codeBlock.textContent || '');
					this.showToast('✅ 代码已复制到剪贴板');
				}
			});
		}

		// 绑定折叠按钮事件
		const toggleBtn = header.querySelector('.sillot-demo-toggle');
		if (toggleBtn) {
			toggleBtn.addEventListener('click', () => {
				wrapper.classList.toggle('sillot-demo-collapsed');
				toggleBtn.textContent = wrapper.classList.contains('sillot-demo-collapsed') ? '▶' : '▼';
			});
		}
	}

	/**
	 * 处理 npm-to 容器
	 * 语法：::: npm-to ... :::
	 */
	private processNpmToContainers(el: HTMLElement): void {
		const containers = el.querySelectorAll<HTMLElement>('.sillot-custom-npm-to');

		containers.forEach(container => {
			if (container.dataset.processed) return;
			container.dataset.processed = 'true';

			this.enhanceNpmToContainer(container);
		});
	}

	/**
	 * 增强 npm-to 容器样式和功能
	 */
	private enhanceNpmToContainer(container: HTMLElement): void {
		// 添加 NPM 图标和标题
		const header = document.createElement('div');
		header.className = 'sillot-npm-header';
		header.innerHTML = `
			<span class="sillot-npm-icon">📦</span>
			<span class="sillot-npm-title">NPM Command</span>
			<span class="sillot-npm-badge">Terminal</span>
		`;
		container.insertBefore(header, container.firstChild);

		// 包装代码块
		const codeBlock = container.querySelector('pre, code');
		if (codeBlock) {
			const wrapper = document.createElement('div');
			wrapper.className = 'sillot-npm-code-wrapper';
			codeBlock.parentNode?.insertBefore(wrapper, codeBlock);
			wrapper.appendChild(codeBlock);

			// 添加复制按钮
			const copyBtn = document.createElement('button');
			copyBtn.className = 'sillot-npm-copy-btn';
			copyBtn.textContent = '📋 Copy';
			copyBtn.title = '复制命令';
			copyBtn.addEventListener('click', () => {
				navigator.clipboard.writeText(codeBlock.textContent || '');
				copyBtn.textContent = '✅ Copied!';
				setTimeout(() => {
					copyBtn.textContent = '📋 Copy';
				}, 2000);
			});
			wrapper.appendChild(copyBtn);
		}

		// 添加运行提示
		const footer = document.createElement('div');
		footer.className = 'sillot-npm-footer';
		footer.innerHTML = `<span class="sillot-npm-hint">💡 在终端中运行此命令</span>`;
		container.appendChild(footer);
	}

	/**
	 * 处理增强表格容器
	 */
	private processTableEnhanced(el: HTMLElement): void {
		const tables = el.querySelectorAll<HTMLElement>('.sillot-table-enhanced');

		tables.forEach(table => {
			if (table.dataset.processed) return;
			table.dataset.processed = 'true';

			this.enhanceTable(table);
		});
	}

	/**
	 * 增强表格样式
	 */
	private enhanceTable(tableEl: HTMLElement): void {
		// 添加响应式包装
		const wrapper = document.createElement('div');
		wrapper.className = 'sillot-table-wrapper';
		tableEl.parentNode?.insertBefore(wrapper, tableEl);
		wrapper.appendChild(tableEl);

		// 添加斑马纹
		const rows = tableEl.querySelectorAll('tr');
		rows.forEach((row, index) => {
			if (index > 0 && index % 2 === 0) {
				row.classList.add('sillot-table-row-even');
			}
		});

		// 高亮表头
		const headers = tableEl.querySelectorAll('th');
		headers.forEach(th => {
			th.classList.add('sillot-table-header');
		});

		// 添加排序功能（如果需要）
		this.addTableSortFeature(tableEl);
	}

	/**
	 * 添加表格排序功能
	 */
	private addTableSortFeature(tableEl: HTMLElement): void {
		const headers = tableEl.querySelectorAll<HTMLElement>('th');

		headers.forEach((header, colIndex) => {
			header.style.cursor = 'pointer';
			header.addEventListener('click', () => {
				const tbody = tableEl.querySelector('tbody');
				if (!tbody) return;

				const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
				const isAsc = header.dataset.sort === 'asc';

				rows.sort((a, b) => {
					const aText = a.cells[colIndex]?.textContent || '';
					const bText = b.cells[colIndex]?.textContent || '';

					const aNum = parseFloat(aText);
					const bNum = parseFloat(bText);

					if (!isNaN(aNum) && !isNaN(bNum)) {
						return isAsc ? aNum - bNum : bNum - aNum;
					}

					return isAsc
						? aText.localeCompare(bText)
						: bText.localeCompare(aText);
				});

				rows.forEach(row => tbody.appendChild(row));
				header.dataset.sort = isAsc ? 'desc' : 'asc';
				header.textContent = `${header.textContent.trim()} ${isAsc ? '↓' : '↑'}`;
			});
		});
	}

	/**
	 * 从文本构建特殊容器（供 buildContainer 调用）
	 */
	async buildSpecialContainer(
		containerType: string,
		title: string,
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement | null> {
		switch (containerType) {
			case 'demo-wrapper':
				return this.buildDemoWrapper(title, contentText, ctx);
			case 'npm-to':
				return this.buildNpmToContainer(contentText, ctx);
			case 'table-enhanced':
				return this.buildTableEnhanced(contentText, ctx);
			default:
				return null;
		}
	}

	/**
	 * 构建 demo-wrapper 容器
	 */
	private async buildDemoWrapper(
		title: string,
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = 'sillot-custom-container sillot-custom-demo-wrapper';
		container.dataset.title = title;

		const contentDiv = container.createDiv({ cls: 'sillot-custom-container-content' });
		if (contentText.trim()) {
			await this.renderContentToElement(contentText, contentDiv, ctx);
		}

		return container;
	}

	/**
	 * 构建 npm-to 容器
	 */
	private async buildNpmToContainer(
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = 'sillot-custom-container sillot-custom-npm-to';

		const contentDiv = container.createDiv({ cls: 'sillot-custom-container-content' });
		if (contentText.trim()) {
			await this.renderContentToElement(contentText, contentDiv, ctx);
		}

		return container;
	}

	/**
	 * 构建增强表格容器
	 */
	private async buildTableEnhanced(
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = 'sillot-table-enhanced';

		if (contentText.trim()) {
			await this.renderContentToElement(contentText, container, ctx);
		}

		return container;
	}

	/**
	 * 渲染 Markdown 内容到元素
	 */
	private async renderContentToElement(
		contentText: string,
		targetEl: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		await MarkdownRenderer.render(
			this.plugin.app,
			contentText,
			targetEl,
			ctx.sourcePath,
			this.plugin
		);
	}

	/**
	 * HTML 转义
	 */
	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * 显示提示消息
	 */
	private showToast(message: string): void {
		const toast = document.createElement('div');
		toast.className = 'sillot-toast';
		toast.textContent = message;
		document.body.appendChild(toast);

		setTimeout(() => {
			toast.classList.add('sillot-toast-hide');
			setTimeout(() => toast.remove(), 300);
		}, 2000);
	}

	/**
	 * 清理资源
	 */
	dispose(): void {
		// 移除事件监听器和临时元素
		document.querySelectorAll('.sillot-demo-wrapper[data-processed]').forEach(el => {
			el.removeAttribute('data-processed');
		});
		document.querySelectorAll('.sillot-npm-to[data-processed]').forEach(el => {
			el.removeAttribute('data-processed');
		});
		document.querySelectorAll('.sillot-table-enhanced[data-processed]').forEach(el => {
			el.removeAttribute('data-processed');
		});
	}
}
