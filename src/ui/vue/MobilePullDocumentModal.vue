<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import { Notice } from 'obsidian';
import { CloseIcon } from 'tdesign-icons-vue-next';
import { useThemeSync } from './composables/useThemeSync';
import { useDocumentTree } from './composables/useDocumentTree';
import { usePreview } from './composables/usePreview';
import type { DocumentTreeService } from '../../sync/DocumentTreeService';
import type { PullSource } from '../../types';
import type { PermalinkIndexEntry } from '../../bridge/types';

interface Props {
  documentTreeService: DocumentTreeService;
  vaultRoot: string;
  githubRepo: string;
  githubBranch: string;
  siteDomain: string;
  docsDir: string;
  onClose: () => void;
  onDownload: (cloudPath: string, localSavePath: string, source: PullSource) => Promise<void>;
  obsidianApp: any;
}

const props = defineProps<Props>();

const { isDark } = useThemeSync();

const activeTab = ref('select');
const pattern = ref('');
const urlInputValue = ref('');
const isParsingUrl = ref(false);
const isDownloading = ref(false);
const selectedPath = ref<string | null>(null);
const pathExpanded = ref(false);

const defaultSource = (): PullSource => ({
  type: 'github',
  baseUrl: props.githubRepo,
  branch: props.githubBranch,
  docsDir: props.docsDir,
});

const { treeNodes, isLoadingTree, selectedSource, loadDocumentTree, toggleNode } = useDocumentTree(props.documentTreeService);
const { previewContent, previewError, localExistence, localSavePath, isLoadingPreview, isRenderedMode, renderedEl, renderComponent, loadPreview, tryRenderPreview } = usePreview(props.documentTreeService, props.obsidianApp);

const selectNode = async (node: any) => {
  if (!node.isLeaf) {
    await toggleNode(node);
    return;
  }

  selectedPath.value = node.path;
  activeTab.value = 'preview';
  pathExpanded.value = false;
  selectedSource.value = defaultSource();
  localSavePath.value = props.documentTreeService.analyzeSavePath(node.path, props.vaultRoot);
  await loadPreview(node.path, selectedSource.value);
};

const handleUrlParse = async () => {
  const url = urlInputValue.value.trim();
  if (!url) return;

  isParsingUrl.value = true;
  try {
    const result = props.documentTreeService.parseUrl(url);
    if (result) {
      selectedPath.value = result.path;
      activeTab.value = 'preview';
      selectedSource.value = result.source;
      localSavePath.value = props.documentTreeService.analyzeSavePath(result.path, props.vaultRoot);
      await loadPreview(result.path, result.source);
      if (result.title) new Notice(`已定位：${result.title}`);
    } else {
      new Notice('无法解析该 URL');
    }
  } finally {
    isParsingUrl.value = false;
  }
};

const handleSearch = () => {
  const query = pattern.value.trim();
  if (!query) return;

  const permalinkIndex = props.documentTreeService.getPermalinkIndex();
  if (!permalinkIndex?.entries?.length) return;

  const lowerQuery = query.toLowerCase();
  const results: Array<PermalinkIndexEntry & { matchedField: string }> = [];
  const seen = new Set<string>();

  for (const entry of permalinkIndex.entries) {
    if (!entry.filePath || seen.has(entry.filePath)) continue;

    let matchedField = '';
    if (entry.title?.toLowerCase().includes(lowerQuery)) matchedField = '标题';
    else if (entry.permalink?.toLowerCase().includes(lowerQuery)) matchedField = '链接';
    else if (entry.filePath?.toLowerCase().includes(lowerQuery)) matchedField = '路径';
    else if (entry.collection?.toLowerCase().includes(lowerQuery)) matchedField = '集合';

    if (matchedField) {
      seen.add(entry.filePath);
      results.push({ ...entry, matchedField });
    }
  }

  const priority: Record<string, number> = { '标题': 0, '链接': 1, '路径': 2, '集合': 3 };
  results.sort((a, b) => (priority[a.matchedField] ?? 9) - (priority[b.matchedField] ?? 9));

  if (results.length > 0) handleSearchResultSelect(results[0]);
};

const handleSearchResultSelect = async (entry: PermalinkIndexEntry) => {
  if (!entry.filePath) return;

  const cloudPath = `${props.docsDir || 'docs'}/${entry.filePath}`;
  selectedPath.value = cloudPath;
  activeTab.value = 'preview';
  selectedSource.value = defaultSource();
  localSavePath.value = props.documentTreeService.analyzeSavePath(cloudPath, props.vaultRoot);
  await loadPreview(cloudPath, selectedSource.value);
};

