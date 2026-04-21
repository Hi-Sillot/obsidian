import { WorkspaceLeaf } from 'obsidian';
import type VuePressPublisherPlugin from '../main';
import { PluginSyncView, VIEW_TYPE_PLUGIN_SYNC } from './PluginSyncView';
import { DevPanelView, VIEW_TYPE_DEV_PANEL } from './DevPanelView';
import { BiGraphView, VIEW_TYPE_BIGRAPH } from '../bigraph/BiGraphView';
import { BiGraphWebView, VIEW_TYPE_BIGRAPH_WEB } from '../bigraph/BiGraphWebView';
import { PublishPanelView, VIEW_TYPE_PUBLISH } from './PublishPanelView';

export class ViewManager {
	private plugin: VuePressPublisherPlugin;

	constructor(plugin: VuePressPublisherPlugin) {
		this.plugin = plugin;
	}

	registerViews() {
		this.plugin.registerView(VIEW_TYPE_PLUGIN_SYNC, (leaf) => {
			return new PluginSyncView(leaf, this.plugin);
		});

		this.plugin.registerView(VIEW_TYPE_DEV_PANEL, (leaf) => {
			return new DevPanelView(leaf, this.plugin);
		});

		this.plugin.registerView(VIEW_TYPE_BIGRAPH, (leaf) => {
			return new BiGraphView(leaf, this.plugin);
		});

		this.plugin.registerView(VIEW_TYPE_BIGRAPH_WEB, (leaf) => {
			return new BiGraphWebView(leaf, this.plugin);
		});

		this.plugin.registerView(VIEW_TYPE_PUBLISH, (leaf) => {
			return new PublishPanelView(leaf, this.plugin);
		});
	}

	async activatePublishPanel() {
		const { workspace } = this.plugin.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_PUBLISH)[0] || null;
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_PUBLISH, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateBiGraphView() {
		const { workspace } = this.plugin.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_BIGRAPH)[0] || null;
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_BIGRAPH, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateBiGraphLocalView() {
		await this.activateBiGraphView();
		const leaf = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_BIGRAPH)[0];
		if (leaf && leaf.view instanceof BiGraphView) {
			leaf.view.focusCurrentFile();
		}
	}

	async openSitePreview(url: string) {
		const { workspace } = this.plugin.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_BIGRAPH_WEB)[0] || null;
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_BIGRAPH_WEB, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
			const view = leaf.view as BiGraphWebView;
			await view.onLoadUrl(url);
		}
	}

	async activateSyncView() {
		const { workspace } = this.plugin.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_PLUGIN_SYNC)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_PLUGIN_SYNC, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateDevPanel() {
		const { workspace } = this.plugin.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DEV_PANEL)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_DEV_PANEL, active: true });
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	detachAll() {
		this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_PLUGIN_SYNC);
		this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_DEV_PANEL);
		this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_BIGRAPH);
		this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_PUBLISH);
	}
}
