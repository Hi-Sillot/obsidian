import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';
import { QRCodeHandler } from './QRCodeHandler';

interface InlineMatch {
	type: 'abbr' | 'annotation' | 'icon' | 'plot' | 'pdf';
	raw: string;
	content: string;
	attrs?: Record<string, string>;
}

export class InlineSyntaxHandler extends BaseSyntaxHandler {
	private qrcodeHandler: QRCodeHandler;

	private static readonly ABBR_REGEX = /\[([^\]]+)\]\(abbr\s+"([^"]+)"\)/g;
	private static readonly ANNOTATION_REGEX = /<sup>\[\^(\w+)\]<\/sup>/g;
	private static readonly ICON_REGEX = /:([\w-]+(?:-[\w-]+)*):/g;
	private static readonly PLOT_REGEX = /```plot\n([\s\S]*?)\n```/g;
	private static readonly PDF_REGEX = /<Pdf\s+(?:src|url)="([^"]+)"\s*(?:width="([^"]*)")?\s*(?:height="([^"]*)")?\s*\/?>/gi;

	constructor(plugin: VuePressPublisherPlugin) {
		super(plugin);
		this.qrcodeHandler = new QRCodeHandler(plugin);
	}

	async processInlineComponents(el: HTMLElement): Promise<void> {
		this.processAbbreviations(el);
		this.processAnnotations(el);
		this.processIcons(el);
		this.processPlots(el);
		this.processPdfs(el);
		await this.qrcodeHandler.processInlineComponents(el);
	}

	preprocessMarkdown(text: string): string {
		let processed = text;

		processed = this.qrcodeHandler.preprocessMarkdown(processed);
		processed = this.preprocessAbbr(processed);
		processed = this.preprocessAnnotation(processed);
		processed = this.preprocessIcon(processed);

		return processed;
	}

	/**
	 * 处理缩写 (Abbr) 语法
	 * 语法：[text](abbr "full text")
	 */
	private processAbbreviations(el: HTMLElement): void {
		const walker = document.createTreeWalker(
			el,
			NodeFilter.SHOW_TEXT,
			null
		);

		const nodes: Text[] = [];
		while (walker.nextNode()) {
			if (walker.currentNode.parentElement?.tagName !== 'ABBR') {
				nodes.push(walker.currentNode as Text);
			}
		}

		nodes.forEach(textNode => {
			const text = textNode.textContent || '';
			const matches = [...text.matchAll(InlineSyntaxHandler.ABBR_REGEX)];

			if (matches.length > 0) {
				const fragment = document.createDocumentFragment();
				let lastIndex = 0;

				matches.forEach(match => {
					if (match.index !== undefined) {
						if (match.index > lastIndex) {
							fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
						}

						const abbr = this.createAbbrElement(match[1], match[2]);
						fragment.appendChild(abbr);
						lastIndex = (match.index || 0) + match[0].length;
					}
				});

				if (lastIndex < text.length) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
				}

				textNode.parentNode?.replaceChild(fragment, textNode);
			}
		});
	}

	/**
	 * 创建缩写元素
	 */
	private createAbbrElement(text: string, title: string): HTMLElement {
		const abbr = document.createElement('abbr');
		abbr.className = 'sillot-abbr';
		abbr.textContent = text;
		abbr.title = title;
		return abbr;
	}

	/**
	 * 预处理缩写语法为 HTML
	 */
	private preprocessAbbr(text: string): string {
		return text.replace(
			InlineSyntaxHandler.ABBR_REGEX,
			(_match, content: string, title: string) => {
				return `<abbr class="sillot-abbr" title="${this.escapeAttr(title)}">${content}</abbr>`;
			}
		);
	}

	/**
	 * 处理注释 (Annotation) 语法
	 * 语法：[^ref] 或 <sup>[^ref]</sup>
	 */
	private processAnnotations(el: HTMLElement): void {
		const sups = el.querySelectorAll<HTMLElement>('sup');

		sups.forEach(sup => {
			const text = sup.textContent || '';
			const match = text.match(/^\[(\^[^\]]+)\]$/);

			if (match) {
				sup.className = 'sillot-annotation';
				sup.dataset.ref = match[1];
			}
		});
	}

	/**
	 * 预处理注释语法
	 */
	private preprocessAnnotation(text: string): string {
		return text.replace(
			/\[(\^\w+)\]/g,
			'<sup class="sillot-annotation" data-ref="$1">[$1]</sup>'
		);
	}

	/**
	 * 处理图标 (Icon) 语法
	 * 语法：:icon-name:
	 */
	private processIcons(el: HTMLElement): void {
		const iconElements = el.querySelectorAll<HTMLElement>('.sillot-inline-icon');

		iconElements.forEach(iconEl => {
			if (iconEl.dataset.processed) return;
			iconEl.dataset.processed = 'true';

			const iconName = iconEl.dataset.icon || '';
			if (iconName) {
				this.renderIcon(iconEl, iconName);
			}
		});
	}

	/**
	 * 渲染图标
	 */
	private renderIcon(container: HTMLElement, iconName: string): void {
		container.innerHTML = '';

		const svg = this.getIconSvg(iconName);
		if (svg) {
			container.innerHTML = svg;
		} else {
			container.textContent = `[${iconName}]`;
			container.classList.add('sillot-icon-fallback');
		}
	}

	/**
	 * 获取图标 SVG（内置常用图标）
	 */
	private getIconSvg(name: string): string | null {
		const icons: Record<string, string> = {
			'info': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
			'warning': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
			'success': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
			'error': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>',
			'tip': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>',
			'danger': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.18L19.93 19H4.07L12 5.18zM11 10h2v4h-2v-4zm0 6h2v2h-2v-2z"/></svg>',
			'note': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>',
			'github': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>',
			'npm': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h7.5v12H0V0zm8.25 0h7.5v12h-7.5V0zM16.5 0H24v12h-7.5V0zM0 13.5h7.5V24H0v-10.5zm8.25 0h7.5V24h-7.5v-10.5zm8.25 0H24V24h-7.5v-10.5z"/></svg>',
			'link': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>',
			'copy': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
			'external-link': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
			'download': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
			'settings': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
		};

		return icons[name] || null;
	}

	/**
	 * 预处理图标语法为 HTML
	 */
	private preprocessIcon(text: string): string {
		return text.replace(
			InlineSyntaxHandler.ICON_REGEX,
			(match, name: string) => {
				const commonIcons = ['info', 'warning', 'success', 'error', 'tip', 'danger', 'note', 'github', 'npm', 'link', 'copy', 'external-link', 'download', 'settings'];
				if (commonIcons.includes(name)) {
					return `<span class="sillot-inline-icon sillot-icon-${name}" data-icon="${name}" data-processed="false"></span>`;
				}
				return match;
			}
		);
	}

	/**
	 * 处理图表 (Plot) 代码块
	 * 语法：```plot ... ```
	 */
	private processPlots(el: HTMLElement): void {
		const plotBlocks = el.querySelectorAll<HTMLElement>('.sillot-plot-block');

		plotBlocks.forEach(block => {
			if (block.dataset.processed) return;
			block.dataset.processed = 'true';

			this.renderPlot(block);
		});
	}

	/**
	 * 渲染简单图表
	 */
	private renderPlot(block: HTMLElement): void {
		const chartType = block.dataset.type || 'bar';
		const dataStr = block.dataset.data || '[]';

		try {
			const data = JSON.parse(dataStr);
			const container = (block.querySelector('.sillot-plot-container') || block) as HTMLElement;

			switch (chartType) {
				case 'bar':
					this.renderBarChart(container, data);
					break;
				case 'line':
					this.renderLineChart(container, data);
					break;
				case 'pie':
					this.renderPieChart(container, data);
					break;
				default:
					this.renderBarChart(container, data);
			}
		} catch (e) {
			block.innerHTML = '<div class="sillot-plot-error">❌ 图表数据解析失败</div>';
		}
	}

	/**
	 * 渲染柱状图
	 */
	private renderBarChart(container: HTMLElement, data: Array<{ label: string; value: number; color?: string }>): void {
		const maxVal = Math.max(...data.map(d => d.value), 1);

		container.innerHTML = `
			<div class="sillot-chart sillot-bar-chart">
				${data.map(item => `
					<div class="sillot-bar-item">
						<div class="sillot-bar-label">${item.label}</div>
						<div class="sillot-bar-track">
							<div class="sillot-bar-fill" style="width: ${(item.value / maxVal * 100)}%; background: ${item.color || 'var(--interactive-accent)'}"></div>
						</div>
						<div class="sillot-bar-value">${item.value}</div>
					</div>
				`).join('')}
			</div>
		`;
	}

	/**
	 * 渲染折线图（简化版 - 使用 CSS）
	 */
	private renderLineChart(container: HTMLElement, data: Array<{ label: string; value: number }>): void {
		const points = data.map((d, i) => ({
			x: (i / Math.max(data.length - 1, 1)) * 100,
			y: 100 - (d.value / Math.max(...data.map(d => d.value), 1)) * 100
		}));

		const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

		container.innerHTML = `
			<div class="sillot-chart sillot-line-chart">
				<svg viewBox="0 0 100 100" preserveAspectRatio="none">
					<path d="${pathD}" fill="none" stroke="var(--interactive-accent)" stroke-width="2"/>
					${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2" fill="var(--interactive-accent)"/>`).join('')}
				</svg>
				<div class="sillot-line-labels">
					${data.map(d => `<span>${d.label}</span>`).join('')}
				</div>
			</div>
		`;
	}

	/**
	 * 渲染饼图（简化版 - 使用 CSS conic-gradient）
	 */
	private renderPieChart(container: HTMLElement, data: Array<{ label: string; value: number; color?: string }>): void {
		const total = data.reduce((sum, d) => sum + d.value, 0);
		const colors = ['#f97316', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
		let currentAngle = 0;

		const gradientStops = data.map((d, i) => {
			const percentage = (d.value / total) * 100;
			const start = currentAngle;
			currentAngle += percentage;
			return `${d.color || colors[i % colors.length]} ${start}% ${currentAngle}%`;
		}).join(', ');

		container.innerHTML = `
			<div class="sillot-chart sillot-pie-chart">
				<div class="sillot-pie-graph" style="background: conic-gradient(${gradientStops})"></div>
				<div class="sillot-pie-legend">
					${data.map((d, i) => `
						<div class="sillot-pie-item">
							<span class="sillot-pie-color" style="background: ${d.color || colors[i % colors.length]}"></span>
							<span class="sillot-pie-label">${d.label}: ${Math.round(d.value / total * 100)}%</span>
						</div>
					`).join('')}
				</div>
			</div>
		`;
	}

	/**
	 * 处理 PDF 嵌入
	 * 语法：<Pdf src="url" width="100%" height="600px" />
	 */
	private processPdfs(el: HTMLElement): void {
		const pdfEmbeds = el.querySelectorAll<HTMLElement>('.sillot-pdf-embed');

		pdfEmbeds.forEach(pdf => {
			if (pdf.dataset.processed) return;
			pdf.dataset.processed = 'true';

			this.renderPdf(pdf);
		});
	}

	/**
	 * 渲染 PDF 嵌入容器
	 */
	private renderPdf(container: HTMLElement): void {
		const src = container.dataset.src || container.dataset.url || '';
		const width = container.dataset.width || '100%';
		const height = container.dataset.height || '600px';

		if (!src) {
			container.innerHTML = '<div class="sillot-pdf-error">❌ PDF 地址缺失</div>';
			return;
		}

		container.innerHTML = `
			<div class="sillot-pdf-wrapper" style="width: ${width}; height: ${height}">
				<div class="sillot-pdf-header">
					<span class="sillot-pdf-title">📄 PDF 文档</span>
					<a href="${src}" target="_blank" class="sillot-pdf-link">在新窗口打开 ↗</a>
				</div>
				<iframe
					class="sillot-pdf-frame"
					src="${src}"
					style="width: 100%; height: calc(100% - 40px); border: none;"
					title="PDF Viewer"
				></iframe>
			</div>
		`;
	}

	/**
	 * 预处理 PDF 标签
	 */
	preprocessPdfTags(text: string): string {
		return text.replace(
			InlineSyntaxHandler.PDF_REGEX,
			(_match, url: string, w?: string, h?: string) => {
				return `<div class="sillot-pdf-embed" data-src="${url}" data-width="${w || '100%'}" data-height="${h || '600px'}" data-processed="false"></div>`;
			}
		);
	}

	/**
	 * HTML 属性转义
	 */
	private escapeAttr(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	/**
	 * 清理资源
	 */
	dispose(): void {
		document.querySelectorAll('[data-processed]').forEach(el => {
			el.removeAttribute('data-processed');
		});
	}
}
