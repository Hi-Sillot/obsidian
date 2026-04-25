import { MarkdownRenderer } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

const TAG = 'FileTreeHandler';

type IconMode = 'colored' | 'simple';

interface FileTreeAttrs {
	icon: IconMode;
	title: string;
}

interface TreeNode {
	name: string;
	isDir: boolean;
	isExpanded: boolean;
	isAdded: boolean;
	isDeleted: boolean;
	isHighlighted: boolean;
	isPlaceholder: boolean;
	comment: string;
	children: TreeNode[];
}

const EXT_ICON_MAP: Record<string, string> = {
	ts: 'file-type-typescript-official',
	tsx: 'file-type-reacttsx',
	js: 'file-type-js-official',
	jsx: 'file-type-reactjs',
	vue: 'file-type-vue',
	json: 'file-type-json',
	md: 'file-type-markdown',
	css: 'file-type-css',
	scss: 'file-type-sass',
	html: 'file-type-html',
	python: 'file-type-python',
	py: 'file-type-python',
	rust: 'file-type-rust',
	rs: 'file-type-rust',
	go: 'file-type-go',
	java: 'file-type-java',
	yaml: 'file-type-yaml',
	yml: 'file-type-yaml',
	toml: 'file-type-toml',
	xml: 'file-type-xml',
	sh: 'file-type-shell',
	bash: 'file-type-shell',
	zsh: 'file-type-shell',
	gitignore: 'file-type-git',
	env: 'file-type-env',
	lock: 'file-type-lock',
	sql: 'file-type-sql',
	dockerfile: 'file-type-docker',
	png: 'file-type-image',
	jpg: 'file-type-image',
	jpeg: 'file-type-image',
	svg: 'file-type-svg',
	gif: 'file-type-image',
	webp: 'file-type-image',
	ico: 'file-type-image',
	mp3: 'file-type-audio',
	wav: 'file-type-audio',
	mp4: 'file-type-video',
	zip: 'file-type-zip',
	tar: 'file-type-zip',
	gz: 'file-type-zip',
	pdf: 'file-type-pdf',
	txt: 'file-type-text',
	cfg: 'file-type-config',
	ini: 'file-type-config',
	conf: 'file-type-config',
};

const SIMPLE_DIR_ICON = '📁';
const SIMPLE_FILE_ICON = '📄';

export class FileTreeHandler extends BaseSyntaxHandler {
	static readonly FILE_TREE_TYPE = 'file-tree';

	async buildContainer(
		containerType: string,
		title: string,
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement | null> {
		if (containerType !== FileTreeHandler.FILE_TREE_TYPE) return null;

		const attrs = this.parseAttrs(title);
		this.plugin.logger?.debug(TAG, `buildContainer icon=${attrs.icon}, title="${attrs.title}"`);

		const tree = this.parseTreeContent(contentText);
		return this.renderTree(tree, attrs, ctx);
	}

	private parseAttrs(titleLine: string): FileTreeAttrs {
		const attrs: FileTreeAttrs = { icon: 'colored', title: '' };
		if (!titleLine) return attrs;

		const iconMatch = titleLine.match(/icon="([^"]*)"/);
		if (iconMatch) {
			attrs.icon = iconMatch[1] === 'simple' ? 'simple' : 'colored';
		}

		const titleMatch = titleLine.match(/title="([^"]*)"/);
		if (titleMatch) {
			attrs.title = titleMatch[1];
		}

