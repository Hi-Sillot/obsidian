import { MarkdownRenderer } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import type { SyncCacheEntry } from '../types';

export function registerSyncBlockRenderer(plugin: VuePressPublisherPlugin) {
	plugin.registerMarkdownCodeBlockProcessor('sync-global', async (source, el, ctx) => {
		const syncId = source.trim().split('\n')[0].trim();
		if (!syncId) {
			el.createEl('em', { text: '[sync-global: 缺少 sync_id]' });
			return;
		}
		await renderPluginSyncBlock(plugin, syncId, el, ctx.sourcePath);
	});

	plugin.registerMarkdownCodeBlockProcessor('sync-block', async (source, el, ctx) => {
		const lines = source.trim().split('\n');
		const firstLine = lines[0].trim();
		const m = firstLine.match(/^([^\s]+)(?:\s+Lv=(\d{8}\s\d{6}))?$/);
		if (!m) {
			el.createEl('em', { text: '[sync-block: 格式错误]' });
			return;
		}
		const syncId = m[1];
		const content = lines.slice(1).join('\n').trim();
		const wrapper = el.createDiv({ cls: 'sillot-sync-doc-block' });
		const label = wrapper.createEl('div', { cls: 'sillot-sync-doc-label' });
		label.createEl('small', { text: `🔗 ${syncId}` });
		if (content) {
			const contentEl = wrapper.createDiv({ cls: 'sillot-sync-doc-content' });
			await MarkdownRenderer.render(plugin.app, content, contentEl, ctx.sourcePath, plugin);
		} else {
			wrapper.createEl('em', { text: `[${syncId}: 内容为空]`, cls: 'sillot-sync-empty' });
		}
	});

	plugin.registerMarkdownPostProcessor(async (el, _ctx) => {
		const codeElements = el.querySelectorAll('code');
		for (let i = 0; i < codeElements.length; i++) {
			const codeEl = codeElements[i];
			const text = codeEl.textContent || '';

			const globalMatch = text.match(/^sync-global:([^\s]+)$/);
			if (globalMatch && !codeEl.parentElement?.classList.contains('sillot-sync-content')) {
				const syncId = globalMatch[1];
				const span = document.createElement('span');
				span.classList.add('sillot-sync-inline');
				span.dataset.syncId = syncId;
				codeEl.replaceWith(span);
				renderPluginSyncInline(plugin, syncId, span);
				continue;
			}

			const docMatch = text.match(/^sync:([^\s{`]+)(?:\s+Lv=(\d{8}\s\d{6}))?\{([^}]*)\}$/);
			if (docMatch && !codeEl.parentElement?.classList.contains('sillot-sync-content')) {
				const syncId = docMatch[1];
				const content = docMatch[3] || '';
				const span = document.createElement('span');
				span.classList.add('sillot-sync-doc-inline');
				span.dataset.syncId = syncId;
				if (content) {
					span.textContent = content;
				} else {
					const label = span.createEl('small', { cls: 'sillot-sync-doc-inline-label' });
					label.textContent = `🔗${syncId}`;
				}
				codeEl.replaceWith(span);
				continue;
			}

		}
	});
}

async function renderPluginSyncBlock(plugin: VuePressPublisherPlugin, syncId: string, container: HTMLElement, sourcePath: string) {
	const cached = plugin.syncCache.content[syncId];
	if (cached && cached.sync_content) {
		await MarkdownRenderer.render(plugin.app, cached.sync_content, container, sourcePath, plugin);
	} else {
		container.setText('⏳');
	}
	fetchAndRenderPluginSync(plugin, syncId, container, sourcePath);
}

function renderPluginSyncInline(plugin: VuePressPublisherPlugin, syncId: string, container: HTMLElement) {
	const cached = plugin.syncCache.content[syncId];
	if (cached && cached.sync_content) {
		container.setText(cached.sync_content);
	} else {
		container.setText('⏳');
	}
	fetchAndRenderPluginSyncInline(plugin, syncId, container);
}

async function fetchAndRenderPluginSync(plugin: VuePressPublisherPlugin, syncId: string, container: HTMLElement, sourcePath: string) {
	if (!plugin.syncManager) {
		container.empty();
		container.createEl('em', { text: `[未配置同步]` });
		return;
	}
	try {
		const res = await plugin.syncManager.client.getPluginSync(syncId);
		if (res.success && res.data) {
			const entry: SyncCacheEntry = {
				sync_id: res.data.sync_id || syncId,
				sync_type: res.data.sync_type || 'codeblock',
				sync_content: res.data.sync_content ?? '',
				description: res.data.description || '',
				category: res.data.category || '',
				updated_at: res.data.updated_at || '',
				cloud_version_time: res.data.cloud_version_time || '',
			};
			plugin.updateSyncContentCache(entry);
			container.empty();
			if (entry.sync_content) {
				await MarkdownRenderer.render(plugin.app, entry.sync_content, container, sourcePath, plugin);
			} else {
				container.createEl('em', { text: `[${syncId}: 内容为空]`, cls: 'sillot-sync-empty' });
			}
		} else {
			const cached = plugin.syncCache.content[syncId];
			if (!cached) {
				container.empty();
				container.createEl('em', { text: `[${syncId}: 云端未找到]` });
			}
		}
	} catch {
		const cached = plugin.syncCache.content[syncId];
		if (!cached) {
			container.empty();
			container.createEl('em', { text: `[${syncId}: 加载失败]` });
		}
	}
}

async function fetchAndRenderPluginSyncInline(plugin: VuePressPublisherPlugin, syncId: string, container: HTMLElement) {
	if (!plugin.syncManager) {
		container.empty();
		container.createEl('em', { text: `[未配置同步]` });
		return;
	}
	try {
		const res = await plugin.syncManager.client.getPluginSync(syncId);
		if (res.success && res.data) {
			const entry: SyncCacheEntry = {
				sync_id: res.data.sync_id || syncId,
				sync_type: res.data.sync_type || 'inline',
				sync_content: res.data.sync_content ?? '',
				description: res.data.description || '',
				category: res.data.category || '',
				updated_at: res.data.updated_at || '',
				cloud_version_time: res.data.cloud_version_time || '',
			};
			plugin.updateSyncContentCache(entry);
			container.empty();
			container.setText(entry.sync_content || `[${syncId}: 内容为空]`);
		} else {
			const cached = plugin.syncCache.content[syncId];
			if (!cached) {
				container.empty();
				container.createEl('em', { text: `[${syncId}: 云端未找到]` });
			}
		}
	} catch {
		const cached = plugin.syncCache.content[syncId];
		if (!cached) {
			container.empty();
			container.createEl('em', { text: `[${syncId}: 加载失败]` });
		}
	}
}
