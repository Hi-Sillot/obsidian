<script setup lang="ts">
import { ref, onMounted, watch, nextTick, onUnmounted } from 'vue';
import { Notice, MarkdownRenderer, Component } from 'obsidian';
import { CloseIcon } from 'tdesign-icons-vue-next';
import type { DocumentTreeService } from '../../sync/DocumentTreeService';
import type { DocTreeNode, PullSource, LocalExistenceResult } from '../../types';
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

// 主题状态
const isDark = ref(false);
let themeObserver: MutationObserver | null = null;

// 标签页状态
const activeTab = ref('select');

// 文档树状态
const treeData = ref<any[]>([]);
const isLoadingTree = ref(false);
const expandedKeys = ref<string[]>([]);
const loadedPaths = ref<Set<string>>(new Set());

// 选择和预览状态
const selectedPath = ref<string | null>(null);
const selectedSource = ref<PullSource | null>(null);
const previewContent = ref<string | null>(null);
const localExistence = ref<LocalExistenceResult | null>(null);
const localSavePath = ref('');
const isLoadingPreview = ref(false);
const isRenderedMode = ref(true);
const pathExpanded = ref(false);
const renderedEl = ref<HTMLElement | null>(null);

// URL 解析状态
const urlInputValue = ref('');
const isParsingUrl = ref(false);
const isDownloading = ref(false);
const pattern = ref('');

// Markdown 渲染器
const renderComponent = new Component();
renderComponent.load();
let lastRenderedKey = '';

// 主题管理
const detectTheme = () => {
  isDark.value = document.body.classList.contains('theme-dark');
};

const applyThemeVariables = (dark: boolean) => {
  const wrapper = document.querySelector('.mobile-pull-doc-wrapper') as HTMLElement;
  if (!wrapper) return;

  const themeVars = dark ? {
    '--td-brand-color': '#1966ff',
    '--td-brand-color-light': '#1e3a5f',
    '--td-bg-color-container': '#1a1a1a',
    '--td-bg-color-container-hover': '#2d2d2d',
    '--td-border-level-1-color': '#3a3a3a',
    '--td-text-color-primary': '#cdd6f4',
    '--td-text-color-secondary': '#6c7086',
    '--td-text-color-placeholder': '#6c7086',
    '--td-text-color-disabled': '#4a4a4a',
    '--panel-bg': '#1a1a1a',
    '--bg-secondary': '#2d2d2d',
    '--border-color': '#3a3a3a',
    '--text-primary': '#cdd6f4',
    '--text-placeholder': '#6c7086',
  } : {
    '--td-brand-color': '#1966ff',
    '--td-brand-color-light': '#e6eef8',
    '--td-bg-color-container': '#ffffff',
    '--td-bg-color-container-hover': '#f5f5f5',
    '--td-border-level-1-color': '#e0e0e0',
    '--td-text-color-primary': '#333333',
    '--td-text-color-secondary': '#999999',
    '--td-text-color-placeholder': '#999999',
    '--td-text-color-disabled': '#cccccc',
    '--panel-bg': '#ffffff',
    '--bg-secondary': '#f5f5f5',
    '--border-color': '#e0e0e0',
    '--text-primary': '#333333',
    '--text-placeholder': '#999999',
  };

  Object.entries(themeVars).forEach(([key, value]) => wrapper.style.setProperty(key, value));
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

// 数据源
const defaultSource = (): PullSource => ({
  type: 'github',
  baseUrl: props.githubRepo,
  branch: props.githubBranch,
  docsDir: props.docsDir,
});

// 文档树转换
const convertDocTreeToOptions = (nodes: DocTreeNode[]): any[] =>
  nodes.map(node => ({
    label: node.name,
    value: node.path,
    isLeaf: node.type === 'file',
    children: node.type === 'directory' ? [] : undefined,
  }));

// 文档树加载
const loadDocumentTree = async () => {
  isLoadingTree.value = true;
  try {
    const source = defaultSource();
    const tree = await props.documentTreeService.fetchDocTree(source);
    selectedSource.value = source;
    loadedPaths.value.add(tree.path);
    if (tree.children) {
      treeData.value = convertDocTreeToOptions(tree.children);
    }
  } catch {
    new Notice('加载文档树失败');
  } finally {
    isLoadingTree.value = false;
  }
};

const loadChildren = async (path: string, parentNode: any) => {
  if (!selectedSource.value) return;

  try {
    const children = await props.documentTreeService.loadChildren(path, selectedSource.value);
    parentNode.children = convertDocTreeToOptions(children);
    children.forEach((child: DocTreeNode) => {
      if (child.type === 'directory') {
        loadedPaths.value.add(child.path);
      }
    });
  } catch (error) {
    console.error('[MobilePullDocModal] 加载子节点失败:', error);
  }
};

// 预览加载
const loadPreview = async (path: string, source: PullSource) => {
  isLoadingPreview.value = true;
  try {
    previewContent.value = await props.documentTreeService.previewDocument(path, source);
    localExistence.value = await props.documentTreeService.checkLocalExistence(path);
    if (!localSavePath.value && localExistence.value?.localPath) {
      localSavePath.value = localExistence.value.localPath;
    }
  } catch {
    previewContent.value = null;
  } finally {
    isLoadingPreview.value = false;
  }
};

// 节点点击处理
const handleNodeClick = async (node: any) => {
  if (!node.isLeaf) {
    // 展开/折叠目录
    const isExpanded = expandedKeys.value.includes(node.value);
    if (isExpanded) {
      expandedKeys.value = expandedKeys.value.filter(k => k !== node.value);
    } else {
      if (!loadedPaths.value.has(node.value)) {
        await loadChildren(node.value, node);
      }
      expandedKeys.value = [...expandedKeys.value, node.value];
    }
  } else {
    // 选择文件
    selectedPath.value = node.value;
    activeTab.value = 'preview';
    pathExpanded.value = false;
    selectedSource.value = defaultSource();
    localSavePath.value = props.documentTreeService.analyzeSavePath(node.value, props.vaultRoot);
    await loadPreview(node.value, selectedSource.value);
  }
};

// URL 解析
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

      if (result.title) {
        new Notice(`已定位：${result.title}`);
      }
    } else {
      new Notice('无法解析该 URL');
    }
  } finally {
    isParsingUrl.value = false;
  }
};

