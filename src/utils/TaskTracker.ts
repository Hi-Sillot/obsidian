export interface TaskInfo {
	id: string;
	label: string;
	progress: number;
}

export class TaskTracker {
	private tasks: Map<string, TaskInfo> = new Map();
	private onChangeCallbacks: Set<() => void> = new Set();

	startTask(id: string, label: string, progress: number = -1) {
		this.tasks.set(id, { id, label, progress });
		this.notify();
	}

	updateTask(id: string, progress: number, label?: string) {
		const task = this.tasks.get(id);
		if (task) {
			task.progress = progress;
			if (label !== undefined) task.label = label;
			this.notify();
		}
	}

	endTask(id: string) {
		this.tasks.delete(id);
		this.notify();
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

	onChange(callback: () => void) {
		this.onChangeCallbacks.add(callback);
		return () => this.onChangeCallbacks.delete(callback);
	}

	private notify() {
		for (const cb of this.onChangeCallbacks) {
			cb();
		}
	}
}
