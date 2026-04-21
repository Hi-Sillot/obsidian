import { App, TFolder, TFile, TAbstractFile } from 'obsidian';
import { PublishStatusChecker } from '../sync/PublishStatusChecker';

type CheckState = 'checked' | 'unchecked';

interface TreeNode {
	name: string;
	path: string;
	isFolder: boolean;
	children: TreeNode[];
	state: CheckState;
	depth: number;
	expanded: boolean;
}

export class SyncPathTree {
	private container: HTMLElement;
	private app: App;
	private root: TreeNode | null = null;
	private onSelectionChange: (selectedPaths: string[]) => void;

	constructor(container: HTMLElement, app: App, options: {
		onSelectionChange: (selectedPaths: string[]) => void;
	}) {
		this.container = container;
		this.app = app;
		this.onSelectionChange = options.onSelectionChange;
	}

	buildTree(selectedPaths: string[]) {
		const vaultRoot = this.app.vault.getRoot();
		this.root = this.buildNode(vaultRoot.name || '(根目录)', '', 0, vaultRoot.children);
		this.applySelection(selectedPaths);
		this.render();
	}

	private buildNode(name: string, path: string, depth: number, children: TAbstractFile[]): TreeNode {
		const folders: TFolder[] = [];
		const files: TFile[] = [];

		for (const child of children) {
			if (child instanceof TFolder) {
				folders.push(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			}
		}

		folders.sort((a, b) => a.name.localeCompare(b.name));
		files.sort((a, b) => a.name.localeCompare(b.name));

		const nodeChildren: TreeNode[] = [];

		for (const folder of folders) {
			nodeChildren.push(this.buildNode(folder.name, folder.path, depth + 1, folder.children));
		}

		for (const file of files) {
			nodeChildren.push({
				name: file.name,
				path: file.path,
				isFolder: false,
				children: [],
				state: 'unchecked',
				depth: depth + 1,
				expanded: false,
			});
		}

		return {
			name: name || '(根目录)',
			path: path || '/',
			isFolder: true,
			children: nodeChildren,
			state: 'unchecked',
			depth,
			expanded: depth < 1,
		};
	}

	private applySelection(selectedPaths: string[]) {
		if (!this.root) return;

		if (selectedPaths.length === 0) {
			this.setNodeState(this.root, 'unchecked');
			return;
		}

		const normalizedSelected = selectedPaths.map(p => PublishStatusChecker.normalizeSyncPath(p));
		const isAllSelected = normalizedSelected.includes('');

		this.applyNodeState(this.root, normalizedSelected, isAllSelected);
	}

	private applyNodeState(node: TreeNode, selectedPaths: string[], isAllSelected: boolean): void {
		if (!node.isFolder) {
			node.state = isAllSelected ? 'checked' : (selectedPaths.some(p => node.path === p || node.path.startsWith(p + '/')) ? 'checked' : 'unchecked');
			return;
		}

		for (const child of node.children) {
			this.applyNodeState(child, selectedPaths, isAllSelected);
		}
		this.recalcNodeState(node);
	}

	private recalcNodeState(node: TreeNode) {
		if (!node.isFolder || node.children.length === 0) return;

		let allChecked = true;

		for (const child of node.children) {
			if (child.state !== 'checked') {
				allChecked = false;
				break;
			}
		}

		node.state = allChecked ? 'checked' : 'unchecked';
	}

	toggleCheck(node: TreeNode) {
		if (node.state === 'checked') {
			this.setNodeState(node, 'unchecked');
		} else {
			this.setNodeState(node, 'checked');
		}
		this.propagateUp(node);
		this.render();
		this.emitChange();
	}

	private setNodeState(node: TreeNode, state: CheckState) {
		node.state = state;
		for (const child of node.children) {
			this.setNodeState(child, state);
		}
	}

	private propagateUp(node: TreeNode) {
		let current = node;
		while (true) {
			const parent = this.findParent(this.root!, current.path);
			if (!parent) break;
			this.recalcNodeState(parent);
			current = parent;
		}
	}

	private findParent(parent: TreeNode, targetPath: string): TreeNode | null {
		for (const child of parent.children) {
			if (child.path === targetPath) return parent;
			if (child.isFolder) {
				const found = this.findParent(child, targetPath);
				if (found) return found;
			}
		}
		return null;
	}

	toggleExpand(node: TreeNode) {
		if (!node.isFolder) return;
		node.expanded = !node.expanded;
		this.render();
	}

	expandToPath(targetPath: string) {
		if (!this.root) return;
		const normalized = PublishStatusChecker.normalizeSyncPath(targetPath);
		if (!normalized) return;
		this.expandNodeToPath(this.root, normalized);
		this.render();
	}

	private expandNodeToPath(node: TreeNode, targetPath: string): boolean {
		if (!node.isFolder) return false;
		if (node.path === targetPath) {
			node.expanded = true;
			return true;
		}
		if (targetPath.startsWith(node.path + '/') || node.path === '') {
			for (const child of node.children) {
				if (this.expandNodeToPath(child, targetPath)) {
					node.expanded = true;
					return true;
				}
			}
		}
		return false;
	}

	getSelectedPaths(): string[] {
		if (!this.root) return [];

		if (this.root.state === 'checked') return ['/'];

		const paths: string[] = [];
		this.collectCheckedPaths(this.root, paths);

		return paths;
	}

	private collectCheckedPaths(node: TreeNode, paths: string[]) {
		if (!node.isFolder) {
			if (node.state === 'checked') {
				paths.push(node.path);
			}
			return;
		}

		if (node.state === 'checked') {
			paths.push(node.path || '/');
			return;
		}

		for (const child of node.children) {
			this.collectCheckedPaths(child, paths);
		}
	}

	selectAll() {
		if (!this.root) return;
		this.setNodeState(this.root, 'checked');
		this.render();
		this.emitChange();
	}

	deselectAll() {
		if (!this.root) return;
		this.setNodeState(this.root, 'unchecked');
		this.render();
		this.emitChange();
	}

	private emitChange() {
		this.onSelectionChange(this.getSelectedPaths());
	}

	private render() {
		this.container.empty();
		this.container.addClass('sillot-sync-tree');

		const toolbar = this.container.createDiv({ cls: 'sillot-sync-tree-toolbar' });
		toolbar.createEl('button', { text: '全选', cls: 'sillot-sync-tree-btn' }).onclick = () => this.selectAll();
		toolbar.createEl('button', { text: '全不选', cls: 'sillot-sync-tree-btn' }).onclick = () => this.deselectAll();

		const expandAllBtn = toolbar.createEl('button', { text: '展开全部', cls: 'sillot-sync-tree-btn' });
		expandAllBtn.onclick = () => { this.setExpandAll(this.root!, true); this.render(); };
		const collapseAllBtn = toolbar.createEl('button', { text: '折叠全部', cls: 'sillot-sync-tree-btn' });
		collapseAllBtn.onclick = () => { this.setExpandAll(this.root!, false); this.root!.expanded = true; this.render(); };

		const treeContainer = this.container.createDiv({ cls: 'sillot-sync-tree-container' });
		if (this.root) {
			for (const child of this.root.children) {
				this.renderNode(treeContainer, child);
			}
		} else {
			treeContainer.createEl('div', { text: '仓库为空或无法读取', cls: 'sillot-sync-tree-empty' });
		}
	}

	private setExpandAll(node: TreeNode, expanded: boolean) {
		if (node.isFolder) {
			node.expanded = expanded;
			for (const child of node.children) {
				this.setExpandAll(child, expanded);
			}
		}
	}

	private renderNode(container: HTMLElement, node: TreeNode) {
		const row = container.createDiv({
			cls: `sillot-sync-tree-row sillot-sync-tree-row--${node.isFolder ? 'folder' : 'file'}`,
		});
		row.style.paddingLeft = `${node.depth * 16 + 4}px`;

		const checkbox = row.createEl('input', {
			cls: 'sillot-sync-tree-checkbox',
			attr: { type: 'checkbox' },
		}) as HTMLInputElement;

		if (node.state === 'checked') {
			checkbox.checked = true;
		} else {
			checkbox.checked = false;
		}

		checkbox.onclick = (e) => {
			e.stopPropagation();
			this.toggleCheck(node);
		};

		if (node.isFolder) {
			const toggleBtn = row.createEl('span', { cls: 'sillot-sync-tree-toggle' });
			toggleBtn.textContent = node.expanded ? '▾' : '▸';
			toggleBtn.onclick = (e) => {
				e.stopPropagation();
				this.toggleExpand(node);
			};

			const icon = row.createSpan({ cls: 'sillot-sync-tree-icon' });
			icon.textContent = node.expanded ? '📂' : '📁';

			const label = row.createSpan({ cls: 'sillot-sync-tree-label' });
			label.textContent = node.name;

			const countBadge = row.createSpan({ cls: 'sillot-sync-tree-count' });
			const mdCount = this.countMdFiles(node);
			const checkedCount = this.countCheckedMdFiles(node);
			countBadge.textContent = `${checkedCount}/${mdCount}`;

			label.onclick = () => this.toggleExpand(node);
		} else {
			const spacer = row.createSpan({ cls: 'sillot-sync-tree-toggle-spacer' });
			spacer.textContent = ' ';

			const icon = row.createSpan({ cls: 'sillot-sync-tree-icon' });
			icon.textContent = '📄';

			const label = row.createSpan({ cls: 'sillot-sync-tree-label sillot-sync-tree-label--file' });
			label.textContent = node.name.replace(/\.md$/, '');
		}

		if (node.isFolder && node.expanded) {
			const childrenContainer = container.createDiv({ cls: 'sillot-sync-tree-children' });
			for (const child of node.children) {
				this.renderNode(childrenContainer, child);
			}
		}
	}

	private countMdFiles(node: TreeNode): number {
		let count = 0;
		for (const child of node.children) {
			if (!child.isFolder && child.path.endsWith('.md')) {
				count++;
			} else if (child.isFolder) {
				count += this.countMdFiles(child);
			}
		}
		return count;
	}

	private countCheckedMdFiles(node: TreeNode): number {
		let count = 0;
		for (const child of node.children) {
			if (!child.isFolder && child.path.endsWith('.md')) {
				if (child.state === 'checked') count++;
			} else if (child.isFolder) {
				count += this.countCheckedMdFiles(child);
			}
		}
		return count;
	}
}
