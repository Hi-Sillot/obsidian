<template>
  <t-popup v-model:visible="showPopup" placement="bottom" close-on-overlay-click>
    <div style="background: var(--panel-bg, #fff); border-radius: 12px 12px 0 0; padding: 20px;">
      <div style="text-align: center; margin-bottom: 16px;">
        <t-text style="font-size: 16px; font-weight: 500;">检查更新</t-text>
      </div>

      <t-cell title="当前版本">
        <template #description>
          <t-text>{{ currentVersion }}</t-text>
        </template>
      </t-cell>

      <t-cell title="最新版本">
        <template #description>
          <t-space align="center">
            <t-text>{{ latestVersion || '-' }}</t-text>
            <t-tag v-if="result?.hasUpdate" theme="warning" variant="light">有更新</t-tag>
            <t-tag v-else-if="!checking && result" theme="success" variant="light">已是最新</t-tag>
          </t-space>
        </template>
      </t-cell>

      <div v-if="result?.releaseInfo?.body" style="margin-top: 16px;">
        <t-text style="font-size: 12px; color: var(--text-secondary, #666);">更新日志</t-text>
        <div style="max-height: 150px; overflow-y: auto; margin-top: 8px; padding: 12px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px;">
          <t-text style="font-size: 13px; white-space: pre-wrap;">{{ result.releaseInfo.body }}</t-text>
        </div>
      </div>

      <div v-if="result?.error" style="margin-top: 16px;">
        <t-alert theme="error" :title="result.error" />
      </div>

      <div style="margin-top: 20px;">
        <t-button
          v-if="result?.hasUpdate"
          block
          theme="warning"
          @click="openReleasePage"
        >
          查看发布页
        </t-button>
        <t-button
          block
          :loading="checking"
          :disabled="checking"
          @click="checkUpdate"
          style="margin-top: 8px;"
        >
          {{ checking ? '检查中...' : '检查更新' }}
        </t-button>
        <t-button block variant="outline" @click="showPopup = false" style="margin-top: 8px;">
          关闭
        </t-button>
      </div>
    </div>
  </t-popup>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { UpdateCheckResult } from '../../utils/UpdateChecker';

const props = defineProps<{
  currentVersion: string;
  checking: boolean;
  result: UpdateCheckResult | null;
}>();

const emit = defineEmits<{
  (e: 'check'): void;
  (e: 'open-release'): void;
}>();

const showPopup = defineModel<boolean>('show', { default: false });

const latestVersion = computed(() => props.result?.latestVersion || null);

const checkUpdate = () => {
  emit('check');
};

const openReleasePage = () => {
  emit('open-release');
};
</script>