// 搜索处理
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

  if (results.length > 0) {
    handleSearchResultSelect(results[0]);
  }
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

// 下载处理
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

const handleClose = () => props.onClose();

// Markdown 渲染
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const renderWithObsidian = async (content: string, el: HTMLElement) => {
  try {
    el.innerHTML = '';
    await MarkdownRenderer.render(props.obsidianApp, content, el, '', renderComponent);
  } catch {
    el.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(content)}</pre>`;
  }
};

const tryRenderPreview = async (content: string) => {
  if (!content || !isRenderedMode.value) return;

  const renderKey = `rendered::${content.substring(0, 100)}`;
  if (renderKey === lastRenderedKey) return;
  lastRenderedKey = renderKey;

  let retries = 0;
  const maxRetries = 5;

  const attemptRender = async () => {
    await nextTick();
    if (renderedEl.value) {
      await renderWithObsidian(content, renderedEl.value);
    } else if (retries < maxRetries) {
      retries++;
      setTimeout(attemptRender, 50);
    }
  };

  attemptRender();
};

// 监听
watch([previewContent, isRenderedMode], async ([content, rendered]) => {
  if (rendered && content) {
    lastRenderedKey = '';
    await tryRenderPreview(content);
  }
});

watch(isDark, (dark) => {
  document.querySelector('.mobile-pull-doc-wrapper')?.classList.toggle('is-dark', dark);
  applyThemeVariables(dark);
});

onMounted(async () => {
  setupThemeObserver();
  await nextTick();
  await loadDocumentTree();
});

onUnmounted(() => {
  themeObserver?.disconnect();
  renderComponent.unload();
});
</script>

<template>
  <div class="mobile-pull-doc-wrapper" :class="{ 'is-dark': isDark }">
    <div class="mobile-overlay" @click.self="handleClose">
      <div class="mobile-panel">
        <div class="panel-header">
          <span class="panel-title">从云端拉取文档</span>
          <t-button variant="text" size="small" class="close-btn" @click="handleClose">
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
                <t-input
                  v-model="pattern"
                  placeholder="搜索文档..."
                  clearable
                  class="search-input"
                  @input="handleSearch"
                />

                <div v-if="isLoadingTree" class="loading-container">
                  <t-loading size="medium" />
                  <t-text class="loading-text">加载文档树...</t-text>
                </div>

                <div v-else class="doc-tree">
                  <template v-for="node in treeData" :key="node.value">
                    <div
                      class="tree-node"
                      @click="handleNodeClick(node)"
                    >
                      <span
                        v-if="!node.isLeaf"
                        class="expand-icon"
                        :class="{ expanded: expandedKeys.includes(node.value) }"
                      >▶</span>
                      <span v-else class="expand-placeholder"></span>
                      <span>{{ node.isLeaf ? '📄' : '📁' }}</span>
                      <span class="tree-label">{{ node.label }}</span>
                    </div>
                    <template v-if="!node.isLeaf && expandedKeys.includes(node.value) && node.children?.length">
                      <div
                        v-for="child in node.children"
                        :key="child.value"
                        class="tree-child-node"
                        @click="handleNodeClick(child)"
                      >
                        <span>{{ child.isLeaf ? '📄' : '📁' }}</span>
                        <span class="tree-label">{{ child.label }}</span>
                      </div>
                    </template>
                  </template>
                </div>

                <t-divider class="section-divider" />

                <t-input
                  v-model="urlInputValue"
                  placeholder="粘贴文档链接..."
                  class="url-input"
                  @keyup.enter="handleUrlParse"
                />
                <t-button
                  :loading="isParsingUrl"
                  class="parse-btn"
                  @click="handleUrlParse"
                >
                  解析
                </t-button>
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
                      <t-empty description="无预览内容" />
                    </div>
                  </div>
                </div>
              </template>
            </t-tab-panel>
          </t-tabs>
        </div>

        <div class="panel-footer">
          <t-button variant="outline" class="cancel-btn" @click="handleClose">
            取消
          </t-button>
          <t-button
            :disabled="!selectedPath || !localSavePath || isDownloading"
            :loading="isDownloading"
            class="download-btn"
            @click="handleDownload"
          >
            {{ localExistence?.exists ? '下载/覆盖' : '下载文档' }}
          </t-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* CSS Variables */
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

/* Layout */
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

.close-btn {
  padding: 4px;
}

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

/* Tabs */
.doc-tabs {
  --td-tab-nav-bg-color: transparent;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Select Tab */
.select-content {
  margin-top: 12px;
}

.search-input {
  margin-bottom: 12px;
}

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

.tree-node,
.tree-child-node {
  padding: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
}

.tree-child-node {
  padding: 10px 12px 10px 36px;
}

.expand-icon {
  transition: transform 0.2s;
  display: inline-block;
  color: var(--text-placeholder);
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.expand-placeholder {
  width: 16px;
  display: inline-block;
}

.tree-label {
  font-size: 14px;
  color: var(--text-primary);
}

.section-divider {
  margin: 16px 0;
}

.url-input {
  margin-bottom: 12px;
}

.parse-btn {
  width: 100%;
}

.url-hint {
  font-size: 12px;
  color: var(--text-placeholder);
  display: block;
  margin-top: 8px;
}

/* Preview Tab */
.empty-preview {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-placeholder);
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

.info-row.clickable {
  cursor: pointer;
}

.info-row:last-child {
  border-bottom: none;
}

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

.expand-arrow.expanded {
  transform: rotate(90deg);
}

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

.info-input {
  padding-top: 8px;
}

.preview-section {
  margin-top: 16px;
}

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
  padding: 12px;
  font-family: Monaco, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.rendered-preview {
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.rendered-preview h1,
.rendered-preview h2,
.rendered-preview h3 {
  margin-top: 1em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.rendered-preview p {
  margin: 0.5em 0;
}

.rendered-preview code {
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: Monaco, Menlo, monospace;
  font-size: 0.9em;
}

.rendered-preview pre {
  background: var(--bg-secondary);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.rendered-preview pre code {
  background: none;
  padding: 0;
}

/* Footer Buttons */
.cancel-btn,
.download-btn {
  flex: 1;
}

/* TDesign Overrides */
.mobile-pull-doc-wrapper .t-tabs__item {
  color: var(--text-placeholder);
}

.mobile-pull-doc-wrapper .t-tabs__item.t-is-active {
  color: var(--td-brand-color);
}

.mobile-pull-doc-wrapper .t-tabs__track {
  background-color: var(--td-brand-color);
}

.mobile-pull-doc-wrapper .t-button--variant-outline {
  border-color: var(--border-color);
  color: var(--text-primary);
}
</style>