const handleDownload = async () => {
  if (!selectedPath.value || !selectedSource.value || !localSavePath.value) {
    new Notice('请先选择要下载的文档');
    return;
  }

  isDownloading.value = true;
  try {
    await props.onDownload(selectedPath.value, localSavePath.value, selectedSource.value);
    props.onClose();
  } finally {
    isDownloading.value = false;
  }
};

watch([previewContent, isRenderedMode], async ([content, rendered]) => {
  if (rendered && content) await tryRenderPreview(content);
});

watch(isDark, (dark) => {
  document.querySelector('.mobile-pull-doc-wrapper')?.classList.toggle('is-dark', dark);
});

onMounted(async () => {
  await loadDocumentTree(defaultSource());
});

onUnmounted(() => {
  renderComponent.unload();
});
</script>

<template>
  <div class="mobile-pull-doc-wrapper" :class="{ 'is-dark': isDark }">
    <div class="mobile-overlay" @click.self="onClose">
      <div class="mobile-panel">
        <div class="panel-header">
          <span class="panel-title">从云端拉取文档</span>
          <t-button variant="text" size="small" class="close-btn" @click="onClose">
            <CloseIcon />
          </t-button>
        </div>

        <div class="panel-content">
          <t-tabs v-model="activeTab" :line-width="30" class="doc-tabs">
            <t-tab-panel value="select">
              <template #label>
                <span class="tab-label">
                  📁 选择
                  <t-badge :count="selectedPath ? 1 : 0" :max-count="99" :offset="[0, -2]" />
                </span>
              </template>

              <div class="select-content">
                <t-input v-model="pattern" placeholder="搜索文档..." clearable class="search-input" @input="handleSearch" />

                <div v-if="isLoadingTree" class="loading-container">
                  <t-loading size="medium" />
                  <t-text class="loading-text">加载文档树...</t-text>
                </div>

                <div v-else class="doc-tree">
                  <div
                    v-for="node in treeNodes"
                    :key="node.path"
                    class="tree-node"
                    :style="{ paddingLeft: (node.level * 16 + 12) + 'px' }"
                    @click="selectNode(node)"
                  >
                    <span v-if="!node.isLeaf" class="expand-icon" :class="{ expanded: node.expanded }">▶</span>
                    <span v-else class="expand-placeholder"></span>
                    <span>{{ node.isLeaf ? '📄' : '📁' }}</span>
                    <span class="tree-label">{{ node.name }}</span>
                  </div>
                </div>

                <t-divider class="section-divider" />

                <t-input v-model="urlInputValue" placeholder="粘贴文档链接..." class="url-input" @keyup.enter="handleUrlParse" />
                <t-button :loading="isParsingUrl" class="parse-btn" @click="handleUrlParse">解析</t-button>
                <t-text class="url-hint">支持 GitHub 文件链接、Raw 链接、站点文档链接</t-text>
              </div>
            </t-tab-panel>

            <t-tab-panel value="preview">
              <template #label>
                <span class="tab-label">👁️ 预览</span>
              </template>

              <div v-if="!selectedPath" class="empty-preview">
                <t-text>请先选择或解析文档</t-text>
              </div>

              <template v-else>
                <div class="doc-info">
                  <div class="info-row clickable" @click="pathExpanded = !pathExpanded">
                    <div class="info-label-group">
                      <span class="info-label">云端路径</span>
                      <span class="expand-arrow" :class="{ expanded: pathExpanded }">▶</span>
                    </div>
                    <span :class="['info-value', { truncated: !pathExpanded }]">{{ selectedPath }}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">本地状态</span>
                    <span class="info-value">{{ localExistence?.exists ? '已存在' : '不存在' }}</span>
                  </div>
                  <div class="info-input">
                    <t-input v-model="localSavePath" placeholder="保存路径" size="small" />
                  </div>
                </div>

                <div class="preview-section">
                  <div class="preview-header">
                    <span class="preview-title">渲染模式</span>
                    <t-switch v-model="isRenderedMode" :label="['渲染', '源码']" />
                  </div>

                  <div class="preview-container">
                    <div v-if="isLoadingPreview" class="loading-container">
                      <t-loading size="medium" />
                      <t-text class="loading-text">加载预览中...</t-text>
                    </div>
                    <template v-else>
                      <pre v-if="!isRenderedMode" class="source-preview">{{ previewContent }}</pre>
                      <div v-else ref="renderedEl" class="rendered-preview markdown-rendered"></div>
                    </template>
                    <div v-if="!isLoadingPreview && !previewContent" class="empty-preview">
                      <div v-if="previewError" class="error-preview">
                        <t-text class="error-title">⚠️ 加载失败</t-text>
                        <t-text class="error-message">{{ previewError }}</t-text>
                      </div>
                      <t-empty v-else description="无预览内容" />
                    </div>
                  </div>
                </div>
              </template>
            </t-tab-panel>
          </t-tabs>
        </div>

        <div class="panel-footer">
          <t-button variant="outline" class="cancel-btn" @click="onClose">取消</t-button>
          <t-button :disabled="!selectedPath || !localSavePath || isDownloading" :loading="isDownloading" class="download-btn" @click="handleDownload">
            {{ localExistence?.exists ? '下载/覆盖' : '下载文档' }}
          </t-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.mobile-pull-doc-wrapper {
  --td-brand-color: #1966ff;
  --td-brand-color-light: #e6eef8;
  --td-tab-nav-bg-color: transparent;
  --td-bg-color-container: #ffffff;
  --td-bg-color-container-hover: #f5f5f5;
  --td-border-level-1-color: #e0e0e0;
  --td-text-color-primary: #333333;
  --td-text-color-secondary: #999999;
  --td-text-color-placeholder: #999999;
  --td-text-color-disabled: #cccccc;
  --panel-bg: #ffffff;
  --bg-secondary: #f5f5f5;
  --border-color: #e0e0e0;
  --text-primary: #333333;
  --text-placeholder: #999999;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
}

