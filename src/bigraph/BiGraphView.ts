import { ItemView, WorkspaceLeaf, Notice, Modal, App } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { BiGraphData, BiGraphNode, BiGraphLink } from './types';
import { FORCE_CONFIG, CANVAS_CONFIG, STYLE_CONFIG } from './types';
import { BiGraphWebView, VIEW_TYPE_BIGRAPH_WEB } from './BiGraphWebView';
import * as d3Force from 'd3-force';
import * as d3Zoom from 'd3-zoom';
import * as d3Selection from 'd3-selection';

export const VIEW_TYPE_BIGRAPH = 'sillot-bigraph';

export class BiGraphView extends ItemView {
	plugin: VuePressPublisherPlugin;
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;
	private simulation: d3Force.Simulation<BiGraphNode, BiGraphLink> | null = null;
	private transform = d3Zoom.zoomIdentity;
	private graphData: BiGraphData = { nodes: [], links: [] };
	private hoveredNode: BiGraphNode | null = null;
	private isDragging = false;
	private draggingNode: BiGraphNode | null = null;
	private showLabels = true;
	private resizeObserver: ResizeObserver | null = null;
	private tooltipEl: HTMLElement | null = null;
	private statsEl: HTMLElement | null = null;
	private currentFilePath: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VuePressPublisherPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_BIGRAPH; }
	getDisplayText() { return '站点图谱'; }
	getIcon() { return 'git-branch'; }

	async onOpen() {
		this.render();
		this.startAutoRefresh();
	}

	async onClose() {
		this.stopSimulation();
		this.stopAutoRefresh();
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}

	private autoRefreshTimer: number | null = null;

	private startAutoRefresh() {
		this.stopAutoRefresh();
		this.autoRefreshTimer = window.setInterval(() => {
			this.updateStats();
		}, 5000);
	}

	private stopAutoRefresh() {
		if (this.autoRefreshTimer) {
			window.clearInterval(this.autoRefreshTimer);
			this.autoRefreshTimer = null;
		}
	}

	private render() {
		const container = this.contentEl;
		container.empty();
		container.addClass('sillot-bigraph-view');

		const header = container.createDiv({ cls: 'sillot-panel-header' });
		header.createEl('h4', { text: '🌐 站点图谱' });
		const closeBtn = header.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
		closeBtn.innerHTML = '✕';
		closeBtn.onclick = () => { this.leaf.detach(); };

		const toolbar = container.createDiv({ cls: 'sillot-bigraph-toolbar' });
		toolbar.createEl('button', { text: '🔄 刷新', cls: 'sillot-bigraph-btn' }).onclick = () => this.loadGraph();
		toolbar.createEl('button', { text: this.showLabels ? '🏷️ 隐藏标签' : '🏷️ 显示标签', cls: 'sillot-bigraph-btn' }).onclick = () => {
			this.showLabels = !this.showLabels;
			this.ticked();
			this.render();
		};
		toolbar.createEl('button', { text: '🔍 适应画布', cls: 'sillot-bigraph-btn' }).onclick = () => this.fitToView();
		toolbar.createEl('button', { text: '📍 当前文件', cls: 'sillot-bigraph-btn' }).onclick = () => this.focusCurrentFile();

		this.statsEl = container.createDiv({ cls: 'sillot-bigraph-stats' });
		this.updateStats();

		const canvasContainer = container.createDiv({ cls: 'sillot-bigraph-canvas-container' });
		this.canvas = canvasContainer.createEl('canvas', { cls: 'sillot-bigraph-canvas' });
		this.context = this.canvas.getContext('2d');

		this.tooltipEl = container.createDiv({ cls: 'sillot-bigraph-tooltip', attr: { style: 'display:none;' } });

		this.setupResizeObserver(canvasContainer);
		this.loadGraph();
	}

	private setupResizeObserver(container: HTMLElement) {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}
		this.resizeObserver = new ResizeObserver(() => {
			this.updateCanvasSize();
			this.ticked();
		});
		this.resizeObserver.observe(container);
	}

	private updateCanvasSize() {
		if (!this.canvas) return;
		const container = this.canvas.parentElement;
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = rect.width * dpr;
		this.canvas.height = rect.height * dpr;
		this.canvas.style.width = rect.width + 'px';
		this.canvas.style.height = rect.height + 'px';
		this.context?.scale(dpr, dpr);
	}

	private updateStats() {
		if (!this.statsEl) return;
		const data = this.graphData;
		const isolated = data.nodes.filter(n => n.isIsolated).length;
		this.statsEl.innerHTML = `
			<span class="sillot-bigraph-stat">节点: ${data.nodes.length}</span>
			<span class="sillot-bigraph-stat">链接: ${data.links.length}</span>
			<span class="sillot-bigraph-stat">孤立: ${isolated}</span>
		`;
	}

	async loadGraph() {
		if (!this.plugin.biGraphService) {
			new Notice('BiGraph 服务未初始化');
			return;
		}

		new Notice('正在加载站点图谱...');
		try {
			const data = await this.plugin.biGraphService!.getGlobalGraph();
			this.graphData = this.deepCopyData(data);
			this.markCurrentNode();
			this.initializeSimulation();
			this.setupZoom();
			this.setupCanvasEvents();
			this.updateStats();
			new Notice(`图谱加载完成: ${data.nodes.length} 节点, ${data.links.length} 链接`);
		} catch (e) {
			this.plugin.logger?.error('BiGraph', '图谱加载失败', e.message);
			new Notice(`图谱加载失败: ${e.message}`);
		}
	}

	private deepCopyData(data: BiGraphData): BiGraphData {
		const nodes = JSON.parse(JSON.stringify(data.nodes)) as BiGraphNode[];
		const links = JSON.parse(JSON.stringify(data.links)) as BiGraphLink[];
		return { nodes, links };
	}

	private markCurrentNode() {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) return;
		this.currentFilePath = activeFile.path;

		for (const node of this.graphData.nodes) {
			node.isCurrent = node.filePathRelative === activeFile.path;
		}
	}

	private initializeSimulation() {
		this.stopSimulation();

		const canvasSize = this.getCanvasSize();
		const nodes = this.graphData.nodes;
		const links = this.graphData.links;

		for (const node of nodes) {
			node.x = canvasSize.width / 2 + (Math.random() - 0.5) * 100;
			node.y = canvasSize.height / 2 + (Math.random() - 0.5) * 100;
			node.fx = null;
			node.fy = null;
		}

		this.simulation = d3Force.forceSimulation<BiGraphNode>(nodes)
			.force('link', d3Force.forceLink<BiGraphNode, BiGraphLink>(links)
				.id(d => d.id)
				.distance(FORCE_CONFIG.link.distance)
				.strength(FORCE_CONFIG.link.strength))
			.force('charge', d3Force.forceManyBody<BiGraphNode>()
				.strength(FORCE_CONFIG.charge.strength)
				.distanceMin(FORCE_CONFIG.charge.distanceMin)
				.distanceMax(FORCE_CONFIG.charge.distanceMax))
			.force('collision', d3Force.forceCollide<BiGraphNode>()
				.radius(FORCE_CONFIG.collision.radius)
				.strength(FORCE_CONFIG.collision.strength))
			.force('x', d3Force.forceX(canvasSize.width / 2)
				.strength(FORCE_CONFIG.x_strength))
			.force('y', d3Force.forceY(canvasSize.height / 2)
				.strength(FORCE_CONFIG.y_strength))
			.alphaDecay(FORCE_CONFIG.simulation.alphaDecay)
			.alphaMin(FORCE_CONFIG.simulation.alphaMin)
			.velocityDecay(FORCE_CONFIG.simulation.velocityDecay)
			.on('tick', () => this.ticked());
	}

	private stopSimulation() {
		if (this.simulation) {
			this.simulation.stop();
			this.simulation = null;
		}
	}

	private setupZoom() {
		if (!this.canvas) return;

		const zoom = d3Zoom.zoom<HTMLCanvasElement, unknown>()
			.scaleExtent(CANVAS_CONFIG.zoomExtent)
			.on('zoom', (event: d3Zoom.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
				this.transform = event.transform;
				this.ticked();
			});

		d3Selection.select(this.canvas).call(zoom as any);
	}

	private setupCanvasEvents() {
		if (!this.canvas) return;

		this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
		this.canvas.addEventListener('click', (e) => this.onClick(e));
		this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));

		const onMouseUp = (e: MouseEvent) => {
			if (this.draggingNode) {
				this.draggingNode.fx = null;
				this.draggingNode.fy = null;
				this.draggingNode = null;
				if (this.simulation) {
					this.simulation.alphaTarget(0).alpha(0.3);
				}
				document.body.style.userSelect = '';
			}
		};

		const onMouseMoveDrag = (e: MouseEvent) => {
			if (!this.draggingNode || !this.canvas) return;
			const rect = this.canvas.getBoundingClientRect();
			const x = (e.clientX - rect.left - this.transform.x) / this.transform.k;
			const y = (e.clientY - rect.top - this.transform.y) / this.transform.k;
			this.draggingNode.x = x;
			this.draggingNode.y = y;
			this.draggingNode.fx = x;
			this.draggingNode.fy = y;
			if (this.simulation) {
				this.simulation.alphaTarget(0.3).restart();
			}
			this.isDragging = true;
		};

		window.addEventListener('mousemove', onMouseMoveDrag);
		window.addEventListener('mouseup', onMouseUp);

		this.register(() => {
			window.removeEventListener('mousemove', onMouseMoveDrag);
			window.removeEventListener('mouseup', onMouseUp);
		});
	}

	private onMouseMove(e: MouseEvent) {
		if (!this.canvas || this.isDragging) return;
		const pos = this.getMousePosition(e);
		const node = this.findNodeAt(pos.x, pos.y);

		if (node !== this.hoveredNode) {
			this.hoveredNode = node;
			this.ticked();
			this.updateTooltip(e, node);
		} else if (this.tooltipEl) {
			this.tooltipEl.style.left = (e.clientX + 15) + 'px';
			this.tooltipEl.style.top = (e.clientY + 15) + 'px';
		}
	}

	private onClick(e: MouseEvent) {
		if (this.isDragging) {
			this.isDragging = false;
			return;
		}
		const pos = this.getMousePosition(e);
		const node = this.findNodeAt(pos.x, pos.y);
		if (node) {
			this.handleNodeClick(node);
		}
	}

	private onMouseDown(e: MouseEvent) {
		const pos = this.getMousePosition(e);
		const node = this.findNodeAt(pos.x, pos.y);
		if (node && this.simulation) {
			this.isDragging = false;
			this.draggingNode = node;
			document.body.style.userSelect = 'none';
			node.fx = pos.x;
			node.fy = pos.y;
			this.simulation.alphaTarget(0.3).restart();
		}
	}

	private getMousePosition(e: MouseEvent): { x: number; y: number } {
		const rect = this.canvas!.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left - this.transform.x) / this.transform.k,
			y: (e.clientY - rect.top - this.transform.y) / this.transform.k,
		};
	}

	private findNodeAt(x: number, y: number): BiGraphNode | null {
		for (const node of this.graphData.nodes) {
			if (node.x == null || node.y == null) continue;
			const dx = node.x - x;
			const dy = node.y - y;
			if (Math.sqrt(dx * dx + dy * dy) < CANVAS_CONFIG.nodeClickRadius) {
				return node;
			}
		}
		return null;
	}

	private handleNodeClick(node: BiGraphNode) {
		const modal = new BiGraphNodeModal(this.app, node, this.plugin);
		modal.open();
	}

	private updateTooltip(e: MouseEvent, node: BiGraphNode | null) {
		if (!this.tooltipEl) return;
		if (!node) {
			this.tooltipEl.style.display = 'none';
			return;
		}
		this.tooltipEl.style.display = 'block';
		this.tooltipEl.style.left = (e.clientX + 15) + 'px';
		this.tooltipEl.style.top = (e.clientY + 15) + 'px';
		this.tooltipEl.innerHTML = `
			<div class="bigraph-tooltip-title">${node.title}</div>
			<div class="bigraph-tooltip-path">${node.permalink || node.id}</div>
			<div class="bigraph-tooltip-stats">连接: ${node.linkCount} | 出链: ${node.outlink.length} | 入链: ${node.backlink.length}</div>
			${node.isCurrent ? '<div class="bigraph-tooltip-current">当前页面</div>' : ''}
			${node.siteUrl ? `<div class="bigraph-tooltip-url">站点: ${node.siteUrl}</div>` : ''}
		`;
	}

	private ticked() {
		if (!this.canvas || !this.context) return;
		const ctx = this.context;
		const canvasSize = this.getCanvasSize();
		const dpr = window.devicePixelRatio || 1;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

		ctx.save();
		ctx.translate(this.transform.x, this.transform.y);
		ctx.scale(this.transform.k, this.transform.k);

		this.drawLinks(ctx);
		this.drawNodes(ctx);
		if (this.showLabels) {
			this.drawLabels(ctx);
		}

		ctx.restore();
		ctx.restore();
	}

	private drawLinks(ctx: CanvasRenderingContext2D) {
		const accent = this.getAccentColor();
		const connectedNodes = this.getConnectedNodes();

		for (const link of this.graphData.links) {
			const source = typeof link.source === 'string'
				? this.graphData.nodes.find(n => n.id === link.source)
				: link.source as BiGraphNode;
			const target = typeof link.target === 'string'
				? this.graphData.nodes.find(n => n.id === link.target)
				: link.target as BiGraphNode;

			if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) continue;

			ctx.beginPath();
			ctx.moveTo(source.x, source.y);
			ctx.lineTo(target.x, target.y);

			if (this.hoveredNode && (source === this.hoveredNode || target === this.hoveredNode)) {
				ctx.strokeStyle = accent;
				ctx.globalAlpha = STYLE_CONFIG.link.highlightOpacity;
			} else {
				ctx.strokeStyle = STYLE_CONFIG.link.color;
				ctx.globalAlpha = this.hoveredNode
					? STYLE_CONFIG.link.normalOpacity
					: STYLE_CONFIG.link.highlightOpacity;
			}
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	private drawNodes(ctx: CanvasRenderingContext2D) {
		const accent = this.getAccentColor();
		const textColor = this.getTextColor();
		const connectedNodes = this.getConnectedNodes();

		for (const node of this.graphData.nodes) {
			if (node.x == null || node.y == null) continue;

			const linkCountBonus = Math.max(0, node.linkCount - 1) * 0.4;
			const radius = (node === this.hoveredNode ? CANVAS_CONFIG.hoverNodeRadius : CANVAS_CONFIG.nodeRadius) + linkCountBonus;

			ctx.beginPath();
			ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);

			if (node.isCurrent) {
				ctx.fillStyle = accent;
				ctx.globalAlpha = STYLE_CONFIG.node.highlightOpacity;
				ctx.fill();
				ctx.strokeStyle = accent;
				ctx.lineWidth = STYLE_CONFIG.currentNode.strokeWidth;
				ctx.stroke();
			} else if (node === this.hoveredNode) {
				ctx.fillStyle = accent;
				ctx.globalAlpha = STYLE_CONFIG.node.highlightOpacity;
				ctx.fill();
			} else if (this.hoveredNode && connectedNodes.has(node)) {
				ctx.fillStyle = textColor;
				ctx.globalAlpha = STYLE_CONFIG.node.highlightOpacity;
				ctx.fill();
			} else {
				ctx.fillStyle = textColor;
				ctx.globalAlpha = this.hoveredNode
					? STYLE_CONFIG.node.normalOpacity
					: STYLE_CONFIG.node.highlightOpacity;
				ctx.fill();
			}
		}
		ctx.globalAlpha = 1;
	}

	private drawLabels(ctx: CanvasRenderingContext2D) {
		const textColor = this.getTextColor();
		const connectedNodes = this.getConnectedNodes();

		ctx.font = STYLE_CONFIG.text.font;

		for (const node of this.graphData.nodes) {
			if (node.x == null || node.y == null) continue;

			if (this.transform.k <= STYLE_CONFIG.text.minScale) continue;

			let opacity = Math.min(
				(this.transform.k - STYLE_CONFIG.text.minScale) /
				(STYLE_CONFIG.text.maxScale - STYLE_CONFIG.text.minScale),
				1
			);

			if (this.hoveredNode) {
				if (node !== this.hoveredNode && !connectedNodes.has(node)) {
					opacity *= STYLE_CONFIG.node.normalOpacity;
				}
			}

			if (opacity <= 0) continue;

			const linkCountBonus = Math.max(0, node.linkCount - 1) * 0.4;
			const visualNodeRadius = CANVAS_CONFIG.nodeRadius + linkCountBonus;
			const textWidth = ctx.measureText(node.title).width;

			ctx.fillStyle = textColor;
			ctx.globalAlpha = opacity;
			ctx.fillText(node.title, node.x - textWidth / 2, node.y + STYLE_CONFIG.text.offset + visualNodeRadius);
		}
		ctx.globalAlpha = 1;
	}

	private getConnectedNodes(): Set<BiGraphNode> {
		const connected = new Set<BiGraphNode>();
		if (!this.hoveredNode) return connected;

		for (const link of this.graphData.links) {
			const source = typeof link.source === 'string'
				? this.graphData.nodes.find(n => n.id === link.source)
				: link.source as BiGraphNode;
			const target = typeof link.target === 'string'
				? this.graphData.nodes.find(n => n.id === link.target)
				: link.target as BiGraphNode;

			if (source === this.hoveredNode && target) connected.add(target);
			if (target === this.hoveredNode && source) connected.add(source);
		}
		return connected;
	}

	private getAccentColor(): string {
		const root = getComputedStyle(document.body);
		return root.getPropertyValue('--interactive-accent').trim() || '#7c3aed';
	}

	private getTextColor(): string {
		const root = getComputedStyle(document.body);
		return root.getPropertyValue('--text-normal').trim() || '#000000';
	}

	private getCanvasSize(): { width: number; height: number } {
		if (!this.canvas) return { width: CANVAS_CONFIG.defaultWidth, height: CANVAS_CONFIG.defaultHeight };
		const rect = this.canvas.getBoundingClientRect();
		return { width: rect.width || CANVAS_CONFIG.defaultWidth, height: rect.height || CANVAS_CONFIG.defaultHeight };
	}

	private fitToView() {
		if (!this.canvas || this.graphData.nodes.length === 0) return;

		const canvasSize = this.getCanvasSize();
		const padding = 50;

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const node of this.graphData.nodes) {
			if (node.x != null && node.y != null) {
				minX = Math.min(minX, node.x);
				minY = Math.min(minY, node.y);
				maxX = Math.max(maxX, node.x);
				maxY = Math.max(maxY, node.y);
			}
		}

		const dataWidth = maxX - minX || 1;
		const dataHeight = maxY - minY || 1;
		const scaleX = (canvasSize.width - padding * 2) / dataWidth;
		const scaleY = (canvasSize.height - padding * 2) / dataHeight;
		const scale = Math.min(scaleX, scaleY, 3);

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		this.transform = d3Zoom.zoomIdentity
			.translate(canvasSize.width / 2, canvasSize.height / 2)
			.scale(scale)
			.translate(-centerX, -centerY);

		this.ticked();
	}

	focusCurrentFile() {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('没有打开的文件');
			return;
		}

		const node = this.graphData.nodes.find(n => n.filePathRelative === activeFile.path);
		if (!node) {
			new Notice('当前文件不在图谱中');
			return;
		}

		node.isCurrent = true;
		for (const n of this.graphData.nodes) {
			if (n !== node) n.isCurrent = false;
		}

		if (node.x != null && node.y != null) {
			const canvasSize = this.getCanvasSize();
			this.transform = d3Zoom.zoomIdentity
				.translate(canvasSize.width / 2, canvasSize.height / 2)
				.scale(2)
				.translate(-node.x, -node.y);
			this.ticked();
		}
	}
}

