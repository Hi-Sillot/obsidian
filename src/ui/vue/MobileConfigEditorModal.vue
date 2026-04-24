<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { CloseIcon } from 'tdesign-icons-vue-next';
import { useThemeSync } from './composables/useThemeSync';
import type { ConfigEditorAPI } from '../../ui/MobileConfigEditorModal';
import type { PRCheckPoller } from '../../utils/PRCheckPoller';
import type { GitHubApi } from '../../sync/githubApi';

interface PickerColumn {
  label: string;
  value: string;
}

interface Props {
  api: ConfigEditorAPI;
  pluginName: string;
  openPRCheckModal?: (prNumber: number, branch: string) => void;
  prCheckPoller?: PRCheckPoller;
  gitHubApi?: GitHubApi;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

// 使用统一的主题同步系统
const { isDark } = useThemeSync();

// 视口观察器（用于键盘弹出时调整布局）
let viewportObserver: ResizeObserver | null = null;

// 标签页状态
const activeTab = ref('config');

// 配置编辑器状态
const selectedConfigType = ref('friends');
const configContent = ref('');
const originalConfigContent = ref('');
const currentConfigPath = ref('');
const loading = ref(false);
const validationErrors = ref<string[]>([]);
const showConfigPicker = ref(false);
const configPickerColumns = ref<PickerColumn[]>([
  { label: 'friends.md', value: 'friends' },
  { label: 'README.md', value: 'readme' },
]);

// VuePress 编辑器状态
const vuepressContent = ref('');
const originalVuepressContent = ref('');
const selectedVuepressPath = ref('');
const loadingVuepress = ref(false);
const vuepressErrors = ref<string[]>([]);
const showVuepressPicker = ref(false);
const vuepressPickerColumns = ref<PickerColumn[]>([]);

// 保存相关状态
const createPR = ref(true);
const prAttemptFailed = ref(false);
const saving = ref(false);
const showProgress = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');
const showResult = ref(false);
const resultSuccess = ref(false);
const prUrl = ref('');

const modalTitle = computed(() => `编辑配置文件 - ${props.pluginName}`);

const hasConfigDiff = computed(() => configContent.value !== originalConfigContent.value);
const hasVuepressDiff = computed(() => vuepressContent.value !== originalVuepressContent.value);

const canSave = computed(() => {
  const hasDiff = activeTab.value === 'config' ? hasConfigDiff.value : hasVuepressDiff.value;
  if (!hasDiff) return false;

  if (activeTab.value === 'config') {
    return configContent.value.trim().length > 0 && validationErrors.value.length === 0;
  }
  return vuepressContent.value.trim().length > 0 && vuepressErrors.value.length === 0;
});

watch([hasConfigDiff, hasVuepressDiff], ([configNew, vueNew], [configOld, vueOld]) => {
  if ((configNew && !configOld) || (vueNew && !vueOld)) {
    prAttemptFailed.value = false;
  }
});

watch([showResult, resultSuccess], ([show, success]) => {
  if (show && success) {
    setTimeout(() => { showResult.value = false; }, 1500);
  }
});

const setupViewportObserver = () => {
  const editorEl = document.querySelector('.mobile-config-editor-wrapper');
  if (!editorEl || !window.visualViewport) return;

  viewportObserver = new ResizeObserver(() => {
    const vv = window.visualViewport!;
    const offsetBottom = window.innerHeight - vv.height - vv.offsetTop;
    (editorEl as HTMLElement).style.setProperty('--keyboard-offset', offsetBottom > 0 ? `${offsetBottom}px` : '0px');
  });
  viewportObserver.observe(document.body);
};

// 辅助函数
const getConfigTitle = (type: string) => {
  const option = configPickerColumns.value.find(o => o.value === type);
  return option?.label ?? type;
};

const getVuepressFileName = (path: string) => path?.split('/').pop() ?? path ?? '';

// 数据加载
const loadConfig = async () => {
  loading.value = true;
  validationErrors.value = [];

  try {
    const content = await props.api.fetchConfig(selectedConfigType.value as any);
    configContent.value = content ?? '';
    originalConfigContent.value = content ?? '';
    const validation = props.api.validateConfig(selectedConfigType.value as any, configContent.value);
    validationErrors.value = validation.errors;
  } catch (error: any) {
    validationErrors.value = [error.message];
  } finally {
    loading.value = false;
  }
};

const loadVuepressConfig = async () => {
  loadingVuepress.value = true;
  vuepressErrors.value = [];

  try {
    if (!selectedVuepressPath.value) {
      vuepressErrors.value = ['未选择文件'];
      return;
    }
    const content = await props.api.fetchFileContent(selectedVuepressPath.value);
    vuepressContent.value = content ?? '';
    originalVuepressContent.value = content ?? '';
  } catch (error: any) {
    vuepressErrors.value = [error.message];
  } finally {
    loadingVuepress.value = false;
  }
};

const init = async () => {
  loading.value = true;
  try {
    selectedConfigType.value = 'friends';
    currentConfigPath.value = props.api.getConfigPath('friends');

    try {
      const vuepressFiles = await props.api.fetchVuePressFiles();
      vuepressPickerColumns.value = vuepressFiles
        .filter(f => f.type === 'file')
        .map(f => ({ label: f.name, value: f.path }));
    } catch (e) {
      console.error('[MobileConfigEditor] fetchVuePressFiles error:', e);
    }

    if (vuepressPickerColumns.value.length > 0) {
      selectedVuepressPath.value = vuepressPickerColumns.value[0].value;
    }

    await loadConfig();
    await loadVuepressConfig();
  } catch (error) {
    console.error('[MobileConfigEditor] 初始化失败:', error);
  } finally {
    loading.value = false;
  }
};

// 事件处理
const openVuepressPicker = () => {
  if (vuepressPickerColumns.value.length > 0) {
    showVuepressPicker.value = true;
  }
};

const onVuepressPickerConfirm = async (value: string[]) => {
  const selectedValue = value[0];
  if (selectedValue) {
    selectedVuepressPath.value = selectedValue;
    showVuepressPicker.value = false;
    await loadVuepressConfig();
  }
};

const onConfigPickerConfirm = async (value: string[]) => {
  const selectedValue = value[0];
  if (selectedValue) {
    selectedConfigType.value = selectedValue;
    currentConfigPath.value = props.api.getConfigPath(selectedValue as any);
    showConfigPicker.value = false;
    await loadConfig();
  }
};

const handleClose = () => emit('close');

const handleSaveResult = (result: any, isVuepress: boolean) => {
  showProgress.value = false;

  if (result.success) {
    resultSuccess.value = true;
    prUrl.value = result.prUrl ?? '';
    prAttemptFailed.value = false;

    if (isVuepress) {
      originalVuepressContent.value = vuepressContent.value;
    } else {
      originalConfigContent.value = configContent.value;
    }

    if (result.prNumber && result.branch && props.prCheckPoller && props.openPRCheckModal) {
      props.prCheckPoller.startPolling(
        String(result.prNumber),
        {
          prNumber: result.prNumber,
          branch: result.branch,
          headSha: result.commitSha ?? '',
          filePath: '',
          startedAt: Date.now(),
        },
        () => props.gitHubApi!,
      );
      props.openPRCheckModal(result.prNumber, result.branch);
    }
  } else {
    resultSuccess.value = false;
    prAttemptFailed.value = createPR.value;
    const errors = [result.error ?? '保存失败'];
    if (isVuepress) {
      vuepressErrors.value = errors;
    } else {
      validationErrors.value = errors;
    }
  }

  showResult.value = true;
};

const handleSave = async () => {
  saving.value = true;
  showProgress.value = true;
  progressPercent.value = 0;
  progressMessage.value = '准备保存...';

  try {
    const isVuepress = activeTab.value !== 'config';
    const content = isVuepress ? vuepressContent.value : configContent.value;
    const type = isVuepress ? 'vuepress' : selectedConfigType.value as any;

    const validation = props.api.validateConfig(type, content);
    if (!validation.valid) {
      if (isVuepress) {
        vuepressErrors.value = validation.errors;
      } else {
        validationErrors.value = validation.errors;
      }
      return;
    }

    const updateFn = isVuepress
      ? () => props.api.updateVuePressFile(selectedVuepressPath.value, content, {
          createPR: createPR.value,
          commitMessage: `更新 .vuepress 配置 via Sillot`,
          onProgress: (percent: number, msg: string) => {
            progressPercent.value = percent;
            progressMessage.value = msg;
          },
        })
      : () => props.api.updateConfig(type, content, {
          createPR: createPR.value,
          commitMessage: `更新配置文件 via Sillot`,
          onProgress: (percent: number, msg: string) => {
            progressPercent.value = percent;
            progressMessage.value = msg;
          },
        });

    const result = await updateFn();
    handleSaveResult(result, isVuepress);
  } catch (error: any) {
    handleSaveResult({ success: false, error: error.message }, activeTab.value !== 'config');
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  setupViewportObserver();
  init();
});

onUnmounted(() => {
  viewportObserver?.disconnect();
});
</script>

<template>
  <div class="mobile-config-editor-wrapper" :class="{ 'is-dark': isDark }">
    <div class="editor-overlay" @click.self="handleClose">
      <div class="editor-panel">
        <div class="panel-header">
          <span class="panel-title">{{ modalTitle }}</span>
          <t-button variant="text" size="small" class="close-btn" @click="handleClose">
            <CloseIcon />
          </t-button>
        </div>