.mobile-pull-doc-wrapper.is-dark {
  --td-brand-color: #1966ff;
  --td-brand-color-light: #1e3a5f;
  --td-tab-nav-bg-color: transparent;
  --td-bg-color-container: #1a1a1a;
  --td-bg-color-container-hover: #2d2d2d;
  --td-border-level-1-color: #3a3a3a;
  --td-text-color-primary: #cdd6f4;
  --td-text-color-secondary: #6c7086;
  --td-text-color-placeholder: #6c7086;
  --td-text-color-disabled: #4a4a4a;
  --panel-bg: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --border-color: #3a3a3a;
  --text-primary: #cdd6f4;
  --text-placeholder: #6c7086;
}

.mobile-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
}

.mobile-panel {
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

.close-btn { padding: 4px; }

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.panel-footer {
  display: flex;
  padding: 16px 20px;
  gap: 12px;
  border-top: 1px solid var(--border-color);
}

.doc-tabs { --td-tab-nav-bg-color: transparent; }

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.select-content { margin-top: 12px; }

.search-input { margin-bottom: 12px; }

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.loading-text {
  display: block;
  margin-top: 12px;
  color: var(--text-placeholder);
}

.doc-tree {
  max-height: 200px;
  overflow-y: auto;
}

.tree-node {
  padding: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
}

.expand-icon {
  transition: transform 0.2s;
  display: inline-block;
  color: var(--text-placeholder);
}

.expand-icon.expanded { transform: rotate(90deg); }

.expand-placeholder {
  width: 16px;
  display: inline-block;
}

.tree-label {
  font-size: 14px;
  color: var(--text-primary);
}

.section-divider { margin: 16px 0; }

.url-input { margin-bottom: 12px; }

.parse-btn { width: 100%; }

.url-hint {
  font-size: 12px;
  color: var(--text-placeholder);
  display: block;
  margin-top: 8px;
}

.empty-preview {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-placeholder);
}

.error-preview {
  padding: 16px;
  background: rgba(255, 77, 79, 0.1);
  border-radius: 8px;
  border-left: 3px solid #ff4d4f;
}

.error-title {
  display: block;
  font-weight: 600;
  color: #ff4d4f;
  margin-bottom: 8px;
  font-size: 14px;
}

.error-message {
  display: block;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.doc-info {
  margin-top: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 12px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.info-row.clickable { cursor: pointer; }

.info-row:last-child { border-bottom: none; }

.info-label-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.info-label {
  color: var(--text-secondary);
  font-size: 13px;
}

.expand-arrow {
  transition: transform 0.2s;
  color: var(--text-secondary);
}

.expand-arrow.expanded { transform: rotate(90deg); }

.info-value {
  color: var(--text-primary);
  font-size: 13px;
}

.info-value.truncated {
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-input { padding-top: 8px; }

.preview-section { margin-top: 16px; }

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.preview-title {
  font-size: 13px;
  color: var(--text-secondary);
}

.preview-container {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  min-height: 200px;
  max-height: 300px;
  overflow-y: auto;
}

.source-preview {
  padding: 16px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-x: auto;
  color: var(--text-primary);
}

.rendered-preview {
  padding: 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.rendered-preview img { max-width: 100%; }

.cancel-btn { flex: 1; }

.download-btn { flex: 2; }
</style>
