import { requestUrl, RequestUrlParam } from 'obsidian';

export interface PublishOptions {
	commitMessage: string;
	baseBranch: string;
	targetBranch: string;
	createPR: boolean;
	prTitle?: string;
	prBody?: string;
	onProgress?: (percent: number, message: string) => void;
}

export interface PublishResult {
	commitSha: string;
	branch: string;
	prUrl?: string;
	prNumber?: number;
}

interface GitBlob {
	path: string;
	mode: string;
	type: string;
	sha: string;
}

export class GitHubApi {
	private repo: string;
	private token: string;

	constructor(repo: string, token: string) {
		this.repo = repo;
		this.token = token;
	}

	getRepo(): string {
		return this.repo;
	}

	private async request(params: RequestUrlParam): Promise<any> {
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const response = await requestUrl(params);
				return response.json;
			} catch (e: any) {
				lastError = e;
				const status = e?.status || 0;
				if (status === 401 || status === 403 || status === 404 || status === 422) {
					throw e;
				}
				if (attempt < maxRetries) {
					const delay = Math.pow(2, attempt) * 1000;
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}

		throw lastError;
	}

	private ghUrl(path: string): string {
		return `https://api.github.com/repos/${this.repo}${path}`;
	}

	private defaultHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.token}`,
			Accept: 'application/vnd.github.v3+json',
			'Content-Type': 'application/json',
		};
	}

	async getFileContent(path: string, branch?: string): Promise<string | null> {
		try {
			const ref = branch || await this.getDefaultBranch();
			const response = await requestUrl({
				url: this.ghUrl(`/contents/${path}?ref=${ref}`),
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: 'application/vnd.github.v3.raw',
				},
			});
			return response.text;
		} catch {
			return null;
		}
	}

	async getFileBinary(path: string, branch?: string): Promise<ArrayBuffer | null> {
		try {
			const ref = branch || await this.getDefaultBranch();
			const response = await requestUrl({
				url: this.ghUrl(`/contents/${path}?ref=${ref}`),
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: 'application/vnd.github.v3.raw',
				},
			});
			return response.arrayBuffer;
		} catch (error) {
			console.error(`[GitHubApi] Failed to get binary file ${path}:`, error);
			return null;
		}
	}

	async fileExists(path: string, branch?: string): Promise<boolean> {
		try {
			const ref = branch || await this.getDefaultBranch();
			await requestUrl({
				url: this.ghUrl(`/contents/${path}?ref=${ref}`),
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: 'application/vnd.github.v3+json',
				},
			});
			return true;
		} catch {
			return false;
		}
	}

	async getDefaultBranch(): Promise<string> {
		try {
			const data = await this.request({
				url: this.ghUrl(''),
				headers: this.defaultHeaders(),
			});
			return data.default_branch || 'main';
		} catch {
			return 'main';
		}
	}

	async publishFiles(files: { path: string; content: string }[], options: PublishOptions): Promise<PublishResult> {
		const progress = options.onProgress || (() => {});

		progress(5, '获取基准分支最新提交...');
		const baseRef = await this.getRef(`heads/${options.baseBranch}`);

		progress(15, `创建 Blob 对象 (${files.length} 个文件)...`);
		const blobs: GitBlob[] = [];
		for (let i = 0; i < files.length; i++) {
			const blobSha = await this.createBlob(files[i].content);
			blobs.push({
				path: files[i].path,
				mode: '100644',
				type: 'blob',
				sha: blobSha,
			});
			progress(15 + Math.round((i + 1) / files.length * 25), `创建 Blob (${i + 1}/${files.length})...`);
		}

		progress(45, '创建 Tree...');
		const treeSha = await this.createTree(blobs, baseRef);

		progress(60, '创建 Commit...');
		const commitSha = await this.createCommit(options.commitMessage, treeSha, [baseRef]);

		progress(75, `更新分支 ${options.targetBranch}...`);
		await this.ensureBranch(options.targetBranch, commitSha);

		let prUrl: string | undefined;
		let prNumber: number | undefined;

		if (options.createPR && options.targetBranch !== options.baseBranch) {
			progress(85, '创建 Pull Request...');
			const pr = await this.createPullRequest({
				title: options.prTitle || options.commitMessage,
				body: options.prBody || `由 Sillot 插件从 Obsidian 发布\n\n${options.commitMessage}`,
				head: options.targetBranch,
				base: options.baseBranch,
			});
			prUrl = pr.html_url;
			prNumber = pr.number;
		}

		progress(100, '发布完成');
		return { commitSha, branch: options.targetBranch, prUrl, prNumber };
	}

	private async getRef(ref: string): Promise<string> {
		const data = await this.request({
			url: this.ghUrl(`/git/ref/${ref}`),
			headers: this.defaultHeaders(),
		});
		return data.object.sha;
	}

	private async createBlob(content: string): Promise<string> {
		const data = await this.request({
			url: this.ghUrl('/git/blobs'),
			method: 'POST',
			headers: this.defaultHeaders(),
			body: JSON.stringify({ content, encoding: 'base64' }),
		});
		return data.sha;
	}

	private async createTree(entries: GitBlob[], baseTreeSha: string): Promise<string> {
		const data = await this.request({
			url: this.ghUrl('/git/trees'),
			method: 'POST',
			headers: this.defaultHeaders(),
			body: JSON.stringify({
				base_tree: baseTreeSha,
				tree: entries,
			}),
		});
		return data.sha;
	}

	private async createCommit(message: string, treeSha: string, parentShas: string[]): Promise<string> {
		const data = await this.request({
			url: this.ghUrl('/git/commits'),
			method: 'POST',
			headers: this.defaultHeaders(),
			body: JSON.stringify({
				message,
				tree: treeSha,
				parents: parentShas,
			}),
		});
		return data.sha;
	}

	private async ensureBranch(branchName: string, commitSha: string): Promise<void> {
		try {
			await this.request({
				url: this.ghUrl(`/git/ref/heads/${branchName}`),
				headers: this.defaultHeaders(),
			});
			await this.request({
				url: this.ghUrl(`/git/ref/heads/${branchName}`),
				method: 'PATCH',
				headers: this.defaultHeaders(),
				body: JSON.stringify({ sha: commitSha, force: true }),
			});
		} catch {
			await this.request({
				url: this.ghUrl('/git/refs'),
				method: 'POST',
				headers: this.defaultHeaders(),
				body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commitSha }),
			});
		}
	}

	async createPullRequest(params: { title: string; body: string; head: string; base: string }): Promise<{ html_url: string; number: number }> {
		return this.request({
			url: this.ghUrl('/pulls'),
			method: 'POST',
			headers: this.defaultHeaders(),
			body: JSON.stringify(params),
		});
	}

	async getCheckRuns(ref: string): Promise<any[]> {
		const data = await this.request({
			url: this.ghUrl(`/commits/${ref}/check-runs`),
			headers: this.defaultHeaders(),
		});
		return data.check_runs || [];
	}

	async mergePullRequest(prNumber: number, options?: { commitTitle?: string; commitMessage?: string; mergeMethod?: string }): Promise<any> {
		return this.request({
			url: this.ghUrl(`/pulls/${prNumber}/merge`),
			method: 'PUT',
			headers: this.defaultHeaders(),
			body: JSON.stringify({
				commit_title: options?.commitTitle,
				commit_message: options?.commitMessage,
				merge_method: options?.mergeMethod || 'merge',
			}),
		});
	}

	async closePullRequest(prNumber: number): Promise<any> {
		return this.request({
			url: this.ghUrl(`/pulls/${prNumber}`),
			method: 'PATCH',
			headers: this.defaultHeaders(),
			body: JSON.stringify({ state: 'closed' }),
		});
	}

	async deleteBranch(branch: string): Promise<void> {
		try {
			await this.request({
				url: this.ghUrl(`/git/refs/heads/${branch}`),
				method: 'DELETE',
				headers: this.defaultHeaders(),
			});
		} catch (e: any) {
			if (e?.status === 422) {
				return;
			}
			throw e;
		}
	}

	async getPRComments(prNumber: number): Promise<any[]> {
		const data = await this.request({
			url: this.ghUrl(`/issues/${prNumber}/comments`),
			headers: this.defaultHeaders(),
		});
		return Array.isArray(data) ? data : [];
	}

	async getPRReviews(prNumber: number): Promise<any[]> {
		const data = await this.request({
			url: this.ghUrl(`/pulls/${prNumber}/reviews`),
			headers: this.defaultHeaders(),
		});
		return Array.isArray(data) ? data : [];
	}

	async getPRState(prNumber: number): Promise<{ state: string; merged: boolean }> {
		const data = await this.request({
			url: this.ghUrl(`/pulls/${prNumber}`),
			headers: this.defaultHeaders(),
		});
		return { state: data?.state || 'open', merged: !!data?.merged };
	}

	async uploadBatchFromZip(zipBlob: Blob, commitMessage: string, branch: string): Promise<void> {
		const JSZip = (await import('jszip')).default;
		const zip = await JSZip.loadAsync(zipBlob);
		const entries = Object.entries(zip.files).filter(([_, f]) => !f.dir);
		const files: { path: string; content: string }[] = [];

		for (const [path, file] of entries) {
			files.push({ path, content: await file.async('base64') });
		}

		await this.publishFiles(files, {
			commitMessage,
			baseBranch: branch,
			targetBranch: branch,
			createPR: false,
		});
	}

	async listDirectory(path: string, branch?: string): Promise<{ name: string; path: string; type: 'file' | 'dir'; size: number; lastModified: string }[]> {
		const ref = branch || await this.getDefaultBranch();
		const data = await this.request({
			url: this.ghUrl(`/contents/${path}?ref=${ref}`),
			headers: this.defaultHeaders(),
		});

		if (!Array.isArray(data)) {
			return [];
		}

		return data.map((item: any) => ({
			name: item.name,
			path: item.path,
			type: item.type === 'dir' ? 'dir' : 'file',
			size: item.size || 0,
			lastModified: item.last_modified || item.commit?.committer?.date || '',
		}));
	}

	async getFileSha(path: string, branch?: string): Promise<string | null> {
		try {
			const ref = branch || await this.getDefaultBranch();
			const data = await this.request({
				url: this.ghUrl(`/contents/${path}?ref=${ref}`),
				headers: this.defaultHeaders(),
			});
			return data.sha || null;
		} catch {
			return null;
		}
	}

	async deleteFile(path: string, sha: string, commitMessage: string, branch?: string): Promise<void> {
		const ref = branch || await this.getDefaultBranch();
		await this.request({
			url: this.ghUrl(`/contents/${path}`),
			method: 'DELETE',
			headers: this.defaultHeaders(),
			body: JSON.stringify({
				message: commitMessage,
				sha,
				branch: ref,
			}),
		});
	}
}