        <t-tabs v-model="activeTab" :line-width="30" class="editor-tabs">
          <t-tab-panel value="config" label="配置文件">
            <div class="tab-content">
              <div class="picker-trigger" @click="showConfigPicker = true">
                <span class="picker-value">{{ getConfigTitle(selectedConfigType) }}</span>
                <span class="picker-arrow">▼</span>
              </div>

              <div class="file-path">文件路径: {{ currentConfigPath }}</div>

              <t-textarea
                v-model="configContent"
                placeholder="配置内容"
                :autosize="{ minRows: 6, maxRows: 13 }"
                :disabled="loading"
                class="config-textarea"
              />

              <t-loading v-if="loading" size="small" class="loading-indicator" />

              <div v-if="validationErrors.length > 0" class="error-list">
                <div v-for="(err, idx) in validationErrors" :key="idx" class="error-item">{{ err }}</div>
              </div>
            </div>
          </t-tab-panel>

          <t-tab-panel value="vuepress" label=".vuepress">
            <div class="tab-content">
              <div class="picker-trigger" @click="openVuepressPicker">
                <span class="picker-value">{{ getVuepressFileName(selectedVuepressPath) || '选择文件' }}</span>
                <span class="picker-arrow">▼</span>
              </div>

              <div class="file-path">文件路径: {{ selectedVuepressPath }}</div>

