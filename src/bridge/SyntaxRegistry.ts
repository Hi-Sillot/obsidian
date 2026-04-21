import { MarkdownRenderer, MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { SyntaxDescriptor, ComponentDescriptor } from '../bridge/types';

const TAG = 'Syntax';

const CONTAINER_TYPES = new Set([
	'info', 'tip', 'warning', 'danger', 'note', 'important', 'caution',
]);

const TAB_TYPES = new Set(['tabs', 'code-tabs', 'video-tabs']);

const DETAILS_TYPES = new Set(['details', 'collapse']);

const CONTAINER_TITLES: Record<string, string> = {
	info: 'ℹ️ Info',
	tip: '💡 Tip',
	warning: '⚠️ Warning',
	danger: '🚫 Danger',
	note: '📝 Note',
	important: '�?Important',
	caution: '�?Caution',
	details: 'Details',
	collapse: 'Collapse',
};

import { LABEL_MAP, BANNER_MAP, VSCODE_SVG, CEDOSS_MAP } from '../../../plume/docs/.vuepress/plugins/vuepress-plugin-sillot-inline/shared/component-data.ts';

interface PendingContainer {
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

	constructor(plugin: VuePressPublisherPlugin) {
		this.plugin = plugin;
	}

	loadFromDescriptors(syntaxes: SyntaxDescriptor[], components: ComponentDescriptor[]) {
		this.plugin.logger?.debug(TAG, `已加载 ${syntaxes.length} 个语法描述, ${components.length} 个组件描述`);
	}

	registerAll() {
		if (this.registered) return;
		this.registered = true;

		this.plugin.registerMarkdownPostProcessor((el, ctx) => {
			this.processSection(el, ctx);
		});

		this.plugin.logger?.debug(TAG, '语法处理器已注册 (PostProcessor)');
	}

	private async processSection(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const sourcePath = ctx.sourcePath;
		const text = this.getSectionRawMarkdown(el, ctx);

		this.plugin.logger?.debug(TAG, `处理 section, sourcePath="${sourcePath}", text="${text.slice(0, 60)}..."`);

		const pending = this.pendingContainers.get(sourcePath);
		const colonLineMatch = text.match(/^(:{3,})\s*$/);
		const pureCloseColons = colonLineMatch ? colonLineMatch[1].length : 0;

		if (pureCloseColons > 0) {
			if (pending) {
				if (pureCloseColons === pending.colons) {
					this.plugin.logger?.debug(TAG, `闭合标记 ${':'.repeat(pureCloseColons)} 找到，累积内容行数=${pending.contentLines.length}`);
					pending.closeEl = el;
					el.style.visibility = 'hidden';
					await this.finalizeContainer(ctx, pending);
					return;
				} else {
					this.plugin.logger?.debug(TAG, `冒号数不匹配(${pending.colons}vs${pureCloseColons})，作为内容累积`);
					pending.contentLines.push(text);
					el.style.visibility = 'hidden';
					return;
				}
			} else {
				this.plugin.logger?.warn(TAG, `单独的 ${':'.repeat(pureCloseColons)} 但没有待处理的容器`);
				this.showUnmatchedMarker(el, `单独的闭合标记 ${':'.repeat(pureCloseColons)}`);
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
				this.plugin.logger?.debug(TAG, `闭合标记 ${':'.repeat(pending.colons)} 找到（section末尾），累积内容行数=${pending.contentLines.length}`);
				const contentBeforeClose = lines.slice(0, -1);
				contentBeforeClose.forEach(line => pending.contentLines.push(line));
				pending.closeEl = el;
				el.style.visibility = 'hidden';
				await this.finalizeContainer(ctx, pending);
				return;
			}

			if (firstColons > pending.colons) {
				this.plugin.logger?.debug(TAG, `嵌套容器标记(${firstColons}冒号 > ${pending.colons}冒号)作为内容累积: "${firstLine.slice(0, 30)}..."`);
				pending.contentLines.push(text);
				el.style.visibility = 'hidden';
				return;
			}

			if (firstColons >= 3 && firstColons <= pending.colons) {
				this.plugin.logger?.warn(TAG, `冒号层级违规(${firstColons}冒号 <= ${pending.colons}冒号)，强制关闭当前容器`);
				await this.finalizeContainer(ctx, pending);
				await this.processSection(el, ctx);
				return;
			}

			this.plugin.logger?.debug(TAG, `累积内容: "${text.slice(0, 40)}...", 当前累计=${pending.contentLines.length}行`);
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
				this.plugin.logger?.warn(TAG, `无法解析开标记: "${firstLine}"`);
				this.showUnmatchedMarker(el, `无法解析 ${':'.repeat(colons)} 标记: ${firstLine}`);
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
				this.plugin.logger?.debug(TAG, `单 section 容器: ${':'.repeat(colons)} ${containerType}, 内容行数=${contentLines.length}`);
				await this.processContainerInline(el, containerType, tabGroupId, title, contentLines, ctx);
			} else {
				this.plugin.logger?.debug(TAG, `开标记 section (${colons}冒号, 无闭合，等待后续section, containerType=${containerType}`);
				this.pendingContainers.set(sourcePath, {
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

		if (hasCustomComponent || hasVideoTabs || hasVideoInline || hasCedossContainer) {
			this.plugin.logger?.debug(TAG, '检测到自定义组件/视频标签/cedoss容器，重新渲染 section');
			let preprocessed = this.preprocessCustomComponentMarkdown(text);
			preprocessed = this.preprocessCedossContainerMarkdown(preprocessed);
			preprocessed = this.preprocessVideoTabsMarkdown(preprocessed);
			preprocessed = this.preprocessVideoInlineMarkdown(preprocessed);
			el.empty();
			el.style.visibility = 'hidden';
			await MarkdownRenderer.render(
				this.plugin.app, preprocessed, el, ctx.sourcePath, this.plugin
			);
			el.style.visibility = '';
			this.processInlineComponents(el);
			return;
		}

		this.processInlineComponents(el);
	}

	private preprocessCustomComponentMarkdown(text: string): string {
		let result = text;

		result = result.replace(
			/<GithubLabel\s+(?:name|label)="([^"]+)"(?:\s+color="([^"]+)")?\s*\/?>/g,
			(_, name, color) => {
				return `\`GithubLabel:${name}${color ? ':' + color : ''}\``;
			}
		);

		result = result.replace(
			/<VSCodeSettingsLink\s+id="([^"]+)"\s*\/?>/g,
			(_, id) => {
				return `\`VSCodeSetting:${id}\``;
			}
		);

		result = result.replace(
			/<BannerTop(\w+)\s*\/?>/g,
			(_, type) => {
				return `\`BannerTop:${type}\``;
			}
		);

		result = result.replace(
			/<C\s+id="([^"]+)"(?:\s+error-mode="([^"]*)")?\s*\/?>/g,
			(_, id, errorMode) => {
				return `\`Cedoss:${id}${errorMode ? ':' + errorMode : ''}\``;
			}
		);

		return result;
	}

	private preprocessCedossContainerMarkdown(text: string): string {
		return text.replace(
			/(\:{3,}\s*cedoss[\s\S]*?\:{3,})/g,
			(containerBlock) => {
				return containerBlock.replace(
					/\[\[([^\]]+)\]\]/g,
					(_, id) => {
						return `\`Cedoss:${id}\``;
					}
				);
			}
		);
	}

	private preprocessVideoTabsMarkdown(text: string): string {
		return text.replace(
			/<!--\s*sillot-video-tabs\s+([\s\S]*?)-->/g,
			(_, attrs) => {
				const ap = attrs.match(/ap="([^"]+)"/)?.[1];
				const ac = attrs.match(/ac="([^"]+)"/)?.[1];
				const bb = attrs.match(/bb="([^"]+)"/)?.[1];
				const active = attrs.match(/active="([^"]+)"/)?.[1] || '';

				const parts: string[] = [];
				if (ap) parts.push(`ap:${ap}`);
				if (ac) parts.push(`ac:${ac}`);
				if (bb) parts.push(`bb:${bb}`);
				if (active) parts.push(`active:${active}`);

				return parts.length >= 2 ? `\`VideoTabs:${parts.join('|')}\`` : '';
			}
		);
	}

	private preprocessVideoInlineMarkdown(text: string): string {
		let result = text;

		result = result.replace(
			/@\[bilibili(?:\s+p(\d+))?([^\]]*)\]\(([^)]+)\)/g,
			(_, page, info, source) => {
				const ids = source.trim().split(/\s+/);
				const bvid = ids.find((id: string) => id.startsWith('BV'));
				const height = info.match(/height="([^"]+)"/)?.[1] || '';
				const p = page || '';
				return `\`Bilibili:${bvid || source.trim()}:${p}${height ? ':' + height : ''}\``;
			}
		);

		result = result.replace(
			/@\[acfun([^\]]*)\]\(([^)]+)\)/g,
			(_, info, id) => {
				const height = info.match(/height="([^"]+)"/)?.[1] || '';
				return `\`AcFun:${id.trim()}${height ? ':' + height : ''}\``;
			}
		);

		result = result.replace(
			/@\[artPlayer([^\]]*)\]\(([^)]+)\)/g,
			(_, info, url) => {
				const height = info.match(/height="([^"]+)"/)?.[1] || '';
				return `\`ArtPlayer:${url.trim()}${height ? ':' + height : ''}\``;
			}
		);

		return result;
	}

	private restoreStrippedStyles(el: HTMLElement, rawMarkdown: string) {
		const styleRegex = /<(\w+)\s+style="([^"]+)">/g;
		let match;
		const styleMap: Array<{ tag: string; style: string }> = [];

		while ((match = styleRegex.exec(rawMarkdown)) !== null) {
			styleMap.push({ tag: match[1], style: match[2] });
		}

		if (styleMap.length === 0) return;

		for (const { tag, style } of styleMap) {
			const elements = Array.from(el.querySelectorAll(tag));
			for (const elem of elements) {
				const htmlElem = elem as HTMLElement;
				if (!htmlElem.getAttribute('style') && !htmlElem.dataset.sillotStyleApplied) {
					htmlElem.setAttribute('style', style);
					htmlElem.dataset.sillotStyleApplied = 'true';
				}
			}
		}
	}

	private countLeadingColons(line: string): number {
		let count = 0;
		for (let i = 0; i < line.length; i++) {
			if (line[i] === ':') count++;
			else break;
		}
		return count >= 3 ? count : 0;
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

	private async renderContentToElement(
		contentText: string,
		targetEl: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		const segments = this.parseContentSegments(contentText);

		for (const segment of segments) {
			if (segment.type === 'container') {
				const container = await this.buildContainerElement(
					segment.containerType!, segment.title || '', segment.content, ctx
				);
				targetEl.appendChild(container);
			} else {
				if (segment.content.trim()) {
					const div = targetEl.createDiv();
					await MarkdownRenderer.render(
						this.plugin.app, segment.content, div, ctx.sourcePath, this.plugin
					);
				}
			}
		}
	}

	private parseContentSegments(
		text: string
	): { type: 'text' | 'container'; content: string; containerType?: string; title?: string }[] {
		const segments: { type: 'text' | 'container'; content: string; containerType?: string; title?: string }[] = [];
		const lines = text.split('\n');
		let i = 0;
		let textBuffer: string[] = [];

		const flushText = () => {
			if (textBuffer.length > 0) {
				segments.push({ type: 'text', content: textBuffer.join('\n') });
				textBuffer = [];
			}
		};

		while (i < lines.length) {
			const line = lines[i].trim();
			const colons = this.countLeadingColons(line);

			if (colons >= 3) {
				const afterColons = line.slice(colons).trim();
				const openMatch = afterColons.match(/^([\w-]+)(?:#([\w-]+))?(?:\s+(.*))?$/);

				if (openMatch && openMatch[1] !== '') {
					flushText();

					const containerType = openMatch[1];
					const title = openMatch[3] || '';
					const contentLines: string[] = [];
					let j = i + 1;
					let found = false;

					while (j < lines.length) {
						const closeLine = lines[j].trim();
						const closeColons = this.countLeadingColons(closeLine);
						if (closeColons === colons && closeLine.slice(closeColons).trim() === '') {
							found = true;
							break;
						}
						contentLines.push(lines[j]);
						j++;
					}

					if (found) {
						segments.push({
							type: 'container',
							content: contentLines.join('\n'),
							containerType,
							title,
						});
						i = j + 1;
						continue;
					}
				}
			}

			textBuffer.push(lines[i]);
			i++;
		}

		flushText();
		return segments;
	}

	private async buildContainerElement(
		containerType: string,
		title: string,
		contentText: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		if (TAB_TYPES.has(containerType)) {
			return this.createTabsFromText(contentText, containerType, title, '', ctx);
		} else if (DETAILS_TYPES.has(containerType)) {
			return this.createDetailsContainerFromText(contentText, title, containerType, ctx);
		} else if (containerType === 'cedoss') {
			return this.createCedossContainerFromText(contentText, ctx);
		} else if (CONTAINER_TYPES.has(containerType)) {
			return this.createHintContainerFromText(contentText, containerType, title, ctx);
		} else {
			return this.createGenericContainerFromText(contentText, containerType, title, ctx);
		}
	}

	private showUnmatchedMarker(el: HTMLElement, message: string) {
		el.empty();
		const hint = el.createEl('span', {
			cls: 'sillot-unmatched-marker',
			text: `⚠️ ${message}`,
		});
		hint.style.cssText = 'color:var(--text-error);font-size:11px;font-style:italic;display:block;padding:4px 8px;';
	}

	private async finalizeContainer(ctx: MarkdownPostProcessorContext, pending: PendingContainer) {
		const { type, title, tabGroupId, startEl, contentLines, closeEl } = pending;
		this.plugin.logger?.debug(TAG, `finalizeContainer: ::: ${type}, 总内容行数=${contentLines.length}`);

		this.pendingContainers.delete(ctx.sourcePath);

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
		let container: HTMLElement;

		if (TAB_TYPES.has(containerType)) {
			container = await this.createTabsFromText(contentText, containerType, title, tabGroupId, ctx);
		} else if (DETAILS_TYPES.has(containerType)) {
			container = await this.createDetailsContainerFromText(contentText, title, containerType, ctx);
		} else if (containerType === 'cedoss') {
			container = await this.createCedossContainerFromText(contentText, ctx);
		} else if (CONTAINER_TYPES.has(containerType)) {
			container = await this.createHintContainerFromText(contentText, containerType, title, ctx);
		} else {
			this.plugin.logger?.debug(TAG, `未知容器类型 "${containerType}"，渲染为通用容器`);
			container = await this.createGenericContainerFromText(contentText, containerType, title, ctx);
		}

		el.style.visibility = 'hidden';
		el.empty();
		el.appendChild(container);
		el.style.visibility = '';
		this.plugin.logger?.debug(TAG, `::: ${containerType} 渲染完成`);
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
			await this.renderContentToElement(processedContent, contentDiv, ctx);
			this.processCedossInline(contentDiv);
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

	private async createTabsFromText(
		contentText: string,
		type: string,
		title: string,
		tabGroupId: string,
		ctx: MarkdownPostProcessorContext
	): Promise<HTMLElement> {
		const isCode = type === 'code-tabs';
		const isVideoTabs = type === 'video-tabs';
		const container = document.createElement('div');
		container.className = isVideoTabs ? 'vp-tabs sillot-video-tabs' : (isCode ? 'vp-code-tabs' : 'vp-tabs');
		if (tabGroupId) {
			container.dataset.tabGroup = tabGroupId;
		}

		if (title) {
			container.createEl('div', { text: title, cls: 'vp-tabs-title' });
		}

		const tabs = this.parseTabsFromText(contentText, isCode);
		if (tabs.length === 0) {
			container.createEl('p', { text: '[tabs: 无有效标签页]', cls: 'sillot-fallback-hint' });
			return container;
		}

		this.plugin.logger?.debug(TAG, `tabs: 解析了 ${tabs.length} 个标签页: ${tabs.map(t => t.title).join(', ')}`);

		const tabBar = container.createDiv({ cls: isCode ? 'vp-code-tabs-nav' : 'vp-tabs-nav' });
		const contentArea = container.createDiv({ cls: isCode ? 'vp-code-tabs-content' : 'vp-tabs-content' });

		const barBtns: HTMLButtonElement[] = [];
		const tabContents: HTMLElement[] = [];

		for (let i = 0; i < tabs.length; i++) {
			const tab = tabs[i];
			const isActive = tab.active;

			const navItemCls = isCode ? 'vp-code-tabs-nav-item' : 'vp-tabs-nav-item';
			const activeNavCls = isCode ? 'vp-code-tabs-nav-item--active' : 'vp-tabs-nav-item--active';
			const tabCls = isCode ? 'vp-code-tabs-tab' : 'vp-tabs-tab';
			const activeTabCls = isCode ? 'vp-code-tabs-tab--active' : 'vp-tabs-tab--active';

			const tabBtn = tabBar.createEl('button', {
				text: tab.title,
				cls: isActive ? `${navItemCls} ${activeNavCls}` : navItemCls,
			});

			const tabContent = contentArea.createDiv({
				cls: isActive ? `${tabCls} ${activeTabCls}` : tabCls,
			});

			if (tab.content.trim()) {
				if (isCode) {
					const pre = tabContent.createEl('pre', { cls: 'vp-code-tabs-code' });
					pre.createEl('code', { text: tab.content });
				} else {
					await this.renderContentToElement(tab.content, tabContent, ctx);
				}
			}

			barBtns.push(tabBtn);
			tabContents.push(tabContent);
		}

		for (let i = 0; i < barBtns.length; i++) {
			barBtns[i].onclick = () => {
				const activeNavCls = isCode ? 'vp-code-tabs-nav-item--active' : 'vp-tabs-nav-item--active';
				const activeTabCls = isCode ? 'vp-code-tabs-tab--active' : 'vp-tabs-tab--active';

				barBtns.forEach(b => b.removeClass(activeNavCls));
				barBtns[i].addClass(activeNavCls);
				tabContents.forEach(c => c.removeClass(activeTabCls));
				tabContents[i].addClass(activeTabCls);

				if (tabGroupId) {
					this.syncTabGroup(tabGroupId, i);
				}
			};
		}

		return container;
	}

	private parseTabsFromText(
		text: string,
		isCode: boolean
	): { title: string; content: string; active: boolean }[] {
		const tabs: { title: string; content: string; active: boolean }[] = [];
		const lines = text.split('\n');
		let currentTitle = '';
		let currentActive = false;
		let currentLines: string[] = [];

		const flushTab = () => {
			if (currentTitle) {
				tabs.push({ title: currentTitle, content: currentLines.join('\n').trim(), active: currentActive });
			}
		};

		for (const line of lines) {
			const tabMatch = line.match(/^@tab(?::active)?\s+(.+)$/);
			if (tabMatch) {
				flushTab();
				currentActive = line.includes('@tab:active');
				currentTitle = tabMatch[1].trim();
				currentLines = [];
			} else {
				currentLines.push(line);
			}
		}

		flushTab();

		if (!tabs.some(t => t.active) && tabs.length > 0) {
			tabs[0].active = true;
		}

		return tabs;
	}

	private syncTabGroup(groupId: string, activeIdx: number) {
		const allGroups = document.querySelectorAll(`[data-tab-group="${groupId}"]`);
		allGroups.forEach(group => {
			const btns = group.querySelectorAll('.vp-tabs-nav-item, .vp-code-tabs-nav-item');
			const tabs = group.querySelectorAll('.vp-tabs-tab, .vp-code-tabs-tab');
			btns.forEach((b, i) => {
				const isCode = b.classList.contains('vp-code-tabs-nav-item');
				const activeClass = isCode ? 'vp-code-tabs-nav-item--active' : 'vp-tabs-nav-item--active';
				const tabActiveClass = isCode ? 'vp-code-tabs-tab--active' : 'vp-tabs-tab--active';
				if (i === activeIdx) {
					b.classList.add(activeClass);
					tabs[i]?.classList.add(tabActiveClass);
				} else {
					b.classList.remove(activeClass);
					tabs[i]?.classList.remove(tabActiveClass);
				}
			});
		});
	}

	private processInlineComponents(el: HTMLElement) {
		this.processGithubLabelTags(el);
		this.processVSCodeLinkTags(el);
		this.processGithubLabelInline(el);
		this.processVSCodeLinkInline(el);
		this.processBannerInline(el);
		this.processBannerArchived(el);
		this.processCedossInline(el);
		this.processVideoTabsInline(el);
		this.processVideoInline(el);
		this.processVideoEmbeds(el);
	}

	private processGithubLabelTags(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && node.textContent.includes('<GithubLabel')) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /<GithubLabel\s+(?:name|label)="([^"]+)"(?:\s+(?:color)="([^"]+)")?\s*\/?>/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const name = match[1];
				const entry = LABEL_MAP[name];
				const span = document.createElement('span');
				span.className = 'sillot-github-label IssueLabel hx_IssueLabel IssueLabel--big lh-condensed js-label-link d-inline-block v-align-middle';
				span.textContent = entry?.fullName || name;
				span.dataset.name = name;
				if (entry?.color) {
					span.style.setProperty('--label-r', String(entry.color.r));
					span.style.setProperty('--label-g', String(entry.color.g));
					span.style.setProperty('--label-b', String(entry.color.b));
					span.style.setProperty('--label-h', String(entry.color.h));
					span.style.setProperty('--label-s', String(entry.color.s));
					span.style.setProperty('--label-l', String(entry.color.l));
				} else if (match[2]) {
					const hex = match[2];
					span.style.backgroundColor = hex;
					span.style.color = this.isLightColor(hex) ? '#1b1f23' : '#ffffff';
				}
				fragment.appendChild(span);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private processVSCodeLinkTags(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && node.textContent.includes('<VSCodeSettingsLink')) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /<VSCodeSettingsLink\s+id="([^"]+)"\s*\/?>/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const id = match[1];
				const anchor = document.createElement('a');
				anchor.className = 'sillot-vscode-link inline';
				anchor.href = `vscode://settings/${id}`;
				anchor.title = `在 VSCode 中打开 ${id} 设置`;

				const icon = anchor.createEl('span', { cls: 'vscode-icon' });
				icon.innerHTML = VSCODE_SVG;

				anchor.createEl('code', { text: id, cls: 'setting-id' });
				fragment.appendChild(anchor);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private processGithubLabelInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-github-label')) continue;
			const text = codeEl.textContent || '';
			const match = text.match(/^GithubLabel:(\w+)(?::([a-fA-F0-9]{6}))?$/);
			if (match) {
				const name = match[1];
				const explicitColor = match[2];
				const entry = LABEL_MAP[name];
				const span = document.createElement('span');
				span.className = 'sillot-github-label IssueLabel hx_IssueLabel IssueLabel--big lh-condensed js-label-link d-inline-block v-align-middle';
				span.textContent = entry?.fullName || name;
				span.dataset.name = name;
				if (entry?.color) {
					span.style.setProperty('--label-r', String(entry.color.r));
					span.style.setProperty('--label-g', String(entry.color.g));
					span.style.setProperty('--label-b', String(entry.color.b));
					span.style.setProperty('--label-h', String(entry.color.h));
					span.style.setProperty('--label-s', String(entry.color.s));
					span.style.setProperty('--label-l', String(entry.color.l));
				} else if (explicitColor) {
					const hex = `#${explicitColor}`;
					span.style.backgroundColor = hex;
					span.style.color = this.isLightColor(hex) ? '#1b1f23' : '#ffffff';
				}
				codeEl.replaceWith(span);
			}
		}
	}

	private processVSCodeLinkInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-vscode-link')) continue;
			const text = codeEl.textContent || '';
			const match = text.match(/^VSCodeSetting:(.+)$/);
			if (match) {
				const id = match[1];
				const anchor = document.createElement('a');
				anchor.className = 'sillot-vscode-link inline';
				anchor.href = `vscode://settings/${id}`;
				anchor.title = `在 VSCode 中打开 ${id} 设置`;

				const icon = anchor.createEl('span', { cls: 'vscode-icon' });
				icon.innerHTML = VSCODE_SVG;

				anchor.createEl('code', { text: id, cls: 'setting-id' });
				codeEl.replaceWith(anchor);
			}
		}
	}

	private processBannerInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-banner, .flash')) continue;
			const text = codeEl.textContent?.trim() || '';
			const match = text.match(/^BannerTop:(\w+)$/);
			if (match) {
				const type = match[1];
				const config = BANNER_MAP[type];
				if (config) {
					const banner = document.createElement('div');
					banner.className = `sillot-banner ${config.flashCls}`;
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.innerHTML = `${config.iconHtml}<span class="split-w"></span>${config.text}`;
					banner.appendChild(content);
					codeEl.replaceWith(banner);
				} else {
					const banner = document.createElement('div');
					banner.className = 'sillot-banner flash flash-warn flash-full border-top-0 text-center text-bold py-2';
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.textContent = `📋 BannerTop: ${type}`;
					banner.appendChild(content);
					codeEl.replaceWith(banner);
				}
			}
		}
	}

	private processBannerArchived(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && /<BannerTop(\w+)\s*\/?>/.test(node.textContent)) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /<BannerTop(\w+)\s*\/?>/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const type = match[1];
				const config = BANNER_MAP[type];
				const banner = document.createElement('div');
				if (config) {
					banner.className = `sillot-banner ${config.flashCls}`;
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.innerHTML = `${config.iconHtml}<span class="split-w"></span>${config.text}`;
					banner.appendChild(content);
				} else {
					banner.className = 'sillot-banner flash flash-warn flash-full border-top-0 text-center text-bold py-2';
					const content = document.createElement('div');
					content.className = 'banner-content';
					content.textContent = `📋 BannerTop: ${type}`;
					banner.appendChild(content);
				}
				fragment.appendChild(banner);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private processCedossInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.const-value, .const-error')) continue;
			const text = codeEl.textContent?.trim() || '';
			const match = text.match(/^Cedoss:([^\s:]+)(?::(\w+))?$/);
			if (match) {
				const id = match[1];
				const errorMode = match[2] || 'verbose';
				const value = CEDOSS_MAP[id];
				const span = document.createElement('span');
				if (value) {
					span.className = 'const-value const-value--linked';
					const link = document.createElement('a');
					link.className = 'const-link';
					link.href = `sillot://cedoss?id=${encodeURIComponent(id)}`;
					link.textContent = value;
					span.appendChild(link);
				} else {
					span.className = `const-error const-error--${errorMode}`;
					if (errorMode === 'icon') {
						span.innerHTML = '<span class="const-error__icon">⚠️</span>';
					} else {
						span.innerHTML = `<span class="const-error__icon">⚠️</span><span class="const-error__text">${id}</span>`;
					}
				}
				codeEl.replaceWith(span);
			}
		}
	}

	private processVideoTabsInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-video-tabs')) continue;
			const text = codeEl.textContent?.trim() || '';
			const match = text.match(/^VideoTabs:(.+)$/);
			if (match) {
				const data = match[1];
				const parts = data.split('|');
				let ap = '';
				let ac = '';
				let bb = '';
				let active = '';
				for (const part of parts) {
					if (part.startsWith('ap:')) ap = part.slice(3);
					else if (part.startsWith('ac:')) ac = part.slice(3);
					else if (part.startsWith('bb:')) bb = part.slice(3);
					else if (part.startsWith('active:')) active = part.slice(7);
				}

				const container = document.createElement('div');
				container.className = 'sillot-video-tabs';

				const nav = container.createDiv({ cls: 'sillot-video-tabs-nav' });
				const contentDiv = container.createDiv({ cls: 'sillot-video-tabs-content' });

				const tabs: Array<{ label: string; el: HTMLElement }> = [];

				if (ap) {
					const tabBtn = nav.createEl('button', { text: 'ArtPlayer', cls: 'sillot-video-tab-btn' });
					const tabContent = contentDiv.createDiv({ cls: 'sillot-video-tab-pane' });
					const wrapper = tabContent.createDiv({ cls: 'sillot-video-embed' });
					wrapper.createEl('video', {
						cls: 'sillot-artplayer-video',
						attr: {
							src: ap,
							controls: '',
							preload: 'metadata',
						},
					});
					tabs.push({ label: 'ArtPlayer', el: tabContent });
					tabBtn.onclick = () => this.switchVideoTab(tabs, 'ArtPlayer', nav, contentDiv);
				}

				if (ac) {
					const acIds = ac.split(',').map(s => s.trim()).filter(Boolean);
					for (const acId of acIds) {
						const label = `AcFun ${acId}`;
						const tabBtn = nav.createEl('button', { text: label, cls: 'sillot-video-tab-btn' });
						const tabContent = contentDiv.createDiv({ cls: 'sillot-video-tab-pane' });
						const wrapper = tabContent.createDiv({ cls: 'sillot-video-embed' });
						wrapper.createEl('iframe', {
							attr: {
								src: `https://www.acfun.cn/player/${acId}`,
								scrolling: 'no',
								border: '0',
								frameborder: 'no',
								framespacing: '0',
								allowfullscreen: 'true',
								allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
							},
						});
						tabs.push({ label, el: tabContent });
						tabBtn.onclick = () => this.switchVideoTab(tabs, label, nav, contentDiv);
					}
				}

				if (bb) {
					const bbIds = bb.split(',').map(s => s.trim()).filter(Boolean);
					for (const bbId of bbIds) {
						const label = `Bilibili ${bbId}`;
						const tabBtn = nav.createEl('button', { text: label, cls: 'sillot-video-tab-btn' });
						const tabContent = contentDiv.createDiv({ cls: 'sillot-video-tab-pane' });
						const wrapper = tabContent.createDiv({ cls: 'sillot-video-embed' });
						wrapper.createEl('iframe', {
							attr: {
								src: `https://player.bilibili.com/player.html?bvid=${bbId}&high_quality=1`,
								scrolling: 'no',
								border: '0',
								frameborder: 'no',
								framespacing: '0',
								allowfullscreen: 'true',
								allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
							},
						});
						tabs.push({ label, el: tabContent });
						tabBtn.onclick = () => this.switchVideoTab(tabs, label, nav, contentDiv);
					}
				}

				const activeLabel = active.toLowerCase();
				let activated = false;
				for (const tab of tabs) {
					if (tab.label.toLowerCase().includes(activeLabel)) {
						tab.el.classList.add('sillot-video-tab-pane--active');
						activated = true;
						break;
					}
				}
				if (!activated && tabs.length > 0) {
					tabs[0].el.classList.add('sillot-video-tab-pane--active');
				}

				const btns = nav.querySelectorAll('.sillot-video-tab-btn');
				let btnActivated = false;
				btns.forEach((btn, idx) => {
					const btnText = btn.textContent?.toLowerCase() || '';
					if (btnText.includes(activeLabel)) {
						btn.classList.add('sillot-video-tab-btn--active');
						btnActivated = true;
					}
				});
				if (!btnActivated && btns.length > 0) {
					btns[0].classList.add('sillot-video-tab-btn--active');
				}

				codeEl.replaceWith(container);
			}
		}
	}

	private switchVideoTab(
		tabs: Array<{ label: string; el: HTMLElement }>,
		activeLabel: string,
		nav: HTMLElement,
		contentDiv: HTMLElement
	) {
		const btns = nav.querySelectorAll('.sillot-video-tab-btn');
		btns.forEach(btn => btn.classList.remove('sillot-video-tab-btn--active'));
		const panes = contentDiv.querySelectorAll('.sillot-video-tab-pane');
		panes.forEach(pane => pane.classList.remove('sillot-video-tab-pane--active'));

		for (let i = 0; i < tabs.length; i++) {
			if (tabs[i].label === activeLabel) {
				tabs[i].el.classList.add('sillot-video-tab-pane--active');
				btns[i]?.classList.add('sillot-video-tab-btn--active');
				break;
			}
		}
	}

	private processVideoInline(el: HTMLElement) {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			if (codeEl.closest('.sillot-video-tabs, .sillot-video-embed')) continue;
			const text = codeEl.textContent?.trim() || '';

			let replaced = false;

			const bilibiliMatch = text.match(/^Bilibili:([^:]+)(?::(\d+))?(?::(.+))?$/);
			if (bilibiliMatch) {
				const bvid = bilibiliMatch[1];
				const page = bilibiliMatch[2];
				const height = bilibiliMatch[3];
				const params = new URLSearchParams();
				params.set('bvid', bvid);
				params.set('high_quality', '1');
				params.set('autoplay', '0');
				if (page) params.set('p', page);
				const wrapper = document.createElement('div');
				wrapper.className = 'sillot-video-embed';
				const iframe = wrapper.createEl('iframe', {
					attr: {
						src: `https://player.bilibili.com/player.html?${params.toString()}`,
						title: 'Bilibili',
						scrolling: 'no',
						border: '0',
						frameborder: 'no',
						framespacing: '0',
						allowfullscreen: 'true',
						allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
					},
				});
				if (height) iframe.style.height = height;
				codeEl.replaceWith(wrapper);
				replaced = true;
			}

			if (!replaced) {
				const acfunMatch = text.match(/^AcFun:([^:]+)(?::(.+))?$/);
				if (acfunMatch) {
					const acId = acfunMatch[1];
					const height = acfunMatch[2];
					const wrapper = document.createElement('div');
					wrapper.className = 'sillot-video-embed';
					const iframe = wrapper.createEl('iframe', {
						attr: {
							src: `https://www.acfun.cn/player/${acId}`,
							title: 'AcFun',
							scrolling: 'no',
							border: '0',
							frameborder: 'no',
							framespacing: '0',
							allowfullscreen: 'true',
							allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture',
						},
					});
					if (height) iframe.style.height = height;
					codeEl.replaceWith(wrapper);
					replaced = true;
				}
			}

			if (!replaced) {
				const artMatch = text.match(/^ArtPlayer:(.+?)(?::(.+))?$/);
				if (artMatch) {
					const url = artMatch[1];
					const height = artMatch[2];
					const wrapper = document.createElement('div');
					wrapper.className = 'sillot-video-embed';
					const video = wrapper.createEl('video', {
						cls: 'sillot-artplayer-video',
						attr: {
							src: url,
							controls: '',
							preload: 'metadata',
						},
					});
					if (height) video.style.height = height;
					codeEl.replaceWith(wrapper);
					replaced = true;
				}
			}
		}
	}

	private processVideoEmbeds(el: HTMLElement) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (node.textContent && node.textContent.includes('@[bilibili]')) {
				textNodes.push(node);
			}
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent || '';
			const regex = /@\[bilibili\]\(([^)]+)\)/g;
			let match;
			let lastIndex = 0;
			const fragment = document.createDocumentFragment();

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
				}

				const bvid = match[1];
				const wrapper = document.createElement('div');
				wrapper.className = 'sillot-video-embed';
				const iframe = wrapper.createEl('iframe', {
					attr: {
						src: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1`,
						scrolling: 'no',
						border: '0',
						frameborder: 'no',
						framespacing: '0',
						allowfullscreen: 'true',
					},
				});
				iframe.style.width = '100%';
				iframe.style.aspectRatio = '16/9';
				iframe.style.borderRadius = '6px';
				fragment.appendChild(wrapper);

				lastIndex = match.index + match[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			if (fragment.childNodes.length > 0) {
				textNode.replaceWith(fragment);
			}
		}
	}

	private isLightColor(hex: string): boolean {
		const c = hex.replace('#', '');
		const r = parseInt(c.substr(0, 2), 16);
		const g = parseInt(c.substr(2, 2), 16);
		const b = parseInt(c.substr(4, 2), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.6;
	}
}
