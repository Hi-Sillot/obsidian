import { createApp, type App as VueApp, h, ref, computed, onMounted, onUnmounted, watch, nextTick, shallowRef } from 'vue';
import { Notice, MarkdownRenderer, Component, type App as ObsidianApp } from 'obsidian';
import {
	NTree,
	NSplit,
	NTabs,
	NTabPane,
	NInput,
	NInputGroup,
	NButton,
	NSpace,
	NSpin,
	NEmpty,
	NCard,
	NConfigProvider,
	NIcon,
	NText,
	NTag,
	NTooltip,
	darkTheme,
	lightTheme,
	type GlobalThemeOverrides,
	type TreeOption,
} from 'naive-ui';
import type { DocumentTreeService } from '../../sync/DocumentTreeService';
import type { DocTreeNode, PullSource, LocalExistenceResult } from '../../types';
import type { PermalinkIndexEntry } from '../../bridge/types';
import { useObsidianTheme } from './composables/useObsidianTheme';

export interface PullDocModalOptions {
	container: HTMLElement;
	obsidianApp: ObsidianApp;
	documentTreeService: DocumentTreeService;
	vaultRoot: string;
	githubRepo: string;
	githubBranch: string;
	siteDomain: string;
	docsDir: string;
	onClose: () => void;
	onDownload: (cloudPath: string, localSavePath: string, source: PullSource) => Promise<void>;
}

// 将 DocTreeNode 转换为 NTree 的 TreeOption 格式
// shallow=true 时只转换当前层，目录节点不设置 children，由 NTree 的 onLoad 异步加载
function convertDocTreeToOptions(nodes: DocTreeNode[], shallow: boolean = true): TreeOption[] {
	return nodes.map(node => ({
		key: node.path,
		label: node.name,
		isLeaf: node.type === 'file',
		prefix: () => h('span', { style: { fontSize: '14px', marginRight: '4px' } }, node.type === 'directory' ? '📁' : '📄'),
		children: (!shallow && node.children) ? convertDocTreeToOptions(node.children, false) : undefined,
	}));
}