              <t-textarea
                v-model="vuepressContent"
                placeholder=".vuepress 配置内容"
                :autosize="{ minRows: 6, maxRows: 20 }"
                :disabled="loadingVuepress"
                class="config-textarea"
              />

              <t-loading v-if="loadingVuepress" size="small" class="loading-indicator" />

              <div v-if="vuepressErrors.length > 0" class="error-list">
                <div v-for="(err, idx) in vuepressErrors" :key="idx" class="error-item">{{ err }}</div>
              </div>
            </div>
          </t-tab-panel>
        </t-tabs>

        <div class="panel-footer">
          <t-checkbox v-model="createPR" class="pr-checkbox">
            创建 Pull Request
          </t-checkbox>
          <div class="footer-actions">
            <t-button variant="outline" class="action-btn" @click="handleClose">
              取消
            </t-button>
            <t-button
              :disabled="!canSave || saving"
              :loading="saving"
              class="action-btn save-btn"
              @click="handleSave"
            >
              保存
            </t-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 选择器弹窗 -->
    <t-popup v-if="showConfigPicker" v-model:visible="showConfigPicker" placement="bottom" close-on-overlay-click>
      <t-picker
        v-if="configPickerColumns.length > 0"
        :columns="configPickerColumns"
        @confirm="onConfigPickerConfirm"
        @cancel="showConfigPicker = false"
      />
    </t-popup>

