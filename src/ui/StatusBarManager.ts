import { App } from 'obsidian';
import type { TaskTracker } from '../utils/TaskTracker';
import type { PRCheckPoller } from '../utils/PRCheckPoller';
import type VuePressPublisherPlugin from '../main';

const TAG = 'StatusBarManager';

export class StatusBarManager {
	private plugin: VuePressPublisherPlugin;
	private statusBarItem: HTMLElement;
	private statusBarIcon: HTMLSpanElement;
	private statusBarCount: HTMLSpanElement;
	private statusBarText: HTMLSpanElement;
	private statusBarPopup: HTMLElement | null = null;

	constructor(plugin: VuePressPublisherPlugin) {
		this.plugin = plugin;
		this.statusBarItem = plugin.addStatusBarItem();
		this.statusBarItem.addClass('sillot-task-statusbar');
		this.statusBarItem.style.display = 'none';
		this.statusBarIcon = this.statusBarItem.createSpan({ cls: 'sillot-task-statusbar-icon', text: '⏳' });
		this.statusBarCount = this.statusBarItem.createSpan({ cls: 'sillot-task-statusbar-count' });
		this.statusBarText = this.statusBarItem.createSpan({ cls: 'sillot-task-statusbar-text', text: '' });

		this.statusBarItem.onclick = () => {
			if (this.statusBarPopup) {
				this.closePopup();
			} else {
				this.showTaskPopup();
			}
		};
	}

	bindTracker(taskTracker: TaskTracker, prCheckPoller: PRCheckPoller) {
		taskTracker.onChange(() => this.updateStatusBar());
		prCheckPoller.onChange(() => this.updateStatusBar());
	}

	private closePopup() {
		if (this.statusBarPopup) {
			this.statusBarPopup.remove();
			this.statusBarPopup = null;
		}
	}

	private showTaskPopup() {
		this.closePopup();
		const tasks = this.plugin.taskTracker.getActiveTasks();
		const pendingChecks = this.plugin.prCheckPoller.getPendingForPersistence();
		const allResults = this.plugin.prCheckPoller.getAllResults();
		const hasContent = tasks.length > 0 || pendingChecks.length > 0;
		if (!hasContent) return;

		this.statusBarPopup = document.body.createDiv({ cls: 'sillot-task-statusbar-popup' });
		const rect = this.statusBarItem.getBoundingClientRect();
		this.statusBarPopup.style.position = 'fixed';
		this.statusBarPopup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
		this.statusBarPopup.style.right = `${window.innerWidth - rect.right}px`;

		const header = this.statusBarPopup.createDiv({ cls: 'sillot-task-statusbar-popup-header' });
		const headerParts: string[] = [];
		if (tasks.length > 0) headerParts.push(`${tasks.length} 任务`);
		if (pendingChecks.length > 0) headerParts.push(`${pendingChecks.length} PR检查`);
		header.createSpan({ text: headerParts.join(' · ') });
		const closeBtn = header.createEl('button', { text: '✕', cls: 'sillot-task-statusbar-popup-close' });
		closeBtn.onclick = (e) => { e.stopPropagation(); this.closePopup(); };

		for (const t of tasks) {
			const row = this.statusBarPopup.createDiv({ cls: 'sillot-task-statusbar-popup-row' });
			const bar = row.createDiv({ cls: 'sillot-task-statusbar-popup-bar' });
			const fill = bar.createDiv({ cls: 'sillot-task-statusbar-popup-fill' });
			if (t.progress < 0) {
				bar.addClass('sillot-task-statusbar-popup-bar--indeterminate');
			} else {
				fill.style.width = `${Math.max(0, Math.min(100, t.progress))}%`;
			}
			row.createDiv({ cls: 'sillot-task-statusbar-popup-label', text: t.label }).title = t.label;
		}

		for (const info of pendingChecks) {
			const result = allResults.get(String(info.prNumber));
			const status = result?.status || 'pending';
			const icon = status === 'pending' ? '⏳' : status === 'success' ? '✅' : status === 'warning' ? '⚠️' : status === 'failure' ? '❌' : '🔌';
			const row = this.statusBarPopup.createDiv({ cls: 'sillot-task-statusbar-popup-row sillot-task-statusbar-popup-prcheck' });
			row.createSpan({ text: icon, cls: 'sillot-task-statusbar-popup-prcheck-icon' });
			const label = row.createDiv({ cls: 'sillot-task-statusbar-popup-label', text: `PR #${info.prNumber} ${status === 'pending' ? '构建检查中...' : '检查完成'}` });
			label.title = `分支: ${info.branch}`;

			if (status !== 'pending') {
				row.addClass('sillot-task-statusbar-popup-prcheck--done');
				row.onclick = () => {
					this.closePopup();
					const { PRCheckModal } = require('../ui/PRCheckModal');
					const modal = new PRCheckModal(this.plugin.app, this.plugin, info.prNumber, info.branch);
					modal.open();
				};
			}
		}

		const onClickOutside = (e: MouseEvent) => {
			if (this.statusBarPopup && !this.statusBarPopup.contains(e.target as Node) && e.target !== this.statusBarItem) {
				this.closePopup();
				document.removeEventListener('click', onClickOutside);
			}
		};
		setTimeout(() => document.addEventListener('click', onClickOutside), 0);
	}

	private updateStatusBar() {
		const tasks = this.plugin.taskTracker.getActiveTasks();
		const pendingChecks = this.plugin.prCheckPoller.getPendingForPersistence();
		const hasActive = tasks.length > 0 || pendingChecks.length > 0;
		if (!hasActive) {
			this.statusBarItem.style.display = 'none';
			this.closePopup();
		} else {
			this.statusBarItem.style.display = '';
			const parts: string[] = [];
			if (tasks.length > 0) {
				const latest = tasks[tasks.length - 1];
				parts.push(latest.label);
			}
			if (pendingChecks.length > 0) {
				parts.push(`${pendingChecks.length}个PR检查中`);
			}
			this.statusBarText.textContent = parts.join(' · ');
			if (tasks.length > 1 || pendingChecks.length > 0) {
				this.statusBarCount.textContent = `${tasks.length + pendingChecks.length}`;
				this.statusBarCount.style.display = 'inline';
			} else {
				this.statusBarCount.style.display = 'none';
			}
			this.statusBarItem.title = [
				...tasks.map(t => t.label),
				...pendingChecks.map(p => `PR #${p.prNumber} 构建检查中`),
			].join('\n');
			if (this.statusBarPopup) this.showTaskPopup();
		}
	}

	destroy() {
		this.closePopup();
		this.statusBarItem.remove();
	}
}