		return attrs;
	}

	private parseTreeContent(text: string): TreeNode[] {
		const lines = text.split('\n');
		const rootNodes: TreeNode[] = [];
		const stack: { node: TreeNode; indent: number }[] = [];

		for (const rawLine of lines) {
			const trimmed = rawLine.trim();
			if (!trimmed || trimmed === ':::') continue;

			const indent = rawLine.search(/\S/);
			if (indent === -1) continue;

			const listContent = trimmed.replace(/^[-*]\s+/, '');
			if (!listContent) continue;

			const node = this.parseListItem(listContent);

			while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
				stack.pop();
			}

			if (stack.length === 0) {
				rootNodes.push(node);
			} else {
				stack[stack.length - 1].node.children.push(node);
			}

			stack.push({ node, indent });
		}

		this.inferDirFlags(rootNodes);
		return rootNodes;
	}

	// 根据子节点推断目录标记：有子节点的自动标记为目录
	private inferDirFlags(nodes: TreeNode[]): void {
		for (const node of nodes) {
			if (node.children.length > 0 && !node.isPlaceholder) {
				node.isDir = true;
			}
			this.inferDirFlags(node.children);
		}
	}

	private parseListItem(text: string): TreeNode {
		let name = text;
		let isAdded = false;
		let isDeleted = false;
		let isHighlighted = false;
		let isPlaceholder = false;
		let comment = '';
		let isDir = false;
		let isExpanded = true;

		// 检测占位符
		if (/^[….]+$/.test(name.trim())) {
			return {
				name: '…',
				isDir: false,
				isExpanded: false,
				isAdded: false,
				isDeleted: false,
				isHighlighted: false,
				isPlaceholder: true,
				comment: '',
				children: [],
			};
		}

		// 提取 # 注释
		const commentMatch = name.match(/#(.+)$/);
		if (commentMatch) {
			comment = commentMatch[1].trim();
			name = name.slice(0, name.length - commentMatch[0].length).trimEnd();
		}

		// 检测 ++ 新增标记
		if (name.startsWith('++')) {
			isAdded = true;
			name = name.slice(2).trim();
		}

		// 检测 -- 删除标记
		if (name.startsWith('--') && !isAdded) {
			isDeleted = true;
			name = name.slice(2).trim();
		}

		// 检测加粗高亮
		if (name.startsWith('**') && name.endsWith('**')) {
			isHighlighted = true;
			name = name.slice(2, -2);
		}

		// 检测目录标记（末尾 /）
		if (name.endsWith('/')) {
			isDir = true;
			isExpanded = false;
			name = name.slice(0, -1).trim();
		}

		return {
			name,
			isDir,
			isExpanded,
			isAdded,
			isDeleted,
			isHighlighted,
			isPlaceholder,
			comment,
			children: [],
		};
	}

	private async renderTree(
		nodes: TreeNode[],
		attrs: FileTreeAttrs,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = 'vp-file-tree';
		if (attrs.icon === 'simple') {
			container.classList.add('vp-file-tree--simple');
		}

		if (attrs.title) {
			container.createEl('p', {
				cls: 'vp-file-tree-title',
				text: attrs.title,
			});
		}

		const listEl = container.createEl('ul', { cls: 'vp-file-tree-root' });

		for (const node of nodes) {
			await this.renderNode(listEl, node, attrs.icon, ctx);
		}

		return container;
	}

	private async renderNode(
		parent: HTMLElement,
		node: TreeNode,
		iconMode: IconMode,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		const li = parent.createEl('li', { cls: 'vp-file-tree-item' });

		if (node.isDir) {
			li.classList.add('vp-file-tree-item--dir');
		}
		if (node.isAdded) {
			li.classList.add('vp-file-tree-item--added');
		}
		if (node.isDeleted) {
			li.classList.add('vp-file-tree-item--deleted');
		}
		if (node.isHighlighted) {
			li.classList.add('vp-file-tree-item--highlighted');
		}
		if (node.isPlaceholder) {
			li.classList.add('vp-file-tree-item--placeholder');
		}

		const row = li.createDiv({ cls: 'vp-file-tree-row' });

		// 目录展开/折叠箭头
		if (node.isDir) {
			const arrow = row.createEl('span', {
				cls: 'vp-file-tree-arrow',
			});
			arrow.textContent = node.children.length > 0 || node.isExpanded ? '▾' : '▸';

			if (node.children.length > 0) {
				arrow.classList.add('vp-file-tree-arrow--clickable');
				let collapsed = false;
				arrow.addEventListener('click', () => {
					collapsed = !collapsed;
					arrow.textContent = collapsed ? '▸' : '▾';
					const childList = li.querySelector(':scope > .vp-file-tree-children') as HTMLElement;
					if (childList) {
						childList.style.display = collapsed ? 'none' : '';
					}
				});
			}
		} else {
			const spacer = row.createEl('span', { cls: 'vp-file-tree-arrow-spacer' });
		}

		// 图标
		const iconEl = row.createEl('span', { cls: 'vp-file-tree-icon' });
		if (iconMode === 'simple') {
			iconEl.textContent = node.isDir ? SIMPLE_DIR_ICON : SIMPLE_FILE_ICON;
		} else {
			await this.renderColoredIcon(iconEl, node);
		}

		// 文件名/目录名
		const nameEl = row.createEl('span', { cls: 'vp-file-tree-name' });
		nameEl.textContent = node.name;

		// 注释
		if (node.comment) {
			const commentEl = row.createEl('span', { cls: 'vp-file-tree-comment' });
			const commentTemp = document.createElement('span');
			await MarkdownRenderer.render(
				this.plugin.app, node.comment, commentTemp, ctx.sourcePath, this.plugin
			);
			commentEl.innerHTML = commentTemp.innerHTML;
		}

		// 状态标记
		if (node.isAdded) {
			const badge = row.createEl('span', { cls: 'vp-file-tree-badge vp-file-tree-badge--added' });
			badge.textContent = 'A';
		}
		if (node.isDeleted) {
			const badge = row.createEl('span', { cls: 'vp-file-tree-badge vp-file-tree-badge--deleted' });
			badge.textContent = 'D';
		}

		// 子节点
		if (node.isDir && node.children.length > 0) {
			const childList = li.createEl('ul', { cls: 'vp-file-tree-children' });
			for (const child of node.children) {
				await this.renderNode(childList, child, iconMode, ctx);
			}
		}
	}

	private async renderColoredIcon(container: HTMLElement, node: TreeNode): Promise<void> {
		if (node.isPlaceholder) {
			container.textContent = '…';
			container.classList.add('vp-file-tree-icon--placeholder');
			return;
		}

		if (node.isDir) {
			const iconSet = node.children.length > 0 ? 'vscode-icons:folder-type-opened' : 'vscode-icons:folder-type';
			await this.fetchIconifyIcon(container, iconSet);
			return;
		}

		// 根据扩展名选择图标
		const ext = this.getFileExtension(node.name);
		const iconName = ext ? EXT_ICON_MAP[ext] : null;

		if (iconName) {
			await this.fetchIconifyIcon(container, `vscode-icons:${iconName}`);
		} else {
			await this.fetchIconifyIcon(container, 'vscode-icons:file-type');
		}
	}

	private async fetchIconifyIcon(container: HTMLElement, iconId: string): Promise<void> {
		const [prefix, name] = iconId.split(':');
		if (!prefix || !name) {
			container.textContent = '📄';
			return;
		}

		const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?width=1em&height=1em`;
		try {
			const resp = await fetch(svgUrl);
			if (resp.ok) {
				const svgText = await resp.text();
				if (svgText.startsWith('<svg')) {
					container.innerHTML = svgText;
					const svg = container.querySelector('svg');
					if (svg) {
						svg.classList.add('vp-file-tree-icon-svg');
					}
					return;
				}
			}
		} catch {
			// 网络不可用时回退
		}

		container.textContent = '📄';
	}

	private getFileExtension(filename: string): string {
		// 特殊文件名处理
		const lowerName = filename.toLowerCase();
		if (lowerName === 'dockerfile') return 'dockerfile';
		if (lowerName === '.gitignore') return 'gitignore';
		if (lowerName === '.env') return 'env';
		if (lowerName === 'license' || lowerName === 'readme') return 'txt';

		const dotIndex = filename.lastIndexOf('.');
		if (dotIndex === -1 || dotIndex === 0) return '';
		return filename.slice(dotIndex + 1).toLowerCase();
	}
}
