import { createApp as createVueApp, type App as VueApp, h, type Component } from 'vue';

let vueApp: VueApp | null = null;

export function createVueAppInstance(component: Component, props: Record<string, any> = {}): VueApp {
	if (vueApp) {
		vueApp.unmount();
	}

	vueApp = createVueApp(component, props);
	return vueApp;
}

export function destroyVueApp(): void {
	if (vueApp) {
		vueApp.unmount();
		vueApp = null;
	}
}

export function renderVueComponent(component: Component, props: Record<string, any> = {}): HTMLElement {
	const container = document.createElement('div');
	container.className = 'sillot-vue-modal-container';

	const app = createVueApp(component, props);
	app.mount(container);

	return container;
}
