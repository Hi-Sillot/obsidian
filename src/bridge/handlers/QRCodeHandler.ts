import QRCode from 'qrcode';
import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

interface QRCodeOptions {
	card?: boolean;
	svg?: boolean;
	title?: string;
	align?: 'left' | 'center' | 'right';
	width?: number;
	light?: string;
	dark?: string;
	margin?: number;
	level?: 'L' | 'M' | 'Q' | 'H';
	version?: number;
	scale?: number;
	mask?: number;
}

interface ParsedQRCode {
	text: string;
	options: QRCodeOptions;
}

export class QRCodeHandler extends BaseSyntaxHandler {
	private static readonly INLINE_REGEX = /@\[qrcode([^\]]*)\]\(([^)]+)\)/g;
	private static readonly CONTAINER_START_REGEX = /^:::\s*qrcode\s*(.*)$/;
	private static readonly CONTAINER_END_REGEX = /^:::$/;

	async processInlineComponents(el: HTMLElement): Promise<void> {
		await this.processInlineQRCodes(el);
	}

	preprocessMarkdown(text: string): string {
		return this.preprocessInlineQRCodes(text);
	}

	async processInlineQRCodes(el: HTMLElement): Promise<void> {
		this.restoreCodeBlockContent(el);

		const allQrElements = el.querySelectorAll<HTMLElement>('.sillot-qrcode-inline');
		const qrElements = Array.from(allQrElements).filter(qrEl => {
			return !qrEl.closest('code, pre, .code-block');
		});

		const promises = qrElements.map(async (qrEl) => {
			if (qrEl.dataset.processed === 'true') return;
			qrEl.dataset.processed = 'true';

			const text = qrEl.dataset.text || '';
			const optionsStr = qrEl.dataset.options || '{}';

			try {
				const options: QRCodeOptions = JSON.parse(optionsStr);
				await this.renderQRCode(qrEl, text, options);
			} catch (e) {
				this.plugin.logger.error('二维码渲染失败:', e);
				qrEl.innerHTML = '<div class="sillot-qrcode-error">❌ 二维码参数解析失败</div>';
			}
		});

		await Promise.all(promises);
	}

	private restoreCodeBlockContent(el: HTMLElement): void {
		const codeBlocks = el.querySelectorAll('code, pre');

		codeBlocks.forEach(codeBlock => {
			const html = codeBlock.innerHTML;

			if (html.includes('sillot-qrcode-inline')) {
				const restored = html.replace(
					/&lt;span\s+class="sillot-qrcode-inline"\s+data-text="([^"]*)"\s+data-options='([^']*)'\s+data-processed="[^"]*"&gt;&lt;\/span&gt;/g,
					(_match, encodedText, options) => {
						try {
							const text = this.unescapeAttr(encodedText);
							const opts = JSON.parse(options);
							const attrsStr = this.optionsToAttrsString(opts);
							return `@[qrcode${attrsStr}](${text})`;
						} catch (e) {
							this.plugin.logger.warn('代码块内容还原失败:', e);
							return _match;
						}
					}
				);

				if (restored !== html) {
					codeBlock.innerHTML = restored;
				}
			}
		});
	}

	private unescapeAttr(str: string): string {
		return str
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
	}

	private optionsToAttrsString(options: QRCodeOptions): string {
		const parts: string[] = [];
		if (options.card) parts.push('card');
		if (options.svg) parts.push('svg');
		if (options.title) parts.push(`title="${options.title}"`);
		if (options.align && options.align !== 'left') parts.push(`align="${options.align}"`);
		if (options.width && options.width !== 300) parts.push(`width=${options.width}`);
		return parts.length > 0 ? ' ' + parts.join(' ') : '';
	}

	private preprocessInlineQRCodes(text: string): string {
		if (!QRCodeHandler.INLINE_REGEX.test(text)) return text;
		QRCodeHandler.INLINE_REGEX.lastIndex = 0;

		const codeBlocks: string[] = [];
		let protectedText = text;

		protectedText = protectedText.replace(/```[\s\S]*?```/g, (match) => {
			codeBlocks.push(match);
			return `\x00CB${codeBlocks.length - 1}\x00`;
		});
		protectedText = protectedText.replace(/`[^`]+`/g, (match) => {
			codeBlocks.push(match);
			return `\x00CB${codeBlocks.length - 1}\x00`;
		});

		protectedText = protectedText.replace(
			QRCodeHandler.INLINE_REGEX,
			(_match: string, attrsStr: string, qrText: string) => {
				const options = this.parseAttributes(attrsStr);
				return `<span class="sillot-qrcode-inline" data-text="${this.escapeAttr(qrText)}" data-options='${JSON.stringify(options)}' data-processed="false"></span>`;
			}
		);

		return protectedText.replace(/\x00CB(\d+)\x00/g, (_match, indexStr) => {
			return codeBlocks[parseInt(indexStr)];
		});
	}

	async buildQRCodeContainer(
		contentText: string,
		title: string,
		attrs: Record<string, string>
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = 'sillot-qrcode-container';

		const options: QRCodeOptions = {
			...this.parseAttrsToOptions(attrs),
			title: title || undefined,
		};

		await this.renderQRCode(container, contentText.trim(), options);

		return container;
	}

	static isQRCodeContainerStart(line: string): { isMatch: boolean; attrs: Record<string, string> } {
		const match = line.match(QRCodeHandler.CONTAINER_START_REGEX);
		if (!match) return { isMatch: false, attrs: {} };

		const attrsStr = match[1]?.trim() || '';
		return {
			isMatch: true,
			attrs: QRCodeHandler.parseContainerAttrs(attrsStr),
		};
	}

	static isContainerEnd(line: string): boolean {
		return QRCodeHandler.CONTAINER_END_REGEX.test(line.trim());
	}

	private async renderQRCode(
		container: HTMLElement,
		text: string,
		options: QRCodeOptions
	): Promise<void> {
		try {
			const qrOptions = this.buildQROptions(options);
			const isCard = options.card;
			const align = options.align || 'left';
			const title = options.title;

			let qrHtml: string;

			if (options.svg) {
				qrHtml = await QRCode.toString(text, {
					...qrOptions,
					type: 'svg',
				});
			} else {
				const dataUrl = await QRCode.toDataURL(text, qrOptions);
				qrHtml = `<img src="${dataUrl}" alt="QR Code" class="sillot-qrcode-image" />`;
			}

			const wrapper = document.createElement('div');
			wrapper.className = `sillot-qrcode-wrapper sillot-qrcode-align-${align}`;
			if (isCard) {
				wrapper.classList.add('sillot-qrcode-card');
			}

			if (title && isCard) {
				const titleEl = document.createElement('div');
				titleEl.className = 'sillot-qrcode-title';
				titleEl.textContent = title;
				wrapper.appendChild(titleEl);
			}

			const contentEl = document.createElement('div');
			contentEl.className = 'sillot-qrcode-content';
			contentEl.innerHTML = qrHtml;
			wrapper.appendChild(contentEl);

			if (title && !isCard) {
				const captionEl = document.createElement('div');
				captionEl.className = 'sillot-qrcode-caption';
				captionEl.textContent = title;
				wrapper.appendChild(captionEl);
			}

			container.innerHTML = '';
			container.appendChild(wrapper);
		} catch (error) {
			this.plugin.logger.error('二维码生成失败:', error);
			container.innerHTML = '<div class="sillot-qrcode-error">❌ 二维码生成失败</div>';
		}
	}

	private buildQROptions(options: QRCodeOptions) {
		return {
			width: options.width || 300,
			margin: options.margin ?? 2,
			color: {
				dark: options.dark || '#000000ff',
				light: options.light || '#ffffffff',
			},
			errorCorrectionLevel: options.level || 'M',
			version: options.version || undefined,
			scale: options.scale || 4,
			mask: options.mask || undefined,
		};
	}

	private parseAttributes(attrsStr: string): QRCodeOptions {
		const options: QRCodeOptions = {};
		const attrRegex = /(\w+)(?:="([^"]*)")?/g;
		let match;

		while ((match = attrRegex.exec(attrsStr)) !== null) {
			const [, key, value] = match;
			switch (key) {
				case 'card':
					options.card = true;
					break;
				case 'svg':
					options.svg = true;
					break;
				case 'title':
					options.title = value || '';
					break;
				case 'align':
					if (['left', 'center', 'right'].includes(value)) {
						options.align = value as 'left' | 'center' | 'right';
					}
					break;
				case 'width':
					options.width = parseInt(value, 10) || 300;
					break;
				case 'light':
					options.light = value;
					break;
				case 'dark':
					options.dark = value;
					break;
				case 'margin':
					options.margin = parseInt(value, 10) || 2;
					break;
				case 'level':
					if (['L', 'M', 'Q', 'H'].includes(value)) {
						options.level = value as 'L' | 'M' | 'Q' | 'H';
					}
					break;
				case 'version':
					options.version = parseInt(value, 10) || undefined;
					break;
				case 'scale':
					options.scale = parseInt(value, 10) || 4;
					break;
				case 'mask':
					options.mask = parseInt(value, 10) || undefined;
					break;
			}
		}

		return options;
	}

	private parseAttrsToOptions(attrs: Record<string, string>): QRCodeOptions {
		const options: QRCodeOptions = {};

		if (attrs.card === 'true' || attrs.card === '') options.card = true;
		if (attrs.svg === 'true' || attrs.svg === '') options.svg = true;
		if (attrs.title) options.title = attrs.title;
		if (attrs.align && ['left', 'center', 'right'].includes(attrs.align)) {
			options.align = attrs.align as 'left' | 'center' | 'right';
		}
		if (attrs.width) options.width = parseInt(attrs.width, 10) || 300;
		if (attrs.light) options.light = attrs.light;
		if (attrs.dark) options.dark = attrs.dark;
		if (attrs.margin) options.margin = parseInt(attrs.margin, 10) || 2;
		if (attrs.level && ['L', 'M', 'Q', 'H'].includes(attrs.level)) {
			options.level = attrs.level as 'L' | 'M' | 'Q' | 'H';
		}
		if (attrs.version) options.version = parseInt(attrs.version, 10) || undefined;
		if (attrs.scale) options.scale = parseInt(attrs.scale, 10) || 4;
		if (attrs.mask) options.mask = parseInt(attrs.mask, 10) || undefined;

		return options;
	}

	private static parseContainerAttrs(attrsStr: string): Record<string, string> {
		const attrs: Record<string, string> = {};
		const attrRegex = /(\w+)(?:="([^"]*)")?/g;
		let match;

		while ((match = attrRegex.exec(attrsStr)) !== null) {
			const [, key, value] = match;
			attrs[key] = value || '';
		}

		return attrs;
	}

	private escapeAttr(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	dispose(): void {
		document.querySelectorAll('.sillot-qrcode-inline[data-processed]').forEach(el => {
			el.removeAttribute('data-processed');
		});
	}
}