class BiGraphNodeModal extends Modal {
	private node: BiGraphNode;
	private plugin: VuePressPublisherPlugin;

	constructor(app: App, node: BiGraphNode, plugin: VuePressPublisherPlugin) {
		super(app);
		this.node = node;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('sillot-bigraph-node-modal');

		contentEl.createEl('h3', { text: this.node.title });

		const infoDiv = contentEl.createDiv({ cls: 'bigraph-modal-info' });
		infoDiv.createEl('p', { text: `路径: ${this.node.filePathRelative || '未知'}` });
		infoDiv.createEl('p', { text: `Permalink: ${this.node.permalink || '未知'}` });
		infoDiv.createEl('p', { text: `连接数: ${this.node.linkCount}` });
		infoDiv.createEl('p', { text: `出链: ${this.node.outlink.length} | 入链: ${this.node.backlink.length}` });

		if (this.node.isCurrent) {
			infoDiv.createEl('p', { text: '⭐ 当前页面', cls: 'bigraph-modal-current' });
		}
		if (this.node.isIsolated) {
			infoDiv.createEl('p', { text: '🏝️ 孤立节点', cls: 'bigraph-modal-isolated' });
		}

		const actionsDiv = contentEl.createDiv({ cls: 'bigraph-modal-actions' });

		if (this.node.siteUrl) {
			actionsDiv.createEl('button', { text: '🌐 在站点中预览', cls: 'mod-cta' }).onclick = async () => {
				await this.plugin.openSitePreview(this.node.siteUrl!);
				this.close();
			};
		}

		if (this.node.filePathRelative) {
			actionsDiv.createEl('button', { text: '📝 在 Obsidian 中打开' }).onclick = async () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(this.node.filePathRelative!);
				if (file) {
					await this.plugin.app.workspace.getLeaf(false).openFile(file as any);
					this.close();
				} else {
					new Notice('文件不存在');
				}
			};
		}

		actionsDiv.createEl('button', { text: '关闭' }).onclick = () => this.close();

		if (this.node.outlink.length > 0) {
			const outDiv = contentEl.createDiv({ cls: 'bigraph-modal-links' });
			outDiv.createEl('h4', { text: `出链 (${this.node.outlink.length})` });
			const outList = outDiv.createEl('ul');
			for (const id of this.node.outlink.slice(0, 20)) {
				outList.createEl('li', { text: id });
			}
			if (this.node.outlink.length > 20) {
				outList.createEl('li', { text: `...还有 ${this.node.outlink.length - 20} 条` });
			}
		}

		if (this.node.backlink.length > 0) {
			const backDiv = contentEl.createDiv({ cls: 'bigraph-modal-links' });
			backDiv.createEl('h4', { text: `入链 (${this.node.backlink.length})` });
			const backList = backDiv.createEl('ul');
			for (const id of this.node.backlink.slice(0, 20)) {
				backList.createEl('li', { text: id });
			}
			if (this.node.backlink.length > 20) {
				backList.createEl('li', { text: `...还有 ${this.node.backlink.length - 20} 条` });
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
