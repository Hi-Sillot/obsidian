import { MarkdownRenderer } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

const CONTAINER_TYPES = new Set([
	'info', 'tip', 'warning', 'danger', 'note', 'important', 'caution',
]);

const DETAILS_TYPES = new Set(['details', 'collapse']);

const SPECIAL_CONTAINER_TYPES = new Set([
	'demo-wrapper',
	'npm-to',
	'repl',
	'codepen',
	'codesandbox',
	'replit',
	'table-enhanced',
]);

const CONTAINER_TITLES: Record<string, string> = {
	info: 'ℹ️ Info',
	tip: '💡 Tip',
	warning: '⚠️ Warning',
	danger: '🚫 Danger',
	note: '📝 Note',
	important: '❗ Important',
	caution: '⚠️ Caution',
	details: 'Details',
	collapse: 'Collapse',
	'demo-wrapper': '🎮 Demo',
	'npm-to': '📦 NPM Command',
};

export class ContainerHandler extends BaseSyntaxHandler {
	static readonly CONTAINER_TYPES = CONTAINER_TYPES;
	static readonly DETAILS_TYPES = DETAILS_TYPES;
	static readonly SPECIAL_CONTAINER_TYPES = SPECIAL_CONTAINER_TYPES;

	async buildContainer(containerType: string, title: string, contentText: string, ctx: MarkdownPostProcessorContext): Promise<HTMLElement | null> {
		if (DETAILS_TYPES.has(containerType)) {
			return this.createDetailsContainerFromText(contentText, title, containerType, ctx);
		} else if (CONTAINER_TYPES.has(containerType)) {
			return this.createHintContainerFromText(contentText, containerType, title, ctx);
		} else if (SPECIAL_CONTAINER_TYPES.has(containerType)) {
			return this.createSpecialContainerFromText(contentText, containerType, title, ctx);
		} else if (containerType === 'cedoss') {
			return null;
		} else if (containerType === 'tabs' || containerType === 'code-tabs' || containerType === 'video-tabs') {
			return null;
		}
		return this.createGenericContainerFromText(contentText, containerType, title, ctx);
	}

	private async createSpecialContainerFromText(
		contentText: string,
		type: string,
		title: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = `sillot-custom-container sillot-custom-${type}`;

		if (type === 'demo-wrapper' && title) {
			container.dataset.title = title;
		}

		const contentDiv = container.createDiv({ cls: 'sillot-custom-container-content' });
		if (contentText.trim()) {
			await this.renderContentToElement(contentText, contentDiv, ctx);
		}

		return container;
	}

	private async createHintContainerFromText(
		contentText: string,
		type: string,
		title: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = `hint-container ${type}`;

		container.createEl('p', {
			text: title || CONTAINER_TITLES[type] || type,
			cls: 'hint-container-title',
		});

		const contentDiv = container.createDiv({ cls: 'hint-container-content' });
		if (contentText.trim()) {
			await this.renderContentToElement(contentText, contentDiv, ctx);
		}

		return container;
	}

	private async createDetailsContainerFromText(
		contentText: string,
		title: string,
		type: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('details');
		container.className = 'hint-container details';
		if (type === 'collapse') {
			container.setAttribute('open', '');
		}

		container.createEl('summary', {
			text: title || 'Details',
			cls: 'hint-container-title',
		});

		const contentDiv = container.createDiv({ cls: 'hint-container-content' });
		if (contentText.trim()) {
			await this.renderContentToElement(contentText, contentDiv, ctx);
		}

		return container;
	}

	private async createGenericContainerFromText(
		contentText: string,
		type: string,
		title: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const container = document.createElement('div');
		container.className = `sillot-custom-container sillot-custom-${type}`;
		container.dataset.containerType = type;

		const header = container.createDiv({ cls: 'sillot-custom-container-header' });
		header.createEl('span', {
			text: title || type,
			cls: 'sillot-custom-container-type',
		});

		const contentDiv = container.createDiv({ cls: 'sillot-custom-container-content' });
		if (contentText.trim()) {
			await this.renderContentToElement(contentText, contentDiv, ctx);
		}

		return container;
	}

	private async renderContentToElement(
		contentText: string,
		targetEl: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		await MarkdownRenderer.render(
			this.plugin.app, contentText, targetEl, ctx.sourcePath, this.plugin
		);
	}
}
