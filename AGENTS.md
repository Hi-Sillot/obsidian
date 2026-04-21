# Obsidian community plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.

## Environment & tooling

- Node.js: use current LTS (Node 18+ recommended).
- **Package manager: npm** (required for this sample - `package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (required for this sample - `esbuild.config.mjs` and build scripts depend on it). Alternative bundlers like Rollup or webpack are acceptable for other projects if they bundle all external dependencies into `main.js`.
- Types: `obsidian` type definitions.

**Note**: This sample project has specific technical dependencies on npm and esbuild. If you're creating a plugin from scratch, you can choose different tools, but you'll need to replace the build configuration accordingly.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

## Linting

- To use eslint install eslint from terminal: `npm install -g eslint`
- To use eslint to analyze this project use this command: `eslint main.ts`
- eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder: `eslint ./src/`

## File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Example file structure**:
  ```
  src/
    main.ts           # Plugin entry point, lifecycle management
    settings.ts       # Settings interface and defaults
    commands/         # Command implementations
      command1.ts
      command2.ts
    ui/              # UI components, modals, views
      modal.ts
      view.ts
    utils/           # Utility functions, helpers
      helpers.ts
      constants.ts
    types.ts         # TypeScript interfaces and types
  ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- Must include (non-exhaustive):  
  - `id` (plugin ID; for local dev it should match the folder name)  
  - `name`  
  - `version` (Semantic Versioning `x.y.z`)  
  - `minAppVersion`  
  - `description`  
  - `isDesktopOnly` (boolean)  
  - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` (if any) to:
  ```
  <Vault>/.obsidian/plugins/<plugin-id>/
  ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` to map plugin version → minimum app version.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` (if present) to the release as individual assets.
- After the initial release, follow the process to add/update your plugin in the community catalog as required.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

## Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

## Agent do/don't

**Do**
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**
- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Common tasks

### Organize code across multiple files

**main.ts** (minimal, lifecycle only):
```ts
import { Plugin } from "obsidian";
import { MySettings, DEFAULT_SETTINGS } from "./settings";
import { registerCommands } from "./commands";

export default class MyPlugin extends Plugin {
  settings: MySettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    registerCommands(this);
  }
}
```

**settings.ts**:
```ts
export interface MySettings {
  enabled: boolean;
  apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
  enabled: true,
  apiKey: "",
};
```

**commands/index.ts**:
```ts
import { Plugin } from "obsidian";
import { doSomething } from "./my-command";

export function registerCommands(plugin: Plugin) {
  plugin.addCommand({
    id: "do-something",
    name: "Do something",
    callback: () => doSomething(plugin),
  });
}
```

### Add a command

```ts
this.addCommand({
  id: "your-command-id",
  name: "Do the thing",
  callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(this.app.workspace.on("file-open", f => { /* ... */ }));
this.registerDomEvent(window, "resize", () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

## Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`. 
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide

## Panel conventions

All custom `ItemView` side panels must follow these conventions:

### Header with close button

Every panel must include a header row with the panel title and a close button. Use the shared CSS classes:

```ts
const headerRow = container.createDiv({ cls: 'sillot-panel-header' });
headerRow.createEl('h4', { text: 'Panel Title' });
const closeBtn = headerRow.createEl('button', { cls: 'sillot-panel-close-btn', attr: { title: '关闭面板' } });
closeBtn.innerHTML = '✕';
closeBtn.onclick = () => { this.leaf.detach(); };
```

### Shared CSS classes

| Class | Purpose |
|---|---|
| `sillot-panel-header` | Flex row: title left, close button right |
| `sillot-panel-close-btn` | Small button with ✕, used for close and toolbar actions |
| `sillot-panel-close-btn--icon` | Variant for icon-only buttons (← → ↻ ⤴) |

### Rules

- Always use `sillot-panel-header` for the header row — never create panel-specific header classes.
- Always use `sillot-panel-close-btn` for close/action buttons — never create panel-specific button classes.
- Close button calls `this.leaf.detach()` to remove the panel from the workspace.
- For icon-only toolbar buttons (navigation, refresh, etc.), add the `sillot-panel-close-btn--icon` modifier.
- Do not duplicate these styles in panel-specific CSS.

## Pagination conventions

All `ItemView` panels that display list/table data must use the shared `PaginationBar` component from `src/ui/PaginationBar.ts`. This component encapsulates pagination, search (with `||` / `&&` operators), and column-scope filtering.

### PaginationBar component

Location: `src/ui/PaginationBar.ts`

The `PaginationBar` class provides:

- **Pagination**: page navigation with prev/next, page number buttons, and ellipsis
- **Search**: text search with `||` (OR) and `&&` (AND) operator support
- **Column filter**: popup checkbox control to limit which columns are searched

#### Constructor

```ts
const paginationBar = new PaginationBar({
    columns: [
        { key: 'fileName', label: '文件' },
        { key: 'status', label: '状态' },
    ],
    pageSize: 10,                    // optional, defaults to 10
    defaultSearchColumns: ['fileName'], // optional, defaults to all columns
    onChange: (state) => this.reRender(), // callback when page/search/columns change
});
```

Parameters:
- `columns`: Array of `{ key: string; label: string }` defining searchable columns
- `pageSize`: Items per page (default: 10)
- `defaultSearchColumns`: Which columns are checked by default (default: all)
- `onChange`: Callback fired when any state changes (page, search query, search columns)

#### Instance methods

| Method | Description |
|---|---|
| `getState()` | Returns a copy of current `PaginationBarState` |
| `setPage(n)` | Set current page number |
| `resetPage()` | Reset page to 1 |
| `render(container, totalItems)` | Render the bar into a container element |

#### Static utility methods

| Method | Description |
|---|---|
| `PaginationBar.paginate(items, page, size)` | Slice items for current page; returns `{ pageItems, totalPages }` |
| `PaginationBar.filterBySearch(items, query, columns, extractor)` | Filter items by search query on specified columns |
| `PaginationBar.parseSearchQuery(query)` | Parse `a \|\| b` or `a && b` into `{ mode, terms }` |
| `PaginationBar.matchesSearch(texts, query)` | Test if any/all texts match the parsed query |
| `PaginationBar.getPageNumbers(current, total)` | Calculate page numbers with ellipsis |

### Usage pattern

#### 1. Declare the PaginationBar instance

```ts
import { PaginationBar } from './PaginationBar';

const SEARCH_COLUMNS = [
    { key: 'name', label: '名称' },
    { key: 'status', label: '状态' },
];

class MyPanelView extends ItemView {
    private paginationBar: PaginationBar;

    constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.paginationBar = new PaginationBar({
            columns: SEARCH_COLUMNS,
            onChange: () => this.reRender(),
        });
    }
}
```

#### 2. Filter and paginate data

```ts
private getFilteredItems(): MyItem[] {
    let result = this.allItems;
    // Apply any custom filters first
    if (this.filter !== 'all') {
        result = result.filter(item => item.status === this.filter);
    }
    // Apply search using PaginationBar
    const state = this.paginationBar.getState();
    if (state.searchQuery) {
        result = PaginationBar.filterBySearch(result, state.searchQuery, state.searchColumns, (item, col) => {
            switch (col) {
                case 'name': return item.name;
                case 'status': return item.status;
                default: return '';
            }
        });
    }
    return result;
}
```

#### 3. Render table with pagination

```ts
private renderTable(container: HTMLElement) {
    const wrapper = container.createDiv({ cls: 'sillot-mypanel-table-wrapper' });
    const table = wrapper.createEl('table', { cls: 'sillot-mypanel-table' });
    // ... thead ...

    const filtered = this.getFilteredItems();
    const state = this.paginationBar.getState();
    const { pageItems, totalPages } = PaginationBar.paginate(filtered, state.currentPage, state.pageSize);
    if (state.currentPage > totalPages) {
        this.paginationBar.setPage(totalPages);
    }

    // ... render pageItems as tbody rows ...

    const paginationContainer = wrapper.createDiv({ cls: 'sillot-mypanel-pagination' });
    this.paginationBar.render(paginationContainer, filtered.length);
}
```

#### 4. Re-render on state change

```ts
private reRender() {
    const container = this.contentEl;
    const tableWrapper = container.querySelector('.sillot-mypanel-table-wrapper');
    if (tableWrapper) tableWrapper.remove();
    this.renderTable(container);
}
```

### Search operators

The search input supports two logical operators:

| Operator | Meaning | Example | Matches |
|---|---|---|---|
| `\|\|` | OR | `foo \|\| bar` | Items containing "foo" OR "bar" in any searched column |
| `&&` | AND | `foo && bar` | Items containing "foo" AND "bar" (each in any searched column) |
| (none) | Simple | `foo` | Items containing "foo" in any searched column |

Rules:
- Only one operator type per query. If both `||` and `&&` appear, the first detected operator determines the mode.
- Terms are trimmed and case-insensitive.
- Empty search query returns all items.

### Column filter popup

The `☰` button next to the search input opens a popup with checkboxes for each searchable column. Only checked columns are included in the search scope.

Behavior:
- "全选" checkbox toggles all columns at once.
- Clicking outside the popup closes it.
- Column selection is persisted in the `PaginationBar` state across re-renders.

### Shared CSS classes

All pagination/search CSS classes are shared (no `<panel>` prefix):

| Class | Purpose |
|---|---|
| `sillot-pagination-bar` | Main flex row container (position: relative for popup) |
| `sillot-pagination-info` | Total item count text ("N 项") |
| `sillot-pagination-page-btn` | Page number / prev / next button |
| `sillot-pagination-page-btn--active` | Active page button (accent color) |
| `sillot-pagination-ellipsis` | Ellipsis between page numbers |
| `sillot-pagination-left` | Flex container for page controls (left side) |
| `sillot-pagination-search` | Flex container for search input + buttons (right side) |
| `sillot-pagination-search-input` | Search text input |
| `sillot-pagination-search-btn` | Search submit button (🔍) |
| `sillot-pagination-col-filter-btn` | Column filter toggle button (☰) |
| `sillot-pagination-col-popup` | Column filter popup (absolute positioned) |
| `sillot-pagination-col-popup-header` | Popup header with "全选" checkbox |
| `sillot-pagination-col-popup-list` | List of column checkboxes |
| `sillot-pagination-col-popup-row` | Single column checkbox row |
| `sillot-pagination-col-popup-label` | Column label text |

### Batch operations (PluginSyncView)

PluginSyncView supports checkbox selection and batch operations:

| Class | Purpose |
|---|---|
| `sillot-sync-batch-bar` | Flex row for batch action buttons |
| `sillot-sync-batch-btn` | Batch action button |
| `sillot-sync-batch-btn--danger` | Danger variant (delete) |

Batch operations:
- **☑ 反选**: Invert checkbox selection
- **🗑 删除选中**: Delete all checked sync blocks
- **🔄 同步选中**: Sync all checked sync blocks to cloud

The action column in PluginSyncView only contains: 插入, 复制, 编辑 (删除 is removed from individual rows; use batch delete instead).

### Rules

- Every new panel with a data list must use `PaginationBar` — do not create custom pagination.
- Do not create panel-specific pagination CSS classes — use the shared `sillot-pagination-*` classes.
- Use Obsidian CSS variables (`--interactive-normal`, `--interactive-accent`, etc.) for theme compatibility.
- When a filter or sort changes, call `paginationBar.resetPage()` before re-rendering.
- The `onChange` callback should trigger a re-render of the table area only (not the entire panel).

## Known limitations & workarounds

### Custom HTML tags in Live Preview mode

Obsidian's Live Preview (real-time preview) editing mode uses CodeMirror 6's Lezer parser, which treats custom HTML tags (like `<GithubLabel />`, `<VSCodeSettingsLink />`) as HTML elements and collapses them by default. This makes the tags nearly invisible (transparent) and difficult to locate or edit when the cursor is not on that line.

**Attempted solutions that do NOT work:**
- CSS targeting `.cm-html` — Obsidian's Live Preview rendering ignores these styles for HTML tag elements
- `Decoration.mark` via `registerEditorExtension` — The mark is applied but still hidden by the Lezer parser's HTML folding behavior
- `Decoration.replace` with `WidgetType` — Replaces the text, making it uneditable; cursor entry does not restore the original text because the decoration remains active

**Recommended workaround:**
Use **Source Mode** (源码模式) for editing notes containing custom component tags:
- Toggle via the dropdown next to the "Switch view" button in the editor toolbar
- Or set globally in **Settings → Editor → Default editing mode → Source mode**

In Source Mode, HTML tags are treated as plain text and remain fully visible and editable at all times.

**Note:** When publishing, the plugin automatically processes all custom components. No manual format conversion is needed.

### Observer/Callback infinite recursion

When implementing an observer pattern (e.g., `onChange` callbacks), **never subscribe inside the callback itself**. This causes infinite recursion:

```ts
// ❌ WRONG: subscribing inside the callback causes infinite loop
private render() {
    this.tracker.onChange(() => {
        this.render(); // re-subscribes inside notify() iteration → infinite loop
    });
}
```

The root cause: `notify()` iterates the callback Set with `for...of`. If a callback adds a new callback to the same Set during iteration, the new callback is triggered in the same round, causing infinite recursion and freezing the main thread.

**Correct approach:** Subscribe once during initialization, and only update DOM in the callback:

```ts
// ✅ CORRECT: subscribe once, callback only updates DOM
register() {
    this.unsubscribe = this.tracker.onChange(() => {
        this.updateIndicator(); // only updates existing DOM elements
    });
}

private render() {
    // creates DOM, does NOT subscribe
}

private updateIndicator() {
    // finds existing DOM elements and updates text/style
}
```

### Progress bar needs a track background

When implementing a progress bar that shows percentage fill (0-100%), always include a track (background) element. Without it, the filled portion has no visual reference for the total width, making the progress indistinguishable.

```css
/* ❌ WRONG: no track, can't see progress ratio */
.progress-bar {
    background: var(--interactive-accent);
    width: 50%; /* looks the same as a short bar */
}

/* ✅ CORRECT: use ::before pseudo-element as track */
.progress-bar {
    background: var(--interactive-accent);
    position: relative;
}
.progress-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--background-modifier-hover);
    z-index: -1;
}
```

For indeterminate progress (progress = -1), use a CSS animation on the bar instead of width-based fill.
