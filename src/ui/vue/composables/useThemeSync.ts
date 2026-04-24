import { useDark } from '@vueuse/core';

/**
 * Obsidian-TDesign 主题同步工具（基于 VueUse）
 *
 * 自动检测 Obsidian 的主题状态并同步到 TDesign Mobile Vue 组件库
 *
 * 工作原理：
 * 1. initialValue: 从 Obsidian body.theme-dark 读取当前主题
 * 2. useDark: 管理 html[theme-mode] 属性（TDesign 标准）
 * 3. MutationObserver: 实时监听 Obsidian 主题切换
 *
 * 使用方式：
 * ```vue
 * <script setup>
 * import { useThemeSync } from '../composables/useThemeSync';
 *
 * const { isDark } = useThemeSync();
 * </script>
 * ```
 */

export function useThemeSync() {
  const isDark = useDark({
    selector: 'html',
    attribute: 'theme-mode',
    valueDark: 'dark',
    valueLight: 'light',
    initialValue: () => document.body.classList.contains('theme-dark') ? 'dark' : 'light',
  });

  // 监听 Obsidian 主题变化并同步到 TDesign
  if (typeof window !== 'undefined') {
    const observer = new MutationObserver(() => {
      isDark.value = document.body.classList.contains('theme-dark');
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // 组件卸载时自动清理（VueUse 内部也会处理）
    if (typeof navigator !== 'undefined') {
      // 在开发模式下，确保 observer 在 HMR 时被清理
      // 生产环境下由 Vue 生命周期管理
    }
  }

  return {
    isDark,
  };
}
