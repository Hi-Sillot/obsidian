<script setup lang="ts">
import { computed } from 'vue';
import { useThemeSync } from './composables/useThemeSync';
import type { UpdateCheckResult, UpdateErrorType } from '../../utils/UpdateChecker';

interface Props {
  currentVersion: string;
  updateRepo: string;
  checking: boolean;
  result: UpdateCheckResult | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  check: [];
  'open-release': [];
}>();

const showPopup = defineModel<boolean>('show', { default: false });

// 同步 Obsidian 和 TDesign 的暗黑模式
const { isDark } = useThemeSync();

const latestVersion = computed(() => props.result?.latestVersion ?? null);

const updateStatus = computed(() => {
  if (props.checking) return 'checking';
  if (!props.result) return 'idle';
  if (props.result.hasUpdate) return 'has-update';
  return 'latest';
});

const errorType = computed<UpdateErrorType | undefined>(() => props.result?.errorType);
const errorDetail = computed(() => props.result?.errorDetail ?? '');

const getErrorMessage = computed(() => {
  if (!props.result?.error) return '';

  const messages: Record<UpdateErrorType, string> = {
    'empty-repo': '配置问题',
    'not-found': '未找到',
    'network': '网络异常',
    'rate-limit': '频率限制',
    'auth-failed': '认证失败',
    'unknown': '检查失败'
  };

  return errorType.value ? `${messages[errorType.value]}: ${props.result.error}` : props.result.error;
});

const checkUpdate = () => emit('check');
const openReleasePage = () => emit('open-release');
</script>

<template>
  <t-popup v-model:visible="showPopup" placement="bottom" close-on-overlay-click>
    <div class="update-popup">
      <div class="popup-header">
        <t-text class="popup-title">检查更新</t-text>
      </div>

      <!-- 版本信息：始终显示 -->
      <t-cell title="当前版本">
        <template #description>
          <t-text>{{ currentVersion }}</t-text>
        </template>
      </t-cell>

      <t-cell title="最新版本">
        <template #description>
          <t-space align="center">
            <t-text>{{ latestVersion ?? '-' }}</t-text>
            <t-tag v-if="updateStatus === 'has-update'" theme="warning" variant="light">有更新</t-tag>
            <t-tag v-else-if="updateStatus === 'latest'" theme="success" variant="light">已是最新</t-tag>
          </t-space>
        </template>
      </t-cell>

      <div v-if="result?.releaseInfo?.body" class="release-notes">
        <t-text class="release-notes-label">更新日志</t-text>
        <div class="release-notes-content">
          <t-text class="release-notes-body">{{ result.releaseInfo.body }}</t-text>
        </div>
      </div>

      <!-- 错误信息区域 -->
      <div v-if="result?.error" class="error-alert">
        <div class="error-alert-content">
          <div class="error-alert-title">{{ getErrorMessage }}</div>
          <div v-if="errorDetail" class="error-alert-detail">{{ errorDetail }}</div>
        </div>
      </div>

      <div class="popup-actions">
        <t-button
          v-if="updateStatus === 'has-update'"
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
          class="action-btn"
          @click="checkUpdate"
        >
          {{ checking ? '检查中...' : '检查更新' }}
        </t-button>
        <t-button block variant="outline" class="action-btn" @click="showPopup = false">
          关闭
        </t-button>
      </div>
    </div>
  </t-popup>
</template>

<style scoped>
.update-popup {
  background: var(--panel-bg, #fff);
  border-radius: 12px 12px 0 0;
  padding: 20px;
}

.popup-header {
  text-align: center;
  margin-bottom: 16px;
}

.popup-title {
  font-size: 16px;
  font-weight: 500;
}

.release-notes {
  margin-top: 16px;
}

.release-notes-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.release-notes-content {
  max-height: 150px;
  overflow-y: auto;
  margin-top: 8px;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
}

.release-notes-body {
  font-size: 13px;
  white-space: pre-wrap;
}

.error-alert {
  margin-top: 16px;
}

.error-alert-content {
  padding: 12px;
  background: linear-gradient(135deg, #fff2f0 0%, #ffedeb 100%);
  border: 1px solid #ffccc7;
  border-radius: 8px;
  border-left: 4px solid #ff4d4f;
}

.error-alert-title {
  font-size: 14px;
  font-weight: 500;
  color: #cf1322;
  margin-bottom: 4px;
}

.error-alert-detail {
  font-size: 13px;
  line-height: 1.5;
  color: #a8071a;
}

.popup-actions {
  margin-top: 20px;
}

.action-btn {
  margin-top: 8px;
}
</style>
