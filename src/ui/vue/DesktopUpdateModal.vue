<script setup lang="ts">
import { computed } from 'vue';
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

const showModal = defineModel<boolean>('show', { default: false });

const latestVersion = computed(() => props.result?.latestVersion ?? null);

const modalTitle = computed(() => {
  if (props.checking) return '检查更新...';
  if (props.result?.hasUpdate) return `发现新版本 ${props.result.latestVersion}`;
  return '检查更新';
});

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
    'empty-repo': '⚠️ 配置问题',
    'not-found': '🔍 未找到',
    'network': '🌐 网络异常',
    'rate-limit': '⏳ 频率限制',
    'auth-failed': '🔐 认证失败',
    'unknown': '❌ 检查失败'
  };
  
  const prefix = errorType.value ? `${messages[errorType.value]} - ` : '';
  return `${prefix}${props.result.error}`;
});

const checkUpdate = () => emit('check');
const openReleasePage = () => emit('open-release');
</script>

<template>
  <n-modal v-model:show="showModal" preset="card" :title="modalTitle" class="update-modal">
    <n-space vertical size="large">
      <!-- 当前版本 -->
      <n-space vertical>
        <n-text depth="3">当前版本</n-text>
        <n-text strong>{{ currentVersion }}</n-text>
      </n-space>

      <n-divider />

      <!-- 最新版本 -->
      <n-space vertical>
        <n-text depth="3">最新版本</n-text>
        <n-space align="center">
          <n-text strong>{{ latestVersion ?? '-' }}</n-text>
          <n-tag v-if="updateStatus === 'has-update'" type="warning" size="small">有更新</n-tag>
          <n-tag v-else-if="updateStatus === 'latest'" type="success" size="small">已是最新</n-tag>
        </n-space>
      </n-space>

      <n-space v-if="result?.releaseInfo?.body" vertical>
        <n-text depth="3">更新日志</n-text>
        <n-scrollbar class="release-scroll" autoresize>
          <n-text class="release-body">{{ result.releaseInfo.body }}</n-text>
        </n-scrollbar>
      </n-space>

      <!-- 错误信息区域：带详细描述和操作按钮 -->
      <n-space v-if="result?.error" vertical class="error-section">
        <n-alert type="error" :title="getErrorMessage">
          <template v-if="errorDetail" #default>
            <n-text depth="3">{{ errorDetail }}</n-text>
          </template>
        </n-alert>
      </n-space>

      <n-space justify="end">
        <n-button @click="showModal = false">关闭</n-button>
        <n-button 
          type="primary" 
          :loading="checking"
          @click="checkUpdate"
        >
          {{ checking ? '检查中...' : '检查更新' }}
        </n-button>
        <n-button
          v-if="updateStatus === 'has-update'"
          type="warning"
          @click="openReleasePage"
        >
          查看发布页
        </n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<style scoped>
.update-modal {
  width: 400px;
  max-width: 90vw;
}

.release-scroll {
  max-height: 200px;
}

.release-body {
  white-space: pre-wrap;
  font-size: 13px;
}

.error-section {
  margin-top: 4px;
}
</style>
