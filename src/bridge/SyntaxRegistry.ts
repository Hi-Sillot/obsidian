import { MarkdownRenderer, MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { SyntaxDescriptor, ComponentDescriptor, InlineComponentData } from '../bridge/types';
import { ContainerHandler } from './handlers/ContainerHandler';
import { TabsHandler } from './handlers/TabsHandler';
import { InlineComponentHandler } from './handlers/InlineComponentHandler';
import { VideoHandler } from './handlers/VideoHandler';
import { ImageEnhanceHandler } from './handlers/ImageEnhanceHandler';
import { CodeBlockEnhanceHandler } from './handlers/CodeBlockEnhanceHandler';
import { ChartHandler } from './handlers/ChartHandler';
import { SpecialContainerHandler } from './handlers/SpecialContainerHandler';
import { InlineSyntaxHandler } from './handlers/InlineSyntaxHandler';
import { ExperienceEnhanceHandler } from './handlers/ExperienceEnhanceHandler';
import { TTSHandler } from './handlers/TTSHandler';
import { AudioReaderHandler } from './handlers/AudioReaderHandler';
import { CardHandler } from './handlers/CardHandler';
import { FileTreeHandler } from './handlers/FileTreeHandler';

const TAG = 'Syntax';

interface PendingContainer {
	key: string;
	type: string;
	title: string;
	tabGroupId: string;
	startEl: HTMLElement;
	contentLines: string[];
	closeEl?: HTMLElement;
	colons: number;
}

export class SyntaxRegistry {
	private plugin: VuePressPublisherPlugin;
	private registered = false;
	private pendingContainers = new Map<string, PendingContainer>();
	private pendingCounter = 0;
	private containerHandler: ContainerHandler;
	private tabsHandler: TabsHandler;
	private inlineComponentHandler: InlineComponentHandler;
	private videoHandler: VideoHandler;
	private imageEnhanceHandler: ImageEnhanceHandler;
	private codeBlockEnhanceHandler: CodeBlockEnhanceHandler;
	private chartHandler: ChartHandler;
	private specialContainerHandler: SpecialContainerHandler;
	private inlineSyntaxHandler: InlineSyntaxHandler;
	private experienceEnhanceHandler: ExperienceEnhanceHandler;
	private ttsHandler: TTSHandler;
	private audioReaderHandler: AudioReaderHandler;
	private cardHandler: CardHandler;
	private fileTreeHandler: FileTreeHandler;

	constructor(plugin: VuePressPublisherPlugin) {
		this.plugin = plugin;
		this.containerHandler = new ContainerHandler(plugin);
		this.tabsHandler = new TabsHandler(plugin);
		this.inlineComponentHandler = new InlineComponentHandler(plugin);
		this.videoHandler = new VideoHandler(plugin);
		this.imageEnhanceHandler = new ImageEnhanceHandler(plugin);
		this.codeBlockEnhanceHandler = new CodeBlockEnhanceHandler(plugin);
		this.chartHandler = new ChartHandler(plugin);
		this.specialContainerHandler = new SpecialContainerHandler(plugin);
		this.inlineSyntaxHandler = new InlineSyntaxHandler(plugin);
		this.experienceEnhanceHandler = new ExperienceEnhanceHandler(plugin);
		this.ttsHandler = new TTSHandler(plugin);
		this.audioReaderHandler = new AudioReaderHandler(plugin);
		this.cardHandler = new CardHandler(plugin);
		this.fileTreeHandler = new FileTreeHandler(plugin);
	}

	loadInlineComponents(data: InlineComponentData) {
		this.inlineComponentHandler.loadData({
			labels: data.labels || {},
			banners: data.banners || {},
			vscodeSvg: data.vscodeSvg || '',
			cedossMap: data.cedossMap || {},
		});
		this.plugin.logger?.debug(TAG, `?????????: labels=${Object.keys(data.labels || {}).length}, banners=${Object.keys(data.banners || {}).length}, cedoss=${Object.keys(data.cedossMap || {}).length}`);
	}

	loadFromDescriptors(syntaxes: SyntaxDescriptor[], components: ComponentDescriptor[]) {
		this.plugin.logger?.debug(TAG, `??? ${syntaxes.length} ?????, ${components.length} ?????`);
	}

	registerAll() {
		if (this.registered) return;
		this.registered = true;

		this.plugin.registerMarkdownPostProcessor((el, ctx) => {
			this.processSection(el, ctx);
		});

		this.plugin.logger?.debug(TAG, '???????? (PostProcessor)');
	}

	private async processSection(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const sourcePath = ctx.sourcePath;
		const text = this.getSectionRawMarkdown(el, ctx);

		if (this.isInsideCodeBlock(el, ctx)) {
			this.plugin.logger?.debug(TAG, `skip section inside codeBlock: el=${el.tagName}, text="${text.substring(0, 60)}"`);
			return;
		}

		let pending: PendingContainer | undefined;
		for (const [k, v] of this.pendingContainers) {
			if (k.startsWith(sourcePath + '::')) {
				pending = v;
			}
		}
		const colonLineMatch = text.match(/^(:{3,})\s*$/);
		const pureCloseColons = colonLineMatch ? colonLineMatch[1].length : 0;

		if (pureCloseColons > 0) {
			if (pending) {
				if (pureCloseColons === pending.colons) {
					pending.closeEl = el;
					el.style.visibility = 'hidden';
					await this.finalizeContainer(ctx, pending);
					return;
				} else {
					pending.contentLines.push(text);
					el.style.visibility = 'hidden';
					return;
				}
			} else {
				this.showUnmatchedMarker(el, `??????? ${':'.repeat(pureCloseColons)}`);
				return;
			}
		}

		if (pending) {
			const lines = text.split('\n');
			const firstLine = lines[0]?.trim() || '';
			const lastLine = lines[lines.length - 1]?.trim();

			const firstColons = this.countLeadingColons(firstLine);
			const lastColons = this.countLeadingColons(lastLine);

			if (lastColons === pending.colons && lines.length > 1) {
				const contentBeforeClose = lines.slice(0, -1);
				contentBeforeClose.forEach(line => pending.contentLines.push(line));
				pending.closeEl = el;
				el.style.visibility = 'hidden';
				await this.finalizeContainer(ctx, pending);
				return;
			}

			if (firstColons > pending.colons) {
				pending.contentLines.push(text);
				el.style.visibility = 'hidden';
				return;
			}

			if (firstColons >= 3 && firstColons === pending.colons) {
				await this.finalizeContainer(ctx, pending);
				await this.processSection(el, ctx);
				return;
			}

			pending.contentLines.push(text);
			el.style.visibility = 'hidden';
			return;
		}

		if (text.startsWith(':::')) {
			const firstLine = text.split('\n')[0].trim();
			const colons = this.countLeadingColons(firstLine);
			const afterColons = firstLine.slice(colons).trim();
			const openMatch = afterColons.match(/^([\w-]+)(?:#([\w-]+))?(?:\s+(.*))?$/);

			if (!openMatch || openMatch[1] === '') {
				this.showUnmatchedMarker(el, `???? ${':'.repeat(colons)} ??: ${firstLine}`);
				return;
			}

			const containerType = openMatch[1];
			const tabGroupId = openMatch[2] || '';
			const title = openMatch[3] || '';
			const allLines = text.split('\n');
			const lastLine = allLines[allLines.length - 1].trim();
			const lastColons = this.countLeadingColons(lastLine);
			const hasClose = lastColons === colons && allLines.length > 1;
			const contentLines = allLines.slice(1, hasClose ? -1 : undefined);

			if (hasClose) {
				await this.processContainerInline(el, containerType, tabGroupId, title, contentLines, ctx);
			} else {
				const key = `${sourcePath}::${++this.pendingCounter}`;
				this.pendingContainers.set(key, {
					key,
					type: containerType,
					title,
					tabGroupId,
					startEl: el,
					contentLines,
					colons,
				});
				el.style.visibility = 'hidden';
			}
			return;
		}

		const hasCustomComponent = /<(GithubLabel|VSCodeSettingsLink|BannerTop|C\s+id=)/.test(text);
		const hasVideoTabs = /<!--\s*sillot-video-tabs\b/.test(text);
		const hasVideoInline = /@\[(bilibili|acfun|artPlayer)/.test(text);
		const hasCedossContainer = /^:{3,}\s*cedoss\b/m.test(text);
		const hasAudioReader = /@\[audioReader/.test(text);
		const hasQRCode = this.hasPatternOutsideCode(text, /@\[qrcode/);
		const hasAbbreviation = /^\*\[[^\]]+\]:\s/m.test(text);
		const hasAnnotation = this.hasAnnotationOutsideCode(text);

		if (hasCustomComponent || hasVideoTabs || hasVideoInline || hasCedossContainer || hasAudioReader || hasQRCode || hasAbbreviation || hasAnnotation) {
			let preprocessed = this.inlineComponentHandler.preprocessMarkdown!(text);
			preprocessed = this.inlineComponentHandler.preprocessCedossContainerMarkdown(preprocessed);
			preprocessed = this.videoHandler.preprocessMarkdown!(preprocessed);
			preprocessed = this.audioReaderHandler.preprocessMarkdown!(preprocessed);
			preprocessed = this.inlineSyntaxHandler.preprocessMarkdown!(preprocessed);
			el.empty();
			el.style.visibility = 'hidden';
			await MarkdownRenderer.render(
				this.plugin.app, preprocessed, el, ctx.sourcePath, this.plugin
			);
			el.style.visibility = '';
			await this.processInlineComponents(el);
			return;
		}

		await this.processInlineComponents(el);
	}

	private async processInlineComponents(el: HTMLElement): Promise<void> {
		this.inlineComponentHandler.processInlineComponents!(el);
		this.videoHandler.processInlineComponents!(el);
		this.imageEnhanceHandler.processInlineComponents!(el);
		this.codeBlockEnhanceHandler.processInlineComponents!(el);
		this.chartHandler.processInlineComponents!(el);
		this.specialContainerHandler.processInlineComponents!(el);
		await this.inlineSyntaxHandler.processInlineComponents!(el);
		this.experienceEnhanceHandler.processInlineComponents!(el);
		this.ttsHandler.processInlineComponents!(el);
		this.audioReaderHandler.processInlineComponents!(el);
	}

	private async finalizeContainer(ctx: MarkdownPostProcessorContext, pending: PendingContainer) {
		const { type, title, tabGroupId, startEl, contentLines, closeEl } = pending;
		this.pendingContainers.delete(pending.key);

		await this.processContainerInline(startEl, type, tabGroupId, title, contentLines, ctx);
		if (closeEl) {
			closeEl.style.visibility = 'hidden';
		}
	}

	private async processContainerInline(
		el: HTMLElement,
		containerType: string,
		tabGroupId: string,
		title: string,
		contentLines: string[],
		ctx: MarkdownPostProcessorContext
	) {
		const contentText = contentLines.join('\n');
		let container: HTMLElement | null = null;

		if (TabsHandler.TAB_TYPES.has(containerType)) {
			container = await this.tabsHandler.buildContainerWithGroupId(containerType, title, tabGroupId, contentText, ctx);
		} else if (ChartHandler.CHART_TYPES.has(containerType)) {
			container = this.chartHandler.createChartContainer(containerType, contentText);
		} else if (CardHandler.CARD_TYPES.has(containerType)) {
			container = await this.cardHandler.buildContainer(containerType, title, contentText, ctx);
		} else if (containerType === 'file-tree') {
			container = await this.fileTreeHandler.buildContainer(containerType, title, contentText, ctx);
		} else if (containerType === 'cedoss') {
			container = await this.createCedossContainerFromText(contentText, ctx);
		} else {
			container = await this.containerHandler.buildContainer(containerType, title, contentText, ctx);
		}

		if (container) {
			el.style.visibility = 'hidden';
			el.empty();
			el.appendChild(container);
			el.style.visibility = '';
		}
	}

	private async createCedossContainerFromText(
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = 'sillot-cedoss';

		const processedContent = contentText.replace(
			/\[\[([^\]]+)\]\]/g,
			(_match, id: string) => {
				return `\`Cedoss:${id}\``;
			}
		);

		const contentDiv = container.createDiv({ cls: 'sillot-cedoss-content' });
		if (processedContent.trim()) {
			await MarkdownRenderer.render(
				this.plugin.app, processedContent, contentDiv, ctx.sourcePath, this.plugin
			);
			this.inlineComponentHandler.processInlineComponents!(contentDiv);
		}

		return container;
	}

	private showUnmatchedMarker(el: HTMLElement, message: string) {
		el.empty();
		const hint = el.createEl('span', {
			cls: 'sillot-unmatched-marker',
			text: `?? ${message}`,
		});
		hint.style.cssText = 'color:var(--text-error);font-size:11px;font-style:italic;display:block;padding:4px 8px;';
	}

	private countLeadingColons(line: string): number {
		let count = 0;
		for (let i = 0; i < line.length; i++) {
			if (line[i] === ':') count++;
			else break;
		}
		return count >= 3 ? count : 0;
	}

	private hasPatternOutsideCode(text: string, pattern: RegExp): boolean {
		let cleaned = text;
		cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
		cleaned = cleaned.replace(/`[^`]+`/g, '');
		return pattern.test(cleaned);
	}

	private hasAnnotationOutsideCode(text: string): boolean {
		return this.hasPatternOutsideCode(text, /\[\+[^\]]+\]/);
	}

	private getSectionRawMarkdown(el: HTMLElement, ctx: MarkdownPostProcessorContext): string {
		const sectionInfo = ctx.getSectionInfo(el);
		if (sectionInfo) {
			const lines = sectionInfo.text.split('\n');
			const rawLines = lines.slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);
			return rawLines.join('\n').trim();
		}
		return el.textContent?.trim() || '';
	}

	private isInsideCodeBlock(el: HTMLElement, ctx: MarkdownPostProcessorContext): boolean {
		if (el.tagName === 'PRE' || el.tagName === 'CODE') {
			return true;
		}
		if (el.closest('pre') || el.closest('code')) {
			return true;
		}

		const sectionInfo = ctx.getSectionInfo(el);
		if (sectionInfo) {
			const lines = sectionInfo.text.split('\n');
			let fenceCount = 0;
			for (let i = 0; i < sectionInfo.lineStart; i++) {
				if (/^```/.test(lines[i].trim())) {
					fenceCount++;
				}
			}
			if (fenceCount % 2 === 1) {
				return true;
			}
		}

		return false;
	}
}
