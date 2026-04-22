import { Notice } from 'obsidian';
import { GitHubApi } from './githubApi';

export interface MoveResult {
	success: boolean;
	oldPath: string;
	newPath: string;
	commitSha?: string;
	prUrl?: string;
	prNumber?: number;
	error?: string;
}

export interface MoveOptions {
	createPR: boolean;
	commitMessage?: string;
	onProgress?: (percent: number, message: string) => void;
}

export class PathMover {
	private api: GitHubApi;
	private docsDir: string;

	constructor(api: GitHubApi, docsDir: string = 'docs') {
		this.api = api;
		this.docsDir = docsDir.replace(/^\/+|\/+$/g, '');
	}

	async moveDocument(
		oldCloudPath: string,
		newCloudPath: string,
		options: MoveOptions
	): Promise<MoveResult> {
		const progress = options.onProgress || (() => {});

		try {
			progress(5, '获取原文件内容...');
			const content = await this.api.getFileContent(oldCloudPath);
			if (content === null) {
				return {
					success: false,
					oldPath: oldCloudPath,
					newPath: newCloudPath,
					error: '无法获取原文件内容，可能文件不存在',
				};
			}

			progress(30, '创建新路径文件...');
			const base64Content = btoa(unescape(encodeURIComponent(content)));

			const defaultMsg = `移动文档: ${oldCloudPath} → ${newCloudPath}`;
			const commitMessage = options.commitMessage || defaultMsg;

			const result = await this.api.publishFiles(
				[
					{ path: newCloudPath, content: base64Content },
					{ path: oldCloudPath, content: '' },
				],
				{
					commitMessage,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: options.createPR ? `move/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR: options.createPR,
					onProgress: (percent, msg) => {
						progress(30 + Math.round(percent * 0.65), msg);
					},
				}
			);

			progress(100, '移动完成');
			return {
				success: true,
				oldPath: oldCloudPath,
				newPath: newCloudPath,
				commitSha: result.commitSha,
				prUrl: result.prUrl,
				prNumber: result.prNumber,
			};
		} catch (error: any) {
			new Notice(`移动文档失败: ${error.message}`, 4000);
			return {
				success: false,
				oldPath: oldCloudPath,
				newPath: newCloudPath,
				error: error.message,
			};
		}
	}

	async deleteDocument(
		cloudPath: string,
		options: { createPR: boolean; commitMessage?: string; onProgress?: (percent: number, message: string) => void }
	): Promise<{ success: boolean; error?: string }> {
		const progress = options.onProgress || (() => {});

		try {
			progress(10, '确认文件存在...');
			const content = await this.api.getFileContent(cloudPath);
			if (content === null) {
				return { success: false, error: '文件不存在' };
			}

			progress(30, '删除文件...');
			const defaultMsg = `删除文档: ${cloudPath}`;
			const result = await this.api.publishFiles(
				[{ path: cloudPath, content: '' }],
				{
					commitMessage: options.commitMessage || defaultMsg,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: options.createPR ? `delete/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR: options.createPR,
					onProgress: (percent, msg) => {
						progress(30 + Math.round(percent * 0.65), msg);
					},
				}
			);

			progress(100, '删除完成');
			return { success: true };
		} catch (error: any) {
			new Notice(`删除文档失败: ${error.message}`, 4000);
			return { success: false, error: error.message };
		}
	}

	validatePath(path: string): { valid: boolean; message: string } {
		if (!path || path.trim() === '') {
			return { valid: false, message: '路径不能为空' };
		}

		if (!path.endsWith('.md')) {
			return { valid: false, message: '路径必须以 .md 结尾' };
		}

		const invalidChars = /[<>"|?*\x00-\x1f]/;
		if (invalidChars.test(path)) {
			return { valid: false, message: '路径包含非法字符' };
		}

		const normalized = path.replace(/^\/+|\/+$/g, '');
		if (normalized.includes('..')) {
			return { valid: false, message: '路径不能包含 .. 相对路径' };
		}

		return { valid: true, message: '路径有效' };
	}
}
