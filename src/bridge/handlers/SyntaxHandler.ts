import type { MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../../main';

export interface SyntaxHandler {
	processInlineComponents?(el: HTMLElement): void;
	preprocessMarkdown?(text: string, sourcePath: string): string;
	buildContainer?(containerType: string, title: string, contentText: string, ctx: MarkdownPostProcessorContext): Promise<HTMLElement | null>;
}

export abstract class BaseSyntaxHandler implements SyntaxHandler {
	protected plugin: VuePressPublisherPlugin;

	constructor(plugin: VuePressPublisherPlugin) {
		this.plugin = plugin;
	}

	processInlineComponents?(el: HTMLElement): void;
	preprocessMarkdown?(text: string, sourcePath: string): string;
	buildContainer?(containerType: string, title: string, contentText: string, ctx: MarkdownPostProcessorContext): Promise<HTMLElement | null>;
}
