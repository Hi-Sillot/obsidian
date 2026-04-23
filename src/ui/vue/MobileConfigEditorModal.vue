<template>
  <div class="mobile-config-editor-wrapper" :class="{ 'is-dark': isDark }" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999;">
    <div class="editor-overlay" @click.self="handleClose" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end;">
      <div class="editor-panel" style="position: relative; width: 100%; background: var(--panel-bg, #fff); border-radius: 16px 16px 0 0; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;">
        <div class="panel-header" style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border-color, #e0e0e0);">
          <span style="font-size: 18px; font-weight: 600; color: var(--text-primary, #333);">{{ modalTitle }}</span>
          <t-button variant="text" size="small" @click="handleClose" style="padding: 4px;">
            <CloseIcon />
          </t-button>
        </div>

        <t-tabs v-model="activeTab" :line-width="30" style="--td-tab-nav-bg-color: transparent; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
          <t-tab-panel value="config" label="配置文件">
            <div class="tab-content" style="flex: 1; overflow-y: auto; padding: 16px 20px;">
              <div
                style="padding: 12px 16px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;"
                @click="showConfigPicker = true"
              >
                <span style="color: var(--text-primary, #333);">{{ getConfigTitle(selectedConfigType) }}</span>
                <span style="color: var(--text-placeholder, #999);">▼</span>
              </div>

              <div style="margin-bottom: 12px; font-size: 12px; color: var(--text-placeholder, #999);">
                文件路径: {{ currentConfigPath }}
              </div>

              <t-textarea
                v-model="configContent"
                placeholder="配置内容"
                :autosize="{ minRows: 6, maxRows: 13 }"
                :disabled="loading"
                style="font-family: Monaco, Menlo, monospace; font-size: 13px;"
              />

              <t-loading v-if="loading" size="small" style="text-align: center; padding: 12px;" />

              <div v-if="validationErrors.length > 0" style="margin-top: 12px; color: #e34a4a; font-size: 12px;">
                <div v-for="(err, idx) in validationErrors" :key="idx" style="margin: 4px 0;">{{ err }}</div>
              </div>
            </div>
          </t-tab-panel>

          <t-tab-panel value="vuepress" label=".vuepress">
            <div class="tab-content" style="flex: 1; overflow-y: auto; padding: 16px 20px;">
              <div
                style="padding: 12px 16px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;"
                @click="openVuepressPicker"
              >
                <span style="color: var(--text-primary, #333);">{{ getVuepressFileName(selectedVuepressPath) || '选择文件' }}</span>
                <span style="color: var(--text-placeholder, #999);">▼</span>
              </div>

              <div style="margin-bottom: 12px; font-size: 12px; color: var(--text-placeholder, #999);">
                文件路径: {{ selectedVuepressPath }}
              </div>

              <t-textarea
                v-model="vuepressContent"
                placeholder=".vuepress 配置内容"
                :autosize="{ minRows: 6, maxRows: 20 }"
                :disabled="loadingVuepress"
                style="font-family: Monaco, Menlo, monospace; font-size: 13px;"
              />

              <t-loading v-if="loadingVuepress" size="small" style="text-align: center; padding: 12px;" />

              <div v-if="vuepressErrors.length > 0" style="margin-top: 12px; color: #e34a4a; font-size: 12px;">
                <div v-for="(err, idx) in vuepressErrors" :key="idx" style="margin: 4px 0;">{{ err }}</div>
              </div>
            </div>
          </t-tab-panel>
        </t-tabs>

        <div class="panel-footer" style="display: flex; flex-direction: column; padding: 16px 20px; gap: 12px; border-top: 1px solid var(--border-color, #e0e0e0);">
          <t-checkbox v-model="createPR" style="display: flex; align-items: center;">
            创建 Pull Request
          </t-checkbox>
          <div style="display: flex; gap: 12px;">
            <t-button @click="handleClose" variant="outline" style="flex: 1;">
              取消
            </t-button>
            <t-button
              @click="handleSave"
              :disabled="!canSave || saving"
              :loading="saving"
              style="flex: 1; background: #1966ff; border-color: #1966ff; color: #fff;"
            >
              保存
            </t-button>
          </div>
        </div>
      </div>
    </div>

    <t-popup
      v-if="showConfigPicker"
      v-model:visible="showConfigPicker"
      placement="bottom"
      :close-on-overlay-click="true"
    >
      <t-picker
        v-if="configPickerColumns.length > 0"
        :columns="configPickerColumns"
        @confirm="onConfigPickerConfirm"
        @cancel="showConfigPicker = false"
      />
    </t-popup>

    <t-popup
      v-if="showVuepressPicker"
      v-model:visible="showVuepressPicker"
      placement="bottom"
      :close-on-overlay-click="true"
    >
      <t-picker
        v-if="vuepressPickerColumns.length > 0"
        :columns="vuepressPickerColumns"
        @confirm="onVuepressPickerConfirm"
        @cancel="showVuepressPicker = false"
      />
      <div v-else style="padding: 24px; text-align: center; background: var(--panel-bg, #fff);">
        <t-empty description="暂无可选配置文件" />
      </div>
    </t-popup>

    <t-popup v-model:visible="showProgress" placement="center" close-on-click-overlay>
      <div style="width: 80vw; max-width: 300px; background: var(--panel-bg, #fff); border-radius: 12px; padding: 24px; text-align: center;">
        <h4 style="margin: 0 0 16px; color: var(--text-primary, #333);">保存中...</h4>
        <t-progress :percentage="progressPercent" style="margin-bottom: 12px;" />
        <t-text style="font-size: 12px; color: var(--text-placeholder, #999);">{{ progressMessage }}</t-text>
      </div>
    </t-popup>

    <t-popup v-model:visible="showResult" placement="center" close-on-click-overlay>
      <div style="width: 80vw; max-width: 300px; background: var(--panel-bg, #fff); border-radius: 12px; padding: 24px; text-align: center;">
        <t-result
          :theme="resultSuccess ? 'success' : 'error'"
          :title="resultSuccess ? (createPR ? 'PR 创建成功' : '保存成功') : '保存失败'"
        >
          <template #extra>
            <t-button v-if="resultSuccess && prUrl" tag="a" :href="prUrl" target="_blank" variant="primary" size="small">
              查看 PR
            </t-button>
            <t-button @click="showResult = false" size="small" style="margin-left: 8px;">
              关闭
            </t-button>
          </template>
        </t-result>
      </div>
    </t-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { CloseIcon } from 'tdesign-icons-vue-next';
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
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const isDark = ref(false);
const activeTab = ref('config');
const selectedConfigType = ref('friends');
const configContent = ref('');
const originalConfigContent = ref('');
const currentConfigPath = ref('');
const loading = ref(false);
const validationErrors = ref<string[]>([]);

