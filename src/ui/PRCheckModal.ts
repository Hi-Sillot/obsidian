import { App, Modal, Setting, Notice, MarkdownRenderer, Component } from 'obsidian';
import type { PRCheckResult, PRCheckStatus, PRCheckRunInfo } from '../utils/PRCheckPoller';
import type VuePressPublisherPlugin from '../main';

const STATUS_DISPLAY: Record<PRCheckStatus, { icon: string; text: string; color: string }> = {
	pending: { icon: '⏳', text: '构建检查中...', color: 'var(--text-warning)' },
	success: { icon: '✅', text: '构建通过', color: 'var(--text-success)' },
	warning: { icon: '⚠️', text: '构建通过（有警告）', color: 'var(--text-warning)' },
	failure: { icon: '❌', text: '构建失败', color: 'var(--text-error)' },
	timeout: { icon: '⌛', text: '轮询超时', color: 'var(--text-faint)' },
	error: { icon: '🔌', text: '查询失败', color: 'var(--text-faint)' },
};

interface PRComment {
	user: string;
	createdAt: string;
	body: string;
	type: 'comment' | 'review';
}

export class PRCheckModal extends Modal {
	private plugin: VuePressPublisherPlugin;
	private prNumber: number;
	private branch: string;
	private currentResult: PRCheckResult | null = null;
	private unsubscribe: (() => void) | null = null;
	private onCloseCallback: (() => void) | null = null;
	private comments: PRComment[] = [];
	private commentsLoaded = false;
	private renderGen = 0;
	private renderComponent: Component | null = null;
	private commentsContainer: HTMLElement | null = null;

	constructor(app: App, plugin: VuePressPublisherPlugin, prNumber: number, branch: string) {
		super(app);
		this.plugin = plugin;
		this.prNumber = prNumber;
		this.branch = branch;
	}

	setOnClose(cb: () => void) {
		this.onCloseCallback = cb;
	}

	onOpen() {
		this.titleEl.setText(`PR #${this.prNumber} 构建检查`);

		this.unsubscribe = this.plugin.prCheckPoller.onChange((result) => {
			if (!result) return;
			if (result.prNumber === this.prNumber) {
				this.currentResult = result;
				this.renderContent();
			}
		});

		const existing = this.plugin.prCheckPoller.getResult(String(this.prNumber));
		if (existing) {
			this.currentResult = existing;
		}

		this.renderContent();
	}

	onClose() {
		this.renderGen++;
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		if (this.renderComponent) {
			this.renderComponent.unload();
			this.renderComponent = null;
		}
		this.contentEl.empty();
		if (this.onCloseCallback) {
			this.onCloseCallback();
		}
	}

	private renderContent() {
		this.renderGen++;
		if (this.renderComponent) {
			this.renderComponent.unload();
			this.renderComponent = null;
		}
		this.contentEl.empty();
		this.renderComponent = new Component();
		this.renderComponent.load();
		this.commentsContainer = null;

		if (!this.currentResult) {
			this.renderPending();
			return;
		}

		const display = STATUS_DISPLAY[this.currentResult.status];

		const statusEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-status' });
		statusEl.createEl('span', { text: display.icon, cls: 'sillot-prcheck-icon' });
		statusEl.createEl('span', { text: display.text, cls: 'sillot-prcheck-text' });
		statusEl.style.color = display.color;

		if (this.currentResult.status === 'pending') {
			statusEl.addClass('sillot-prcheck-pending');
		}

		const infoEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-info' });
		infoEl.createEl('span', { text: `分支: ${this.currentResult.branch}` });
		infoEl.createEl('span', { text: ` | ` });
		infoEl.createEl('span', { text: `检查于: ${new Date(this.currentResult.polledAt).toLocaleTimeString()}` });

		if (this.currentResult.prState) {
			const prStateConfig: Record<string, { icon: string; text: string; cls: string }> = {
				open: { icon: '🟢', text: '开启', cls: 'sillot-prcheck-prstate--open' },
				closed: { icon: '🔴', text: '已关闭', cls: 'sillot-prcheck-prstate--closed' },
				merged: { icon: '🟣', text: '已合并', cls: 'sillot-prcheck-prstate--merged' },
			};
			const pc = prStateConfig[this.currentResult.prState];
			if (pc) {
				const stateEl = this.contentEl.createDiv({ cls: `sillot-prcheck-prstate ${pc.cls}` });
				stateEl.createEl('span', { text: `${pc.icon} ${pc.text}` });
			}
		}

		if (this.currentResult.checkRuns.length > 0) {
			this.renderCheckRuns();
		}

		if (this.currentResult.status !== 'pending') {
			this.commentsContainer = this.contentEl.createDiv({ cls: 'sillot-prcheck-comments' });
			if (this.commentsLoaded) {
				this.renderCommentsContent(this.commentsContainer);
			} else {
				this.loadAndRenderComments();
			}
		}

		this.renderActions();
	}

