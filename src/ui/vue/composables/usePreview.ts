import { ref, nextTick } from 'vue';
import { MarkdownRenderer, Component } from 'obsidian';
import type { DocumentTreeService } from '../../../sync/DocumentTreeService';
import type { PullSource, LocalExistenceResult } from '../../../types';

export function usePreview(documentTreeService: DocumentTreeService, obsidianApp: any) {
  const previewContent = ref<string | null>(null);
  const previewError = ref<string | null>(null);
  const localExistence = ref<LocalExistenceResult | null>(null);
  const localSavePath = ref('');
  const isLoadingPreview = ref(false);
  const isRenderedMode = ref(true);
  const renderedEl = ref<HTMLElement | null>(null);

  const renderComponent = new Component();
  renderComponent.load();
  let lastRenderedKey = '';

  const escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const renderWithObsidian = async (content: string, el: HTMLElement) => {
    try {
      el.innerHTML = '';
      await MarkdownRenderer.render(obsidianApp, content, el, '', renderComponent);
    } catch {
      el.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(content)}</pre>`;
    }
  };

  const loadPreview = async (path: string, source: PullSource) => {
    isLoadingPreview.value = true;
    previewError.value = null;
    try {
      previewContent.value = await documentTreeService.previewDocument(path, source);
      localExistence.value = await documentTreeService.checkLocalExistence(path);
      if (!localSavePath.value && localExistence.value?.localPath) {
        localSavePath.value = localExistence.value.localPath;
      }
    } catch (error) {
      previewContent.value = null;
      previewError.value = error instanceof Error ? error.message : '加载预览失败';
    } finally {
      isLoadingPreview.value = false;
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

  return {
    previewContent,
    previewError,
    localExistence,
    localSavePath,
    isLoadingPreview,
    isRenderedMode,
    renderedEl,
    renderComponent,
    loadPreview,
    tryRenderPreview,
  };
}
