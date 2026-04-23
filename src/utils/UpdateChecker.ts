export interface ReleaseInfo {
	version: string;
	tagName: string;
	htmlUrl: string;
	downloadUrl: string;
	publishedAt: string;
	body: string;
	isPrerelease: boolean;
}

export type UpdateErrorType = 'empty-repo' | 'not-found' | 'network' | 'rate-limit' | 'auth-failed' | 'unknown';

export interface UpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion: string;
	releaseInfo: ReleaseInfo | null;
	error?: string;
	errorType?: UpdateErrorType;
	errorDetail?: string;
}

export class UpdateChecker {
	private githubToken: string;
	private updateRepo: string;
	private manifestVersion: string;
	private updateChannel: 'github' | 'github-dev' | 'local' = 'github';

	constructor(options: { githubToken?: string; updateRepo: string; updateChannel?: 'github' | 'github-dev' | 'local'; manifestVersion: string }) {
		this.githubToken = options.githubToken || '';
		this.updateRepo = options.updateRepo;
		this.updateChannel = options.updateChannel || 'github';
		this.manifestVersion = options.manifestVersion;
	}

	updateConfig(options: { githubToken?: string; updateRepo?: string; updateChannel?: 'github' | 'github-dev' | 'local' }) {
		if (options.githubToken !== undefined) this.githubToken = options.githubToken;
		if (options.updateRepo !== undefined) this.updateRepo = options.updateRepo;
		if (options.updateChannel !== undefined) this.updateChannel = options.updateChannel;
	}

	async checkForUpdates(): Promise<UpdateCheckResult> {
		if (this.updateChannel === 'local') {
			return {
				hasUpdate: false,
				currentVersion: this.manifestVersion,
				latestVersion: this.manifestVersion,
				releaseInfo: null,
				error: '使用本地模式，请手动选择更新文件',
				errorType: 'unknown'
			};
		}

		const DEFAULT_REPO = 'Hi-Sillot/obsidian';
		const effectiveRepo = this.updateRepo?.trim() || DEFAULT_REPO;

		try {
			const releases = await this.fetchReleases(effectiveRepo);
			if (!releases || releases.length === 0) {
				return {
					hasUpdate: false,
					currentVersion: this.manifestVersion,
					latestVersion: this.manifestVersion,
					releaseInfo: null,
					error: '该仓库暂无发布版本',
					errorType: 'not-found',
					errorDetail: `仓库 ${effectiveRepo} 没有找到任何 Release，请确认仓库地址是否正确`
				};
			}

			const isDev = this.updateChannel === 'github-dev';
			const release = releases.find(r => r.prerelease === isDev) || releases[0];
			const latestVersion = this.extractVersion(release.tag_name);
			const currentVersion = this.extractVersion(this.manifestVersion);

			const hasUpdate = this.compareVersions(currentVersion, latestVersion) < 0;

			return {
				hasUpdate,
				currentVersion,
				latestVersion,
				releaseInfo: {
					version: latestVersion,
					tagName: release.tag_name,
					htmlUrl: release.html_url,
					downloadUrl: release.html_url,
					publishedAt: release.published_at,
					body: release.body || '',
					isPrerelease: release.prerelease
				}
			};
		} catch (error: any) {
			const errorMsg = error.message || 'Failed to check for updates';
			let errorType: UpdateErrorType = 'unknown';
			let errorDetail = '';

			if (errorMsg.includes('404') || errorMsg.includes('Not Found')) {
				errorType = 'not-found';
				errorDetail = `仓库 ${effectiveRepo} 不存在或无访问权限`;
			} else if (errorMsg.includes('403') || errorMsg.includes('rate limit')) {
				errorType = 'rate-limit';
				errorDetail = 'API 调用频率超限，请稍后再试或配置 GitHub Token';
			} else if (errorMsg.includes('401') || errorMsg.includes('401')) {
				errorType = 'auth-failed';
				errorDetail = 'Token 认证失败，请检查 GitHub Token 是否正确';
			} else if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
				errorType = 'network';
				errorDetail = '网络连接失败，请检查网络设置或代理配置';
			}

			return {
				hasUpdate: false,
				currentVersion: this.manifestVersion,
				latestVersion: this.manifestVersion,
				releaseInfo: null,
				error: errorMsg,
				errorType,
				errorDetail
			};
		}
	}

	private async fetchReleases(repo: string): Promise<any[]> {
		const url = `https://api.github.com/repos/${repo}/releases?per_page=10`;

		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		};

		if (this.githubToken) {
			headers['Authorization'] = `Bearer ${this.githubToken}`;
		}

		const response = await fetch(url, { headers });

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.status}`);
		}

		return await response.json();
	}

	private extractVersion(tagName: string): string {
		return tagName.startsWith('v') || tagName.startsWith('V')
			? tagName.substring(1)
			: tagName;
	}

	private compareVersions(v1: string, v2: string): number {
		const parts1 = v1.split('.').map(p => parseInt(p, 10) || 0);
		const parts2 = v2.split('.').map(p => parseInt(p, 10) || 0);

		const maxLen = Math.max(parts1.length, parts2.length);
		for (let i = 0; i < maxLen; i++) {
			const p1 = parts1[i] || 0;
			const p2 = parts2[i] || 0;
			if (p1 < p2) return -1;
			if (p1 > p2) return 1;
		}
		return 0;
	}

	formatUpdateMessage(result: UpdateCheckResult): string {
		if (result.error) {
			return `检查更新失败: ${result.error}`;
		}
		if (!result.hasUpdate) {
			return `当前版本 ${result.currentVersion} 已是最新`;
		}
		return `发现新版本 ${result.latestVersion}（当前 ${result.currentVersion}）`;
	}
}