	private renderPending() {
		const statusEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-status sillot-prcheck-pending' });
		statusEl.createEl('span', { text: '⏳', cls: 'sillot-prcheck-icon' });
		statusEl.createEl('span', { text: '正在等待构建检查结果...', cls: 'sillot-prcheck-text' });

		const infoEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-info' });
		infoEl.createEl('span', { text: `分支: ${this.branch}` });

		const hintEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-hint' });
		hintEl.setText('构建检查通常需要 1-3 分钟，结果将自动更新到此窗口。');

		new Setting(this.contentEl)
			.addButton(btn => btn
				.setButtonText('在浏览器中查看 PR')
				.onClick(() => {
					const repo = this.plugin.settings.githubRepo;
					window.open(`https://github.com/${repo}/pull/${this.prNumber}`, '_blank');
				}))
			.addButton(btn => btn
				.setButtonText('关闭')
				.onClick(() => this.close()));
	}

	private renderCheckRuns() {
		if (!this.currentResult) return;

		const runsEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-runs' });
		runsEl.createEl('h4', { text: '检查项' });

		for (const run of this.currentResult.checkRuns) {
			const runEl = runsEl.createDiv({ cls: 'sillot-prcheck-run' });
			const icon = this.getRunIcon(run);
			runEl.createEl('span', { text: icon, cls: 'sillot-prcheck-run-icon' });
			runEl.createEl('span', { text: run.name, cls: 'sillot-prcheck-run-name' });

			if (run.conclusion && run.conclusion !== 'success') {
				const tag = run.conclusion === 'failure' ? '失败' : run.conclusion === 'cancelled' ? '已取消' : run.conclusion === 'timed_out' ? '超时' : run.conclusion;
				runEl.createEl('span', { text: tag, cls: 'sillot-prcheck-run-tag' });
			}

			if (run.detailsUrl) {
				const link = runEl.createEl('a', { text: '详情', cls: 'sillot-prcheck-run-link' });
				link.href = run.detailsUrl;
				link.target = '_blank';
			}
		}
	}

	private async loadAndRenderComments() {
		const gen = this.renderGen;
		const container = this.commentsContainer;
		if (!container) return;

		container.empty();
		const headerRow = container.createDiv({ cls: 'sillot-prcheck-comments-header' });
		headerRow.createEl('h4', { text: 'PR 评论' });
		container.createDiv({ text: '正在加载评论...', cls: 'sillot-prcheck-comments-loading' });

		try {
			await this.loadComments();
		} catch (e: any) {
			if (this.renderGen !== gen) return;
			container.empty();
			const headerRow = container.createDiv({ cls: 'sillot-prcheck-comments-header' });
			headerRow.createEl('h4', { text: 'PR 评论' });
			this.renderRefreshBtn(headerRow);
			container.createDiv({ text: `评论加载失败: ${e.message || '未知错误'}`, cls: 'sillot-prcheck-comments-error' });
			return;
		}

		if (this.renderGen !== gen) return;
		this.renderCommentsContent(container);
	}

	private renderCommentsContent(container: HTMLElement) {
		container.empty();
		const headerRow = container.createDiv({ cls: 'sillot-prcheck-comments-header' });
		headerRow.createEl('h4', { text: `PR 评论 (${this.comments.length})` });
		this.renderRefreshBtn(headerRow);

		if (this.comments.length === 0) {
			container.createDiv({ text: '暂无评论', cls: 'sillot-prcheck-comments-empty' });
			return;
		}

		for (const comment of this.comments) {
			const item = container.createDiv({ cls: 'sillot-prcheck-comment' });
			const header = item.createDiv({ cls: 'sillot-prcheck-comment-header' });
			header.createEl('span', { text: comment.user, cls: 'sillot-prcheck-comment-user' });
			const typeTag = comment.type === 'review' ? '🔍 Review' : '💬';
			header.createEl('span', { text: typeTag, cls: 'sillot-prcheck-comment-type' });
			header.createEl('span', { text: new Date(comment.createdAt).toLocaleString(), cls: 'sillot-prcheck-comment-time' });

			const bodyEl = item.createDiv({ cls: 'sillot-prcheck-comment-body' });
			if (this.renderComponent) {
				MarkdownRenderer.render(this.app, comment.body, bodyEl, '', this.renderComponent);
			} else {
				bodyEl.setText(comment.body);
			}
		}
	}

	private renderRefreshBtn(parent: HTMLElement) {
		const btn = parent.createEl('button', { text: '🔄', cls: 'sillot-prcheck-comments-refresh' });
		btn.title = '刷新评论';
		btn.onclick = () => {
			this.commentsLoaded = false;
			this.comments = [];
			if (this.commentsContainer) {
				this.loadAndRenderComments();
			}
		};
	}

