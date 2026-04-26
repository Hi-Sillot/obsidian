import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

interface TTSState {
	isPlaying: boolean;
	isPaused: boolean;
	currentUtterance: SpeechSynthesisUtterance | null;
	voices: SpeechSynthesisVoice[];
	selectedVoice: SpeechSynthesisVoice | null;
	rate: number;
	pitch: number;
	volume: number;
	currentText: string;
	currentIndex: number;
}

export class TTSHandler extends BaseSyntaxHandler {
	private state: TTSState = {
		isPlaying: false,
		isPaused: false,
		currentUtterance: null,
		voices: [],
		selectedVoice: null,
		rate: 1.0,
		pitch: 1.0,
		volume: 1.0,
		currentText: '',
		currentIndex: 0
	};

	private ttsContainer: HTMLElement | null = null;
	private controlPanel: HTMLElement | null = null;

	processInlineComponents(el: HTMLElement): void {
		this.addTTSButton(el);
		this.initTTSControls();
	}

	preprocessMarkdown(text: string): string {
		return text;
	}

	private addTTSButton(el: HTMLElement): void {
		const viewEl = this.findViewContainer(el);
		if (!viewEl) return;

		const existingBtn = viewEl.querySelector('.sillot-tts-toggle');
		if (existingBtn) return;

		const toggleBtn = document.createElement('button');
		toggleBtn.className = 'sillot-tts-toggle';
		toggleBtn.innerHTML = '🔊 TTS';
		toggleBtn.setAttribute('aria-label', '文本朗读');
		toggleBtn.setAttribute('data-processed', 'true');

		toggleBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggleTTSPanel(viewEl);
		});

		const toolbar = this.findToolbarContainer(viewEl);
		if (toolbar) {
			toolbar.appendChild(toggleBtn);
		}
	}

	private findViewContainer(el: HTMLElement): HTMLElement | null {
		const selectors = [
			'.markdown-preview-view',
			'.markdown-source-view',
			'.view-content',
			'[data-type="markdown"]'
		];

		for (const selector of selectors) {
			const viewEl = el.closest(selector) as HTMLElement | null;
			if (viewEl) return viewEl;
		}

		return null;
	}

	private findToolbarContainer(viewEl: HTMLElement): HTMLElement | null {
		const toolbarSelectors = [
			'.view-header',
			'.view-actions',
			'.nav-buttons',
			'.markdown-preview-container'
		];

		for (const selector of toolbarSelectors) {
			const toolbar = viewEl.querySelector(selector) as HTMLElement | null;
			if (toolbar) return toolbar;
		}

		return viewEl;
	}

	private toggleTTSPanel(viewEl: HTMLElement): void {
		let panel = viewEl.querySelector('.sillot-tts-panel') as HTMLElement;

		if (panel) {
			panel.classList.toggle('sillot-tts-panel-visible');
			return;
		}

		panel = document.createElement('div');
		panel.className = 'sillot-tts-panel';
		panel.setAttribute('data-processed', 'true');

		panel.innerHTML = this.renderControlPanel();
		viewEl.appendChild(panel);

		this.bindControlEvents(panel);
		this.loadVoices();

		requestAnimationFrame(() => {
			panel.classList.add('sillot-tts-panel-visible');
		});
	}

	private renderControlPanel(): string {
		return `
			<div class="sillot-tts-header">
				<span class="sillot-tts-title">🎙️ 文本朗读</span>
				<button class="sillot-tts-close" aria-label="关闭">×</button>
			</div>
			
			<div class="sillot-tts-controls">
				<div class="sillot-tts-main-btns">
					<button class="sillot-tts-btn sillot-tts-play" data-action="play" title="播放">
						<span class="sillot-tts-icon">▶</span>
					</button>
					<button class="sillot-tts-btn sillot-tts-pause" data-action="pause" title="暂停/继续">
						<span class="sillot-tts-icon">⏸</span>
					</button>
					<button class="sillot-tts-btn sillot-tts-stop" data-action="stop" title="停止">
						<span class="sillot-tts-icon">⏹</span>
					</button>
				</div>

				<div class="sillot-tts-settings">
					<div class="sillot-tts-setting">
						<label>语速</label>
						<input type="range" class="sillot-tts-rate" min="0.5" max="2" step="0.1" value="${this.state.rate}">
						<span class="sillot-tts-value">${this.state.rate}x</span>
					</div>
					<div class="sillot-tts-setting">
						<label>音调</label>
						<input type="range" class="sillot-tts-pitch" min="0.5" max="2" step="0.1" value="${this.state.pitch}">
						<span class="sillot-tts-value">${this.state.pitch}</span>
					</div>
					<div class="sillot-tts-setting">
						<label>音量</label>
						<input type="range" class="sillot-tts-volume" min="0" max="1" step="0.1" value="${this.state.volume}">
						<span class="sillot-tts-value">${Math.round(this.state.volume * 100)}%</span>
					</div>
				</div>

				<div class="sillot-tts-voice-select">
					<label>语音</label>
					<select class="sillot-tts-voice-list">
						<option value="">加载中...</option>
					</select>
				</div>

				<div class="sillot-tts-status">
					<span class="sillot-tts-status-text">就绪</span>
					<div class="sillot-tts-progress-bar">
						<div class="sillot-tts-progress-fill"></div>
					</div>
				</div>
			</div>
		`;
	}

	private bindControlEvents(panel: HTMLElement): void {
		const closeBtn = panel.querySelector('.sillot-tts-close') as HTMLButtonElement;
		closeBtn?.addEventListener('click', () => {
			panel.classList.remove('sillot-tts-panel-visible');
		});

		const actionButtons = panel.querySelectorAll('[data-action]');
		actionButtons.forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				const action = (btn as HTMLElement).dataset.action;
				switch (action) {
					case 'play': this.startReading(); break;
					case 'pause': this.togglePause(); break;
					case 'stop': this.stopReading(); break;
				}
			});
		});

		const rateInput = panel.querySelector('.sillot-tts-rate') as HTMLInputElement;
		rateInput?.addEventListener('input', (e) => {
			this.state.rate = parseFloat((e.target as HTMLInputElement).value);
			this.updateSettingDisplay(panel, 'rate', `${this.state.rate}x`);
		});

		const pitchInput = panel.querySelector('.sillot-tts-pitch') as HTMLInputElement;
		pitchInput?.addEventListener('input', (e) => {
			this.state.pitch = parseFloat((e.target as HTMLInputElement).value);
			this.updateSettingDisplay(panel, 'pitch', String(this.state.pitch));
		});

		const volumeInput = panel.querySelector('.sillot-tts-volume') as HTMLInputElement;
		volumeInput?.addEventListener('input', (e) => {
			this.state.volume = parseFloat((e.target as HTMLInputElement).value);
			this.updateSettingDisplay(panel, 'volume', `${Math.round(this.state.volume * 100)}%`);
		});

		const voiceSelect = panel.querySelector('.sillot-tts-voice-list') as HTMLSelectElement;
		voiceSelect?.addEventListener('change', (e) => {
			const voiceName = (e.target as HTMLSelectElement).value;
			this.state.selectedVoice = this.state.voices.find(v => v.name === voiceName) || null;
		});

		this.controlPanel = panel;
	}

	private updateSettingDisplay(panel: HTMLElement, setting: string, value: string): void {
		const settingEl = panel.querySelector(`.sillot-tts-${setting}`);
		if (!settingEl?.parentElement) return;
		const display = settingEl.parentElement.querySelector('.sillot-tts-value');
		if (display) display.textContent = value;
	}

	private loadVoices(): void {
		const loadVoicesList = () => {
			this.state.voices = speechSynthesis.getVoices();

			if (!this.controlPanel) return;

			const select = this.controlPanel.querySelector('.sillot-tts-voice-list') as HTMLSelectElement;
			if (!select) return;

			select.innerHTML = '';

			const defaultOption = document.createElement('option');
			defaultOption.value = '';
			defaultOption.textContent = '默认语音';
			select.appendChild(defaultOption);

			this.state.voices.forEach(voice => {
				const option = document.createElement('option');
				option.value = voice.name;
				option.textContent = `${voice.name} (${voice.lang})`;
				option.setAttribute('data-lang', voice.lang);
				select.appendChild(option);
			});

			const zhVoice = this.state.voices.find(v => v.lang.startsWith('zh'));
			if (zhVoice) {
				this.state.selectedVoice = zhVoice;
				select.value = zhVoice.name;
			}
		};

		loadVoicesList();
		speechSynthesis.onvoiceschanged = loadVoicesList;
	}

	private initTTSControls(): void {
		if ('speechSynthesis' in window) {
			speechSynthesis.cancel();
		}
	}

	private startReading(): void {
		if (!('speechSynthesis' in window)) {
			this.updateStatus('您的浏览器不支持语音合成 API');
			return;
		}

		const activeView = this.getActiveViewContent();
		if (!activeView) {
			this.updateStatus('未找到可朗读的内容');
			return;
		}

		const text = this.extractReadableText(activeView);
		if (!text.trim()) {
			this.updateStatus('内容为空，无法朗读');
			return;
		}

		if (this.state.isPaused && speechSynthesis.paused) {
			speechSynthesis.resume();
			this.state.isPlaying = true;
			this.state.isPaused = false;
			this.updateStatus('正在朗读...');
			this.updatePlayButton(true);
			return;
		}

		speechSynthesis.cancel();

		this.state.currentText = text;
		this.state.currentIndex = 0;
		this.speakText(text);
	}

	private speakText(text: string): void {
		const utterance = new SpeechSynthesisUtterance(text);

		utterance.rate = this.state.rate;
		utterance.pitch = this.state.pitch;
		utterance.volume = this.state.volume;

		if (this.state.selectedVoice) {
			utterance.voice = this.state.selectedVoice;
		}

		utterance.lang = this.state.selectedVoice?.lang || 'zh-CN';

		utterance.onstart = () => {
			this.state.isPlaying = true;
			this.state.isPaused = false;
			this.updateStatus('正在朗读...');
			this.updatePlayButton(true);
		};

		utterance.onend = () => {
			this.state.isPlaying = false;
			this.state.isPaused = false;
			this.updateStatus('朗读完成 ✓');
			this.updatePlayButton(false);
			this.updateProgress(100);
		};

		utterance.onerror = (event) => {
			this.plugin.logger?.error('TTS', '语音合成错误', event.error);
			this.state.isPlaying = false;
			this.updateStatus(`错误: ${event.error}`);
			this.updatePlayButton(false);
		};

		utterance.onboundary = (event) => {
			if (event.name === 'word' && text.length > 0) {
				const progress = Math.min(100, Math.round((event.charIndex / text.length) * 100));
				this.updateProgress(progress);
			}
		};

		this.state.currentUtterance = utterance;
		speechSynthesis.speak(utterance);
	}

	private togglePause(): void {
		if (!this.state.isPlaying) return;

		if (this.state.isPaused) {
			speechSynthesis.resume();
			this.state.isPaused = false;
			this.updateStatus('正在朗读...');
			this.updatePlayButton(true);
		} else {
			speechSynthesis.pause();
			this.state.isPaused = true;
			this.updateStatus('已暂停 ⏸');
			this.updatePlayButton(false);
		}
	}

	private stopReading(): void {
		speechSynthesis.cancel();
		this.state.isPlaying = false;
		this.state.isPaused = false;
		this.state.currentUtterance = null;
		this.updateStatus('已停止 ⏹');
		this.updatePlayButton(false);
		this.updateProgress(0);
	}

	private getActiveViewContent(): HTMLElement | null {
		const selectors = [
			'.markdown-preview-view .markdown-preview-sizer',
			'.markdown-preview-view .markdown-preview-content',
			'.markdown-preview-view',
			'.view-content .markdown-source-view'
		];

		for (const selector of selectors) {
			const activeView = document.activeElement?.closest(selector.replace(/ .+$/, '')) as HTMLElement | null;
			if (activeView) {
				const contentEl = activeView.querySelector(selector.split(' ').slice(1).join(' ')) as HTMLElement | null;
				return contentEl || activeView;
			}
		}

		for (const selector of selectors) {
			const elements = document.querySelectorAll(selector);
			if (elements.length > 0) {
				return elements[elements.length - 1] as HTMLElement;
			}
		}

		return document.querySelector('.workspace-leaf-content') as HTMLElement || null;
	}

	private extractReadableText(element: HTMLElement): string {
		const excludeSelectors = [
			'.sillot-tts-panel',
			'.sillot-watermark-container',
			'script',
			'style',
			'code',
			'pre',
			'.frontmatter',
			'.metadata-container'
		];

		let text = '';

		const walk = (node: Node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				text += node.textContent + ' ';
				return;
			}

			if (node.nodeType === Node.ELEMENT_NODE) {
				const el = node as Element;
				const shouldExclude = excludeSelectors.some(sel => el.matches(sel));

				if (shouldExclude) return;

				for (const child of Array.from(el.childNodes)) {
					walk(child);
				}

				if (el.tagName === 'P' || el.tagName === 'DIV' || el.tagName === 'LI') {
					text += '\n\n';
				} else if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') {
					text += '\n\n';
				}
			}
		};

		walk(element);

		return text
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]+/g, ' ')
			.trim();
	}

	private updateStatus(message: string): void {
		if (!this.controlPanel) return;
		const statusEl = this.controlPanel.querySelector('.sillot-tts-status-text');
		if (statusEl) statusEl.textContent = message;
	}

	private updatePlayButton(isPlaying: boolean): void {
		if (!this.controlPanel) return;
		const playBtn = this.controlPanel.querySelector('.sillot-tts-play .sillot-tts-icon');
		if (playBtn) {
			playBtn.textContent = isPlaying ? '⏸' : '▶';
		}
	}

	private updateProgress(percent: number): void {
		if (!this.controlPanel) return;
		const fill = this.controlPanel.querySelector('.sillot-tts-progress-fill') as HTMLElement;
		if (fill) fill.style.width = `${percent}%`;
	}

	dispose(): void {
		if ('speechSynthesis' in window) {
			speechSynthesis.cancel();
		}

		document.querySelectorAll('.sillot-tts-toggle').forEach(btn => btn.remove());
		document.querySelectorAll('.sillot-tts-panel').forEach(panel => panel.remove());

		this.state.isPlaying = false;
		this.state.isPaused = false;
		this.state.currentUtterance = null;
		this.ttsContainer = null;
		this.controlPanel = null;
	}
}
