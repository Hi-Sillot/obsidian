// setting-tab.ts
import { App, PluginSettingTab } from "obsidian";
import VueSamplePlugin from "./main";
import { createApp, App as VueApp } from "vue"; // 引入 VueApp 类型
import MySettingTab from './components/SettingTab.vue'

export class VueSamplePluginSettingTab extends PluginSettingTab {
    plugin: VueSamplePlugin;
    private vueApp: VueApp | null = null; // 新增：保存 Vue 实例引用

    constructor(app: App, plugin: VueSamplePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        // 新增：确保销毁之前的实例
        if (this.vueApp) {
            this.vueApp.unmount();
            this.vueApp = null;
        }

        // 挂载新实例
        this.vueApp = createApp(MySettingTab);
        this.vueApp.mount(containerEl);
    }

    // 新增：Obsidian 提供的卸载生命周期
    hide() {
        // 销毁 Vue 实例
        if (this.vueApp) {
            this.vueApp.unmount();
            this.vueApp = null;
        }
        // 清空 DOM
        this.containerEl.empty();
    }
}