const vuepressContent = ref('');
const originalVuepressContent = ref('');
const vuepressPath = ref('');
const selectedVuepressPath = ref('');
const loadingVuepress = ref(false);
const vuepressErrors = ref<string[]>([]);
const showVuepressPicker = ref(false);
const vuepressPickerColumns = ref<PickerColumn[]>([]);

const createPR = ref(true);
const prAttemptFailed = ref(false);
const saving = ref(false);
const showProgress = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');
const showResult = ref(false);
const resultSuccess = ref(false);
const prUrl = ref('');
const showConfigPicker = ref(false);
const configPickerColumns = ref<PickerColumn[]>([]);

const modalTitle = computed(() => `编辑配置文件 - ${props.pluginName}`);

const hasConfigDiff = computed(() => {
  void activeTab.value;
  return configContent.value !== originalConfigContent.value;
});
const hasVuepressDiff = computed(() => {
  void activeTab.value;
  return vuepressContent.value !== originalVuepressContent.value;
});

watch(hasConfigDiff, (newVal, oldVal) => {
  if (newVal && !oldVal) {
    prAttemptFailed.value = false;
  }
});

watch(hasVuepressDiff, (newVal, oldVal) => {
  if (newVal && !oldVal) {
    prAttemptFailed.value = false;
  }
});

watch([showResult, resultSuccess], ([show, success]) => {
  if (show && success) {
    setTimeout(() => {
      showResult.value = false;
    }, 1500);
  }
});

const canSave = computed(() => {
  const hasDiff = activeTab.value === 'config'
    ? configContent.value !== originalConfigContent.value
    : vuepressContent.value !== originalVuepressContent.value;
  if (!hasDiff) return false;
  const hasContent = activeTab.value === 'config'
    ? configContent.value.trim().length > 0 && validationErrors.value.length === 0
    : vuepressContent.value.trim().length > 0 && vuepressErrors.value.length === 0;
  return hasContent;
});

