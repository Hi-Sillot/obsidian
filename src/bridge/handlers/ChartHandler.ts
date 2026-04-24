import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';
import { MarkdownPostProcessorContext, MarkdownRenderer } from 'obsidian';

interface ChartConfig {
	type: 'mermaid' | 'echarts' | 'chartjs' | 'flowchart';
	rawContent: string;
	options?: Record<string, unknown>;
}

interface LoadedLibrary {
	name: string;
	loaded: boolean;
	promise?: Promise<any>;
	error?: Error;
}

export class ChartHandler extends BaseSyntaxHandler {
	private static readonly CHART_CONTAINER_PREFIX = 'sillot-chart-';
	private loadedLibraries = new Map<string, LoadedLibrary>();

	// CDN 地址（使用可靠的 CDN）
	private static readonly CDN_URLS = {
		mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.esm.mjs',
		echarts: 'https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js',
		chartjs: 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.js',
		flowchart: 'https://cdn.jsdelivr.net/npm/@flowchart-ts/core@3/dist/index.umd.js',
	};

	processInlineComponents(el: HTMLElement): void {
		this.processMermaidBlocks(el);
		this.processChartContainers(el);
	}

	/**
	 * 处理 Mermaid 代码块
	 * Obsidian 原生支持 Mermaid，这里主要确保样式一致性和错误处理
	 */
	private processMermaidBlocks(el: HTMLElement): void {
		const mermaidBlocks = el.querySelectorAll<HTMLElement>('pre.language-mermaid');

		mermaidBlocks.forEach(block => {
			if (block.classList.contains('sillot-mermaid-processed')) return;

			const codeEl = block.querySelector('code');
			if (!codeEl) return;

			const mermaidCode = codeEl.textContent?.trim();
			if (!mermaidCode) return;

			// 标记为已处理
			block.classList.add('sillot-mermaid-processed', 'sillot-chart-enhanced');

			// 添加容器包装以统一样式
			this.wrapMermaidBlock(block, mermaidCode);
		});
	}

	/**
	 * 包装 Mermaid 代码块以添加统一样式
	 */
	private wrapMermaidBlock(block: HTMLElement, code: string): void {
		const wrapper = document.createElement('div');
		wrapper.className = 'sillot-mermaid-wrapper';
		wrapper.setAttribute('data-chart-type', 'mermaid');

		// 创建标题栏
		const header = document.createElement('div');
		header.className = 'sillot-chart-header';
		header.innerHTML = `
			<span class="sillot-chart-type">Mermaid</span>
			<span class="sillot-chart-actions">
				<button class="sillot-chart-action-btn" data-action="copy" title="复制代码">📋</button>
				<button class="sillot-chart-action-btn" data-action="fullscreen" title="全屏查看">⛶</button>
			</span>
		`;

		// 将原始 block 移入包装器
		block.parentNode?.insertBefore(wrapper, block);
		wrapper.appendChild(header);
		wrapper.appendChild(block);

		// 绑定按钮事件
		this.bindChartActions(wrapper, code);
	}

	/**
	 * 处理自定义图表容器 (::: echarts, ::: chartjs, ::: flowchart)
	 */
	private processChartContainers(el: HTMLElement): void {
		// 查找所有图表容器
		const chartContainers = el.querySelectorAll<HTMLElement>('.sillot-chart-container');

		chartContainers.forEach(container => {
			if (container.dataset.rendered === 'true') return;

			const chartType = container.dataset.chartType as ChartConfig['type'];
			const rawContent = container.dataset.chartContent || '';

			if (!chartType || !rawContent) return;

			this.renderChart(container, { type: chartType, rawContent });
		});
	}

