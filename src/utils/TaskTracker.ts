export interface TaskInfo {
	id: string;
	label: string;
	progress: number;
}

export type TaskResult = 'success' | 'failed' | 'cancelled';

export interface TaskHistoryEntry {
	id: string;
	label: string;
	startTime: number;
	endTime: number;
	result: TaskResult;
	progress: number;
	resultMessage?: string;
}

const MAX_HISTORY = 200;

export class TaskTracker {
	private tasks: Map<string, TaskInfo> = new Map();
	private taskStartTimes: Map<string, number> = new Map();
	private taskLabels: Map<string, string> = new Map();
	private history: TaskHistoryEntry[] = [];
	private onChangeCallbacks: Set<() => void> = new Set();
	private onHistoryChangeCallbacks: Set<() => void> = new Set();

	startTask(id: string, label: string, progress: number = -1) {
		this.tasks.set(id, { id, label, progress });
		this.taskStartTimes.set(id, Date.now());
		this.taskLabels.set(id, label);
		this.notify();
	}

	updateTask(id: string, progress: number, label?: string) {
		const task = this.tasks.get(id);
		if (task) {
			task.progress = progress;
			if (label !== undefined) {
				task.label = label;
				this.taskLabels.set(id, label);
			}
			this.notify();
		}
	}

	endTask(id: string, result: TaskResult = 'success', resultMessage?: string) {
		const startTime = this.taskStartTimes.get(id) || Date.now();
		const label = this.taskLabels.get(id) || id;
		const task = this.tasks.get(id);
		const progress = task?.progress ?? -1;

		const entry: TaskHistoryEntry = {
			id,
			label,
			startTime,
			endTime: Date.now(),
			result,
			progress,
			resultMessage,
		};

		this.history.push(entry);
		if (this.history.length > MAX_HISTORY) {
			this.history = this.history.slice(-MAX_HISTORY);
		}

		this.tasks.delete(id);
		this.taskStartTimes.delete(id);
		this.taskLabels.delete(id);
		this.notify();
		this.notifyHistory();
	}

	getActiveTasks(): TaskInfo[] {
		return Array.from(this.tasks.values());
	}

	hasActiveTasks(): boolean {
		return this.tasks.size > 0;
	}

	getLatestTask(): TaskInfo | null {
		const tasks = this.getActiveTasks();
		return tasks.length > 0 ? tasks[tasks.length - 1] : null;
	}

	getHistory(): TaskHistoryEntry[] {
		return [...this.history];
	}

	clearHistory() {
		this.history = [];
		this.notifyHistory();
	}

	onChange(callback: () => void) {
		this.onChangeCallbacks.add(callback);
		return () => this.onChangeCallbacks.delete(callback);
	}

	onHistoryChange(callback: () => void) {
		this.onHistoryChangeCallbacks.add(callback);
		return () => this.onHistoryChangeCallbacks.delete(callback);
	}

	private notify() {
		for (const cb of this.onChangeCallbacks) {
			cb();
		}
	}

	private notifyHistory() {
		for (const cb of this.onHistoryChangeCallbacks) {
			cb();
		}
	}
}
