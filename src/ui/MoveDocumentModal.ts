import { App, Modal, Notice, Platform } from 'obsidian';
import { PathMover, type MoveOptions } from '../sync/PathMover';
import { GitHubApi } from '../sync/githubApi';
import type VuePressPublisherPlugin from '../main';

export class MoveDocumentModal extends Modal {
	private plugin: VuePressPublisherPlugin;
	private oldPath: string;
	private docsDir: string;
	private mover: PathMover;
	private createPRToggle: boolean;
	private recentPaths: string[];
	private onSubmit: (result: { newPath: string; createPR: boolean }) => void;

	private newPathInput: HTMLInputElement | null = null;
	private validationEl: HTMLElement | null = null;
	private progressModal: HTMLElement | null = null;
	private progressBar: HTMLElement | null = null;
	private progressMsg: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: VuePressPublisherPlugin,
		oldPath: string,
		docsDir: string,
		onSubmit: (result: { newPath: string; createPR: boolean }) => void
	) {
		super(app);
		this.plugin = plugin;
		this.oldPath = oldPath;
		this.docsDir = docsDir.replace(/^\/+|\/+$/g, '');
		this.createPRToggle = plugin.settings.publishCreatePR;
		this.recentPaths = plugin.settings.recentPublishPaths || [];
		this.onSubmit = onSubmit;

		const api = new GitHubApi(plugin.settings.githubRepo, plugin.settings.githubToken);
		this.mover = new PathMover(api, docsDir);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.className = 'sillot-move-modal';

		const modalEl = contentEl.closest('.modal') as HTMLElement | null;
		if (modalEl) {
			modalEl.classList.add('sillot-modal-80vw');
		}

		this.createHeader(contentEl);
		this.createForm(contentEl);
		this.createFooter(contentEl);
		this.createProgressModal();
	}

	private createHeader(parent: HTMLElement) {
		const header = parent.createDiv('move-modal-header');
		header.createEl('h2', { text: '修改文档路径' });
		header.createEl('span', {
			text: this.plugin.manifest.name,
			cls: 'move-modal-plugin-name'
		});
	}

	private createForm(parent: HTMLElement) {
		const form = parent.createDiv('move-modal-form');

		const oldPathRow = form.createDiv('move-row');
		oldPathRow.createEl('label', { text: '当前路径' });
		const oldPathValue = oldPathRow.createEl('span', { cls: 'move-path-display' });
		oldPathValue.textContent = this.oldPath;

		const newPathRow = form.createDiv('move-row');
		newPathRow.createEl('label', { text: '新路径' });
		newPathRow.createEl('span', { text: `相对于 ${this.docsDir} 目录`, cls: 'move-row-desc' });
		this.newPathInput = newPathRow.createEl('input', {
			type: 'text',
			cls: 'config-text-input move-path-input',
			attr: { placeholder: '输入新路径（不含 .md 后缀）' }
		}) as HTMLInputElement;

		const oldPathBase = this.oldPath.replace(/\.md$/, '');
		this.newPathInput.value = oldPathBase;

		this.newPathInput.oninput = () => {
			this.validateNewPath();
		};

		this.validationEl = form.createDiv('move-validation');

		if (this.recentPaths.length > 0) {
			const recentRow = form.createDiv('move-row');
			recentRow.createEl('label', { text: '最近路径' });
			const recentContainer = recentRow.createDiv('move-recent-paths');
			for (const path of this.recentPaths.slice(0, 5)) {
				const chip = recentContainer.createEl('button', {
					text: path,
					cls: 'recent-path-chip'
				});
				chip.onclick = () => {
					if (this.newPathInput) {
						this.newPathInput.value = path;
						this.validateNewPath();
					}
				};
			}
		}

		const prRow = form.createDiv('move-row');
		prRow.createEl('label', { text: '创建 Pull Request' });
		const prToggle = prRow.createEl('button', { cls: `config-toggle ${this.createPRToggle ? 'active' : ''}` });
		prToggle.textContent = this.createPRToggle ? '开启' : '关闭';
		prToggle.onclick = () => {
			this.createPRToggle = !this.createPRToggle;
			prToggle.classList.toggle('active', this.createPRToggle);
			prToggle.textContent = this.createPRToggle ? '开启' : '关闭';
		};

		const warning = form.createDiv('move-warning');
		warning.innerHTML = `
			<span class="warning-icon">⚠️</span>
			<span>移动文档将同时创建新路径和删除旧路径。</span>
			${!Platform.isDesktop ? '<br><span class="warning-icon">⚠️</span><span>移动端不支持自动更新引用链接，请在桌面端处理。</span>' : ''}
		`;
	}

	private createFooter(parent: HTMLElement) {
		const footer = parent.createDiv('move-footer');
		footer.createEl('button', {
			text: '取消',
			cls: 'config-btn config-btn-cancel'
		}).onclick = () => this.close();

		const submitBtn = footer.createEl('button', {
			text: '确认移动',
			cls: 'config-btn config-btn-primary'
		});
		submitBtn.onclick = () => this.executeMove();
	}

	private createProgressModal() {
		this.progressModal = this.contentEl.createDiv('move-progress-modal');
		this.progressModal.innerHTML = `
			<div class="progress-content">
				<h3>移动文档中...</h3>
				<div class="progress-bar-container">
					<div class="progress-bar"></div>
				</div>
				<div class="progress-msg">准备中...</div>
			</div>
		`;
		this.progressModal.style.display = 'none';
		this.progressBar = this.progressModal.querySelector('.progress-bar');
		this.progressMsg = this.progressModal.querySelector('.progress-msg');
	}

	private validateNewPath(): boolean {
		if (!this.validationEl || !this.newPathInput) return false;

		const newPath = this.newPathInput.value.trim();
		const fullNewPath = newPath.endsWith('.md') ? newPath : `${newPath}.md`;

		if (!newPath) {
			this.validationEl.innerHTML = '';
			this.validationEl.style.display = 'none';
			return false;
		}

		const validation = this.mover.validatePath(fullNewPath);
		if (!validation.valid) {
			this.validationEl.innerHTML = `<div class="validation-error">⚠ ${validation.message}</div>`;
			this.validationEl.style.display = 'block';
			return false;
		}

		if (newPath === this.oldPath.replace(/\.md$/, '')) {
			this.validationEl.innerHTML = `<div class="validation-error">⚠ 新路径不能与当前路径相同</div>`;
			this.validationEl.style.display = 'block';
			return false;
		}

		this.validationEl.innerHTML = '';
		this.validationEl.style.display = 'none';
		return true;
	}

	private async executeMove() {
		if (!this.newPathInput) return;

		const newPath = this.newPathInput.value.trim();
		if (!newPath) {
			new Notice('请输入新路径', 3000);
			return;
		}

		const fullNewPath = newPath.endsWith('.md') ? newPath : `${newPath}.md`;

		if (!this.validateNewPath()) {
			new Notice('请修正路径错误', 3000);
			return;
		}

		this.showProgress();
		this.updateProgress(0, '获取原文件内容...');

		try {
			const moveOptions: MoveOptions = {
				createPR: this.createPRToggle,
				commitMessage: `移动文档 via Sillot: ${this.oldPath} → ${fullNewPath}`,
				onProgress: (percent, msg) => {
					this.updateProgress(percent, msg);
				},
			};

			const result = await this.mover.moveDocument(this.oldPath, fullNewPath, moveOptions);

			this.hideProgress();

			if (result.success) {
				this.showResult(true, result.prUrl ?? '', result.prNumber ?? null);
			} else {
				this.showResult(false, '', null, result.error);
			}
		} catch (error: any) {
			this.hideProgress();
			this.showResult(false, '', null, error.message);
		}
	}

	private showProgress() {
		if (this.progressModal) {
			this.progressModal.style.display = 'block';
		}
	}

	private updateProgress(percent: number, msg: string) {
		if (this.progressBar) {
			this.progressBar.style.width = `${percent}%`;
		}
		if (this.progressMsg) {
			this.progressMsg.textContent = msg;
		}
	}

	private hideProgress() {
		if (this.progressModal) {
			this.progressModal.style.display = 'none';
		}
	}

	private showResult(success: boolean, prUrl: string, prNumber: number | null, error?: string) {
		const modal = this.contentEl.createDiv('move-result-modal');
		modal.innerHTML = `
			<div class="result-content ${success ? 'success' : 'error'}">
				<div class="result-icon">${success ? '✓' : '✗'}</div>
				<h3>${success ? '移动成功' : '移动失败'}</h3>
				${success && prNumber ? `<p>PR #${prNumber} 已创建</p>` : ''}
				${error ? `<p class="error-msg">${error}</p>` : ''}
				<div class="result-actions">
					${success && prUrl ? `<a href="${prUrl}" target="_blank" class="config-btn config-btn-primary">查看 PR</a>` : ''}
					<button class="config-btn">关闭</button>
				</div>
			</div>
		`;

		modal.querySelector('.result-actions button')?.addEventListener('click', () => {
			modal.remove();
			if (success) {
				this.onSubmit({ newPath: this.newPathInput?.value || '', createPR: this.createPRToggle });
				this.close();
			}
		});
	}

	onClose() {
		this.contentEl.empty();
		this.progressModal?.remove();
		this.progressModal = null;
	}
}