    <t-popup v-if="showVuepressPicker" v-model:visible="showVuepressPicker" placement="bottom" close-on-overlay-click>
      <t-picker
        v-if="vuepressPickerColumns.length > 0"
        :columns="vuepressPickerColumns"
        @confirm="onVuepressPickerConfirm"
        @cancel="showVuepressPicker = false"
      />
      <div v-else class="empty-picker">
        <t-empty description="暂无可选配置文件" />
      </div>
    </t-popup>

    <!-- 进度弹窗 -->
    <t-popup v-model:visible="showProgress" placement="center" close-on-click-overlay>
      <div class="progress-popup">
        <h4 class="progress-title">保存中...</h4>
        <t-progress :percentage="progressPercent" class="progress-bar" />
        <t-text class="progress-message">{{ progressMessage }}</t-text>
      </div>
    </t-popup>

    <!-- 结果弹窗 -->
    <t-popup v-model:visible="showResult" placement="center" close-on-click-overlay>
      <div class="result-popup">
        <t-result
          :theme="resultSuccess ? 'success' : 'error'"
          :title="resultSuccess ? (createPR ? 'PR 创建成功' : '保存成功') : '保存失败'"
        >
          <template #extra>
            <t-button v-if="resultSuccess && prUrl" tag="a" :href="prUrl" target="_blank" variant="primary" size="small">
              查看 PR
            </t-button>
            <t-button size="small" @click="showResult = false">关闭</t-button>
          </template>
        </t-result>
      </div>
    </t-popup>
  </div>
</template>

<style>
.mobile-config-editor-wrapper {
  --panel-bg: #ffffff;
  --bg-secondary: #f5f5f5;
  --border-color: #e0e0e0;
  --text-primary: #333333;
  --text-placeholder: #999999;
  --keyboard-offset: 0px;

  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  padding-bottom: var(--keyboard-offset);
}

.mobile-config-editor-wrapper.is-dark {
  --panel-bg: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --border-color: #3a3a3a;
  --text-primary: #cdd6f4;
  --text-placeholder: #6c7086;
}

.editor-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
}

.editor-panel {
  position: relative;
  width: 100%;
  background: var(--panel-bg);
  border-radius: 16px 16px 0 0;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  padding: 4px;
}

.editor-tabs {
  --td-tab-nav-bg-color: transparent;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.picker-trigger {
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.picker-value {
  color: var(--text-primary);
}

.picker-arrow {
  color: var(--text-placeholder);
}

.file-path {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-placeholder);
}

.config-textarea {
  font-family: Monaco, Menlo, monospace;
  font-size: 13px;
}

.loading-indicator {
  text-align: center;
  padding: 12px;
}

.error-list {
  margin-top: 12px;
  color: #e34a4a;
  font-size: 12px;
}

.error-item {
  margin: 4px 0;
}

.panel-footer {
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  gap: 12px;
  border-top: 1px solid var(--border-color);
}

.pr-checkbox {
  display: flex;
  align-items: center;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  flex: 1;
}

.save-btn {
  background: #1966ff;
  border-color: #1966ff;
  color: #fff;
}

.empty-picker {
  padding: 24px;
  text-align: center;
  background: var(--panel-bg);
}

.progress-popup,
.result-popup {
  width: 80vw;
  max-width: 300px;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

.progress-title {
  margin: 0 0 16px;
  color: var(--text-primary);
}

.progress-bar {
  margin-bottom: 12px;
}

.progress-message {
  font-size: 12px;
  color: var(--text-placeholder);
}
</style>
