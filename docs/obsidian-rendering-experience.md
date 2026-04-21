# Obsidian Markdown 渲染经验总结

## 核心机制

### MarkdownPostProcessor 工作原理

Obsidian 使用 `MarkdownPostProcessor` 对已渲染的 HTML 进行后处理：

```typescript
this.plugin.registerMarkdownPostProcessor((el, ctx) => {
    // el: 已渲染的 HTMLElement（非原始 Markdown）
    // ctx: MarkdownPostProcessorContext
});
```

**关键点**：`el` 是 Obsidian 内部 Markdown 解析器已经渲染好的 HTML 元素，不是原始 Markdown 源码。

### Section 拆分机制

Obsidian 将 Markdown 文档按块级元素拆分为多个 section，每个 section 独立触发一次 `MarkdownPostProcessor`。拆分规则：

- 段落、标题、列表、代码块等各自成为独立 section
- `:::` 标记会被 Obsidian 识别为块级边界，创建独立 section
- `::::`（4+冒号）**不被** Obsidian 识别，会作为普通文本处理

## 常见陷阱与解决方案

### 1. `el.textContent` 丢失 Markdown 格式

**问题**：`el.textContent` 提取的是已渲染 HTML 的纯文本，所有 Markdown 格式标记都会丢失。

| 原始 Markdown | `el.textContent` 结果 |
|---|---|
| `- 列表项` | `列表项`（丢失 `- `） |
| `**加粗**` | `加粗`（丢失 `**`） |
| `` `代码` `` | `代码`（丢失反引号） |
| `::: info` | `info`（丢失 `:::`） |

**解决方案**：使用 `ctx.getSectionInfo(el)` 获取原始 Markdown 源码：

```typescript
private getSectionRawMarkdown(el: HTMLElement, ctx: MarkdownPostProcessorContext): string {
    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo) {
        const lines = sectionInfo.text.split('\n');
        const rawLines = lines.slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);
        return rawLines.join('\n').trim();
    }
    return el.textContent?.trim() || '';  // fallback
}
```

`getSectionInfo` 返回 `{text, lineStart, lineEnd}`，其中 `text` 是整个文档的原始 Markdown。

### 2. 异步竞态条件

**问题**：`MarkdownRenderer.render()` 是异步的，在 `await` 期间，后续 section 的 `processSection` 可能已经执行，导致：

- 递归调用：`MarkdownRenderer.render` 触发的 postProcessor 找到 pending container 并累积内容
- 重复 finalize：多个 section 同时触发 `finalizeContainer`

**解决方案**：在 `finalizeContainer` 中，**先删除 pending container 再 await 渲染**：

```typescript
private async finalizeContainer(ctx, pending) {
    this.pendingContainers.delete(ctx.sourcePath);  // 先删除
    await this.processContainerInline(...);          // 再渲染
}
```

### 3. 嵌套容器语法

**问题**：`:::` 容器内嵌套 `:::` 容器时，闭合标记会匹配错误。

**解决方案**：使用多冒号层级约定（与 VuePress/markdown-it 一致）：

```
::: container       ← 3冒号（外层）
  :::: container    ← 4冒号（内层）
  ::::
:::                  ← 3冒号闭合外层
```

**逐级嵌套约定**：
- 少冒号包多冒号（`:::` → `::::` → `:::::`）
- 闭合标记的冒号数必须与开标记匹配
- 多冒号容器内不会出现少冒号容器

**解析逻辑**：

```typescript
// 检查闭合标记（优先级最高）
if (lastColons === pending.colons && lines.length > 1) { /* 闭合 */ }

// 检查嵌套层级（更多冒号 = 更深层）
if (firstColons > pending.colons) { /* 作为内容累积 */ }

// 层级违规（同级或更少冒号出现在内部）
if (firstColons >= 3 && firstColons <= pending.colons) { /* 强制关闭当前容器 */ }
```

### 4. `MarkdownRenderer.render` 不识别自定义容器语法

**问题**：`MarkdownRenderer.render` 只识别 Obsidian 原生语法，不识别 `::::` 等自定义容器标记。嵌套容器内容会被当作纯文本渲染。

**解决方案**：递归内容渲染。在调用 `MarkdownRenderer.render` 之前，先解析内容中的容器块，单独渲染，再组合：