	private async loadComments() {
		const api = this.plugin.createGitHubApi();
		if (!api) {
			this.comments = [];
			this.commentsLoaded = true;
			return;
		}

		const [rawComments, rawReviews] = await Promise.all([
			api.getPRComments(this.prNumber),
			api.getPRReviews(this.prNumber),
		]);

		const comments: PRComment[] = [];

		for (const c of rawComments) {
			if (c.body && c.user) {
				comments.push({
					user: c.user.login || c.user.name || 'unknown',
					createdAt: c.created_at,
					body: c.body,
					type: 'comment',
				});
			}
		}

		for (const r of rawReviews) {
			if (r.body && r.user) {
				comments.push({
					user: r.user.login || r.user.name || 'unknown',
					createdAt: r.submitted_at || r.created_at,
					body: r.body,
					type: 'review',
				});
			}
		}

		comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

		this.comments = comments;
		this.commentsLoaded = true;
	}

	private renderActions() {
		if (!this.currentResult) return;

		const actionsEl = this.contentEl.createDiv({ cls: 'sillot-prcheck-actions' });
		const row = actionsEl.createDiv({ cls: 'sillot-prcheck-actions-row' });

		const status = this.currentResult.status;

		const addBtn = (text: string, onClick: () => void, isCta = false) => {
			const btn = row.createEl('button', {
				text,
				cls: 'sillot-prcheck-action-btn' + (isCta ? ' is-cta' : ''),
			});
			btn.onclick = onClick;
		};

		addBtn('🔗 在浏览器中查看', () => {
			const repo = this.plugin.settings.githubRepo;
			window.open(`https://github.com/${repo}/pull/${this.prNumber}`, '_blank');
		});

		if ((status === 'success' || status === 'warning') && this.currentResult?.prState === 'open') {
			addBtn('🔀 合并此 PR', () => this.mergePR(), true);
		}

		if (status === 'failure' || status === 'timeout' || status === 'error') {
			addBtn('🔄 重新检查', () => this.recheck(), true);
		}

		if (this.currentResult?.prState === 'open') {
			addBtn('❌ 关闭 PR（不合并）', () => this.closePR());
		}
	}

	private getRunIcon(run: PRCheckRunInfo): string {
		if (run.status !== 'completed') return '⏳';
		switch (run.conclusion) {
			case 'success': return '✅';
			case 'failure': return '❌';
			case 'cancelled': return '🚫';
			case 'timed_out': return '⌛';
			case 'action_required': return '⚠️';
			default: return '⚪';
		}
	}

	private async mergePR() {
		const api = this.plugin.createGitHubApi();
		if (!api) {
			new Notice('GitHub API 未配置');
			return;
		}

		const notice = new Notice(`正在合并 PR #${this.prNumber}...`, 0);
		try {
			await api.mergePullRequest(this.prNumber, {
				commitTitle: `Merge PR #${this.prNumber}`,
				mergeMethod: 'merge',
			});
			notice.hide();
			new Notice(`PR #${this.prNumber} 已合并 ✅`);
			this.plugin.prCheckPoller.stopPolling(String(this.prNumber));
			this.plugin.prCheckPoller.updatePRState(String(this.prNumber), 'merged');
			await this.plugin.savePRCheckPending();
			this.close();
		} catch (e: any) {
			notice.hide();
			new Notice(`合并 PR 失败：${e.message}`);
		}
	}

	private async closePR() {
		const api = this.plugin.createGitHubApi();
		if (!api) {
			new Notice('GitHub API 未配置');
			return;
		}

		const branch = this.currentResult?.branch || this.branch;
		const notice = new Notice(`正在关闭 PR #${this.prNumber}...`, 0);
		try {
			await api.closePullRequest(this.prNumber);
			this.plugin.prCheckPoller.stopPolling(String(this.prNumber));
			this.plugin.prCheckPoller.updatePRState(String(this.prNumber), 'closed');
			await this.plugin.savePRCheckPending();

			try {
				await api.deleteBranch(branch);
				notice.hide();
				new Notice(`PR #${this.prNumber} 已关闭，分支 ${branch} 已删除`);
			} catch (e: any) {
				notice.hide();
				new Notice(`PR #${this.prNumber} 已关闭，但分支 ${branch} 删除失败：${e.message || '未知错误'}`);
			}
			this.close();
		} catch (e: any) {
			notice.hide();
			new Notice(`关闭 PR 失败：${e.message}`);
		}
	}

	private recheck() {
		if (!this.currentResult) return;

		this.plugin.prCheckPoller.startPolling(
			String(this.prNumber),
			{
				prNumber: this.prNumber,
				branch: this.currentResult.branch,
				headSha: this.currentResult.headSha,
				filePath: '',
				startedAt: Date.now(),
			},
			() => this.plugin.createGitHubApi(),
		);

		this.currentResult = null;
		this.commentsLoaded = false;
		this.comments = [];
		this.renderContent();
		new Notice('已开始重新检查 PR #' + this.prNumber);
	}
}
