import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

export class ExperienceEnhanceHandler extends BaseSyntaxHandler {
	private watermarkContainer: HTMLElement | null = null;
	private includeCache: Map<string, string> = new Map();

	processInlineComponents(el: HTMLElement): void {
		this.processWatermark(el);
		this.processIncludes(el);
		this.processCodeTrees(el);
	}

	preprocessMarkdown(text: string): string {
		let processed = text;
		processed = this.preprocessInclude(processed);
		return processed;
	}

	private processWatermark(el: HTMLElement): void {
		const viewEl = el.closest('.markdown-preview-view') || el.closest('.markdown-source-view');
		if (!viewEl) return;

		const settings = this.plugin.settings;
		if (!settings?.watermark?.enabled) return;

		const text = settings.watermark.text || 'Sillot';
		const opacity = settings.watermark.opacity ?? 0.1;
		const fontSize = settings.watermark.fontSize || 14;
		const color = settings.watermark.color || '#000000';

		if (this.watermarkContainer && this.watermarkContainer.parentNode === viewEl) return;

		this.removeExistingWatermark(viewEl as HTMLElement);

		const container = document.createElement('div');
		container.className = 'sillot-watermark-container';
		container.setAttribute('data-processed', 'true');

		container.innerHTML = `
			<div class="sillot-watermark" 
				 style="--wm-text: '${text}'; --wm-opacity: ${opacity}; --wm-font-size: ${fontSize}px; --wm-color: ${color};">
				${Array.from({ length: 20 }, (_, i) => `<span class="sillot-wm-item" style="--wm-index: ${i};"></span>`).join('')}
			</div>
		`;

		viewEl.appendChild(container);
		this.watermarkContainer = container;
	}

	private removeExistingWatermark(parent: HTMLElement): void {
		const existing = parent.querySelector('.sillot-watermark-container');
		if (existing) existing.remove();
	}

	private processIncludes(el: HTMLElement): void {
		el.querySelectorAll('[data-include]').forEach(async (item) => {
			const includeEl = item as HTMLElement;
			if (includeEl.dataset.processed === 'true') return;

			includeEl.dataset.processed = 'true';

			const src = includeEl.dataset.include;
			if (!src) {
				includeEl.innerHTML = '<div class="sillot-include-error">❌ 缺少 include 路径</div>';
				return;
			}

			try {
				const content = await this.loadIncludeContent(src);

				if (content) {
					includeEl.innerHTML = content;
					includeEl.classList.add('sillot-include-loaded');
				} else {
					includeEl.innerHTML = '<div class="sillot-include-error">❌ 无法加载内容</div>';
				}
			} catch (error) {
				includeEl.innerHTML = `<div class="sillot-include-error">❌ 加载失败: ${error instanceof Error ? error.message : '未知错误'}</div>`;
			}
		});
	}

	private async loadIncludeContent(src: string): Promise<string | null> {
		if (this.includeCache.has(src)) return this.includeCache.get(src)!;

		try {
			const adapter = this.plugin.app.vault.adapter;
			const normalizedPath = this.normalizePath(src);
			const exists = await adapter.exists(normalizedPath);

			if (!exists) return null;

			const content = await adapter.read(normalizedPath);
			this.includeCache.set(src, content);
			return content;
		} catch (error) {
			this.plugin.logger?.error('Include', 'Include 加载失败', `${src}: ${(error as Error).message}`);
			return null;
		}
	}

	private normalizePath(path: string): string {
		path = path.replace(/^\.?\//, '');
		if (!path.endsWith('.md')) path += '.md';
		return path;
	}

	private preprocessInclude(text: string): string {
		return text.replace(
			/<!--\s*@include:\s*(.+?)\s*-->/g,
			(_match, src: string) => {
				return `<div class="sillot-include" data-include="${src.trim()}" data-processed="false">
					<div class="sillot-include-loading">📄 正在加载内容...</div>
				</div>`;
			}
		);
	}

	private processCodeTrees(el: HTMLElement): void {
		el.querySelectorAll('pre.sillot-code-tree, [data-code-tree]').forEach((block) => {
			const treeBlock = block as HTMLElement;
			if (treeBlock.dataset.processed === 'true') return;

			treeBlock.dataset.processed = 'true';

			const rawContent = treeBlock.textContent || '';
			const lines = rawContent.split('\n').filter(line => line.trim());

			if (lines.length === 0) return;

			const treeData = this.parseTreeStructure(lines);
			treeBlock.innerHTML = this.renderTreeHTML(treeData);
			treeBlock.classList.add('sillot-code-tree-rendered');
		});
	}

	private parseTreeStructure(lines: string[]): TreeNode[] {
		const root: TreeNode[] = [];
		const stack: { level: number; children: TreeNode[] }[] = [{ level: -1, children: root }];

		lines.forEach((line) => {
			const level = this.getIndentLevel(line);
			const name = line.trim();
			const isDir = line.endsWith('/') || line.endsWith('\\') || !line.includes('.');
			const icon = isDir ? '📁' : this.getFileIcon(name);

			const node: TreeNode = {
				name,
				icon,
				isDirectory: isDir,
				children: isDir ? [] : undefined
			};

			while (stack.length > 1 && stack[stack.length - 1].level >= level) {
				stack.pop();
			}

			const parent = stack[stack.length - 1];
			parent.children.push(node);

			if (isDir) {
				stack.push({ level, children: node.children! });
			}
		});

		return root;
	}

	private getIndentLevel(line: string): number {
		const match = line.match(/^(\s*)/);
		return match ? Math.floor(match[1].length / 2) : 0;
	}

	private getFileIcon(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase() || '';

		const icons: Record<string, string> = {
			ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️',
			vue: '💚', html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
			json: '📋', md: '📝', yml: '⚙️', yaml: '⚙️',
			py: '🐍', rb: '💎', go: '🐹', rs: '🦀',
			java: '☕', kt: '🟣', swift: '🍎',
			sh: '📜', bash: '📜', ps1: '💙',
			sql: '🗃️', svg: '🖼️', png: '🖼️', jpg: '🖼️',
			gitignore: '🚫', env: '🔒', dockerfile: '🐳'
		};

		return icons[ext] || '📄';
	}

	private renderTreeHTML(nodes: TreeNode[], depth = 0): string {
		return nodes.map(node => {
			const indent = '  '.repeat(depth);
			const connector = depth > 0 ? '├─ ' : '';
			const prefix = node.isDirectory ? '' : '';

			let html = `${indent}${connector}${node.icon} <span class="sillot-tree-name">${this.escapeHtml(node.name)}</span>${prefix}\n`;

			if (node.children && node.children.length > 0) {
				html += this.renderTreeHTML(node.children, depth + 1);
			}

			return html;
		}).join('');
	}

	private escapeHtml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	dispose(): void {
		if (this.watermarkContainer) {
			this.watermarkContainer.remove();
			this.watermarkContainer = null;
		}
		this.includeCache.clear();
	}
}

interface TreeNode {
	name: string;
	icon: string;
	isDirectory: boolean;
	children?: TreeNode[];
}
