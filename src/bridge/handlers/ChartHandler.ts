import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';
import { MarkdownPostProcessorContext } from 'obsidian';

declare global {
	interface Window {
		SillotExt?: {
			echarts: any;
			ChartJS: any;
			parseFlowchart: any;
			Transformer: any;
			Markmap: any;
			globalCSS?: string;
		};
	}
}

interface ChartConfig {
	type: 'echarts' | 'chartjs' | 'flowchart' | 'markmap';
	rawContent: string;
	options?: Record<string, unknown>;
}

interface ExtLibraries {
	echarts: any;
	ChartJS: any;
	parseFlowchart: any;
	Transformer: any;
	Markmap: any;
	globalCSS?: string;
}

export class ChartHandler extends BaseSyntaxHandler {
	private static readonly CHART_CONTAINER_PREFIX = 'sillot-chart-';
	static readonly CHART_TYPES = new Set(['echarts', 'chartjs', 'flowchart', 'markmap']);

	private static extLoadPromise: Promise<ExtLibraries | null> | null = null;
	private static extLibs: ExtLibraries | null = null;

	processInlineComponents(el: HTMLElement): void {
		this.processChartContainers(el);
	}

	createChartContainer(chartType: string, contentText: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'sillot-chart-container';
		container.setAttribute('data-chart-type', chartType);
		container.setAttribute('data-chart-content', contentText);

		const typeLabels: Record<string, string> = {
			echarts: 'ECharts',
			chartjs: 'Chart.js',
			flowchart: 'Flowchart',
			markmap: 'Markmap',
		};

		const header = document.createElement('div');
		header.className = 'sillot-chart-header';
		header.innerHTML = `
			<span class="sillot-chart-type">${typeLabels[chartType] || chartType}</span>
			<span class="sillot-chart-actions">
				<button class="sillot-chart-action-btn" data-action="copy" title="复制代码">📋</button>
				<button class="sillot-chart-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
			</span>
		`;
		container.appendChild(header);

		const canvas = document.createElement('div');
		canvas.className = 'sillot-chart-canvas';
		container.appendChild(canvas);

		this.bindChartActions(container, contentText);
		this.renderChart(container, { type: chartType as ChartConfig['type'], rawContent: contentText }).catch(err => {
			this.plugin.logger?.warn('Chart', '图表渲染失败:', err);
		});

		return container;
	}

	private processChartContainers(el: HTMLElement): void {
		const chartContainers = el.querySelectorAll<HTMLElement>('.sillot-chart-container');

		chartContainers.forEach(container => {
			if (container.dataset.rendered === 'true') return;
			const chartType = container.dataset.chartType as ChartConfig['type'];
			const rawContent = container.dataset.chartContent || '';
			if (!chartType || !rawContent) return;
			this.renderChart(container, { type: chartType, rawContent });
		});
	}

