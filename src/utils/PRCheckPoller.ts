import { GitHubApi } from '../sync/githubApi';
import type { Logger } from './Logger';

export type PRCheckStatus = 'pending' | 'success' | 'failure' | 'warning' | 'timeout' | 'error';
export type PRState = 'open' | 'closed' | 'merged';

export interface PRCheckResult {
	prNumber: number;
	branch: string;
	headSha: string;
	status: PRCheckStatus;
	prState?: PRState;
	checkRuns: PRCheckRunInfo[];
	polledAt: number;
}

export interface PRCheckRunInfo {
	name: string;
	status: 'queued' | 'in_progress' | 'completed';
	conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
	title?: string;
	detailsUrl?: string;
}

export interface PendingPRCheck {
	prNumber: number;
	branch: string;
	headSha: string;
	filePath: string;
	startedAt: number;
}

type PRCheckChangeCallback = (result: PRCheckResult | null) => void;

function getPollInterval(pollCount: number): number {
	if (pollCount === 0) return 58000;
	if (pollCount <= 2) return 10000;
	if (pollCount <= 5) return 15000;
	if (pollCount <= 9) return 20000;
	return 30000;
}

const MAX_POLL_DURATION = 10 * 60 * 1000;

export class PRCheckPoller {
	private pending: Map<string, PendingPRCheck> = new Map();
	private results: Map<string, PRCheckResult> = new Map();
	private timers: Map<string, number> = new Map();
	private pollCounts: Map<string, number> = new Map();
	private onChangeCallbacks: Set<PRCheckChangeCallback> = new Set();
	private logger: Logger | null;

	constructor(logger?: Logger) {
		this.logger = logger || null;
	}

	startPolling(key: string, info: PendingPRCheck, getApi: () => GitHubApi | null) {
		this.stopPolling(key);
		this.pending.set(key, info);
		this.pollCounts.set(key, 0);

		this.scheduleNext(key, getApi, getPollInterval(0));
	}

	stopPolling(key: string) {
		const timer = this.timers.get(key);
		if (timer) {
			window.clearTimeout(timer);
			this.timers.delete(key);
		}
		const had = this.pending.has(key);
		this.pending.delete(key);
		this.pollCounts.delete(key);
		if (had) {
			for (const cb of this.onChangeCallbacks) {
				cb(null);
			}
		}
	}

	stopAll() {
		for (const key of this.timers.keys()) {
			this.stopPolling(key);
		}
	}

	getResult(key: string): PRCheckResult | undefined {
		return this.results.get(key);
	}

	getAllResults(): Map<string, PRCheckResult> {
		return new Map(this.results);
	}

	getPending(key: string): PendingPRCheck | undefined {
		return this.pending.get(key);
	}

	onChange(callback: PRCheckChangeCallback) {
		this.onChangeCallbacks.add(callback);
		return () => this.onChangeCallbacks.delete(callback);
	}

	updatePRState(key: string, prState: PRState) {
		const result = this.results.get(key);
		if (result) {
			result.prState = prState;
			for (const cb of this.onChangeCallbacks) {
				cb(result);
			}
		}
	}

	restoreFromData(data: PendingPRCheck[], getApi: () => GitHubApi | null) {
		for (const info of data) {
			const key = String(info.prNumber);
			if (!this.results.has(key) && !this.pending.has(key)) {
				const elapsed = Date.now() - info.startedAt;
				if (elapsed < MAX_POLL_DURATION) {
					this.startPolling(key, info, getApi);
				}
			}
		}
	}

	restoreResults(data: PRCheckResult[]) {
		for (const result of data) {
			const key = String(result.prNumber);
			if (!this.results.has(key) && !this.pending.has(key)) {
				this.results.set(key, result);
			}
		}
	}

	getPendingForPersistence(): PendingPRCheck[] {
		return Array.from(this.pending.values());
	}

	getResultsForPersistence(): PRCheckResult[] {
		return Array.from(this.results.values());
	}

	removeResult(key: string) {
		this.results.delete(key);
	}

	private scheduleNext(key: string, getApi: () => GitHubApi | null, delay: number) {
		const timer = window.setTimeout(async () => {
			this.timers.delete(key);
			await this.pollOnce(key, getApi);
		}, delay);
		this.timers.set(key, timer);
	}

	private async pollOnce(key: string, getApi: () => GitHubApi | null) {
		const info = this.pending.get(key);
		if (!info) return;

		const api = getApi();
		if (!api) {
			this.setResult(key, {
				prNumber: info.prNumber,
				branch: info.branch,
				headSha: info.headSha,
				status: 'error',
				checkRuns: [],
				polledAt: Date.now(),
			});
			return;
		}

		const count = (this.pollCounts.get(key) || 0) + 1;
		this.pollCounts.set(key, count);

		try {
			const rawRuns = await api.getCheckRuns(info.headSha);
			const checkRuns: PRCheckRunInfo[] = rawRuns.map((run: any) => ({
				name: run.name,
				status: run.status,
				conclusion: run.conclusion,
				title: run.output?.title,
				detailsUrl: run.details_url || run.html_url,
			}));

			let prState: PRState | undefined;
			try {
				const prInfo = await api.getPRState(info.prNumber);
				prState = prInfo.merged ? 'merged' : prInfo.state === 'closed' ? 'closed' : 'open';
			} catch {}

			const allCompleted = checkRuns.length > 0 && checkRuns.every(r => r.status === 'completed');

			if (allCompleted) {
				const hasFailure = checkRuns.some(r => r.conclusion === 'failure');
				const hasWarning = checkRuns.some(r => r.conclusion === 'neutral' || r.conclusion === 'action_required');
				const status: PRCheckStatus = hasFailure ? 'failure' : hasWarning ? 'warning' : 'success';

				this.pending.delete(key);
				this.pollCounts.delete(key);
				this.setResult(key, {
					prNumber: info.prNumber,
					branch: info.branch,
					headSha: info.headSha,
					status,
					prState,
					checkRuns,
					polledAt: Date.now(),
				});
				return;
			}

			const elapsed = Date.now() - info.startedAt;
			if (elapsed > MAX_POLL_DURATION) {
				this.pending.delete(key);
				this.pollCounts.delete(key);
				this.setResult(key, {
					prNumber: info.prNumber,
					branch: info.branch,
					headSha: info.headSha,
					status: 'timeout',
					prState,
					checkRuns,
					polledAt: Date.now(),
				});
				return;
			}

			this.setResult(key, {
				prNumber: info.prNumber,
				branch: info.branch,
				headSha: info.headSha,
				status: 'pending',
				prState,
				checkRuns,
				polledAt: Date.now(),
			});

			this.scheduleNext(key, getApi, getPollInterval(count));
		} catch (e: any) {
			this.logger?.error('PRCheckPoller', `轮询 PR #${info.prNumber} 失败`, e.message);
			this.setResult(key, {
				prNumber: info.prNumber,
				branch: info.branch,
				headSha: info.headSha,
				status: 'error',
				checkRuns: [],
				polledAt: Date.now(),
			});
		}
	}

	private setResult(key: string, result: PRCheckResult) {
		this.results.set(key, result);
		for (const cb of this.onChangeCallbacks) {
			cb(result);
		}
	}
}
