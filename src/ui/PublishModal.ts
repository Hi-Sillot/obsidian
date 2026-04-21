import { App, Modal, Setting } from 'obsidian';
import type { PublishResult } from '../types';

export class PublishModal extends Modal {
	result: PublishResult;
	private defaultBranch: string;
	private branchPrefix: string;
	private onSubmit: (result: PublishResult) => void;

	constructor(app: App, defaultBranch: string, branchPrefix: string, createPR: boolean, onSubmit: (result: PublishResult) => void) {
		super(app);
		this.defaultBranch = defaultBranch;
		this.branchPrefix = branchPrefix;
		this.onSubmit = onSubmit;

		const now = new Date();
		const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

		this.result = {
			commitMessage: `Publish from Obsidian ${ts}`,
			branch: createPR ? `${branchPrefix}${ts}` : defaultBranch,
			createPR,
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: '发布到 VuePress' });

		new Setting(contentEl)
			.setName('提交信息')
			.addText(text => text
				.setValue(this.result.commitMessage)
				.onChange(value => this.result.commitMessage = value));

		new Setting(contentEl)
			.setName('创建 Pull Request')
			.setDesc('开启后将创建新分支并提交 PR，关闭则直接推送到目标分支')
			.addToggle(toggle => toggle
				.setValue(this.result.createPR)
				.onChange(value => {
					this.result.createPR = value;
					if (value) {
						const now = new Date();
						const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
						this.result.branch = `${this.branchPrefix}${ts}`;
					} else {
						this.result.branch = this.defaultBranch;
					}
					this.renderBranchSetting();
				}));

		this.renderBranchSetting();

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('发布')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.result);
				}));
	}

	private branchSettingEl: HTMLElement | null = null;

	private renderBranchSetting() {
		if (this.branchSettingEl) {
			this.branchSettingEl.remove();
		}

		const desc = this.result.createPR
			? `将创建新分支并提交 PR 到 ${this.defaultBranch}`
			: `直接推送到 ${this.defaultBranch}`;

		const setting = new Setting(this.contentEl)
			.setName(this.result.createPR ? '目标分支（新）' : '目标分支')
			.setDesc(desc)
			.addText(text => text
				.setValue(this.result.branch)
				.onChange(value => this.result.branch = value)
			);

		if (this.result.createPR) {
			setting.addExtraButton(btn => btn
				.setIcon('reset')
				.setTooltip('重新生成分支名')
				.onClick(() => {
					const now = new Date();
					const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
					this.result.branch = `${this.branchPrefix}${ts}`;
					this.renderBranchSetting();
				}));
		}

		this.branchSettingEl = setting.settingEl;

		const btnArea = this.contentEl.querySelector('.modal-button-area');
		if (btnArea && this.branchSettingEl) {
			this.contentEl.insertBefore(this.branchSettingEl, btnArea);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
