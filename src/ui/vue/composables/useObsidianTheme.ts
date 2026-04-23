import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { GlobalThemeOverrides } from 'naive-ui';

export type ObsidianTheme = 'dark' | 'light';

export interface ObsidianColorPalette {
	primary: string;
	primaryHover: string;
	bg: string;
	bgPrimary: string;
	border: string;
	text: string;
	textMuted: string;
	textFaint: string;
}

function getObsidianTheme(): ObsidianTheme {
	return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

function getObsidianColors(theme: ObsidianTheme): ObsidianColorPalette {
	const s = getComputedStyle(document.body);
	const fallback = theme === 'dark' ? {
		primary: '#7C3AED',
		primaryHover: '#8B5CF6',
		bg: '#1a1a1a',
		bgPrimary: '#11111b',
		border: '#3a3a4a',
		text: '#cdd6f4',
		textMuted: '#a6adc8',
		textFaint: '#6c7086',
	} : {
		primary: '#7C3AED',
		primaryHover: '#6D28D9',
		bg: '#ffffff',
		bgPrimary: '#f5f5f5',
		border: '#e0e0e0',
		text: '#4a4a4a',
		textMuted: '#6a6a6a',
		textFaint: '#9a9a9a',
	};

	return {
		primary: s.getPropertyValue('--interactive-accent').trim() || fallback.primary,
		primaryHover: s.getPropertyValue('--interactive-hover').trim() || fallback.primaryHover,
		bg: s.getPropertyValue('--background-secondary').trim() || fallback.bg,
		bgPrimary: s.getPropertyValue('--background-primary').trim() || fallback.bgPrimary,
		border: s.getPropertyValue('--background-modifier-border').trim() || fallback.border,
		text: s.getPropertyValue('--text-normal').trim() || fallback.text,
		textMuted: s.getPropertyValue('--text-muted').trim() || fallback.textMuted,
		textFaint: s.getPropertyValue('--text-faint').trim() || fallback.textFaint,
	};
}

function createThemeOverrides(theme: ObsidianTheme): GlobalThemeOverrides {
	const c = getObsidianColors(theme);
	return {
		common: {
			primaryColor: c.primary,
			primaryColorHover: c.primaryHover,
			primaryColorPressed: c.primary,
			bodyColor: c.bgPrimary,
			cardColor: c.bg,
			popoverColor: c.bg,
			modalColor: c.bg,
			inputColor: c.bg,
			borderColor: c.border,
			dividerColor: c.border,
			textColorBase: c.text,
			textColor1: c.text,
			textColor2: c.textMuted,
			textColor3: c.textFaint,
			fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
			fontFamilyMono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
			borderRadius: '8px',
		},
		Button: {
			colorPrimary: c.primary,
			colorHoverPrimary: c.primaryHover,
			colorPressedPrimary: c.primary,
			textColorPrimary: '#ffffff',
		},
		Card: {
			color: c.bg,
			colorModal: c.bg,
			borderColor: c.border,
		},
		Modal: {
			color: c.bg,
		},
		Input: {
			color: c.bg,
			colorFocus: c.bg,
			borderColor: c.border,
			borderHover: c.primary,
			borderFocus: c.primary,
		},
		Form: {
			labelTextColor: c.textMuted,
		},
		Tabs: {
			tabTextColorLine: c.textMuted,
			tabTextColorActiveLine: c.text,
			tabTextColorHoverLine: c.primary,
			barColor: c.primary,
		},
		Select: {
			peers: {
				InternalSelection: {
					color: c.bg,
					border: `1px solid ${c.border}`,
					borderHover: c.primary,
					borderFocus: c.primary,
					textColor: c.text,
				},
			},
		},
		Progress: {
			fill: c.primary,
		},
		Alert: {
			colorError: theme === 'dark' ? '#f5212d' : '#d03050',
		},
		Checkbox: {
			colorChecked: c.primary,
			borderChecked: c.primary,
		},
		List: {
			color: 'transparent',
		},
		Tree: {
			nodeColor: c.text,
			nodeTextColor: c.text,
		},
		Split: {
			resizeTriggerColor: c.border,
			resizeTriggerColorHover: c.primary,
		},
	};
}

export function useObsidianTheme() {
	const currentTheme = ref<ObsidianTheme>(getObsidianTheme());
	const themeOverrides = computed(() => createThemeOverrides(currentTheme.value));

	let themeObserver: MutationObserver | null = null;

	onMounted(() => {
		themeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.attributeName === 'class') {
					const newTheme = getObsidianTheme();
					if (newTheme !== currentTheme.value) {
						currentTheme.value = newTheme;
					}
				}
			}
		});
		themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	});

	onUnmounted(() => {
		themeObserver?.disconnect();
		themeObserver = null;
	});

	return {
		currentTheme,
		themeOverrides,
	};
}