let themeObserver: MutationObserver | null = null;
let viewportObserver: ResizeObserver | null = null;

const detectTheme = () => {
  isDark.value = document.body.classList.contains('theme-dark');
};

const applyThemeVariables = (dark: boolean) => {
  const root = document.documentElement;

  if (dark) {
    document.documentElement.setAttribute('theme-mode', 'dark');
    root.style.setProperty('--panel-bg', '#1a1a1a');
    root.style.setProperty('--bg-secondary', '#2d2d2d');
    root.style.setProperty('--border-color', '#3a3a3a');
    root.style.setProperty('--text-primary', '#cdd6f4');
    root.style.setProperty('--text-placeholder', '#6c7086');
    root.style.setProperty('--td-popup-bg-color', '#1a1a1a');
    root.style.setProperty('--td-picker-bg-color', '#1a1a1a');
    root.style.setProperty('--td-picker-mask-color-bottom', 'rgba(26, 26, 26, 0.4)');
    root.style.setProperty('--td-picker-mask-color-top', 'rgba(26, 26, 26, 0.92)');
  } else {
    document.documentElement.removeAttribute('theme-mode');
    root.style.setProperty('--panel-bg', '#ffffff');
    root.style.setProperty('--bg-secondary', '#f5f5f5');
    root.style.setProperty('--border-color', '#e0e0e0');
    root.style.setProperty('--text-primary', '#333333');
    root.style.setProperty('--text-placeholder', '#999999');
    root.style.setProperty('--td-popup-bg-color', '#ffffff');
    root.style.setProperty('--td-picker-bg-color', '#ffffff');
    root.style.setProperty('--td-picker-mask-color-bottom', 'hsla(0, 0%, 100%, 0.4)');
    root.style.setProperty('--td-picker-mask-color-top', 'hsla(0, 0%, 100%, 0.92)');
  }
};

