import { createApp as createVueApp, type App as VueApp, type Component } from 'vue';
import { setupTDesignMobile } from './tdesign-mobile-helper';
import { useDeviceDetection } from './useDeviceDetection';

let vueApp: VueApp | null = null;

export function createVueAppInstance(component: Component, props: Record<string, any> = {}): VueApp {
	if (vueApp) {
		vueApp.unmount();
	}

	vueApp = createVueApp(component, props);
	setupTDesignMobile(vueApp);
	return vueApp;
}

export function destroyVueApp(): void {
	if (vueApp) {
		vueApp.unmount();
		vueApp = null;
	}
}

export function unmountVueComponent(container: HTMLElement): void {
	if (vueApp) {
		vueApp.unmount();
		vueApp = null;
	}
}

export function renderVueComponent(component: Component, props: Record<string, any> = {}, container?: HTMLElement): HTMLElement {
	if (container) {
		const app = createVueApp(component, props);
		setupTDesignMobile(app);
		app.mount(container);
		return container;
	}

	console.log('[renderVueComponent] Creating container');
	const newContainer = document.createElement('div');
	newContainer.className = 'sillot-vue-modal-container';

	console.log('[renderVueComponent] Creating Vue app');
	const app = createVueApp(component, props);
	setupTDesignMobile(app);
	console.log('[renderVueComponent] Mounting app');
	app.mount(newContainer);
	console.log('[renderVueComponent] Mounted, innerHTML:', newContainer.innerHTML.substring(0, 300));

	vueApp = app;
	return newContainer;
}

export { useDeviceDetection };
