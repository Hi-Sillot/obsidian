import { requestUrl, RequestUrlParam } from 'obsidian';
import type { PluginSyncInfo, DocSyncInfo, ContentItem, KDocsResponse } from '../types';
import type { Logger } from '../utils/Logger';

const TAG = 'KDocs';

export class KDocsClient {
	private webhookUrl: string;
	private token: string;
	private logger: Logger | null;

	constructor(webhookUrl: string, token: string, logger?: Logger) {
		this.webhookUrl = webhookUrl;
		this.token = token;
		this.logger = logger || null;
	}

	updateConfig(webhookUrl: string, token: string) {
		this.webhookUrl = webhookUrl;
		this.token = token;
	}

	formatDateTime(date: Date = new Date()): string {
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	}

	async call<T = any>(action: string, data: any): Promise<KDocsResponse<T>> {
		this.logger?.debug(TAG, `→ ${action}`, JSON.stringify(data));
		if (!this.webhookUrl) {
			return { success: false, error: '未配置 Webhook URL' };
		}
		if (!this.token) {
			return { success: false, error: '未配置 AirScript Token' };
		}
		try {
			const params: RequestUrlParam = {
				url: this.webhookUrl,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'AirScript-Token': this.token,
				},
				body: JSON.stringify({
					Context: {
						argv: { action, data },
					},
				}),
			};
			const response = await requestUrl(params);
			const raw = response.json;

			if (raw.status === 'finished' && raw.error === '') {
				const result = raw.data?.result;
				this.logger?.debug(TAG, `← ${action} result`, typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : String(result));
				if (result && typeof result === 'object') {
					return result;
				}
				return { success: true, data: result };
			}

			if (raw.error && raw.error !== '') {
				this.logger?.error(TAG, `${action} script error`, raw.error);
				const errorDetails = raw.error_details;
				const msg = errorDetails?.msg || raw.error;
				return { success: false, error: msg };
			}

			if (raw.status && raw.status !== 'finished') {
				this.logger?.warn(TAG, `${action} status: ${raw.status}`);
				return { success: false, error: `脚本执行状态: ${raw.status}` };
			}

			return raw;
		} catch (error) {
			this.logger?.error(TAG, `${action} request failed`, error.message);
			throw error;
		}
	}

	async ping(): Promise<KDocsResponse> {
		return this.call('ping', {});
	}

	async healthCheck(): Promise<{ ok: boolean; detail: string }> {
		if (!this.webhookUrl) {
			return { ok: false, detail: '未配置 Webhook URL' };
		}
		if (!this.token) {
			return { ok: false, detail: '未配置 AirScript Token（脚本令牌），请在插件设置中填写。' };
		}
		try {
			const pingRes = await this.ping();
			if (!pingRes.success) {
				return { ok: false, detail: `脚本执行出错: ${pingRes.error || '未知错误'}` };
			}

			const listRes = await this.listPluginSyncs();
			if (listRes.success === true) {
				return { ok: true, detail: '连接成功！Webhook、Token 和数据表均正常。' };
			}
			if (listRes.error && listRes.error.includes('not found')) {
				return { ok: true, detail: '连接成功！但数据表尚未创建，请点击「初始化表」。' };
			}
			return { ok: false, detail: `数据表访问出错: ${listRes.error || '未知错误'}` };
		} catch (error) {
			const msg = error.message || String(error);
			if (msg.includes('403')) {
				return { ok: false, detail: '403 禁止访问：AirScript Token 无效或已过期，请重新生成。' };
			}
			return { ok: false, detail: `请求失败: ${msg}` };
		}
	}

	async getPluginSync(syncId: string) {
		return this.call<PluginSyncInfo>('getPluginSync', { sync_id: syncId });
	}

	async upsertPluginSync(data: { sync_id: string; sync_type: string; sync_content: string; description?: string; category?: string }) {
		return this.call('upsertPluginSync', data);
	}

	async listPluginSyncs(category?: string) {
		return this.call<PluginSyncInfo[]>('listPluginSyncs', { category });
	}

	async deletePluginSync(syncId: string) {
		return this.call('deletePluginSync', { sync_id: syncId });
	}

	async getDocSync(syncBlockId: string, notePath: string) {
		return this.call<DocSyncInfo>('getDocSync', { sync_block_id: syncBlockId, note_path: notePath });
	}

	async upsertDocSync(data: { sync_block_id: string; note_path: string; sync_type: string; local_version_time: string; block_content: string; conflict_resolution?: string }) {
		return this.call('upsertDocSync', data);
	}

	async pullCloudContent(syncBlockId: string, notePath: string, newLocalTime: string) {
		return this.call('pullCloudContent', { sync_block_id: syncBlockId, note_path: notePath, new_local_version_time: newLocalTime });
	}

	async markConflict(syncBlockId: string, notePath: string, localTime: string) {
		return this.call('markConflict', { sync_block_id: syncBlockId, note_path: notePath, local_version_time: localTime });
	}

	async queryContentByUUID(uuid: string) {
		return this.call<ContentItem>('queryContentByUUID', { uuid });
	}

	async listContentByCategory(category: string, limit?: number, offset?: number) {
		return this.call('listContentByCategory', { category, limit, offset });
	}

	async insertPublishRecord(data: { file_name: string; target_branch: string; status: string; vuepress_path?: string; error_message?: string }) {
		return this.call('insertPublishRecord', data);
	}

	async initTables() {
		return this.call('initTables', {});
	}
}