	async renderChart(container: HTMLElement, config: ChartConfig): Promise<void> {
		const chartId = `${ChartHandler.CHART_CONTAINER_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		container.id = chartId;
		this.showLoadingState(container, config.type);

		try {
			switch (config.type) {
				case 'echarts':
					await this.renderECharts(container, config.rawContent);
					break;
				case 'chartjs':
					await this.renderChartJS(container, config.rawContent);
					break;
				case 'flowchart':
					await this.renderFlowchart(container, config.rawContent);
					break;
				case 'markmap':
					await this.renderMarkmap(container, config.rawContent);
					break;
				default:
					throw new Error(`不支持的图表类型: ${config.type}`);
			}
			container.dataset.rendered = 'true';
			container.classList.add('sillot-chart-rendered');
		} catch (error) {
			this.showErrorState(container, error as Error, config.type);
		}
	}

	/**
	 * 确保侧载依赖已加载（单例模式，全局只加载一次）
	 * 返回库对象，若加载失败返回 null
	 */
	private async ensureExtLoaded(): Promise<ExtLibraries | null> {
		if (ChartHandler.extLibs) {
			const valid = this.validateExtLibs(ChartHandler.extLibs);
			if (valid) return ChartHandler.extLibs;
			this.plugin.logger?.warn('Chart', '缓存的 extLibs 无效，重新加载');
			ChartHandler.extLibs = null;
		}
		if (ChartHandler.extLoadPromise) {
			return ChartHandler.extLoadPromise;
		}

		const extPath = this.plugin.settings?.extPath;
		if (!extPath) {
			this.plugin.logger?.warn('Chart', 'extPath 未配置，图表功能不可用');
			return null;
		}

		ChartHandler.extLoadPromise = (async () => {
			try {
				if (window.SillotExt) {
					const valid = this.validateExtLibs(window.SillotExt as any);
					if (valid) {
						ChartHandler.extLibs = window.SillotExt as ExtLibraries;
						return ChartHandler.extLibs;
					}
				}

				const relativePath = this.normalizeExtPath(extPath);
				await this.loadScriptInline(relativePath);

				if (!window.SillotExt) {
					throw new Error('侧载包执行完成但未导出 window.SillotExt');
				}

				const finalValid = this.validateExtLibs(window.SillotExt as any);
				if (!finalValid) {
					throw new Error('侧载包已加载但缺少必要导出项');
				}

				ChartHandler.extLibs = window.SillotExt as ExtLibraries;
				this.plugin.logger?.debug('Chart', '高级依赖加载成功');
				return ChartHandler.extLibs;
			} catch (err) {
				this.plugin.logger?.warn('Chart', '高级依赖加载失败:', err);
				return null;
			} finally {
				ChartHandler.extLoadPromise = null;
			}
		})();

		return ChartHandler.extLoadPromise;
	}

	private validateExtLibs(libs: any): boolean {
		if (!libs || typeof libs !== 'object') return false;
		const required = ['echarts', 'ChartJS'];
		for (const key of required) {
			if (!libs[key]) return false;
		}
		return true;
	}

	private normalizeExtPath(extPath: string): string {
		let p = extPath.trim();
		if (p.startsWith('./')) p = p.substring(2);
		if (p.startsWith('../')) p = p.substring(3);
		while (p.startsWith('/')) p = p.substring(1);
		return p;
	}

	private async loadScriptInline(relativePath: string): Promise<void> {
		let content: string;
		try {
			content = await this.readExtFile(relativePath);
		} catch (readErr) {
			throw new Error(`读取侧载包失败 (${relativePath}): ${(readErr as Error).message}`);
		}

		if (!content || content.length < 100) {
			throw new Error(`侧载包文件过小或为空 (${content?.length ?? 0} bytes)`);
		}

		const scriptId = 'sillot-ext-script';
		const existing = document.getElementById(scriptId);
		if (existing) {
			existing.remove();
		}

		return new Promise<void>((resolve, reject) => {
			try {
				const script = document.createElement('script');
				script.id = scriptId;
				script.textContent = content;
				document.head.appendChild(script);

				setTimeout(() => {
					resolve();
				}, 300);
			} catch (err) {
				reject(err);
			}
		});
	}

	private async readExtFile(extPath: string): Promise<string> {
		const isAbsolutePath = /^[A-Za-z]:\\|^\//.test(extPath);
		if (isAbsolutePath) {
			return this.readViaNodeFs(extPath);
		}
		return this.readViaAdapter(extPath);
	}

	private readViaNodeFs(absolutePath: string): string {
		try {
			const fs = require('fs') as { readFileSync: (p: string, e?: string) => Buffer };
			return fs.readFileSync(absolutePath, 'utf-8').toString();
		} catch (err: any) {
			if (err.code === 'ENOENT') {
				throw new Error(`文件不存在: ${absolutePath}`);
			}
			throw new Error(`读取文件失败 (${absolutePath}): ${err.message}`);
		}
	}

	private async readViaAdapter(relativePath: string): Promise<string> {
		const adapter = this.plugin.app.vault.adapter;
		try {
			return await adapter.read(relativePath);
		} catch (err: any) {
			throw new Error(`Vault 内读取失败 (${relativePath}): ${err.message}`);
		}
	}

	/** ====== ECharts 渲染 ====== */

	private async renderECharts(container: HTMLElement, jsonConfig: string): Promise<void> {
		const libs = await this.ensureExtLoaded();
		if (!libs?.echarts) throw new Error('ECharts 库未加载，请检查高级依赖侧载配置');

		const echarts = libs.echarts;
		const canvasEl = container.querySelector<HTMLDivElement>('.sillot-chart-canvas') || container;

		let options: Record<string, unknown>;
		try {
			options = JSON.parse(jsonConfig);
		} catch {
			throw new Error('ECharts 配置 JSON 格式无效');
		}

		const chartDom = document.createElement('div');
		chartDom.style.width = '100%';
		chartDom.style.height = '400px';
		canvasEl.innerHTML = '';
		canvasEl.appendChild(chartDom);

		const chart = echarts.init(chartDom);
		const isDark = document.body.classList.contains('theme-dark');
		if (!options.theme && isDark) {
			Object.assign(options, { backgroundColor: 'transparent' });
		}
		chart.setOption(options);

		const resizeObserver = new ResizeObserver(() => chart.resize());
		resizeObserver.observe(canvasEl);
		(container as any)._chartInstance = chart;
		(container as any)._resizeObserver = resizeObserver;
	}

	/** ====== Chart.js 渲染 ====== */

	private async renderChartJS(container: HTMLElement, jsonConfig: string): Promise<void> {
		const libs = await this.ensureExtLoaded();
		if (!libs?.ChartJS) throw new Error('Chart.js 库未加载，请检查高级依赖侧载配置');

		const ChartJS = libs.ChartJS;
		const canvasEl = container.querySelector('.sillot-chart-canvas') || container;

		let config: Record<string, unknown>;
		try {
			config = JSON.parse(jsonConfig);
		} catch {
			throw new Error('Chart.js 配置 JSON 格式无效');
		}

		const canvas = document.createElement('canvas');
		canvasEl.innerHTML = '';
		canvasEl.appendChild(canvas);

		const chartInstance = new ChartJS(canvas.getContext('2d')!, config as any);
		(canvas as any).__chartjsInstance = chartInstance;
		(container as any)._chartInstance = canvas;
	}

	/** ====== Flowchart.ts v3 渲染 ====== */

	private async renderFlowchart(container: HTMLElement, configStr: string): Promise<void> {
		const libs = await this.ensureExtLoaded();
		if (!libs?.parseFlowchart) throw new Error('Flowchart 库未加载，请检查高级依赖侧载配置');

		const parseFlowchart = libs.parseFlowchart;
		const canvasEl = container.querySelector('.sillot-chart-canvas') || container;

		let definition: string;
		try {
			const parsed = JSON.parse(configStr);
			definition = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
		} catch {
			definition = configStr;
		}

		const svgDiv = document.createElement('div');
		svgDiv.style.width = '100%';
		canvasEl.innerHTML = '';
		canvasEl.appendChild(svgDiv);

		const textColor = getComputedStyle(document.documentElement)
			.getPropertyValue('--text-normal').trim() || '#333';
		const bgColor = getComputedStyle(document.documentElement)
			.getPropertyValue('--background-secondary').trim() || '#fff';

		try {
			const chart = parseFlowchart(definition);
			chart.draw(svgDiv, {
				'line-width': 2,
				'maxWidth': 3,
				'line-length': 50,
				'text-margin': 10,
				'font-size': 14,
				'font-color': textColor,
				'element-color': bgColor,
				fill: 'white',
				'yes-text': '是',
				'no-text': '否',
				'arrow-end': 'block',
				scale: 1,
				symbols: {
					start: { 'font-color': '#008000', 'element-color': '#E8F5E9', fill: '#C8E6C9' },
					end: { class: 'end-element' },
				},
			});
		} catch (error) {
			this.plugin.logger?.warn('Chart', 'Flowchart 渲染失败:', error);
			throw error;
		}
	}

	/** ====== Markmap 渲染 ====== */

	private async renderMarkmap(container: HTMLElement, markdown: string): Promise<void> {
		const libs = await this.ensureExtLoaded();
		if (!libs?.Markmap || !libs?.Transformer) throw new Error('Markmap 库未加载，请检查高级依赖侧载配置');

		const { Markmap, Transformer, globalCSS } = libs;
		const canvasEl = container.querySelector('.sillot-chart-canvas') || container;
		canvasEl.innerHTML = '';

		if (!document.getElementById('sillot-markmap-style')) {
			const styleEl = document.createElement('style');
			styleEl.id = 'sillot-markmap-style';
			styleEl.textContent = globalCSS || '';
			document.head.appendChild(styleEl);
		}

		const svgDiv = document.createElement('div');
		svgDiv.style.width = '100%';
		svgDiv.style.height = '500px';
		canvasEl.appendChild(svgDiv);

		try {
			const transformer = new Transformer([]);
			const { root } = transformer.transform(markdown.trim());

			const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svgEl.setAttribute('width', '100%');
			svgEl.setAttribute('height', '100%');
			svgDiv.appendChild(svgEl);

			const mm = Markmap.create(svgEl, {
				autoFit: true,
				duration: 300,
				maxWidth: 300,
				paddingX: 16,
				initialExpandLevel: -1,
			}, root);

			(container as any)._chartInstance = mm;
			(container as any)._svgContainer = svgDiv;
		} catch (error) {
			this.plugin.logger?.warn('Chart', 'Markmap 渲染失败:', error);
			throw error;
		}
	}

	/** ====== UI 辅助方法 ====== */

	private showLoadingState(container: HTMLElement, type: string): void {
		const canvasEl = container.querySelector('.sillot-chart-canvas');
		if (canvasEl) {
			canvasEl.innerHTML = `
				<div class="sillot-chart-loading">
					<div class="sillot-spinner"></div>
					<p>正在加载 ${type.toUpperCase()} 引擎...</p>
				</div>
			`;
		}
	}

	private showErrorState(container: HTMLElement, error: Error, type: string): void {
		const canvasEl = container.querySelector('.sillot-chart-canvas');
		if (canvasEl) {
			canvasEl.innerHTML = `
				<div class="sillot-chart-error">
					<div class="sillot-error-icon">⚠️</div>
					<h4>${type.toUpperCase()} 渲染失败</h4>
					<p>${error.message}</p>
					<pre class="sillot-error-details">${error.stack || ''}</pre>
				</div>
			`;
		}
		container.classList.add('sillot-chart-error-state');
	}

	private bindChartActions(wrapper: HTMLElement, code: string): void {
		const buttons = wrapper.querySelectorAll('.sillot-chart-action-btn');

		buttons.forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();

				const action = (btn as HTMLElement).dataset.action;
				switch (action) {
					case 'copy':
						navigator.clipboard.writeText(code).then(() => {
							this.showToast('已复制到剪贴板');
						});
						break;
					case 'fullscreen':
						this.openFullscreen(wrapper);
						break;
				}
			});
		});
	}

	private openFullscreen(element: HTMLElement): void {
		const chartCanvas = element.querySelector('.sillot-chart-canvas');
		if (!chartCanvas) return;

		const overlay = document.createElement('div');
		overlay.className = 'sillot-chart-fullscreen-overlay';

		const toolbar = document.createElement('div');
		toolbar.className = 'sillot-chart-fullscreen-toolbar';
		toolbar.innerHTML = `
			<span class="sillot-chart-fullscreen-title">${element.querySelector('.sillot-chart-type')?.textContent || 'Chart'}</span>
			<button class="sillot-chart-fullscreen-close" title="退出全屏 (ESC)">✕</button>
		`;

		const contentArea = document.createElement('div');
		contentArea.className = 'sillot-chart-fullscreen-content';

		overlay.appendChild(toolbar);
		overlay.appendChild(contentArea);
		document.body.appendChild(overlay);

		const originalParent = chartCanvas.parentNode;
		contentArea.appendChild(chartCanvas);

		requestAnimationFrame(() => {
			overlay.classList.add('sillot-chart-fullscreen-active');
			this.resizeChartInElement(chartCanvas as HTMLElement);
		});

		const closeFullscreen = () => {
			overlay.classList.remove('sillot-chart-fullscreen-active');
			setTimeout(() => {
				if (originalParent) originalParent.appendChild(chartCanvas);
				requestAnimationFrame(() => this.resizeChartInElement(chartCanvas as HTMLElement));
				overlay.remove();
			}, 200);
			document.removeEventListener('keydown', escHandler);
		};

		const escHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') closeFullscreen();
		};
		document.addEventListener('keydown', escHandler);

		toolbar.querySelector('.sillot-chart-fullscreen-close')?.addEventListener('click', closeFullscreen);
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeFullscreen();
		});
	}

	private resizeChartInElement(el: HTMLElement): void {
		const echartsDom = el.querySelector('div[_echarts_instance_]');
		if (echartsDom) {
			const instanceId = echartsDom.getAttribute('_echarts_instance_');
			const libs = ChartHandler.extLibs;
			if (instanceId && libs?.echarts?.getInstanceById) {
				const instance = libs.echarts.getInstanceById(instanceId);
				if (instance) requestAnimationFrame(() => instance.resize());
			}
		}

		const canvasEl = el.querySelector('canvas');
		if (canvasEl && (canvasEl as any).__chartjsInstance) {
			const chart = (canvasEl as any).__chartjsInstance;
			if (chart?.resize) requestAnimationFrame(() => chart.resize());
		}

		const mmInstance = (el as any)?.mm;
		if (mmInstance?.fit) requestAnimationFrame(() => mmInstance.fit());
	}

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

	dispose(): void {
		document.querySelectorAll('.sillot-chart-rendered').forEach(container => {
			if ((container as any)._chartInstance) {
				(container as any)._chartInstance.destroy?.();
				(container as any)._chartInstance.dispose?.();
			}
			if ((container as any)._resizeObserver) {
				(container as any)._resizeObserver.disconnect?.();
			}
		});
	}
}
