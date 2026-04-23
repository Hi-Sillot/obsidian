import { App, Modal, Notice } from 'obsidian';
import type VuePressPublisherPlugin from '../main';

export interface InstallProgress {
	percent: number;
	message: string;
}

export class UpdateInstallModal extends Modal {
	private plugin: VuePressPublisherPlugin;
	private zipData: ArrayBuffer;
	private onCloseCallback: (() => void) | null = null;
	private contentContainer: HTMLElement | null = null;
	private progressBar: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;
	private statusText: HTMLElement | null = null;
	private closeBtn: HTMLButtonElement | null = null;
	private completed = false;

	constructor(app: App, plugin: VuePressPublisherPlugin, zipData: ArrayBuffer) {
		super(app);
		this.plugin = plugin;
		this.zipData = zipData;
	}

	setOnClose(cb: () => void) {
		this.onCloseCallback = cb;
	}

	onOpen() {
		this.titleEl.setText('安装插件更新');
		this.contentEl.empty();

		const container = this.contentEl.createDiv({ cls: 'update-install-modal' });
		this.contentContainer = container;

		const progressSection = container.createDiv({ cls: 'progress-section' });

		this.progressBar = progressSection.createDiv({ cls: 'progress-bar' });
		const progressFill = this.progressBar.createDiv({ cls: 'progress-bar-fill' });
		progressFill.style.width = '0%';

		this.progressText = progressSection.createDiv({ cls: 'progress-text', text: '准备中...' });
		this.statusText = container.createDiv({ cls: 'status-text', text: '正在解析更新包...' });

		this.closeBtn = container.createEl('button', {
			text: '取消',
			cls: 'mod-warning',
			attr: { disabled: true }
		});

		this.closeBtn.onclick = () => this.close();

		this.startInstall();
	}

	private async startInstall() {
		try {
			this.updateProgress(0, '正在加载更新包...');
			const jszip = await import('jszip');
			const zip = await jszip.loadAsync(this.zipData);

			const entries: { name: string; entry: any }[] = [];
			zip.forEach((path, fileEntry) => {
				if (!fileEntry.dir) entries.push({ name: path, entry: fileEntry });
			});

			const mainJsEntry = entries.find(e => e.name === 'main.js');
			const manifestEntry = entries.find(e => e.name === 'manifest.json');
			const mainCssEntry = entries.find(e => e.name === 'main.css');
			const stylesEntry = entries.find(e => e.name.startsWith('styles/') && e.name.endsWith('.css'));
			const bridgeCacheEntries = entries.filter(e => e.name.startsWith('bridge-cache/'));

			let newVersion = '';
			if (manifestEntry) {
				const manifestContent = await manifestEntry.entry.async('string');
				try {
					const manifestData = JSON.parse(manifestContent);
					newVersion = manifestData.version || '';
				} catch { }
			}

			const currentVersion = this.plugin.manifest.version || '0.0.0';
			const isDowngrade = newVersion && this.compareVersions(newVersion, currentVersion) < 0;

			if (isDowngrade) {
				this.showDowngradeConfirm(newVersion, currentVersion, entries, mainJsEntry, manifestEntry, mainCssEntry, stylesEntry, bridgeCacheEntries);
				return;
			}

			this.doInstall(entries, mainJsEntry, manifestEntry, mainCssEntry, stylesEntry, bridgeCacheEntries);
		} catch (err: any) {
			if (this.statusText) {
				this.statusText.setText(`安装失败: ${err.message}`);
				this.statusText.style.color = 'var(--text-error)';
			}
			if (this.closeBtn) {
				this.closeBtn.removeAttribute('disabled');
				this.closeBtn.setText('关闭');
			}
			new Notice(`安装失败: ${err.message}`, 5000);
		}
	}

