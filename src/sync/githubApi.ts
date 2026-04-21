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

	private async request(params: RequestUrlParam): Promise<any> {
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

	private async createPullRequest(params: { title: string; body: string; head: string; base: string }): Promise<{ html_url: string; number: number }> {
		return this.request({
			url: this.ghUrl('/pulls'),
			method: 'POST',
			headers: this.defaultHeaders(),
			body: JSON.stringify(params),
		});
	}

	async uploadBatchFromZip(zipBlob: Blob, commitMessage: string, branch: string): Promise<void> {
		const JSZip = (await import('jszip')).default;
		const zip = await JSZip.loadAsync(zipBlob);
		const files = Object.entries(zip.files)
			.filter(([_, file]) => !file.dir)
			.map(([path, file]) => ({ path, content: '' }));

		for (let i = 0; i < files.length; i++) {
			const [path, file] = Object.entries(zip.files).filter(([_, f]) => !f.dir)[i];
			files[i].content = await file.async('base64');
		}

		await this.publishFiles(files, {
			commitMessage,
			baseBranch: branch,
			targetBranch: branch,
			createPR: false,
		});
	}
}