export function createPullDocModal(options: PullDocModalOptions): {
	app: VueApp;
	unmount: () => void;
} {
	const { currentTheme, themeOverrides } = useObsidianTheme();

	// 标签页状态
	const activeTab = ref('tree');

	// 文档树状态
	const treeData = ref<TreeOption[]>([]);
	const expandedKeys = ref<string[]>([]);
	const selectedKeys = ref<string[]>([]);
	const isLoadingTree = ref(false);
	const docTreeRoot = ref<DocTreeNode | null>(null);
	const loadedPaths = new Set<string>();

	// 选中的文档信息
	const selectedPath = ref<string | null>(null);
	const selectedSource = ref<PullSource | null>(null);
	const previewContent = ref<string | null>(null);
	const localExistence = ref<LocalExistenceResult | null>(null);
	const localSavePath = ref('');
	const isLoadingPreview = ref(false);

	// 预览模式：source=源码, rendered=渲染
	const previewMode = ref<'source' | 'rendered'>('rendered');
	// 渲染容器（使用 shallowRef 确保响应式追踪）
	const renderedEl = shallowRef<HTMLElement | null>(null);
	// Obsidian MarkdownRenderer 需要的 Component 实例
	const renderComponent = new Component();
	renderComponent.load();
	// 防止重复渲染的标记
	let lastRenderedKey = '';

	// 清理渲染内容（解决模式切换时的 DOM 残留问题）
	const cleanupRenderedContent = () => {
		console.log('[PullDocModal] cleanupRenderedContent 调用, renderedEl:', !!renderedEl.value);
		if (renderedEl.value) {
			// 使用 Obsidian Component 的 unload 方法清理子组件和事件监听器
			try {
				renderComponent.unload();
				renderComponent.load(); // 重新加载以供下次使用
			} catch (e) {
				console.warn('[PullDocModal] Component unload 失败:', e);
			}
			// 清空容器内容（保留引用，因为 DOM 始终存在）
			renderedEl.value.empty();
			renderedEl.value.innerHTML = '';
			console.log('[PullDocModal] ✅ cleanup 完成');
		}
		lastRenderedKey = '';
	};

	// URL 输入状态
	const urlInputValue = ref('');
	const isParsingUrl = ref(false);

	// 下载状态
	const isDownloading = ref(false);

	// 搜索/过滤
	const pattern = ref('');
	const searchResults = ref<Array<PermalinkIndexEntry & { matchedField: string }>>([]);
	const isSearching = ref(false);
	const showSearchResults = ref(false);

	// 分割面板大小
	const splitSize = ref(0.35);

	// 基于 permalinkIndex 的全文搜索
	const performSearch = (query: string) => {
		if (!query.trim()) {
			searchResults.value = [];
			showSearchResults.value = false;
			return;
		}

		const permalinkIndex = options.documentTreeService.getPermalinkIndex();
		if (!permalinkIndex?.entries?.length) {
			searchResults.value = [];
			showSearchResults.value = false;
			return;
		}

		const lowerQuery = query.toLowerCase();
		const results: Array<PermalinkIndexEntry & { matchedField: string }> = [];
		const seen = new Set<string>();

		for (const entry of permalinkIndex.entries) {
			if (!entry.filePath) continue;
			if (seen.has(entry.filePath)) continue;

			let matchedField = '';
			if (entry.title?.toLowerCase().includes(lowerQuery)) {
				matchedField = '标题';
			} else if (entry.permalink?.toLowerCase().includes(lowerQuery)) {
				matchedField = '链接';
			} else if (entry.filePath?.toLowerCase().includes(lowerQuery)) {
				matchedField = '路径';
			} else if (entry.collection?.toLowerCase().includes(lowerQuery)) {
				matchedField = '集合';
			}

			if (matchedField) {
				seen.add(entry.filePath);
				results.push({ ...entry, matchedField });
			}
		}

		// 按匹配优先级排序：标题 > 链接 > 路径 > 集合
		const priority: Record<string, number> = { '标题': 0, '链接': 1, '路径': 2, '集合': 3 };
		results.sort((a, b) => (priority[a.matchedField] ?? 9) - (priority[b.matchedField] ?? 9));

		searchResults.value = results.slice(0, 50);
		showSearchResults.value = results.length > 0;
	};

	// 选中搜索结果
	const handleSearchResultSelect = async (entry: PermalinkIndexEntry) => {
		showSearchResults.value = false;
		pattern.value = '';

		if (!entry.filePath) return;

		// filePath 是 sourceRelPath（vault 相对路径），需要加 docsDir 前缀得到 GitHub 路径
		const docsDir = options.docsDir || 'docs';
		const cloudPath = `${docsDir}/${entry.filePath}`;

		selectedPath.value = cloudPath;
		selectedSource.value = defaultSource();
		localSavePath.value = options.documentTreeService.analyzeSavePath(cloudPath, options.vaultRoot);

		isLoadingPreview.value = true;
		try {
			previewContent.value = await options.documentTreeService.previewDocument(cloudPath, selectedSource.value);
			localExistence.value = await options.documentTreeService.checkLocalExistence(cloudPath);
			if (!localSavePath.value && localExistence.value?.localPath) {
				localSavePath.value = localExistence.value.localPath;
			}
		} catch (error) {
			console.error('[PullDocModal] 加载预览失败:', error);
			previewContent.value = null;
		} finally {
			isLoadingPreview.value = false;
		}
	};

	// 构建默认的 PullSource
	const defaultSource = (): PullSource => ({
		type: 'github',
		baseUrl: options.githubRepo,
		branch: options.githubBranch,
		docsDir: options.docsDir,
	});

	// 加载文档树（只加载根节点的直接子节点，子目录由 NTree 的 onLoad 异步加载）
	const loadDocumentTree = async () => {
		isLoadingTree.value = true;
		try {
			const source = defaultSource();
			const tree = await options.documentTreeService.fetchDocTree(source);
			docTreeRoot.value = tree;
			selectedSource.value = source;
			loadedPaths.add(tree.path);
			expandedKeys.value = [tree.path];
			if (tree.children) {
				// shallow=true：目录节点不设 children，触发 NTree 异步加载
				treeData.value = convertDocTreeToOptions(tree.children);
			}
		} catch (error) {
			console.error('[PullDocModal] 加载文档树失败:', error);
			new Notice('加载文档树失败');
		} finally {
			isLoadingTree.value = false;
		}
	};

	// NTree 异步加载回调：展开目录节点时按需加载子节点
	const handleTreeLoad = (node: TreeOption): Promise<void> => {
		return new Promise<void>(async (resolve) => {
			if (!selectedSource.value) {
				resolve();
				return;
			}
			const path = node.key as string;
			if (loadedPaths.has(path)) {
				// 已加载过的路径，children 已存在，直接 resolve
				resolve();
				return;
			}
			loadedPaths.add(path);

			try {
				const children = await options.documentTreeService.loadChildren(path, selectedSource.value);
				// shallow=true：子目录也不设 children，继续支持异步加载
				node.children = convertDocTreeToOptions(children);
			} catch (error) {
				console.error('[PullDocModal] 异步加载子节点失败:', error);
			}
			resolve();
		});
	};

	// 选中文档
	const handleTreeSelect = async (keys: string[]) => {
		if (keys.length === 0) return;
		const path = keys[0];
		selectedPath.value = path;
		selectedKeys.value = keys;
		selectedSource.value = defaultSource();

		// 更新保存路径
		localSavePath.value = options.documentTreeService.analyzeSavePath(path, options.vaultRoot);

		// 加载预览
		isLoadingPreview.value = true;
		try {
			previewContent.value = await options.documentTreeService.previewDocument(path, selectedSource.value);
			localExistence.value = await options.documentTreeService.checkLocalExistence(path);
			if (!localSavePath.value && localExistence.value?.localPath) {
				localSavePath.value = localExistence.value.localPath;
			}
		} catch (error) {
			console.error('[PullDocModal] 加载预览失败:', error);
			previewContent.value = null;
		} finally {
			isLoadingPreview.value = false;
		}
	};

	// 展开全部（仅展开已加载的目录节点，未加载的由 NTree onLoad 触发异步加载）
	const handleExpandAll = () => {
		if (!docTreeRoot.value) return;
		const allKeys: string[] = [];
		const collectKeys = (node: DocTreeNode) => {
			if (node.type === 'directory') {
				allKeys.push(node.path);
				if (node.children) {
					for (const child of node.children) {
						collectKeys(child);
					}
				}
			}
		};
		collectKeys(docTreeRoot.value);
		expandedKeys.value = allKeys;
	};

	const handleCollapseAll = () => {
		expandedKeys.value = docTreeRoot.value ? [docTreeRoot.value.path] : [];
	};

	// URL 解析
	const handleUrlParse = async () => {
		const url = urlInputValue.value.trim();
		if (!url) return;

		isParsingUrl.value = true;
		try {
			const result = options.documentTreeService.parseUrl(url);
			if (result) {
				selectedPath.value = result.path;
				selectedSource.value = result.source;
				localSavePath.value = options.documentTreeService.analyzeSavePath(result.path, options.vaultRoot);

				isLoadingPreview.value = true;
				try {
					previewContent.value = await options.documentTreeService.previewDocument(result.path, result.source);
					localExistence.value = await options.documentTreeService.checkLocalExistence(result.path);
					if (!localSavePath.value && localExistence.value?.localPath) {
						localSavePath.value = localExistence.value.localPath;
					}
				} catch {
					previewContent.value = null;
				} finally {
					isLoadingPreview.value = false;
				}

				// 解析成功提示
				if (result.title) {
					new Notice(`已定位：${result.title}`);
				}

			} else {
				new Notice('无法解析该 URL，请检查格式是否正确');
			}
		} finally {
			isParsingUrl.value = false;
		}
	};

	// 下载文档
	const handleDownload = async () => {
		if (!selectedPath.value || !selectedSource.value || !localSavePath.value) {
			new Notice('请先选择要下载的文档');
			return;
		}

		isDownloading.value = true;
		try {
			await options.onDownload(selectedPath.value, localSavePath.value, selectedSource.value);
		} finally {
			isDownloading.value = false;
		}
	};

	// 使用 Obsidian MarkdownRenderer 渲染 markdown 内容到指定 DOM 元素
	const renderWithObsidian = async (content: string, el: HTMLElement) => {
		try {
			// 先彻底清理容器：移除所有子节点和事件监听器
			el.empty();
			el.innerHTML = '';

			// 使用新的 Component 实例进行渲染，避免残留
			await MarkdownRenderer.render(options.obsidianApp, content, el, '', renderComponent);
		} catch (error) {
			console.error('[PullDocModal] Obsidian 渲染失败，回退为简单渲染:', error);
			el.empty();
			el.innerHTML = renderSimplePreview(content);
		}
	};

	// 双 Watch 分离策略：解决 ref 回调和 watch 时序问题
	// Watch 1: 监听内容变化，标记需要渲染
	// Watch 2: 监听 DOM 就绪，执行渲染

	const pendingRenderContent = ref<string | null>(null);

	// Watch 1: 内容/模式变化时，记录待渲染内容
	watch([previewContent, previewMode], ([content, mode]) => {
		console.log('[PullDocModal] [Watch1] 内容/模式变化:', { mode, hasContent: !!content });

		if (mode === 'rendered' && content) {
			pendingRenderContent.value = content;
			console.log('[PullDocModal] [Watch1] 设置待渲染内容');
		} else {
			pendingRenderContent.value = null;
			if (mode !== 'rendered') {
				cleanupRenderedContent();
			}
		}
	});

	// Watch 2: DOM 就绪且有待渲染内容时，执行渲染
	watch([() => renderedEl.value, pendingRenderContent], async ([el, content]) => {
		console.log('[PullDocModal] [Watch2] DOM/内容状态:', { 
			hasEl: !!el, 
			elTag: el?.tagName,
			hasContent: !!content,
			contentLength: content?.length 
		});

		if (!el || !content) {
			console.log('[PullDocModal] [Watch2] 跳过：DOM 或内容未就绪');
			return;
		}

		const renderKey = `${content.length}::${content.substring(0, 50)}`;
		console.log('[PullDocModal] [Watch2] 准备渲染:', { renderKey, lastRenderedKey });
		
		if (renderKey === lastRenderedKey) {
			console.log('[PullDocModal] [Watch2] 跳过渲染：内容未变化');
			return;
		}
		lastRenderedKey = renderKey;

		cleanupRenderedContent();
		await nextTick();

		try {
			renderWithObsidian(content, el);
			console.log('[PullDocModal] [Watch2] ✅ 渲染完成');
		} catch (error) {
			console.error('[PullDocModal] [Watch2] ❌ 渲染失败:', error);
			cleanupRenderedContent();
		}
	});

	// 简单 Markdown 预览渲染（回退方案）
	const renderSimplePreview = (content: string): string => {
		let html = content;
		html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
			const langClass = lang ? `language-${lang}` : '';
			return `<pre class="pull-doc-code-block ${langClass}"><code>${escapeHtml(code.trim())}</code></pre>`;
		});
		html = html.replace(/`([^`]+)`/g, '<code class="pull-doc-inline-code">$1</code>');
		html = html.replace(/^### (.*$)/gm, '<h4>$1</h4>');
		html = html.replace(/^## (.*$)/gm, '<h3>$1</h3>');
		html = html.replace(/^# (.*$)/gm, '<h2>$1</h2>');
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		html = html.replace(/\n/g, '<br>');
		const truncated = content.length > 5000
			? html + '<div style="color:var(--text-faint);font-size:12px;margin-top:8px">...(已截断，仅显示前 5000 字符)</div>'
			: html;
		return `<div class="pull-doc-markdown">${truncated}</div>`;
	};

	const escapeHtml = (text: string): string => {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	};

	// 格式化路径
	const formatPath = (path: string | null): string => {
		if (!path) return '';
		const parts = path.split('/');
		return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : path;
	};

	// 渲染信息面板
	const renderInfoPanel = () => {
		if (!selectedPath.value) return null;

		return h(NCard, { size: 'small', style: { flexShrink: '0' } }, {
			default: () => h(NSpace, { vertical: true, size: 8 }, {
				default: () => [
					// 云端路径
					h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
						h(NText, { depth: 3, style: { fontSize: '12px', flexShrink: '0' } }, { default: () => '📍 云端路径' }),
						h(NText, { style: { fontSize: '13px', wordBreak: 'break-all' } }, { default: () => selectedPath.value }),
					]),
					// 本地状态
					localExistence.value ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
						h(NText, { depth: 3, style: { fontSize: '12px', flexShrink: '0' } }, { default: () => '📥 本地状态' }),
						localExistence.value.exists
							? h(NTag, { size: 'small', type: 'warning' }, { default: () => `已存在 (${formatPath(localExistence.value!.localPath)})` })
							: h(NTag, { size: 'small', type: 'success' }, { default: () => '不存在' }),
					]) : null,
					// 保存路径
					h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
						h(NText, { depth: 3, style: { fontSize: '12px', flexShrink: '0' } }, { default: () => '💾 保存路径' }),
						h(NInput, {
							value: localSavePath.value,
							size: 'small',
							placeholder: '保存路径',
							onUpdateValue: (val: string) => { localSavePath.value = val; },
							style: { flex: '1' },
						}),
					]),
				],
			}),
		});
	};

	// 渲染预览面板
	const renderPreviewPanel = () => {
		if (!selectedPath.value) {
			return h('div', {
				style: {
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
				},
			}, [
				h(NEmpty, { description: '请选择或输入文档链接' }),
			]);
		}

		if (isLoadingPreview.value) {
			return h('div', {
				style: {
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
				},
			}, [
				h(NSpace, { vertical: true, align: 'center' }, {
					default: () => [
						h(NSpin, { size: 'large' }),
						h(NText, { depth: 3 }, { default: () => '加载预览中...' }),
					],
				}),
			]);
		}

		if (previewContent.value) {
			const content = previewContent.value;
			const mode = previewMode.value;
			// 使用 Naive UI NTabs 管理源码/渲染切换
			// display-directive="show" 确保 DOM 始终存在，ref 回调可靠执行
			return h(NTabs, {
				value: mode,
				'onUpdate:value': (val: string | number) => { previewMode.value = val as 'source' | 'rendered'; },
				type: 'segment',
				size: 'small',
				style: { height: '100%', display: 'flex', flexDirection: 'column' },
			}, {
				default: () => [
					h(NTabPane, {
						name: 'source',
						tab: '📝 源码',
						displayDirective: 'show',
					}, {
						default: () => h('div', {
							style: {
								padding: '12px',
								overflow: 'auto',
								height: '100%',
								maxHeight: 'calc(80vh - 180px)',
							},
						}, [
							h('pre', {
								style: {
									fontFamily: 'var(--font-monospace)',
									fontSize: '13px',
									lineHeight: '1.6',
									whiteSpace: 'pre-wrap',
									wordBreak: 'break-word',
									margin: '0',
									color: 'var(--text-normal)',
								},
							}, content),
						]),
					}),
					h(NTabPane, {
						name: 'rendered',
						tab: '📖 渲染',
						displayDirective: 'show',  // 关键：DOM 始终存在
					}, {
						default: () => h('div', {
							ref: (el: any) => {
								console.log('[PullDocModal] renderedEl ref 回调:', !!el, el?.tagName);
								if (el) renderedEl.value = el as HTMLElement;
							},
							style: {
								padding: '12px',
								overflow: 'auto',
								height: '100%',
								maxHeight: 'calc(80vh - 180px)',
							},
							class: 'markdown-rendered pull-doc-rendered',
						}),
					}),
				],
			});
		}

		return h('div', {
			style: {
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				height: '100%',
			},
		}, [
			h(NEmpty, { description: '无预览内容' }),
		]);
	};

	// 渲染文档树标签页
	const renderTreeTab = () => {
		const permalinkIndex = options.documentTreeService.getPermalinkIndex();
		const hasIndex = (permalinkIndex?.entries?.length ?? 0) > 0;

		return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } }, [
			// 搜索框 + 工具栏
			h('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', flexShrink: 0 } }, [
				h(NInput, {
					value: pattern.value,
					placeholder: hasIndex ? '搜索标题、链接、路径...' : '过滤文档树...',
					size: 'small',
					clearable: true,
					onUpdateValue: (val: string) => {
						pattern.value = val;
						if (hasIndex) {
							performSearch(val);
						}
					},
					onBlur: () => {
						setTimeout(() => { showSearchResults.value = false; }, 200);
					},
					style: { flex: '1' },
				}),
				h(NTooltip, {}, {
					trigger: () => h(NButton, { size: 'small', onClick: handleExpandAll }, { default: () => '展开' }),
					default: () => '展开全部',
				}),
				h(NTooltip, {}, {
					trigger: () => h(NButton, { size: 'small', onClick: handleCollapseAll }, { default: () => '折叠' }),
					default: () => '折叠全部',
				}),
			]),
			// 搜索结果列表（当有搜索词且有索引时显示）
			showSearchResults.value && searchResults.value.length > 0
				? h('div', {
					style: {
						flex: '1',
						overflow: 'auto',
						border: `1px solid ${currentTheme.value === 'dark' ? '#3a3a4a' : '#e0e0e0'}`,
						borderRadius: '6px',
						marginBottom: '8px',
					},
				}, searchResults.value.map(entry =>
					h('div', {
						style: {
							padding: '6px 10px',
							cursor: 'pointer',
							borderBottom: `1px solid ${currentTheme.value === 'dark' ? '#2a2a3a' : '#f0f0f0'}`,
							transition: 'background 0.15s',
						},
						onClick: () => handleSearchResultSelect(entry),
						onMouseenter: (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = currentTheme.value === 'dark' ? '#2a2a3a' : '#f5f5f5'; },
						onMouseleave: (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = ''; },
					}, [
						h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
							h(NText, { strong: true, style: { fontSize: '13px' } }, { default: () => entry.title || entry.filePath.split('/').pop() }),
							h(NTag, { size: 'tiny', type: 'info', bordered: false }, { default: () => entry.matchedField }),
							entry.collection ? h(NTag, { size: 'tiny', bordered: false }, { default: () => entry.collection }) : null,
						]),
						h(NText, { depth: 3, style: { fontSize: '11px' } }, { default: () => entry.filePath }),
					])
				))
				// 文档树（无搜索结果或无索引时显示）
				: isLoadingTree.value
					? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '1' } }, [
						h(NSpace, { vertical: true, align: 'center' }, {
							default: () => [
								h(NSpin, { size: 'large' }),
								h(NText, { depth: 3 }, { default: () => '加载文档树...' }),
							],
						}),
					])
					: h(NTree, {
						data: treeData.value,
						pattern: pattern.value,
						blockLine: true,
						selectable: true,
						expandOnClick: true,
						virtualScroll: true,
						expandedKeys: expandedKeys.value,
						selectedKeys: selectedKeys.value,
						onLoad: handleTreeLoad,
						'onUpdate:expandedKeys': (keys: string[]) => { expandedKeys.value = keys; },
						'onUpdate:selectedKeys': handleTreeSelect,
						style: { flex: '1', overflow: 'auto' },
					}, {
						empty: () => h(NEmpty, { description: '暂无文档' }),
					}),
		]);
	};

	// 渲染 URL 标签页
	const renderUrlTab = () => {
		return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } }, [
			h('div', { style: { marginBottom: '12px', flexShrink: 0 } }, [
				h(NInputGroup, {}, {
					default: () => [
						h(NInput, {
							value: urlInputValue.value,
							placeholder: '粘贴 GitHub 或站点文档链接...',
							size: 'small',
							onUpdateValue: (val: string) => { urlInputValue.value = val; },
							onKeydown: (e: KeyboardEvent) => {
								if (e.key === 'Enter' && urlInputValue.value) {
									handleUrlParse();
								}
							},
						}),
						h(NButton, {
							type: 'primary',
							size: 'small',
							loading: isParsingUrl.value,
							onClick: handleUrlParse,
						}, { default: () => '解析' }),
					],
				}),
				h(NText, { depth: 3, style: { fontSize: '12px', marginTop: '4px', display: 'block' } }, {
					default: () => '支持的格式：GitHub 文件链接、Raw 链接、站点文档链接',
				}),
			]),
			!selectedPath.value
				? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '1' } }, [
					h(NEmpty, { description: '请粘贴文档链接后点击「解析」' }),
				])
				: null,
		]);
	};

	// 主布局
	const MainPanel = {
		setup() {
			onMounted(async () => {
				await loadDocumentTree();
			});

			return () => h(NConfigProvider, {
				theme: currentTheme.value === 'dark' ? darkTheme : lightTheme,
				themeOverrides: themeOverrides.value,
			}, {
				default: () => h('div', {
					style: {
						height: '100%',
						display: 'flex',
						flexDirection: 'column',
						gap: '12px',
					},
				}, [
					// 标题
					h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 } }, [
						h('h2', { style: { margin: 0, fontSize: '18px', fontWeight: 600 } }, '从云端拉取文档'),
					]),

					// NSplit 左右分割布局
					h(NSplit, {
						direction: 'horizontal',
						size: splitSize.value,
						'onUpdate:size': (val: number) => { splitSize.value = val; },
						min: 0.2,
						max: 0.6,
						style: { flex: '1', minHeight: '0' },
					}, {
						1: () => h('div', {
							style: {
								height: '100%',
								display: 'flex',
								flexDirection: 'column',
								overflow: 'hidden',
							},
						}, [
							// 标签页
							h(NTabs, {
								value: activeTab.value,
								type: 'line',
								size: 'small',
								'onUpdate:value': (val: string) => { activeTab.value = val; },
								style: { flexShrink: 0 },
							}, {
								default: () => [
									h(NTabPane, { name: 'tree', tab: '📁 文档树' }, {
										default: () => renderTreeTab(),
									}),
									h(NTabPane, { name: 'url', tab: '🔗 URL' }, {
										default: () => renderUrlTab(),
									}),
								],
							}),
							// 信息面板
							renderInfoPanel(),
						]),
						2: () => h('div', {
							style: {
								height: '100%',
								display: 'flex',
								flexDirection: 'column',
								overflow: 'hidden',
							},
						}, [
							// 预览标题（NTabs 已内置切换按钮，无需额外按钮）
							h('div', { style: { marginBottom: '8px', flexShrink: 0 } }, [
								h(NText, { strong: true, style: { fontSize: '14px' } }, { default: () => '预览' }),
							]),
							// 预览内容（NTabs 内置源码/渲染切换）
							h(NCard, {
								size: 'small',
								style: { flex: '1', overflow: 'auto', minHeight: '0' },
								contentStyle: { padding: '8px', height: '100%', overflow: 'auto' },
							}, {
								default: () => renderPreviewPanel(),
							}),
						]),
					}),

					// 底部操作栏
					h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0, paddingTop: '8px', borderTop: `1px solid ${currentTheme.value === 'dark' ? '#3a3a4a' : '#e0e0e0'}` } }, [
						h(NButton, { onClick: options.onClose }, { default: () => '取消' }),
						h(NButton, {
							type: 'primary',
							loading: isDownloading.value,
							disabled: !selectedPath.value || !localSavePath.value,
							onClick: handleDownload,
						}, {
							default: () => localExistence.value?.exists ? '下载/覆盖' : '下载文档',
						}),
					]),
				]),
			});
		},
	};

	const container = options.container;
	container.className = 'sillot-naive-modal';
	container.innerHTML = '';

	const app = createApp(MainPanel);
	app.mount(container);

	return {
		app,
		unmount: () => {
			// 先清理所有渲染内容
			cleanupRenderedContent();
			// 卸载 Component
			try {
				renderComponent.unload();
			} catch (e) {
				console.warn('[PullDocModal] unmount Component 失败:', e);
			}
			app.unmount();
			container.innerHTML = '';
		},
	};
}
