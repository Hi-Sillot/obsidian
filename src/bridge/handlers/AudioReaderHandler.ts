import type VuePressPublisherPlugin from '../../main';
import { BaseSyntaxHandler } from './SyntaxHandler';

interface AudioReaderConfig {
	src: string;
	type?: string;
	title?: string;
	autoplay?: boolean;
	startTime?: number;
	endTime?: number;
	volume?: number;
}

export class AudioReaderHandler extends BaseSyntaxHandler {
	private static readonly AUDIO_READER_REGEX = /@\[audioReader([^\]]*)\]\(([^)]+)\)/g;

	processInlineComponents(el: HTMLElement): void {
		this.processAudioReaders(el);
	}

	preprocessMarkdown(text: string, _sourcePath: string): string {
		return this.preprocessAudioReaderTags(text);
	}

	private processAudioReaders(el: HTMLElement): void {
		const audioElements = el.querySelectorAll<HTMLElement>('.sillot-audio-reader');

		audioElements.forEach(audioEl => {
			if (audioEl.dataset.processed === 'true') return;
			audioEl.dataset.processed = 'true';

			const src = audioEl.dataset.src || '';
			const config: Partial<AudioReaderConfig> = this.parseConfigFromElement(audioEl);

			this.renderAudioPlayer(audioEl, { src, ...config });
		});
	}

	private parseConfigFromElement(el: HTMLElement): Partial<AudioReaderConfig> {
		const config: Partial<AudioReaderConfig> = {};

		if (el.dataset.type) {
			config.type = el.dataset.type;
		}
		if (el.dataset.title) {
			config.title = el.dataset.title;
		}
		if (el.dataset.autoplay === 'true') {
			config.autoplay = true;
		}
		if (el.dataset.startTime) {
			config.startTime = parseFloat(el.dataset.startTime);
		}
		if (el.dataset.endTime) {
			config.endTime = parseFloat(el.dataset.endTime);
		}
		if (el.dataset.volume) {
			config.volume = parseFloat(el.dataset.volume);
		}

		return config;
	}

	private preprocessAudioReaderTags(text: string): string {
		return text.replace(
			AudioReaderHandler.AUDIO_READER_REGEX,
			(match: string, attrsStr: string, src: string) => {
				const config = this.parseConfigString(attrsStr.trim());
				const attrs = this.buildDataAttributes({ src, ...config });

				return '<span class="sillot-audio-reader" ' + attrs + ' data-processed="false"></span>';
			}
		);
	}

	private parseConfigString(attrsStr: string): Partial<AudioReaderConfig> {
		const config: Partial<AudioReaderConfig> = {};

		if (!attrsStr) return config;

		const typeMatch = attrsStr.match(/type=["']([^"']+)["']/);
		if (typeMatch) {
			config.type = typeMatch[1];
		}

		const titleMatch = attrsStr.match(/title=["']([^"']+)["']/);
		if (titleMatch) {
			config.title = titleMatch[1];
		}

		if (/autoplay/.test(attrsStr)) {
			config.autoplay = true;
		}

		const startTimeMatch = attrsStr.match(/start-time=["']?(\d+(?:\.\d+)?)["']?/);
		if (startTimeMatch) {
			config.startTime = parseFloat(startTimeMatch[1]);
		}

		const endTimeMatch = attrsStr.match(/end-time=["']?(\d+(?:\.\d+)?)["']?/);
		if (endTimeMatch) {
			config.endTime = parseFloat(endTimeMatch[1]);
		}

		const volumeMatch = attrsStr.match(/volume=["']?(\d(?:\.\d+)?)["']?/);
		if (volumeMatch) {
			config.volume = parseFloat(volumeMatch[1]);
		}

		return config;
	}

	private buildDataAttributes(config: AudioReaderConfig): string {
		const attrs: string[] = [];

		attrs.push('data-src="' + this.escapeAttr(config.src) + '"');

		if (config.type) {
			attrs.push('data-type="' + this.escapeAttr(config.type) + '"');
		}
		if (config.title) {
			attrs.push('data-title="' + this.escapeAttr(config.title) + '"');
		}
		if (config.autoplay) {
			attrs.push('data-autoplay="true"');
		}
		if (config.startTime !== undefined) {
			attrs.push('data-start-time="' + config.startTime + '"');
		}
		if (config.endTime !== undefined) {
			attrs.push('data-end-time="' + config.endTime + '"');
		}
		if (config.volume !== undefined) {
			attrs.push('data-volume="' + config.volume + '"');
		}

		return attrs.join(' ');
	}

	private renderAudioPlayer(container: HTMLElement, config: AudioReaderConfig): void {
		if (!config.src) {
			container.innerHTML = '<span class="sillot-audio-error">❌ 音频地址缺失</span>';
			container.classList.add('sillot-audio-error-state');
			return;
		}

		const audioType = config.type || this.inferAudioType(config.src);
		const title = config.title || '';
		const volume = Math.max(0, Math.min(1, config.volume ?? 0.7));

		let html = '<span class="sillot-audio-wrapper" data-audio-initialized="false">';

		if (title) {
			html += '<span class="sillot-audio-title">' + this.escapeHtml(title) + '</span>';
		}

		html += '<button class="sillot-audio-play-btn" type="button" aria-label="播放音频" title="点击播放">';
		html += '<svg class="sillot-audio-icon sillot-audio-icon--play" viewBox="0 0 24 24" fill="currentColor">';
		html += '<path d="M8 5v14l11-7z"/>';
		html += '</svg>';
		html += '<svg class="sillot-audio-icon sillot-audio-icon--pause" viewBox="0 0 24 24" fill="currentColor" style="display:none;">';
		html += '<path d="M6 19h4V5H6v14zm8-14v14h4V5h4z"/>';
		html += '</svg>';
		html += '</button>';

		html += '<span class="sillot-audio-duration">--:--</span>';

		html += '<div class="sillot-audio-progress" style="display:none;">';
		html += '<div class="sillot-audio-progress-bar">';
		html += '<div class="sillot-audio-progress-fill" style="width: 0%"></div>';
		html += '</div>';
		html += '<span class="sillot-audio-current-time">0:00</span>';
		html += '<span class="sillot-audio-separator">/</span>';
		html += '<span class="sillot-audio-total-time">0:00</span>';
		html += '</div>';

		html += '<audio class="sillot-audio-element" preload="metadata" style="display:none;">';
		html += '<source src="' + this.escapeAttr(config.src) + '" type="' + this.escapeAttr(audioType) + '">';
		html += '您的浏览器不支持音频播放';
		html += '</audio>';

		html += '</span>';

		container.innerHTML = html;

		this.initializeAudioPlayer(container, config);
	}

	private initializeAudioPlayer(container: HTMLElement, config: AudioReaderConfig): void {
		const wrapper = container.querySelector('.sillot-audio-wrapper') as HTMLElement;
		if (!wrapper) return;

		const playBtn = container.querySelector('.sillot-audio-play-btn') as HTMLButtonElement;
		const audioEl = container.querySelector<HTMLAudioElement>('.sillot-audio-element');
		const durationEl = container.querySelector('.sillot-audio-duration') as HTMLElement;
		const progressContainer = container.querySelector('.sillot-audio-progress') as HTMLElement;
		const progressFill = container.querySelector('.sillot-audio-progress-fill') as HTMLElement;
		const currentTimeEl = container.querySelector('.sillot-audio-current-time') as HTMLElement;
		const totalTimeEl = container.querySelector('.sillot-audio-total-time') as HTMLElement;
		const iconPlay = container.querySelector('.sillot-audio-icon--play') as HTMLElement;
		const iconPause = container.querySelector('.sillot-audio-icon--pause') as HTMLElement;

		if (!playBtn || !audioEl) return;

		audioEl.volume = Math.max(0, Math.min(1, config.volume ?? 0.7));

		audioEl.addEventListener('loadedmetadata', () => {
			const duration = audioEl.duration;
			if (duration && isFinite(duration)) {
				durationEl.textContent = this.formatTime(duration);
				totalTimeEl.textContent = this.formatTime(duration);

				if (config.startTime !== undefined) {
					audioEl.currentTime = config.startTime;
				}

				wrapper.dataset.audioInitialized = 'true';
			}
		});

		playBtn.addEventListener('click', () => {
			this.togglePlay(audioEl, playBtn, iconPlay, iconPause, progressContainer, config);
		});

		audioEl.addEventListener('timeupdate', () => {
			if (!progressContainer || progressContainer.style.display === 'none') return;

			const currentTime = audioEl.currentTime;
			currentTimeEl.textContent = this.formatTime(currentTime);

			if (audioEl.duration && isFinite(audioEl.duration)) {
				const progress = (currentTime / audioEl.duration) * 100;
				progressFill.style.width = Math.min(100, progress) + '%';
			}

			if (config.endTime !== undefined && currentTime >= config.endTime) {
				audioEl.pause();
				this.updatePlayButton(playBtn, iconPlay, iconPause, false);
				if (config.startTime !== undefined) {
					audioEl.currentTime = config.startTime;
				}
			}
		});

		audioEl.addEventListener('ended', () => {
			this.updatePlayButton(playBtn, iconPlay, iconPause, false);
			if (progressContainer) {
				progressContainer.style.display = 'none';
			}
			if (durationEl) {
				durationEl.style.display = 'inline';
			}

			if (config.startTime !== undefined) {
				audioEl.currentTime = config.startTime;
			}
		});

		audioEl.addEventListener('error', () => {
			this.plugin.logger?.error('Audio', '音频加载失败', config.src);
			container.innerHTML = '<span class="sillot-audio-error">❌ 音频加载失败</span>';
			container.classList.add('sillot-audio-error-state');
		});

		if (config.autoplay) {
			setTimeout(() => {
				this.togglePlay(audioEl, playBtn, iconPlay, iconPause, progressContainer, config);
			}, 100);
		}
	}

	private togglePlay(
		audio: HTMLAudioElement,
		btn: HTMLButtonElement,
		iconPlay: HTMLElement,
		iconPause: HTMLElement,
		progressContainer: HTMLElement | null,
		config: AudioReaderConfig
	): void {
		if (audio.paused) {
			if (config.startTime !== undefined && audio.currentTime < config.startTime) {
				audio.currentTime = config.startTime;
			}

			audio.play().then(() => {
				this.updatePlayButton(btn, iconPlay, iconPause, true);
				if (progressContainer) {
					progressContainer.style.display = 'inline-flex';
				}
				const durationEl = btn.parentElement?.querySelector<HTMLElement>('.sillot-audio-duration');
				if (durationEl) {
					durationEl.style.display = 'none';
				}
			}).catch((err) => {
				this.plugin.logger?.error('Audio', '音频播放失败', (err as Error).message);
			});
		} else {
			audio.pause();
			this.updatePlayButton(btn, iconPlay, iconPause, false);
		}
	}

	private updatePlayButton(
		btn: HTMLButtonElement,
		iconPlay: HTMLElement,
		iconPause: HTMLElement,
		isPlaying: boolean
	): void {
		if (iconPlay && iconPause) {
			iconPlay.style.display = isPlaying ? 'none' : '';
			iconPause.style.display = isPlaying ? '' : 'none';
		}

		btn.classList.toggle('sillot-audio-playing', isPlaying);
		btn.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
	}

	private inferAudioType(url: string): string {
		const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || '';

		const mimeTypes: Record<string, string> = {
			mp3: 'audio/mpeg',
			m4a: 'audio/mp4',
			ogg: 'audio/ogg',
			wav: 'audio/wav',
			webm: 'audio/webm',
			flac: 'audio/flac',
			aac: 'audio/aac',
		};

		return mimeTypes[ext] || 'audio/mpeg';
	}

	private formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return '--:--';

		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return mins + ':' + secs.toString().padStart(2, '0');
	}

	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	private escapeAttr(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	dispose(): void {
		document.querySelectorAll('.sillot-audio-element').forEach(audio => {
			(audio as HTMLAudioElement).pause();
			(audio as HTMLAudioElement).remove();
		});
	}
}