	/**
	 * 渲染图表到指定容器
	 */
	async renderChart(container: HTMLElement, config: ChartConfig): Promise<void> {
		const chartId = `${ChartHandler.CHART_CONTAINER_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		container.id = chartId;

		// 显示加载状态
		this.showLoadingState(container, config.type);

		try {
			switch (config.type) {
				case 'mermaid':
					await this.renderMermaid(container, config.rawContent);
					break;
				case 'echarts':
					await this.renderECharts(container, config.rawContent);
					break;
				case 'chartjs':
					await this.renderChartJS(container, config.rawContent);
					break;
				case 'flowchart':
					await this.renderFlowchart(container, config.rawContent);
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
	 * 渲染 Mermaid 图表
	 */
	private async renderMermaid(container: HTMLElement, code: string): Promise<void> {
		// 尝试加载 Mermaid 库
		const mermaid = await this.loadLibrary('mermaid');

		if (!mermaid) {
			// 如果无法加载外部库，尝试使用 Obsidian 内置渲染
			await this.renderWithObsidianMermaid(container, code);
			return;
		}

		// 使用外部 Mermaid 库渲染
		const renderId = `mermaid-${Date.now()}`;

		try {
			// 初始化 Mermaid（如果尚未初始化）
			if (!(mermaid as any).isInitialized) {
				await mermaid.initialize({
					startOnLoad: false,
					theme: document.body.classList.contains('theme-dark') ? 'dark' : 'default',
					securityLevel: 'loose',
					fontFamily: 'var(--font-text)',
				});
				(mermaid as any).isInitialized = true;
			}

			// 创建 SVG 容器
			const svgContainer = container.querySelector('.sillot-chart-canvas') || container;
			svgContainer.innerHTML = '';

			// 渲染 Mermaid
			const { svg } = await mermaid(renderId, code.trim());
			svgContainer.innerHTML = svg;

			// 设置 SVG 样式使其响应式
			const svgElement = svgContainer.querySelector('svg');
			if (svgElement) {
				svgElement.style.maxWidth = '100%';
				svgElement.style.height = 'auto';
			}
		} catch (error) {
			console.error('[Sillot] Mermaid 渲染失败:', error);
			throw error;
		}
	}

	/**
	 * 使用 Obsidian 内置的 Mermaid 渲染（降级方案）
	 */
	private async renderWithObsidianMermaid(container: HTMLElement, code: string): Promise<void> {
		const canvasEl = (container.querySelector('.sillot-chart-canvas') || container) as HTMLElement;

		try {
			// 直接插入 Mermaid 代码让 Obsidian 处理
			const preEl = document.createElement('pre');
			preEl.className = 'language-mermaid';
			const codeEl = document.createElement('code');
			codeEl.textContent = code;
			preEl.appendChild(codeEl);
			canvasEl.innerHTML = '';
			canvasEl.appendChild(preEl);

			// 触发 Obsidian 的 Markdown 渲染
			await MarkdownRenderer.render(
				this.plugin.app,
				`\`\`\`mermaid\n${code}\n\`\`\``,
				canvasEl,
				'', // sourcePath
				this.plugin
			);
		} catch (error) {
			console.error('[Sillot] Obsidian Mermaid 降级渲染失败:', error);
			throw error;
		}
	}

	/**
	 * 渲染 ECharts 图表
	 */
	private async renderECharts(container: HTMLElement, jsonConfig: string): Promise<void> {
		const echarts = await this.loadLibrary('echarts');
		if (!echarts) throw new Error('ECharts 库加载失败');

		const canvasEl = container.querySelector<HTMLDivElement>('.sillot-chart-canvas') || container;

		// 解析配置
		let options: Record<string, unknown>;
		try {
			options = JSON.parse(jsonConfig);
		} catch {
			throw new Error('ECharts 配置 JSON 格式无效');
		}

		// 创建 Canvas 容器
		const chartDom = document.createElement('div');
		chartDom.style.width = '100%';
		chartDom.style.height = '400px'; // 默认高度
		canvasEl.innerHTML = '';
		canvasEl.appendChild(chartDom);

		// 初始化图表
		const chart = echarts.init(chartDom);

		// 应用主题适配
		const isDark = document.body.classList.contains('theme-dark');
		if (!options.theme && isDark) {
			Object.assign(options, { backgroundColor: 'transparent' });
		}

		// 设置选项并渲染
		chart.setOption(options);

		// 响应式调整
		const resizeObserver = new ResizeObserver(() => chart.resize());
		resizeObserver.observe(canvasEl);

		// 存储实例以便后续销毁
		(container as any)._chartInstance = chart;
		(container as any)._resizeObserver = resizeObserver;
	}

	/**
	 * 渲染 Chart.js 图表
	 */
	private async renderChartJS(container: HTMLElement, jsonConfig: string): Promise<void> {
		const ChartJS = await this.loadLibrary('chartjs');
		if (!ChartJS) throw new Error('Chart.js 库加载失败');

		const canvasEl = container.querySelector('.sillot-chart-canvas') || container;

		// 解析配置
		let config: Record<string, unknown>;
		try {
			config = JSON.parse(jsonConfig);
		} catch {
			throw new Error('Chart.js 配置 JSON 格式无效');
		}

		// 创建 Canvas 元素
		const canvas = document.createElement('canvas');
		canvasEl.innerHTML = '';
		canvasEl.appendChild(canvas);

		// 初始化图表
		new ChartJS(canvas.getContext('2d')!, config as any);

		// 存储引用
		(container as any)._chartInstance = canvas;
	}

	/**
	 * 渲染 Flowchart.js 图表
	 */
	private async renderFlowchart(container: HTMLElement, configStr: string): Promise<void> {
		const flowchartLib = await this.loadLibrary('flowchart');
		if (!flowchartLib) throw new Error('Flowchart 库加载失败');

		const canvasEl = container.querySelector('.sillot-chart-canvas') || container;

		// 创建 SVG 容器
		const svgDiv = document.createElement('div');
		svgDiv.style.width = '100%';
		svgDiv.style.height = 'auto';
		canvasEl.innerHTML = '';
		canvasEl.appendChild(svgDiv);

		// 解析配置（支持简单文本定义）
		let definition: string;
		try {
			// 尝试解析为 JSON
			const parsed = JSON.parse(configStr);
			definition = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
		} catch {
			// 作为纯文本处理
			definition = configStr;
		}

		// 使用 Flowchart 库渲染
		try {
			(flowchartLib as any).parse(definition, (element: any) => {
				element.drawSVG(svgDiv, {
					'line-width': 2,
					'maxWidth': 3,
					'line-length': 50,
					'text-margin': 10,
					'font-size': 14,
					'font-color': getComputedStyle(document.documentElement)
						.getPropertyValue('--text-normal').trim() || '#333',
					'element-color': getComputedStyle(document.documentElement)
						.getPropertyValue('--background-secondary').trim() || '#fff',
					'fill': 'white',
					'yes-text': '是',
					'no-text': '否',
					'arrow-end': 'block',
					'scale': 1,
					'symbols': {
						'start': {
							'font-color': '#008000',
							'element-color': '#E8F5E9',
							'fill': '#C8E6C9'
						},
						'end': {
							'class': 'end-element'
						}
					}
				});
			});
		} catch (error) {
			console.error('[Sillot] Flowchart 渲染失败:', error);
			throw error;
		}
	}

	/**
	 * 动态加载图表库（带缓存）
	 */
	private async loadLibrary(name: keyof typeof ChartHandler.CDN_URLS): Promise<any> {
		// 检查是否已加载
		const cached = this.loadedLibraries.get(name);
		if (cached?.loaded) {
			return (window as any)[this.getGlobalVarName(name)];
		}

		// 如果正在加载，等待完成
		if (cached?.promise) {
			return cached.promise.then(() => (window as any)[this.getGlobalVarName(name)]);
		}

		// 开始加载
		const url = ChartHandler.CDN_URLS[name];
		const loadInfo: LoadedLibrary = { name, loaded: false };

		loadInfo.promise = new Promise<any>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = url;
			script.async = true;
			script.onload = () => {
				loadInfo.loaded = true;
				resolve((window as any)[this.getGlobalVarName(name)]);
			};
			script.onerror = () => {
				const error = new Error(`加载 ${name} 库失败: ${url}`);
				loadInfo.error = error;
				reject(error);
			};
			document.head.appendChild(script);
		}).catch(error => {
			console.warn(`[Sillot] ${name} 加载失败:`, error);
			return null;
		});

		this.loadedLibraries.set(name, loadInfo);

		return loadInfo.promise;
	}

	/**
	 * 获取全局变量名
	 */
	private getGlobalVarName(name: string): string {
		const names: Record<string, string> = {
			mermaid: 'mermaid',
			echarts: 'echarts',
			chartjs: 'Chart',
			flowchart: 'flowchart',
		};
		return names[name] || name;
	}

	/**
	 * 显示加载状态
	 */
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

	/**
	 * 显示错误状态
	 */
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

	/**
	 * 绑定图表操作按钮事件
	 */
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

	/**
	 * 打开全屏模式
	 */
	private openFullscreen(element: HTMLElement): void {
		if (element.requestFullscreen) {
			element.requestFullscreen();
		} else if ((element as any).webkitRequestFullscreen) {
			(element as any).webkitRequestFullscreen();
		}

		element.classList.add('sillot-chart-fullscreen');

		// 监听退出全屏
		document.addEventListener('fullscreenchange', () => {
			if (!document.fullscreenElement) {
				element.classList.remove('sillot-chart-fullscreen');
			}
		}, { once: true });
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
	 * 清理资源（在组件卸载时调用）
	 */
	dispose(): void {
		// 销毁所有图表实例
		document.querySelectorAll('.sillot-chart-rendered').forEach(container => {
			if ((container as any)._chartInstance) {
				(container as any)._chartInstance.destroy?.();
			}
			if ((container as any)._chartInstance) {
				(container as any)._chartInstance.dispose?.();
			}
			if ((container as any)._resizeObserver) {
				(container as any)._resizeObserver.disconnect?.();
			}
		});

		// 清除缓存的库引用
		this.loadedLibraries.clear();
	}
}