```typescript
private async renderContentToElement(contentText, targetEl, ctx) {
    const segments = this.parseContentSegments(contentText);
    for (const segment of segments) {
        if (segment.type === 'container') {
            // 递归渲染嵌套容器
            const container = await this.buildContainerElement(...);
            targetEl.appendChild(container);
        } else {
            // 普通文本用 MarkdownRenderer.render
            await MarkdownRenderer.render(...);
        }
    }
}
```

`parseContentSegments` 逐行扫描内容，识别容器开/闭标记，将内容拆分为"文本段"和"容器段"。

## Obsidian 与 VuePress Markdown 差异

| 特性 | VuePress (markdown-it) | Obsidian |
|---|---|---|
| `:::` 容器 | 原生支持（插件） | 部分识别为块级元素 |
| `::::` 嵌套 | 原生支持 | 不识别，需自行处理 |
| `@tab` 语法 | 原生支持（插件） | 不识别，需自行处理 |
| `[[wikilink]]` | 不支持 | 原生支持 |
| 代码块内的 `:::` | 正确忽略 | 可能误识别 |
| Section 拆分 | 不拆分 | 按块级元素拆分 |
| 自定义 HTML 标签 | 正常渲染 | 被 sanitizer 完全剥离 |
| inline style | 正常渲染 | 被 sanitizer 剥离 |

## HTML Sanitizer 限制

### 自定义 HTML 标签被完全剥离

Obsidian 的 Markdown 渲染器内置 HTML sanitizer，会**完全移除**不在白名单中的 HTML 标签。白名单仅包含标准 HTML 元素（`<div>`、`<span>`、`<a>` 等），自定义组件标签会被丢弃。

**受影响的标签**：

| 原始 Markdown | Obsidian 渲染结果 |
|---|---|
| `<GithubLabel label="bug" color="ee0701" />` | 完全消失（空文本） |
| `<VSCodeSettingsLink id="editor.fontSize" />` | 完全消失（空文本） |
| `<BannerTopArchived />` | 完全消失（空文本） |

**关键点**：这些标签不是被转义为纯文本，而是被**完全剥离**。DOM 中不存在任何痕迹，`processGithubLabelTags` 在文本节点中搜索 `<GithubLabel` 永远找不到。

### inline style 被剥离

Obsidian sanitizer 会移除 HTML 元素上的 `style` 属性：

```html
<!-- 原始 Markdown -->
<span style="color: red;">红色文字</span>

<!-- Obsidian 渲染后 -->
<span>红色文字</span>
```

**解决方案**：通过 `restoreStrippedStyles` 在后处理阶段重新注入：

```typescript
private restoreStrippedStyles(el: HTMLElement, rawMarkdown: string) {
    const styleRegex = /<(\w+)\s+style="([^"]+)">/g;
    let match;
    while ((match = styleRegex.exec(rawMarkdown)) !== null) {
        const elements = Array.from(el.querySelectorAll(match[1]));
        for (const elem of elements) {
            if (!elem.getAttribute('style')) {
                elem.setAttribute('style', match[2]);
            }
        }
    }
}
```

### 自定义组件预处理方案

**核心思路**：在 Obsidian 渲染之前，将自定义组件标签转换为 Obsidian 能保留的格式（行内代码），渲染后再替换为实际 UI。

**第一步：预处理原始 Markdown**

```typescript
private preprocessCustomComponentMarkdown(text: string): string {
    let result = text;

    // <GithubLabel label="bug" color="ee0701" /> → `GithubLabel:bug:ee0701`
    result = result.replace(
        /<GithubLabel\s+(?:name|label)="([^"]+)"(?:\s+color="([^"]+)")?\s*\/?>/g,
        (_, name, color) => `\`GithubLabel:${name}${color ? ':' + color : ''}\``
    );

    // <VSCodeSettingsLink id="editor.fontSize" /> → `VSCodeSetting:editor.fontSize`
    result = result.replace(
        /<VSCodeSettingsLink\s+id="([^"]+)"\s*\/?>/g,
        (_, id) => `\`VSCodeSetting:${id}\``
    );

    // <BannerTopArchived /> → `BannerTopArchived`
    result = result.replace(
        /<BannerTopArchived\s*\/?>/g,
        '`BannerTopArchived`'
    );

    return result;
}
```

**第二步：重新渲染 section**

```typescript
const hasCustomComponent = /<(GithubLabel|VSCodeSettingsLink|BannerTopArchived)/.test(text);

