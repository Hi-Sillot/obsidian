<template>
  <div class="mobile-pull-doc-wrapper" :class="{ 'is-dark': isDark }" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999;">
    <div class="mobile-overlay" @click.self="handleClose" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end;">
      <div class="mobile-panel" style="position: relative; width: 100%; background: var(--panel-bg, #fff); border-radius: 16px 16px 0 0; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;">
        <div class="panel-header" style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border-color, #e0e0e0);">
          <span style="font-size: 18px; font-weight: 600; color: var(--text-primary, #333);">从云端拉取文档</span>
          <t-button variant="text" size="small" @click="handleClose" style="padding: 4px;">
            <CloseIcon />
          </t-button>
        </div>

        <div class="panel-content" style="flex: 1; overflow-y: auto; padding: 16px 20px;">
          <t-tabs v-model="activeTab" :line-width="30" style="--td-tab-nav-bg-color: transparent;">
            <t-tab-panel value="select">
              <template #label>
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  📁 选择
                  <t-badge :count="selectedPath ? 1 : 0" :max-count="99" :offset="[0, -2]" />
                </span>
              </template>

              <div style="margin-top: 12px;">
                <t-input
                  v-model="pattern"
                  placeholder="搜索文档..."
                  :clearable="true"
                  @input="handleSearch"
                  style="margin-bottom: 12px;"
                />

                <div v-if="isLoadingTree" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px;">
                  <t-loading size="medium" />
                  <t-text style="display: block; margin-top: 12px; color: var(--text-placeholder, #999);">加载文档树...</t-text>
                </div>

                <div v-else class="doc-tree" style="max-height: 200px; overflow-y: auto;">
                  <template v-for="node in treeData" :key="node.value">
                    <div
                      style="padding: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-color, #e0e0e0);"
                      @click="handleNodeClick(node)"
                    >
                      <span
                        v-if="!node.isLeaf"
                        class="expand-icon"
                        :class="{ expanded: expandedKeys.includes(node.value) }"
                        style="transition: transform 0.2s; display: inline-block;"
                      >▶</span>
                      <span v-else style="width: 16px; display: inline-block;"></span>
                      <span>{{ node.isLeaf ? '📄' : '📁' }}</span>
                      <span style="font-size: 14px; color: var(--text-primary, #333);">{{ node.label }}</span>
                    </div>
                    <template v-if="!node.isLeaf && expandedKeys.includes(node.value) && node.children?.length">
                      <div
                        v-for="child in node.children"
                        :key="child.value"
                        style="padding: 10px 12px 10px 36px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-color, #e0e0e0);"
                        @click="handleNodeClick(child)"
                      >
                        <span>{{ child.isLeaf ? '📄' : '📁' }}</span>
                        <span style="font-size: 14px; color: var(--text-primary, #333);">{{ child.label }}</span>
                      </div>
                    </template>
                  </template>
                </div>

                <t-divider style="margin: 16px 0;" />

                <t-input
                  v-model="urlInputValue"
                  placeholder="粘贴文档链接..."
                  style="margin-bottom: 12px;"
                  @keyup.enter="handleUrlParse"
                />
                <t-button
                  @click="handleUrlParse"
                  :loading="isParsingUrl"
                  style="width: 100%;"
                >
                  解析
                </t-button>
                <t-text style="font-size: 12px; color: var(--text-placeholder, #999); display: block; margin-top: 8px;">
                  支持 GitHub 文件链接、Raw 链接、站点文档链接
                </t-text>
              </div>
            </t-tab-panel>

            <t-tab-panel value="preview">
              <template #label>
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  👁️ 预览
                </span>
              </template>

              <div v-if="!selectedPath" style="text-align: center; padding: 48px 24px; color: var(--text-placeholder, #999);">
                <t-text>请先选择或解析文档</t-text>
              </div>

              <template v-else>
                <div style="margin-top: 12px; background: var(--bg-secondary, #f5f5f5); border-radius: 12px; padding: 12px;">
                  <div
                    style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color, #e0e0e0); cursor: pointer;"
                    @click="pathExpanded = !pathExpanded"
                  >
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span style="color: var(--text-secondary, #666); font-size: 13px;">云端路径</span>
                      <span :style="{ transform: pathExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-secondary, #666)' }">▶</span>
                    </div>
                    <span v-if="!pathExpanded" style="color: var(--text-primary, #333); font-size: 13px; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ selectedPath }}</span>
                    <span v-else style="color: var(--text-primary, #333); font-size: 13px; max-width: 55%; text-align: right; word-break: break-all;">{{ selectedPath }}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color, #e0e0e0);">
                    <span style="color: var(--text-secondary, #666); font-size: 13px;">本地状态</span>
                    <span style="color: var(--text-primary, #333); font-size: 13px;">{{ localExistence?.exists ? '已存在' : '不存在' }}</span>
                  </div>
                  <div style="padding-top: 8px;">
                    <t-input v-model="localSavePath" placeholder="保存路径" size="small" />
                  </div>
                </div>

                <div style="margin-top: 16px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <span style="font-size: 13px; color: var(--text-secondary, #666);">渲染模式</span>
                    <t-switch
                      v-model="isRenderedMode"
                      :label="['渲染', '源码']"
                    />
                  </div>

                  <div style="border: 1px solid var(--border-color, #e0e0e0); border-radius: 8px; min-height: 200px; max-height: 300px; overflow-y: auto;">
                    <div v-if="isLoadingPreview" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px;">
                      <t-loading size="medium" />
                      <t-text style="display: block; margin-top: 12px; color: var(--text-placeholder, #999);">加载预览中...</t-text>
                    </div>
                    <template v-else>
                      <pre v-if="!isRenderedMode" style="padding: 12px; font-family: Monaco, Menlo, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; margin: 0;">
                        {{ previewContent }}
                      </pre>
                      <div v-else ref="renderedEl" class="rendered-preview markdown-rendered" style="padding: 12px;"></div>
                    </template>
                    <div v-if="!isLoadingPreview && !previewContent" style="display: flex; align-items: center; justify-content: center; height: 150px; color: var(--text-placeholder, #999);">
                      <t-empty description="无预览内容" />
                    </div>
                  </div>
                </div>
              </template>
            </t-tab-panel>
          </t-tabs>
        </div>

        <div class="panel-footer" style="display: flex; padding: 16px 20px; gap: 12px; border-top: 1px solid var(--border-color, #e0e0e0);">
          <t-button @click="handleClose" variant="outline" style="flex: 1;">
            取消
          </t-button>
          <t-button
            @click="handleDownload"
            :disabled="!selectedPath || !localSavePath || isDownloading"
            :loading="isDownloading"
            style="flex: 1;"
          >
            {{ localExistence?.exists ? '下载/覆盖' : '下载文档' }}
          </t-button>
        </div>
      </div>
    </div>
  </div>
</template>

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

const isDark = ref(false);
const activeTab = ref('select');
const treeData = ref<any[]>([]);
const isLoadingTree = ref(false);
const expandedKeys = ref<string[]>([]);
const loadedPaths = ref<Set<string>>(new Set());

const selectedPath = ref<string | null>(null);
const selectedSource = ref<PullSource | null>(null);
const previewContent = ref<string | null>(null);
const localExistence = ref<LocalExistenceResult | null>(null);
const localSavePath = ref('');
const isLoadingPreview = ref(false);

const isRenderedMode = ref(true);
const pathExpanded = ref(false);
const renderedEl = ref<HTMLElement | null>(null);
const renderComponent = new Component();
renderComponent.load();
let lastRenderedKey = '';

const urlInputValue = ref('');
const isParsingUrl = ref(false);
const isDownloading = ref(false);

const pattern = ref('');

let themeObserver: MutationObserver | null = null;

const detectTheme = () => {
  isDark.value = document.body.classList.contains('theme-dark');
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

const applyThemeVariables = (dark: boolean) => {
  const wrapper = document.querySelector('.mobile-pull-doc-wrapper') as HTMLElement;
  if (!wrapper) return;

  if (dark) {
    wrapper.style.setProperty('--td-brand-color', '#1966ff');
    wrapper.style.setProperty('--td-brand-color-light', '#1e3a5f');
    wrapper.style.setProperty('--td-bg-color-container', '#1a1a1a');
    wrapper.style.setProperty('--td-bg-color-container-hover', '#2d2d2d');
    wrapper.style.setProperty('--td-border-level-1-color', '#3a3a3a');
    wrapper.style.setProperty('--td-text-color-primary', '#cdd6f4');
    wrapper.style.setProperty('--td-text-color-secondary', '#6c7086');
    wrapper.style.setProperty('--td-text-color-placeholder', '#6c7086');
    wrapper.style.setProperty('--panel-bg', '#1a1a1a');
    wrapper.style.setProperty('--bg-secondary', '#2d2d2d');
    wrapper.style.setProperty('--border-color', '#3a3a3a');
    wrapper.style.setProperty('--text-primary', '#cdd6f4');
    wrapper.style.setProperty('--text-placeholder', '#6c7086');
  } else {
    wrapper.style.setProperty('--td-brand-color', '#1966ff');
    wrapper.style.setProperty('--td-brand-color-light', '#e6eef8');
    wrapper.style.setProperty('--td-bg-color-container', '#ffffff');
    wrapper.style.setProperty('--td-bg-color-container-hover', '#f5f5f5');
    wrapper.style.setProperty('--td-border-level-1-color', '#e0e0e0');
    wrapper.style.setProperty('--td-text-color-primary', '#333333');
    wrapper.style.setProperty('--td-text-color-secondary', '#999999');
    wrapper.style.setProperty('--td-text-color-placeholder', '#999999');
    wrapper.style.setProperty('--panel-bg', '#ffffff');
    wrapper.style.setProperty('--bg-secondary', '#f5f5f5');
    wrapper.style.setProperty('--border-color', '#e0e0e0');
    wrapper.style.setProperty('--text-primary', '#333333');
    wrapper.style.setProperty('--text-placeholder', '#999999');
  }
};

const defaultSource = (): PullSource => ({
  type: 'github',
  baseUrl: props.githubRepo,
  branch: props.githubBranch,
  docsDir: props.docsDir,
});

const convertDocTreeToOptions = (nodes: DocTreeNode[]): any[] => {
  return nodes.map(node => ({
    label: node.name,
    value: node.path,
    isLeaf: node.type === 'file',
    children: node.type === 'directory' ? [] : undefined,
  }));
};

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

const handleNodeClick = async (node: any) => {
  if (!node.isLeaf) {
    if (expandedKeys.value.includes(node.value)) {
      expandedKeys.value = expandedKeys.value.filter(k => k !== node.value);
    } else {
      if (!loadedPaths.value.has(node.value)) {
        await loadChildren(node.value, node);
      }
      expandedKeys.value = [...expandedKeys.value, node.value];
    }
  } else {
    selectedPath.value = node.value;
    activeTab.value = 'preview';
    pathExpanded.value = false;
    selectedSource.value = defaultSource();
    localSavePath.value = props.documentTreeService.analyzeSavePath(node.value, props.vaultRoot);

    isLoadingPreview.value = true;
    try {
      console.log('[MobilePullDocModal] 预览文档:', node.value, selectedSource.value);
      previewContent.value = await props.documentTreeService.previewDocument(node.value, selectedSource.value);
      console.log('[MobilePullDocModal] 预览内容长度:', previewContent.value?.length);
      localExistence.value = await props.documentTreeService.checkLocalExistence(node.value);
      if (!localSavePath.value && localExistence.value?.localPath) {
        localSavePath.value = localExistence.value.localPath;
      }
    } catch (error) {
      console.error('[MobilePullDocModal] 预览失败:', error);
      previewContent.value = null;
    } finally {
      isLoadingPreview.value = false;
    }
  }
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

      isLoadingPreview.value = true;
      try {
        previewContent.value = await props.documentTreeService.previewDocument(result.path, result.source);
        localExistence.value = await props.documentTreeService.checkLocalExistence(result.path);
        if (!localSavePath.value && localExistence.value?.localPath) {
          localSavePath.value = localExistence.value.localPath;
        }
      } catch {
        previewContent.value = null;
      } finally {
        isLoadingPreview.value = false;
      }

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

const handleSearch = () => {
  if (!pattern.value.trim()) {
    return;
  }

  const permalinkIndex = props.documentTreeService.getPermalinkIndex();
  if (!permalinkIndex?.entries?.length) {
    return;
  }

  const lowerQuery = pattern.value.toLowerCase();
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
    const entry = results[0];
    handleSearchResultSelect(entry);
  }
};

const handleSearchResultSelect = async (entry: PermalinkIndexEntry) => {
  if (!entry.filePath) return;

  const docsDir = props.docsDir || 'docs';
  const cloudPath = `${docsDir}/${entry.filePath}`;

  selectedPath.value = cloudPath;
  activeTab.value = 'preview';
  selectedSource.value = defaultSource();
  localSavePath.value = props.documentTreeService.analyzeSavePath(cloudPath, props.vaultRoot);

  isLoadingPreview.value = true;
  try {
    previewContent.value = await props.documentTreeService.previewDocument(cloudPath, selectedSource.value);
    localExistence.value = await props.documentTreeService.checkLocalExistence(cloudPath);
    if (!localSavePath.value && localExistence.value?.localPath) {
      localSavePath.value = localExistence.value.localPath;
    }
  } catch {
    previewContent.value = null;
  } finally {
    isLoadingPreview.value = false;
  }
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

const handleClose = () => {
  props.onClose();
};

const renderWithObsidian = async (content: string, el: HTMLElement) => {
  try {
    el.innerHTML = '';
    await MarkdownRenderer.render(props.obsidianApp, content, el, '', renderComponent);
  } catch {
    el.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(content)}</pre>`;
  }
};

const escapeHtml = (text: string): string => {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const tryRenderPreview = async (content: string, mode: string) => {
  if (mode !== 'rendered' || !content) return;

  const renderKey = `${mode}::${content.substring(0, 100)}`;
  if (renderKey === lastRenderedKey) return;
  lastRenderedKey = renderKey;

  const maxRetries = 5;
  let retries = 0;

  const attemptRender = async () => {
    await nextTick();
    if (renderedEl.value) {
      console.log('[MobilePullDocModal] 开始渲染 markdown');
      await renderWithObsidian(content, renderedEl.value);
      console.log('[MobilePullDocModal] 渲染完成');
    } else if (retries < maxRetries) {
      retries++;
      console.log(`[MobilePullDocModal] renderedEl 还未准备好，重试 ${retries}/${maxRetries}`);
      setTimeout(attemptRender, 50);
    } else {
      console.warn('[MobilePullDocModal] renderedEl 始终未准备好');
    }
  };

  attemptRender();
};

watch([previewContent, isRenderedMode], async ([content, rendered]) => {
  console.log('[MobilePullDocModal] previewContent changed:', { contentLength: content?.length, rendered, hasRenderedEl: !!renderedEl.value });
  if (rendered) {
    lastRenderedKey = '';
    await tryRenderPreview(content || '', 'rendered');
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
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
  renderComponent.unload();
});
</script>

<style>
/* TDesign CSS Variables */
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

  /* Custom Variables */
  --panel-bg: #ffffff;
  --bg-secondary: #f5f5f5;
  --border-color: #e0e0e0;
  --text-primary: #333333;
  --text-placeholder: #999999;
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

  /* Custom Variables */
  --panel-bg: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --border-color: #3a3a3a;
  --text-primary: #cdd6f4;
  --text-placeholder: #6c7086;
}

.mobile-pull-doc-wrapper .mobile-panel {
  background: var(--panel-bg);
}

.mobile-pull-doc-wrapper .panel-header {
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .panel-title {
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .panel-content {
  background: var(--panel-bg);
}

.mobile-pull-doc-wrapper .doc-tree .tree-node,
.mobile-pull-doc-wrapper .tree-child-node {
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .tree-label,
.mobile-pull-doc-wrapper .info-label,
.mobile-pull-doc-wrapper .info-value {
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .doc-info {
  background: var(--bg-secondary);
}

.mobile-pull-doc-wrapper .preview-header .preview-title {
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .panel-footer {
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .cancel-btn {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .t-tabs__content {
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .expand-icon {
  color: var(--text-placeholder);
}

.mobile-pull-doc-wrapper .expand-icon.expanded {
  transform: rotate(90deg);
}

.mobile-pull-doc-wrapper .rendered-preview {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .rendered-preview h1,
.mobile-pull-doc-wrapper .rendered-preview h2,
.mobile-pull-doc-wrapper .rendered-preview h3 {
  margin-top: 1em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.mobile-pull-doc-wrapper .rendered-preview p {
  margin: 0.5em 0;
}

.mobile-pull-doc-wrapper .rendered-preview code {
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: Monaco, Menlo, monospace;
  font-size: 0.9em;
}

.mobile-pull-doc-wrapper .rendered-preview pre {
  background: var(--bg-secondary);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.mobile-pull-doc-wrapper .rendered-preview pre code {
  background: none;
  padding: 0;
}

/* TDesign Component Overrides */
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

.mobile-pull-doc-wrapper .t-input {
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .t-input__label {
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .t-textarea {
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .t-cell {
  border-color: var(--border-color);
}

.mobile-pull-doc-wrapper .t-cell__title {
  color: var(--text-primary);
}

.mobile-pull-doc-wrapper .t-cell__value {
  color: var(--text-secondary);
}

.mobile-pull-doc-wrapper .t-checkbox__label {
  color: var(--text-primary);
}
</style>
