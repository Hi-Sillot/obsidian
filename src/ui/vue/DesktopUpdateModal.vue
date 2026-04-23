<template>
  <n-modal v-model:show="showModal" preset="card" :title="modalTitle" style="width: 400px; max-width: 90vw;">
    <n-space vertical size="large">
      <n-space vertical>
        <n-text depth="3">当前版本</n-text>
        <n-text strong>{{ currentVersion }}</n-text>
      </n-space>

      <n-divider />

      <n-space vertical>
        <n-text depth="3">最新版本</n-text>
        <n-space align="center">
          <n-text strong>{{ latestVersion || '-' }}</n-text>
          <n-tag v-if="result?.hasUpdate" type="warning" size="small">有更新</n-tag>
          <n-tag v-else-if="!checking && result" type="success" size="small">已是最新</n-tag>
        </n-space>
      </n-space>

      <n-space v-if="result?.releaseInfo?.body" vertical>
        <n-text depth="3">更新日志</n-text>
        <n-scrollbar style="max-height: 200px;" autoresize>
          <n-text style="white-space: pre-wrap; font-size: 13px;">{{ result.releaseInfo.body }}</n-text>
        </n-scrollbar>
      </n-space>

      <n-space v-if="result?.error" vertical>
        <n-alert type="error" :title="result.error" />
      </n-space>

      <n-space justify="end">
        <n-button @click="showModal = false">关闭</n-button>
        <n-button type="primary" :loading="checking" @click="checkUpdate">
          {{ checking ? '检查中...' : '检查更新' }}
        </n-button>
        <n-button
          v-if="result?.hasUpdate"
          type="warning"
          @click="openReleasePage"
        >
          查看发布页
        </n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { UpdateCheckResult } from '../../utils/UpdateChecker';

const props = defineProps<{
  currentVersion: string;
  updateRepo: string;
  checking: boolean;
  result: UpdateCheckResult | null;
}>();

const emit = defineEmits<{
  (e: 'check'): void;
  (e: 'open-release'): void;
}>();

const showModal = defineModel<boolean>('show', { default: false });

const modalTitle = computed(() => {
  if (props.checking) return '检查更新...';
  if (props.result?.hasUpdate) return `发现新版本 ${props.result.latestVersion}`;
  return '检查更新';
});

const latestVersion = computed(() => props.result?.latestVersion || null);

const checkUpdate = () => {
  emit('check');
};

const openReleasePage = () => {
  emit('open-release');
};
</script>
