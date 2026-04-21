import { App } from 'obsidian';
import type { PluginSettings } from '../types';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	none: 4,
};

export class Logger {
	private app: App;
	private getSettings: () => PluginSettings;
	private maxFileSize = 2 * 1024 * 1024;
	private writeTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingLines: string[] = [];

	constructor(app: App, getSettings: () => PluginSettings) {
		this.app = app;
		this.getSettings = getSettings;
	}

	debug(tag: string, message: string, detail?: string) {
		this.log('debug', tag, message, detail);
	}

	info(tag: string, message: string, detail?: string) {
		this.log('info', tag, message, detail);
	}

	warn(tag: string, message: string, detail?: string) {
		this.log('warn', tag, message, detail);
	}

	error(tag: string, message: string, detail?: string) {
		this.log('error', tag, message, detail);
	}

	banner(version: string) {
		const lines = [
			'',
			'  ╔══════════════════════════════════════════════════════════════╗',
			'  ║                                                            ║',
			'  ║   ███████╗██╗███████╗██╗  ██╗ ██████╗ ███████╗████████╗    ║',
			'  ║   ██╔════╝██║██╔════╝██║ ██╔╝██╔═══██╗██╔════╝╚══██╔══╝    ║',
			'  ║   ███████╗██║███████╗█████╔╝ ██║   ██║███████╗   ██║       ║',
			'  ║   ╚════██║██║╚════██║██╔═██╗ ██║   ██║╚════██║   ██║       ║',
			'  ║   ███████║██║███████║██║  ██╗╚██████╔╝███████║   ██║       ║',
			'  ║   ╚══════╝╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝       ║',
			'  ║                                                            ║',
			'  ║            Sillot · SiYuan + VuePress Bridge              ║',
			'  ║                    v' + version.padEnd(41) + '║',
			'  ║                                                            ║',
			'  ╚══════════════════════════════════════════════════════════════╝',
			'',
		];
		for (const line of lines) {
			this.pendingLines.push(line);
		}
		this.scheduleWrite();
		console.log(lines.join('\n'));
	}

	private log(level: LogLevel, tag: string, message: string, detail?: string) {
		const settings = this.getSettings();
		const configLevel = settings.logLevel || 'info';

		if (LEVEL_ORDER[level] < LEVEL_ORDER[configLevel]) return;

		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		const ms = now.getMilliseconds().toString().padStart(3, '0');
		const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${ms}`;

		const levelStr = level.toUpperCase().padEnd(5);
		const line = detail
			? `[${timestamp}] [${levelStr}] [${tag}] ${message}\n  ${detail}`
			: `[${timestamp}] [${levelStr}] [${tag}] ${message}`;

		switch (level) {
			case 'debug': console.log(`[${tag}] ${message}`, detail || ''); break;
			case 'info': console.info(`[${tag}] ${message}`, detail || ''); break;
			case 'warn': console.warn(`[${tag}] ${message}`, detail || ''); break;
			case 'error': console.error(`[${tag}] ${message}`, detail || ''); break;
		}

		this.pendingLines.push(line);
		this.scheduleWrite();
	}

	private scheduleWrite() {
		if (this.writeTimer) return;
		this.writeTimer = setTimeout(() => {
			this.writeTimer = null;
			this.flush();
		}, 500);
	}

	async flush() {
		if (this.pendingLines.length === 0) return;

		const lines = this.pendingLines.splice(0);
		const text = lines.join('\n') + '\n';

		try {
			const logPath = this.getLogPath();
			const dir = logPath.substring(0, logPath.lastIndexOf('/'));
			const adapter = this.app.vault.adapter;

			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			let existing = '';
			if (await adapter.exists(logPath)) {
				existing = await adapter.read(logPath);
				if (existing.length > this.maxFileSize) {
					const lines = existing.split('\n');
					const keepCount = Math.floor(lines.length / 2);
					existing = lines.slice(-keepCount).join('\n');
				}
			}

			await adapter.write(logPath, existing + text);
		} catch (e) {
			console.error('[Sillot/Logger] 写入日志文件失败:', e.message);
		}
	}

	private getLogPath(): string {
		const settings = this.getSettings();
		return settings.logFilePath || '.obsidian/plugins/sillot/log/sillot.log';
	}

	async clear() {
		try {
			const logPath = this.getLogPath();
			if (await this.app.vault.adapter.exists(logPath)) {
				await this.app.vault.adapter.remove(logPath);
			}
		} catch (e) {
			console.error('[Sillot/Logger] 清除日志失败:', e.message);
		}
	}
}
