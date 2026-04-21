export class BridgeCssInjector {
	private styleEl: HTMLStyleElement | null = null;
	private bridgeCss: string = '';

	loadFromText(css: string): void {
		this.bridgeCss = css;
	}

	inject(): void {
		this.remove();
		if (!this.bridgeCss) return;
		this.styleEl = document.createElement('style');
		this.styleEl.id = 'sillot-bridge-vars';
		this.styleEl.textContent = this.bridgeCss;
		document.head.appendChild(this.styleEl);
	}

	remove(): void {
		if (this.styleEl) {
			this.styleEl.remove();
			this.styleEl = null;
		}
	}

	getCSS(): string {
		return this.bridgeCss;
	}

	isInjected(): boolean {
		return this.styleEl !== null && document.contains(this.styleEl);
	}
}