	private compareVersions(a: string, b: string): number {
		const pa = a.split('.').map(Number);
		const pb = b.split('.').map(Number);
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const na = pa[i] || 0;
			const nb = pb[i] || 0;
			if (na > nb) return 1;
			if (na < nb) return -1;
		}
		return 0;
	}

	private showDowngradeConfirm(
		newVersion: string,
		currentVersion: string,
		entries: { name: string; entry: any }[],
		mainJsEntry: { name: string; entry: any } | undefined,
		manifestEntry: { name: string; entry: any } | undefined,
		mainCssEntry: { name: string; entry: any } | undefined,
		stylesEntry: { name: string; entry: any } | undefined,
		bridgeCacheEntries: { name: string; entry: any }[]
	) {
		if (this.contentContainer) {
			this.contentContainer.empty();

			const warningEl = this.contentContainer.createDiv({ cls: 'downgrade-warning' });
			warningEl.createEl('strong', { text: '⚠️ 降级警告' });
			warningEl.createDiv({
				text: `新版本 ${newVersion} 低于当前版本 ${currentVersion}，确认要降级吗？`
			});

			const btnGroup = this.contentContainer.createDiv({ cls: 'btn-group' });
			const confirmBtn = btnGroup.createEl('button', {
				text: '确认降级',
				cls: 'mod-warning'
			});
			const cancelBtn = btnGroup.createEl('button', {
				text: '取消',
				cls: 'mod-editor'
			});

			confirmBtn.onclick = () => {
				this.contentContainer?.empty();
				const progressSection = this.contentContainer!.createDiv({ cls: 'progress-section' });
				this.progressBar = progressSection.createDiv({ cls: 'progress-bar' });
				const progressFill = this.progressBar.createDiv({ cls: 'progress-bar-fill' });
				progressFill.style.width = '0%';
				this.progressText = progressSection.createDiv({ cls: 'progress-text', text: '准备中...' });
				this.statusText = this.contentContainer!.createDiv({ cls: 'status-text', text: '正在解析更新包...' });
				this.doInstall(entries, mainJsEntry, manifestEntry, mainCssEntry, stylesEntry, bridgeCacheEntries);
			};
			cancelBtn.onclick = () => this.close();
		}
	}

	private async doInstall(
		entries: { name: string; entry: any }[],
		mainJsEntry: { name: string; entry: any } | undefined,
		manifestEntry: { name: string; entry: any } | undefined,
		mainCssEntry: { name: string; entry: any } | undefined,
		stylesEntry: { name: string; entry: any } | undefined,
		bridgeCacheEntries: { name: string; entry: any }[]
	) {
		try {
			const totalFiles = (mainJsEntry ? 1 : 0) + (manifestEntry ? 1 : 0) + (mainCssEntry ? 1 : 0) + (stylesEntry ? 1 : 0) + bridgeCacheEntries.length;
			let processedFiles = 0;

			const updateStatus = (msg: string) => {
				if (this.statusText) this.statusText.setText(msg);
			};

			const adapter = this.app.vault.adapter;
			const pluginDir = '.obsidian/plugins/sillot/';

			if (manifestEntry) {
				processedFiles++;
				this.updateProgress(Math.round((processedFiles / totalFiles) * 80), `正在安装 manifest.json...`);
				updateStatus(`正在安装 manifest.json...`);
				const content = await manifestEntry.entry.async('string');
				await adapter.write(pluginDir + 'manifest.json', content);
			}

			if (mainJsEntry) {
				processedFiles++;
				this.updateProgress(Math.round((processedFiles / totalFiles) * 80), `正在安装 main.js...`);
				updateStatus(`正在安装 main.js...`);
				const content = await mainJsEntry.entry.async('string');
				await adapter.write(pluginDir + 'main.js', content);
			}

			if (mainCssEntry) {
				processedFiles++;
				this.updateProgress(Math.round((processedFiles / totalFiles) * 80), `正在安装 main.css...`);
				updateStatus(`正在安装 main.css...`);
				const content = await mainCssEntry.entry.async('string');
				await adapter.write(pluginDir + 'main.css', content);
			}

			if (stylesEntry) {
				processedFiles++;
				this.updateProgress(Math.round((processedFiles / totalFiles) * 80), `正在安装 styles.css...`);
				updateStatus(`正在安装 styles.css...`);
				const content = await stylesEntry.entry.async('string');
				await adapter.write(pluginDir + 'styles/styles.css', content);
			}

			if (bridgeCacheEntries.length > 0) {
				updateStatus(`正在安装 bridge-cache...`);
				const cacheDir = pluginDir + 'bridge-cache/';
				if (!(await adapter.exists(cacheDir))) {
					await adapter.mkdir(cacheDir);
				}
				for (let i = 0; i < bridgeCacheEntries.length; i++) {
					const entry = bridgeCacheEntries[i];
					processedFiles++;
					this.updateProgress(Math.round((processedFiles / totalFiles) * 80), `正在安装 bridge-cache 文件 (${i + 1}/${bridgeCacheEntries.length})...`);
					const content = await entry.entry.async('string');
					const fileName = entry.name.replace('bridge-cache/', '');
					await adapter.write(cacheDir + fileName, content);
				}
			}

			this.updateProgress(100, '安装完成！');
			updateStatus('插件更新安装完成，请重启 Obsidian 以加载新版本。');

			if (this.closeBtn) {
				this.closeBtn.removeAttribute('disabled');
				this.closeBtn.setText('关闭');
			}
			this.completed = true;

			new Notice('插件更新安装完成，请重启 Obsidian', 5000);

		} catch (err: any) {
			if (this.statusText) {
				this.statusText.setText(`安装失败: ${err.message}`);
				this.statusText.style.color = 'var(--text-error)';
			}
			if (this.closeBtn) {
				this.closeBtn.removeAttribute('disabled');
				this.closeBtn.setText('关闭');
			}
			new Notice(`安装失败: ${err.message}`, 5000);
		}
	}

	private updateProgress(percent: number, message: string) {
		if (this.progressBar) {
			const fill = this.progressBar.querySelector('.progress-bar-fill') as HTMLElement;
			if (fill) fill.style.width = `${percent}%`;
		}
		if (this.progressText) this.progressText.setText(message);
	}

	onClose() {
		this.contentEl.empty();
		if (this.onCloseCallback) {
			this.onCloseCallback();
		}
	}
}
