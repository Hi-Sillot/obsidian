import { TFile, Vault, Notice } from 'obsidian';
import { KDocsClient } from '../kdocs/KDocsClient';
import type { ParsedSyncBlock, SyncResult, KDocsResponse, SyncCacheEntry } from '../types';
import type { Logger } from '../utils/Logger';

export class SyncManager {
	client: KDocsClient;
	onCacheUpdate?: (entry: SyncCacheEntry) => void;

	constructor(webhookUrl: string, token: string, private vault: Vault, logger?: Logger) {
		this.client = new KDocsClient(webhookUrl, token, logger);
	}

	formatDateTime(): string {
		const date = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	}

	parseSyncBlocks(content: string, _filePath: string): ParsedSyncBlock[] {
		const blocks: ParsedSyncBlock[] = [];

		const globalInlineRegex = /`sync-global:([^\s`]+)`/g;
		let match;
		while ((match = globalInlineRegex.exec(content)) !== null) {
			blocks.push({
				syncId: match[1],
				content: '',
				localTime: '',
				type: 'inline',
				scope: 'global',
				startPos: match.index,
				endPos: match.index + match[0].length,
				fullMatch: match[0],
			});
		}

		const globalCodeRegex = /```sync-global\n([^\s\n]+)\n([\s\S]*?)```/g;
		while ((match = globalCodeRegex.exec(content)) !== null) {
			blocks.push({
				syncId: match[1],
				content: match[2].trim(),
				localTime: '',
				type: 'codeblock',
				scope: 'global',
				startPos: match.index,
				endPos: match.index + match[0].length,
				fullMatch: match[0],
			});
		}

		const docInlineRegex = /`sync:(?!global:)([^\s{`]+)(?:\s+Lv=(\d{8}\s\d{6}))?\{([^}]*)\}`/g;
		while ((match = docInlineRegex.exec(content)) !== null) {
			blocks.push({
				syncId: match[1],
				content: match[3],
				localTime: match[2] || this.formatDateTime(),
				type: 'inline',
				scope: 'document',
				startPos: match.index,
				endPos: match.index + match[0].length,
				fullMatch: match[0],
			});
		}

		const docCodeRegex = /```sync-block\n([^\s\n]+)(?:\s+Lv=(\d{8}\s\d{6}))?\n?([\s\S]*?)```/g;
		while ((match = docCodeRegex.exec(content)) !== null) {
			blocks.push({
				syncId: match[1],
				content: match[3].trim(),
				localTime: match[2] || this.formatDateTime(),
				type: 'codeblock',
				scope: 'document',
				startPos: match.index,
				endPos: match.index + match[0].length,
				fullMatch: match[0],
			});
		}

		return blocks;
	}

	async syncFile(file: TFile): Promise<SyncResult> {
		const content = await this.vault.read(file);
		const blocks = this.parseSyncBlocks(content, file.path);
		const result: SyncResult = { synced: 0, conflicts: 0, details: [] };
		let newContent = content;
		let hasChanges = false;

		for (const block of blocks) {
			if (block.scope === 'global') {
				const syncResult = await this.syncGlobalBlock(block);
				if (syncResult.contentChanged) {
					if (block.type === 'codeblock') {
						const replacement = `\`\`\`sync-global\n${block.syncId}\n${syncResult.newContent}\n\`\`\``;
						newContent = newContent.replace(block.fullMatch, replacement);
						hasChanges = true;
					}
					if (this.onCacheUpdate) {
						this.onCacheUpdate({
							sync_id: block.syncId,
							sync_type: block.type,
							sync_content: syncResult.newContent,
							description: '',
							category: '',
							updated_at: '',
							cloud_version_time: '',
						});
					}
				}
				result.synced++;
				result.details.push(`global/${block.syncId}: ${syncResult.action}`);
			} else {
				const syncResult = await this.syncDocumentBlock(block, file.path);
				if (syncResult.contentChanged) {
					const replacement = block.type === 'inline'
						? `\`sync:${block.syncId} Lv=${syncResult.newTime}{${syncResult.newContent}}\``
						: `\`\`\`sync-block\n${block.syncId} Lv=${syncResult.newTime}\n${syncResult.newContent}\n\`\`\``;
					newContent = newContent.replace(block.fullMatch, replacement);
					hasChanges = true;
				}
				if (syncResult.conflict) result.conflicts++;
				result.synced++;
				result.details.push(`document/${block.syncId}: ${syncResult.action}`);
			}
		}

		if (hasChanges) await this.vault.modify(file, newContent);
		return result;
	}

	private async syncGlobalBlock(block: ParsedSyncBlock): Promise<{
		action: string;
		contentChanged: boolean;
		newContent: string;
	}> {
		const res = await this.client.getPluginSync(block.syncId);
		if (!res.success || !res.data) {
			return { action: '云端未找到', contentChanged: false, newContent: '' };
		}
		return {
			action: '从云端更新',
			contentChanged: true,
			newContent: res.data.sync_content,
		};
	}

	private async syncDocumentBlock(block: ParsedSyncBlock, notePath: string): Promise<{
		action: string;
		contentChanged: boolean;
		newContent: string;
		newTime: string;
		conflict: boolean;
	}> {
		const localTime = block.localTime;
		const localContent = block.content;

		const res = await this.client.getDocSync(block.syncId, notePath);
		if (!res.success || !res.data) {
			await this.client.upsertDocSync({
				sync_block_id: block.syncId,
				note_path: notePath,
				sync_type: block.type,
				local_version_time: localTime,
				block_content: localContent,
			});
			return { action: '首次推送', contentChanged: false, newContent: localContent, newTime: localTime, conflict: false };
		}

		const cloudTime = res.data.cloud_version_time;
		const cloudContent = res.data.block_content;
		const localTimeNum = parseInt(localTime.replace(/\s/g, ''));
		const cloudTimeNum = parseInt(cloudTime.replace(/\s/g, ''));

		if (localTimeNum === cloudTimeNum) {
			if (localContent !== cloudContent) {
				await this.client.markConflict(block.syncId, notePath, localTime);
				return { action: '冲突待解决', contentChanged: false, newContent: localContent, newTime: localTime, conflict: true };
			}
			return { action: '已同步', contentChanged: false, newContent: localContent, newTime: localTime, conflict: false };
		}
		if (localTimeNum > cloudTimeNum) {
			await this.client.upsertDocSync({
				sync_block_id: block.syncId,
				note_path: notePath,
				sync_type: block.type,
				local_version_time: localTime,
				block_content: localContent,
			});
			return { action: '本地更新推送', contentChanged: false, newContent: localContent, newTime: localTime, conflict: false };
		}

		return { action: '云端更新拉取', contentChanged: true, newContent: cloudContent, newTime: cloudTime, conflict: false };
	}

	async getPluginSyncList(category?: string): Promise<KDocsResponse> {
		return this.client.listPluginSyncs(category);
	}

	async createOrUpdatePluginSync(data: { sync_id: string; sync_type: 'inline' | 'codeblock'; sync_content: string; description?: string; category?: string }): Promise<KDocsResponse> {
		return this.client.upsertPluginSync(data);
	}

	async deletePluginSync(syncId: string): Promise<KDocsResponse> {
		return this.client.deletePluginSync(syncId);
	}

	async healthCheck(): Promise<{ ok: boolean; detail: string }> {
		return this.client.healthCheck();
	}
}
