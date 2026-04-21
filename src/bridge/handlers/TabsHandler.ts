import { MarkdownRenderer, MarkdownPostProcessorContext } from 'obsidian';
import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

const TAB_TYPES = new Set(['tabs', 'code-tabs', 'video-tabs']);

export class TabsHandler extends BaseSyntaxHandler {
	static readonly TAB_TYPES = TAB_TYPES;

	async buildContainer(containerType: string, title: string, contentText: string, ctx: MarkdownPostProcessorContext): Promise<HTMLElement | null> {
		if (!TAB_TYPES.has(containerType)) return null;
		return this.createTabsFromText(contentText, containerType, title, '', ctx);
	}

	async buildContainerWithGroupId(containerType: string, title: string, tabGroupId: string, contentText: string, ctx: MarkdownPostProcessorContext): Promise<HTMLElement> {
		return this.createTabsFromText(contentText, containerType, title, tabGroupId, ctx);
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
					await MarkdownRenderer.render(
						this.plugin.app, tab.content, tabContent, ctx.sourcePath, this.plugin
					);
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
}