const setupThemeObserver = () => {
  detectTheme();
  applyThemeVariables(isDark.value);
  themeObserver = new MutationObserver(() => {
    detectTheme();
    applyThemeVariables(isDark.value);
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
};

const setupViewportObserver = () => {
  const editorEl = document.querySelector('.mobile-config-editor-wrapper');
  if (!editorEl) return;
  
  viewportObserver = new ResizeObserver(() => {
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      const offsetBottom = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
      if (offsetBottom > 0) {
        (editorEl as HTMLElement).style.setProperty('--keyboard-offset', `${offsetBottom}px`);
      } else {
        (editorEl as HTMLElement).style.setProperty('--keyboard-offset', '0px');
      }
    }
  });
  
  if (window.visualViewport) {
    viewportObserver.observe(document.body);
  }
};

const getConfigTitle = (type: string) => {
  const option = configPickerColumns.value.find(o => o.value === type);
  return option ? option.label : type;
};

const getVuepressFileName = (path: string) => {
  if (!path) return '';
  return path.split('/').pop() || path;
};

const init = async () => {
  loading.value = true;
  try {
    configPickerColumns.value = [
      { label: 'friends.md', value: 'friends' },
      { label: 'README.md', value: 'readme' },
    ];

    selectedConfigType.value = 'friends';
    currentConfigPath.value = props.api.getConfigPath('friends');
    vuepressPath.value = props.api.getConfigPath('vuepress');

    try {
      const vuepressFiles = await props.api.fetchVuePressFiles();
      console.log('[MobileConfigEditor] vuepressFiles:', vuepressFiles);

      vuepressPickerColumns.value = vuepressFiles
        .filter(f => f.type === 'file')
        .map(f => ({
          label: f.name,
          value: f.path,
        }));
      console.log('[MobileConfigEditor] vuepressPickerColumns:', vuepressPickerColumns.value);
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

const openVuepressPicker = () => {
  console.log('[MobileConfigEditor] openVuepressPicker, columns:', vuepressPickerColumns.value.length);
  console.log('[MobileConfigEditor] selectedVuepressPath:', selectedVuepressPath.value);
  if (vuepressPickerColumns.value.length > 0) {
    showVuepressPicker.value = true;
  } else {
    console.warn('[MobileConfigEditor] vuepressPickerColumns 为空，无法打开选择器');
  }
};

const onVuepressPickerConfirm = async (value: string[], context: { index: number[]; label: string[] }) => {
  const selectedValue = value[0];
  if (selectedValue) {
    selectedVuepressPath.value = selectedValue;
    showVuepressPicker.value = false;
    await loadVuepressConfig();
  }
};

const onConfigPickerConfirm = async (value: string[], context: { index: number[]; label: string[] }) => {
  const selectedValue = value[0];
  if (selectedValue) {
    selectedConfigType.value = selectedValue;
    currentConfigPath.value = props.api.getConfigPath(selectedValue as any);
    showConfigPicker.value = false;
    await loadConfig();
  }
};

const loadConfig = async () => {
  loading.value = true;
  validationErrors.value = [];

  try {
    const content = await props.api.fetchConfig(selectedConfigType.value as any);
    configContent.value = content || '';
    originalConfigContent.value = content || '';
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
    console.log('[MobileConfigEditor] loadVuepressConfig, path:', selectedVuepressPath.value);
    if (!selectedVuepressPath.value) {
      vuepressErrors.value = ['未选择文件'];
      return;
    }
    const content = await props.api.fetchFileContent(selectedVuepressPath.value);
    console.log('[MobileConfigEditor] loadVuepressConfig, content length:', content?.length);
    vuepressContent.value = content || '';
    originalVuepressContent.value = content || '';
    vuepressErrors.value = [];
  } catch (error: any) {
    console.error('[MobileConfigEditor] loadVuepressConfig error:', error);
    vuepressErrors.value = [error.message];
  } finally {
    loadingVuepress.value = false;
  }
};

const handleClose = () => {
  emit('close');
};

const handleSave = async () => {
  saving.value = true;
  showProgress.value = true;
  progressPercent.value = 0;
  progressMessage.value = '准备保存...';

  try {
    if (activeTab.value === 'config') {
      const validation = props.api.validateConfig(selectedConfigType.value as any, configContent.value);
      if (!validation.valid) {
        validationErrors.value = validation.errors;
        showProgress.value = false;
        saving.value = false;
        return;
      }

      const result = await props.api.updateConfig(selectedConfigType.value as any, configContent.value, {
        createPR: createPR.value,
        commitMessage: `更新配置文件 via Sillot`,
        onProgress: (percent: number, msg: string) => {
          progressPercent.value = percent;
          progressMessage.value = msg;
        },
      });

      showProgress.value = false;
      if (result.success) {
        resultSuccess.value = true;
        prUrl.value = result.prUrl || '';
        prAttemptFailed.value = false;
        originalConfigContent.value = configContent.value;
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
        originalVuepressContent.value = vuepressContent.value;
      } else {
        resultSuccess.value = false;
        prAttemptFailed.value = createPR.value;
        validationErrors.value = [result.error || '保存失败'];
      }
    } else {
      const validation = props.api.validateConfig('vuepress', vuepressContent.value);
      if (!validation.valid) {
        vuepressErrors.value = validation.errors;
        showProgress.value = false;
        saving.value = false;
        return;
      }

      const result = await props.api.updateVuePressFile(selectedVuepressPath.value, vuepressContent.value, {
        createPR: createPR.value,
        commitMessage: `更新 .vuepress 配置 via Sillot`,
        onProgress: (percent: number, msg: string) => {
          progressPercent.value = percent;
          progressMessage.value = msg;
        },
      });

      showProgress.value = false;
      if (result.success) {
        resultSuccess.value = true;
        prUrl.value = result.prUrl || '';
        prAttemptFailed.value = false;
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
        vuepressErrors.value = [result.error || '保存失败'];
      }
    }
    showResult.value = true;
  } catch (error: any) {
    showProgress.value = false;
    resultSuccess.value = false;
    showResult.value = true;
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  setupThemeObserver();
  setupViewportObserver();
  init();
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
  if (viewportObserver) {
    viewportObserver.disconnect();
    viewportObserver = null;
  }
});
</script>

<style>
.mobile-config-editor-wrapper {
  --panel-bg: #ffffff;
  --bg-secondary: #f5f5f5;
  --border-color: #e0e0e0;
  --text-primary: #333333;
  --text-placeholder: #999999;
  --keyboard-offset: 0px;
  padding-bottom: var(--keyboard-offset);
}

.mobile-config-editor-wrapper.is-dark {
  --panel-bg: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --border-color: #3a3a3a;
  --text-primary: #cdd6f4;
  --text-placeholder: #6c7086;
}
</style>