if (hasCustomComponent) {
    const preprocessed = this.preprocessCustomComponentMarkdown(text);
    el.empty();
    await MarkdownRenderer.render(this.plugin.app, preprocessed, el, ctx.sourcePath, this.plugin);
    this.processInlineComponents(el);
    return;
}
```

**第三步：后处理替换行内代码**

Obsidian 渲染 `` `GithubLabel:bug:ee0701` `` 后产生 `<code>GithubLabel:bug:ee0701</code>`，`processGithubLabelInline` 检测并替换：

```typescript
private processGithubLabelInline(el: HTMLElement) {
    const codeElements = el.querySelectorAll('code');
    for (const codeEl of codeElements) {
        const text = codeEl.textContent || '';
        const match = text.match(/^GithubLabel:(\w+)(?::([a-fA-F0-9]{6}))?$/);
        if (match) {
            const name = match[1];
            const color = match[2] ? `#${match[2]}` : GITHUB_LABEL_COLORS[name] || '#ededed';
            const span = document.createElement('span');
            span.className = 'sillot-github-label';
            span.textContent = name;
            span.style.backgroundColor = color;
            span.style.color = this.isLightColor(color) ? '#1b1f23' : '#ffffff';
            codeEl.replaceWith(span);
        }
    }
}
```

**完整流程**：

```
原始 Markdown: <GithubLabel label="bug" color="ee0701" />
    ↓ preprocessCustomComponentMarkdown
预处理后: `GithubLabel:bug:ee0701`
    ↓ MarkdownRenderer.render
DOM: <code>GithubLabel:bug:ee0701</code>
    ↓ processGithubLabelInline
最终 DOM: <span class="sillot-github-label" style="background-color:#ee0701;color:#fff">bug</span>
```

## CSS 主题同步（plume 兼容）

### class 命名差异

VuePress plume 主题的容器 class 格式为**类型独立 class**：

```html
<!-- plume 主题格式 -->
<div class="hint-container info">...</div>
<div class="hint-container tip">...</div>
<div class="hint-container details">...</div>
```

**错误做法**（类型作为 class 前缀）：

```html
<div class="hint-container hint-container-info">...</div>
```

这会导致 CSS 选择器 `.hint-container.info` 永远匹配不上。

**正确做法**：

```typescript
container.className = `hint-container ${type}`;
```

### CSS 选择器格式

```css
/* ✅ 正确：与 plume 一致 */
.hint-container.info { ... }
.hint-container.tip { ... }
.hint-container.danger .hint-container-title::before { ... }

/* ❌ 错误：无法匹配 plume 的 class 结构 */
.hint-container-info { ... }
.hint-container-tip { ... }
```

### CSS 变量注入

plume 主题依赖大量 `--vp-c-*` CSS 变量（颜色、间距等），Obsidian 原生不提供这些变量。需要在插件 CSS 中完整注入：

```css
:root {
    /* 品牌色 */
    --vp-c-brand-1: var(--vp-c-turquoise-1);
    --vp-c-brand-2: var(--vp-c-turquoise-2);
    --vp-c-brand-3: var(--vp-c-turquoise-3);

    /* 灰度 */
    --vp-c-gray-1: #dddde3;
    --vp-c-gray-2: #e4e4e9;
    --vp-c-gray-3: #ebebef;

    /* 文本色 */
    --vp-c-text-1: rgba(60 60 67);
    --vp-c-text-2: rgba(60 60 67 / 0.78);

    /* 容器专用变量 */
    --vp-custom-block-info-text: var(--vp-c-text-2);
    --vp-custom-block-info-bg: var(--vp-c-default-soft);
    --vp-custom-block-info-border: transparent;
    /* ... 其他容器类型 */
}

.theme-dark {
    --vp-c-gray-1: #515c67;
    --vp-c-gray-2: #414853;
    --vp-c-gray-3: #32363f;
    --vp-c-text-1: rgba(235 235 245 / 0.98);
    --vp-c-text-2: rgba(235 235 245 / 0.6);
    /* ... 暗色覆盖 */
}
```

**暗色模式**：Obsidian 在暗色模式下会给 `<body>` 添加 `.theme-dark` class，所以用 `.theme-dark` 选择器覆盖变量即可。

### 容器图标：SVG vs Emoji

plume 主题使用 SVG 图标作为容器标题前缀，而非 emoji：

```css
/* ✅ 正确：SVG 图标（与 plume 一致） */
.hint-container-title::before {
    display: inline-block;
    width: 1.25em;
    height: 1.25em;
    margin-right: 4px;
    vertical-align: middle;
    content: "";
    background-repeat: no-repeat;
    background-size: 100%;
    transform: translateY(-1px);
}

.hint-container.info .hint-container-title::before {
    background-image: url("data:image/svg+xml,...");
}

/* ❌ 问题：Emoji 在不同系统渲染不一致 */
.hint-container-info .hint-container-title::before {
    content: 'ℹ️ ';
}
```

**SVG 图标优势**：
- 跨平台渲染一致
- 颜色可通过 SVG fill 属性控制
- 与 plume 主题视觉完全一致

### 变量来源

CSS 变量从 plume 主题源码同步：

- 颜色变量：`plume/node_modules/vuepress-theme-plume/lib/client/styles/vars.css`
- 容器样式：`plume/node_modules/vuepress-theme-plume/lib/client/styles/hint-container.css`

更新插件样式时，应从这两个文件同步最新值。

## 渲染架构总结

```
processSection(el, ctx)
  ├── 获取原始 Markdown（getSectionRawMarkdown）
  ├── 检查纯闭合标记（::: / ::::）
  ├── 有 pending 容器？
  │   ├── 检查 section 末尾闭合标记
  │   ├── 检查嵌套层级（冒号数比较）
  │   ├── 层级违规 → 强制关闭 + 递归重处理
  │   └── 普通内容累积
  ├── 新开标记？
  │   ├── 单 section 容器 → 直接渲染
  │   └── 多 section 容器 → 创建 pending
  ├── 自定义组件标签？
  │   ├── preprocessCustomComponentMarkdown（转换为行内代码）
  │   ├── MarkdownRenderer.render（重新渲染）
  │   └── processInlineComponents（替换行内代码为 UI）
  └── 普通文本 → processInlineComponents

finalizeContainer(ctx, pending)
  ├── 先删除 pending（防竞态）
  └── processContainerInline → create*FromText
      └── renderContentToElement（递归）
          ├── parseContentSegments（拆分文本/容器段）
          ├── 容器段 → buildContainerElement（递归）
          └── 文本段 → MarkdownRenderer.render

processInlineComponents(el)
  ├── processGithubLabelTags（DOM 文本节点搜索，已被 sanitizer 阻断）
  ├── processVSCodeLinkTags（同上）
  ├── processGithubLabelInline（<code> 节点替换，预处理后的主路径）
  ├── processVSCodeLinkInline（同上）
  ├── processBannerInline（<code> 节点替换，使用 BANNER_MAP）
  ├── processBannerArchived（DOM 文本节点搜索，fallback）
  ├── processVideoTabsInline（视频选项卡）
  ├── processVideoInline（视频嵌入）
  └── processVideoEmbeds（@[bilibili] 嵌入）
```

## 共享数据方案：Vue ↔ Obsidian 组件同步

### 问题背景

GithubLabel 等组件在 VuePress 和 Obsidian 中各有一套数据定义：

- **Vue 版本**：`GithubLabel.vue` 内嵌 `LABEL_MAP`，包含 `fullName`（含 emoji）和 `color`（RGB + HSL 完整色彩数据）
- **Obsidian 版本**：`SyntaxRegistry.ts` 内嵌 `GITHUB_LABEL_COLORS`，仅包含简写名称和十六进制颜色

两套数据各自维护，修改一方时容易遗漏另一方，导致渲染效果不一致。

### 解决方案：共享 TypeScript 数据文件

将组件数据提取到共享的 `.ts` 文件，Vue 和 Obsidian 各自导入该文件：

```
plume/docs/.vuepress/plugins/vuepress-plugin-sillot-inline/
├── shared/
│   └── component-data.ts    ← 唯一数据源（LABEL_MAP, BANNER_MAP）
├── components/
│   └── GithubLabel.vue      ← import { LABEL_MAP } from '../shared/component-data.ts'
└── styles/
    └── github_labels.css    ← CSS 感知亮度算法（Vue 和 Obsidian 共用逻辑）

obsidian/src/bridge/
└── SyntaxRegistry.ts         ← import { LABEL_MAP, BANNER_MAP } from '../../../plume/.../component-data.ts'
```

### 共享数据结构

```typescript
// component-data.ts
export interface LabelColor {
  r: number; g: number; b: number;  // RGB（用于背景色计算）
  h: number; s: number; l: number;  // HSL（用于暗色模式亮度调整）
}

export interface LabelEntry {
  fullName: string;    // 完整显示名（含 emoji），如 "- - - Bug 🩸"
  color: LabelColor;
}

export const LABEL_MAP: Record<string, LabelEntry> = {
  Bug: {
    fullName: '- - - Bug 🩸',
    color: { r: 255, g: 26, b: 42, h: 355, s: 100, l: 55 }
  },
  // ...
};

export const BANNER_MAP: Record<string, { icon: string; text: string; cls: string }> = {
  Archived: { icon: '📦', text: '此项目已归档', cls: 'sillot-banner-archived' },
  // ...
};
```

### Obsidian 渲染改进

使用共享数据后，Obsidian 插件的 GithubLabel 渲染从简单 `backgroundColor` 升级为 **CSS 变量 + 感知亮度算法**，与 Vue 版本完全一致：

**之前（简化版）**：

```typescript
span.textContent = name;  // 仅显示简写名
span.style.backgroundColor = color;  // 简单十六进制色
span.style.color = isLight ? '#1b1f23' : '#ffffff';  // 简单亮度判断
```

**之后（完整版）**：

```typescript
span.textContent = entry?.fullName || name;  // 显示完整名（含 emoji）
// 设置 CSS 变量，由 CSS 感知亮度算法自动计算颜色
span.style.setProperty('--label-r', String(entry.color.r));
span.style.setProperty('--label-g', String(entry.color.g));
span.style.setProperty('--label-b', String(entry.color.b));
span.style.setProperty('--label-h', String(entry.color.h));
span.style.setProperty('--label-s', String(entry.color.s));
span.style.setProperty('--label-l', String(entry.color.l));
```

### CSS 感知亮度算法

Vue 版本的 `github_labels.css` 使用 CSS 自定义属性实现感知亮度计算，Obsidian 版本已同步：

```css
.sillot-github-label {
    /* 感知亮度计算（ITU-R BT.709） */
    --perceived-lightness: calc(
        ((var(--label-r) * 0.2126) + (var(--label-g) * 0.7152) + (var(--label-b) * 0.0722)) / 255
    );
    --lightness-threshold: 0.453;
    --lightness-switch: max(0, min(calc(
        1 / (var(--lightness-threshold) - var(--perceived-lightness))
    ), 1));
    --border-threshold: 0.96;
    --border-alpha: max(0, min(calc(
        (var(--perceived-lightness) - var(--border-threshold)) * 100
    ), 1));

    /* 亮色模式：实色背景 + 自动文字颜色 */
    color: hsl(0deg, 0%, calc(var(--lightness-switch) * 100%));
    background: rgb(var(--label-r), var(--label-g), var(--label-b));
    border-color: hsla(var(--label-h), calc(var(--label-s) * 1%),
        calc((var(--label-l) - 25) * 1%), var(--border-alpha));
}

.theme-dark .sillot-github-label {
    /* 暗色模式：半透明背景 + 亮度提升 */
    --lightness-threshold: 0.6;
    --background-alpha: 0.18;
    --border-alpha: 0.3;
    --lighten-by: calc(
        ((var(--lightness-threshold) - var(--perceived-lightness)) * 100)
        * var(--lightness-switch)
    );
    color: hsl(var(--label-h), calc(var(--label-s) * 1%),
        calc((var(--label-l) + var(--lighten-by)) * 1%));
    background: rgba(var(--label-r), var(--label-g), var(--label-b), var(--background-alpha));
    border-color: hsla(var(--label-h), calc(var(--label-s) * 1%),
        calc((var(--label-l) + var(--lighten-by)) * 1%), var(--border-alpha));
}
```

**算法优势**：
- 亮色模式：背景色过亮时自动使用深色文字，过暗时使用白色文字
- 暗色模式：背景色变为半透明，文字亮度自动提升，边框颜色同步调整
- 边框：根据感知亮度自动决定是否显示边框及边框透明度
- 无需 JavaScript `isLightColor()` 计算，纯 CSS 实现

### 构建配置

esbuild 的 `bundle: true` 会自动将共享文件内联到输出中，无需额外配置。TypeScript 需启用 `allowImportingTsExtensions` 和 `noEmit`：

```json
// tsconfig.json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

### 同步更新流程

修改组件数据时只需编辑 `component-data.ts`，重新构建两个项目即可同步：

1. 编辑 `plume/.../shared/component-data.ts`
2. `cd plume && bun run build` → VuePress 站点更新
3. `cd obsidian && bun run build` → Obsidian 插件更新（esbuild 自动 bundle 共享数据）

**不再需要**：手动在 `SyntaxRegistry.ts` 中同步 `GITHUB_LABEL_COLORS` 或 `BANNER_CONFIG`。
