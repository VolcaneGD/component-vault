# Component Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished, offline-first Windows desktop application for importing, authoring, previewing, organizing, copying, and exporting reusable HTML UI components.

**Architecture:** Electron owns windows, files, SQLite, and export services; React owns all presentation and interaction state; a typed preload bridge is the only boundary between them. Component previews run in sandboxed iframes with generated CSP, and persistent settings restore libraries, views, split ratios, and valid on-screen window bounds.

**Tech Stack:** Electron, React, TypeScript, Vite through electron-vite, Monaco Editor, better-sqlite3, iconv-lite, React Testing Library, Vitest, Playwright, Electron Builder.

## Global Constraints

- Target Windows 10 and Windows 11 x64.
- Keep Electron `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` for renderer windows.
- Expose only typed, allowlisted IPC operations through preload.
- Store user libraries locally in SQLite WAL mode; do not add cloud services or accounts.
- Default preview network access to blocked; allow only saved HTTPS origins for opted-in components.
- Preserve UTF-8 and Shift_JIS HTML import without damaging Japanese text.
- Implement A Workbench, B Gallery, and C Adaptive Studio through the left-side View Switcher.
- Default to Workbench: sidebar on the left, Tabbed Code Editor above Live Preview on the right.
- Persist view mode, gallery columns, pane ratios, last selection, window bounds, and maximized state.
- Include `Copyright (c) 2026 uni928`, the PropertyHTML MIT license, and the source URL in About and Third-Party Notices.
- Produce both a Windows installer and a portable ZIP.

---

## Planned File Structure

```text
ComponentVault/
  package.json
  electron.vite.config.ts
  electron-builder.yml
  tsconfig.json
  vitest.config.ts
  playwright.config.ts
  src/
    shared/
      contracts.ts            # Domain types and typed IPC API
      validation.ts           # Runtime validation at process boundaries
    main/
      index.ts                # Electron lifecycle and composition root
      ipc/registerIpc.ts      # Allowlisted IPC handlers
      window/windowState.ts   # Bounds validation, persistence, restore
      database/database.ts    # SQLite connection, WAL, migrations, backup
      database/schema.ts      # SQL schema and migration versions
      services/library.ts     # Library/component CRUD, search, ordering
      services/importHtml.ts  # Encoding detection and HTML normalization
      services/exportHtml.ts  # Standalone bundle generation and re-import
      services/settings.ts    # App and window setting persistence
    preload/
      index.ts                # contextBridge exposure
    renderer/
      index.html
      src/
        main.tsx
        App.tsx
        app.css
        store/useAppStore.ts
        features/shell/AppShell.tsx
        features/shell/ViewSwitcher.tsx
        features/library/LibrarySidebar.tsx
        features/library/GalleryView.tsx
        features/editor/ComponentEditor.tsx
        features/editor/EditorTabs.tsx
        features/preview/PreviewHost.tsx
        features/preview/buildPreviewDocument.ts
        features/studio/AdaptiveStudio.tsx
        features/commands/CommandPalette.tsx
        features/import/ImportDialog.tsx
        features/export/ExportDialog.tsx
        features/feedback/UndoToast.tsx
        features/feedback/ErrorConsole.tsx
        features/about/AboutDialog.tsx
  tests/
    unit/
    renderer/
    e2e/
  resources/
    THIRD_PARTY_NOTICES.md
  README.md
```

---

### Task 1: Electron Foundation and Typed Process Boundary

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `tests/setup.ts`
- Create: `src/shared/contracts.ts`, `src/shared/validation.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/app.css`
- Test: `tests/unit/contracts.test.ts`

**Interfaces:**
- Produces: `ComponentRecord`, `LibraryRecord`, `PreviewPolicy`, `AppSettings`, `WindowState`, `ComponentVaultApi`.
- Produces: `window.componentVault: ComponentVaultApi` for renderer consumers.

- [ ] **Step 1: Initialize the package and install the pinned dependency graph**

Run:

```powershell
npm init -y
npm install react react-dom zustand @monaco-editor/react better-sqlite3 iconv-lite
npm install -D electron electron-vite electron-builder typescript vite @vitejs/plugin-react vitest jsdom @vitest/coverage-v8 @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test @types/node @types/react @types/react-dom @types/better-sqlite3
```

Update `package.json` scripts to expose `dev`, `build`, `test`, `test:unit`, `test:e2e`, `typecheck`, `package`, and `package:dir`.

- [ ] **Step 2: Write the failing shared-contract test**

```ts
import { describe, expect, it } from 'vitest';
import { defaultAppSettings, isViewMode } from '../../src/shared/contracts';

describe('shared contracts', () => {
  it('defaults to the approved two-column workbench', () => {
    expect(defaultAppSettings()).toMatchObject({
      viewMode: 'workbench', galleryColumns: 3,
      editorPreviewRatio: 0.55,
    });
  });
  it.each(['workbench', 'gallery', 'studio'])('accepts %s', mode => {
    expect(isViewMode(mode)).toBe(true);
  });
  it('rejects arbitrary view names', () => expect(isViewMode('other')).toBe(false));
});
```

- [ ] **Step 3: Run the test and verify the contract is missing**

Run: `npm run test:unit -- tests/unit/contracts.test.ts`

Expected: FAIL because `src/shared/contracts.ts` does not exist.

- [ ] **Step 4: Implement the domain types, defaults, preload bridge, and secure BrowserWindow**

Define exact unions and records in `contracts.ts`, including:

```ts
export type ViewMode = 'workbench' | 'gallery' | 'studio';
export interface AppSettings {
  viewMode: ViewMode;
  galleryColumns: 1 | 2 | 3 | 4;
  editorPreviewRatio: number;
  studioPaneRatios: [number, number, number];
  lastLibraryId: string | null;
  lastComponentId: string | null;
}
export const defaultAppSettings = (): AppSettings => ({
  viewMode: 'workbench', galleryColumns: 3, editorPreviewRatio: 0.55,
  studioPaneRatios: [0.24, 0.42, 0.34], lastLibraryId: null, lastComponentId: null,
});
export const isViewMode = (value: unknown): value is ViewMode =>
  value === 'workbench' || value === 'gallery' || value === 'studio';
```

Create a BrowserWindow with `contextIsolation`, renderer sandbox, no Node integration, a strict app CSP, and no unrestricted IPC forwarding.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/contracts.test.ts; npm run typecheck; npm run build`

Expected: all commands exit 0 and the renderer build loads the AppShell placeholder.

Commit:

```powershell
git add package.json package-lock.json electron.vite.config.ts tsconfig.json vitest.config.ts src tests/unit/contracts.test.ts
git commit -m "feat: scaffold secure Electron application"
```

### Task 2: Window State Persistence and Display-Safe Restore

**Files:**
- Create: `src/main/window/windowState.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/windowState.test.ts`

**Interfaces:**
- Consumes: `WindowState` from `src/shared/contracts.ts`.
- Produces: `clampWindowState(state, displays, fallback): WindowState`.
- Produces: `WindowStateController.track(window)` and `WindowStateController.restore()`.

- [ ] **Step 1: Write failing tests for restore and monitor changes**

```ts
it('moves an off-screen saved window onto the primary display', () => {
  const restored = clampWindowState(
    { x: 5000, y: 5000, width: 1200, height: 800, isMaximized: false, displayId: 'old' },
    [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    { width: 1280, height: 820 },
  );
  expect(restored.x).toBeGreaterThanOrEqual(0);
  expect(restored.y).toBeGreaterThanOrEqual(0);
  expect(restored.width).toBeLessThanOrEqual(1920);
});
```

Add cases for maximized restore, partially visible windows, and minimum `960x640` size.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm run test:unit -- tests/unit/windowState.test.ts`

Expected: FAIL because `clampWindowState` is missing.

- [ ] **Step 3: Implement debounced save and safe restore**

Persist non-maximized bounds plus `isMaximized` and display ID. Debounce `move` and `resize` writes by 300 ms. Select the display with the largest intersection; if no meaningful intersection exists, center the fallback size on the primary work area. Apply maximize only after the window is ready.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- tests/unit/windowState.test.ts; npm run typecheck`

Expected: PASS, including the disconnected-monitor case.

Commit:

```powershell
git add src/main/window src/main/index.ts tests/unit/windowState.test.ts
git commit -m "feat: restore window size and position safely"
```

### Task 3: SQLite Schema, Backups, and Repositories

**Files:**
- Create: `src/main/database/schema.ts`, `src/main/database/database.ts`
- Create: `src/main/services/library.ts`, `src/main/services/settings.ts`
- Create: `src/main/ipc/registerIpc.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/unit/database.test.ts`, `tests/unit/libraryService.test.ts`

**Interfaces:**
- Produces: `openDatabase(path): DatabaseContext` with `db`, `close`, and `backupBeforeMigration`.
- Produces: `LibraryService.listLibraries`, `saveLibrary`, `deleteLibrary`, `listComponents`, `saveComponent`, `deleteComponent`, `reorderComponents`, and `searchComponents`.
- Produces: `SettingsService.getAppSettings()` and `saveAppSettings(patch)`.

- [ ] **Step 1: Write failing in-memory database tests**

```ts
it('stores one component with tags and preview policy atomically', () => {
  const service = createLibraryService(openTestDatabase());
  const library = service.saveLibrary({ name: 'UI Essentials', description: '' });
  const saved = service.saveComponent({
    libraryId: library.id, name: 'Aurora Button', description: '', category: 'Buttons',
    html: '<button>Magic</button>', css: 'button{color:white}', javascript: '',
    sourceType: 'editor', originalFileName: null, tags: ['button', 'dark'],
    previewPolicy: { externalNetworkEnabled: false, allowedOrigins: [] },
  });
  expect(service.getComponent(saved.id)?.tags).toEqual(['button', 'dark']);
});
```

Add tests for WAL mode, cascaded deletion, stable sort order, search, default settings, and schema version.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/unit/database.test.ts tests/unit/libraryService.test.ts`

Expected: FAIL because database services do not exist.

- [ ] **Step 3: Implement schema version 1 and transactional repositories**

Create tables `libraries`, `components`, `tags`, `component_tags`, `preview_policies`, `app_settings`, and `schema_meta`. Include nullable `components.deleted_at` in schema version 1 for the undo workflow. Enable `foreign_keys` and `journal_mode=WAL`. Use transactions for component plus tags/policy, and copy the database to a timestamped `.backup` before a future version migration.

- [ ] **Step 4: Register explicit IPC handlers**

Use constant channels such as `library:list`, `component:save`, and `settings:update`. Validate IDs, strings, column ranges, ratios, and HTTPS origin syntax before invoking services. Expose matching methods on `ComponentVaultApi`; never expose `ipcRenderer.send`.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/database.test.ts tests/unit/libraryService.test.ts; npm run typecheck`

Expected: PASS with no open database handles after tests.

Commit:

```powershell
git add src/main/database src/main/services src/main/ipc src/main/index.ts src/preload/index.ts tests/unit
git commit -m "feat: add persistent component libraries"
```

### Task 4: Encoding-Safe HTML Import and Normalization

**Files:**
- Create: `src/main/services/importHtml.ts`
- Modify: `src/main/ipc/registerIpc.ts`, `src/preload/index.ts`, `src/shared/contracts.ts`
- Test: `tests/unit/importHtml.test.ts`, `tests/fixtures/import/full-document.html`, `tests/fixtures/import/fragment.html`, `tests/fixtures/import/shift-jis.html`

**Interfaces:**
- Produces: `decodeHtml(bytes): { text: string; encoding: 'utf-8' | 'shift_jis' }`.
- Produces: `normalizeHtmlImport(fileName, text): ComponentDraft`.
- Produces: `importHtmlFiles(paths): ImportResult[]`, where one failure does not reject other files.

- [ ] **Step 1: Write failing decoding and normalization tests**

```ts
it('derives a component name from title, then h1, then filename', () => {
  expect(normalizeHtmlImport('fallback.html', '<title>Card</title><div>Body</div>').name).toBe('Card');
  expect(normalizeHtmlImport('fallback.html', '<h1>Upload</h1>').name).toBe('Upload');
  expect(normalizeHtmlImport('fallback.html', '<button>OK</button>').name).toBe('fallback');
});
```

Add a Shift_JIS fixture containing Japanese and assert the decoded string exactly.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm run test:unit -- tests/unit/importHtml.test.ts`

Expected: FAIL because the import functions are missing.

- [ ] **Step 3: Implement decoding and document splitting**

Prefer BOM, then declared `meta charset`, then detector confidence. Convert with `iconv-lite`. For full documents, extract body markup, non-external style blocks, and executable script bodies; preserve the original source metadata. For fragments, keep markup intact and split any top-level style/script blocks into their editors.

- [ ] **Step 4: Implement partial-success multi-file import**

Return `{ ok: true, draft }` or `{ ok: false, fileName, message }` per file. Reject directories, non-HTML extensions, unreadable files, and files above 5 MiB unless the renderer repeats the operation with `allowLargeFiles: true`.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/importHtml.test.ts; npm run typecheck`

Expected: PASS with Japanese fixture equality.

Commit:

```powershell
git add src/main/services/importHtml.ts src/main/ipc/registerIpc.ts src/preload/index.ts src/shared/contracts.ts tests
git commit -m "feat: import HTML with encoding detection"
```

### Task 5: Sandboxed Preview Document and CSP Policy

**Files:**
- Create: `src/renderer/src/features/preview/buildPreviewDocument.ts`
- Create: `src/renderer/src/features/preview/PreviewHost.tsx`
- Create: `src/renderer/src/features/feedback/ErrorConsole.tsx`
- Test: `tests/unit/buildPreviewDocument.test.ts`, `tests/renderer/PreviewHost.test.tsx`

**Interfaces:**
- Produces: `buildPreviewDocument(component, nonce): string`.
- Produces: `<PreviewHost component={component} />` with reload and error console.

- [ ] **Step 1: Write failing CSP generation tests**

```ts
it('blocks all network origins by default', () => {
  const doc = buildPreviewDocument(component({ previewPolicy: { externalNetworkEnabled: false, allowedOrigins: [] } }), 'n');
  expect(doc).toContain("default-src 'none'");
  expect(doc).not.toContain('https:');
});

it('adds only normalized HTTPS origins', () => {
  const doc = buildPreviewDocument(component({ previewPolicy: {
    externalNetworkEnabled: true,
    allowedOrigins: ['https://cdn.example.com'],
  }}), 'n');
  expect(doc).toContain('https://cdn.example.com');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/unit/buildPreviewDocument.test.ts`

Expected: FAIL because the builder is missing.

- [ ] **Step 3: Implement preview generation and isolation**

Create a complete `srcdoc` with CSP, component CSS, component HTML, and nonce-bound JavaScript. Use `<iframe sandbox="allow-scripts allow-forms allow-modals">` without same-origin, navigation, downloads, or popups. Forward serialized runtime errors and CSP violations through `postMessage` using a random preview instance ID; accept messages only from the mounted iframe window and matching ID.

- [ ] **Step 4: Render Error Console and blocked-origin guidance**

Show error type, message, line/column when available, clear/reload actions, and an action to add a blocked HTTPS origin to the component policy. Never crash the editor because preview execution failed.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/buildPreviewDocument.test.ts tests/renderer/PreviewHost.test.tsx; npm run typecheck`

Expected: PASS, including a test that a forged parent-window message is ignored.

Commit:

```powershell
git add src/renderer/src/features/preview src/renderer/src/features/feedback/ErrorConsole.tsx tests
git commit -m "feat: add sandboxed live component preview"
```

### Task 6: Dark App Shell, Sidebar, and A/B/C View Switcher

**Files:**
- Create: `src/renderer/src/store/useAppStore.ts`
- Create: `src/renderer/src/features/shell/AppShell.tsx`, `src/renderer/src/features/shell/ViewSwitcher.tsx`
- Create: `src/renderer/src/features/library/LibrarySidebar.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app.css`
- Test: `tests/renderer/AppShell.test.tsx`, `tests/renderer/ViewSwitcher.test.tsx`

**Interfaces:**
- Produces: `useAppStore` state for selected library/component and persisted layout settings.
- Produces: `<ViewSwitcher value onChange />` for `workbench`, `gallery`, `studio`.

- [ ] **Step 1: Write failing navigation and persistence tests**

```tsx
it('switches from Workbench to Gallery and persists the choice', async () => {
  render(<AppShell />);
  await user.click(screen.getByRole('button', { name: /B Gallery/i }));
  expect(screen.getByRole('main')).toHaveAttribute('data-view', 'gallery');
  expect(window.componentVault.saveAppSettings).toHaveBeenCalledWith({ viewMode: 'gallery' });
});
```

Add keyboard focus tests and accessible names for all three modes.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx tests/renderer/ViewSwitcher.test.tsx`

Expected: FAIL because AppShell features are missing.

- [ ] **Step 3: Implement App Shell and visual tokens**

Use CSS custom properties for navy-black backgrounds, elevated surfaces, purple-blue accent, borders, focus rings, spacing, radii, and reduced motion. Implement the persistent sidebar with New component, View Switcher, search, libraries, tags, import/export, and settings.

- [ ] **Step 4: Implement lazy mode boundaries**

Render Workbench, Gallery, or Adaptive Studio from the selected setting. Keep the selected component stable between modes and persist changes through the typed API.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx tests/renderer/ViewSwitcher.test.tsx; npm run typecheck; npm run build`

Expected: PASS and no horizontal overflow at `960x640`.

Commit:

```powershell
git add src/renderer tests/renderer
git commit -m "feat: add dark shell and view switcher"
```

### Task 7: Monaco Editor, Autosave, and Workbench Splitter

**Files:**
- Create: `src/renderer/src/features/editor/EditorTabs.tsx`, `src/renderer/src/features/editor/ComponentEditor.tsx`
- Create: `src/renderer/src/features/shell/WorkbenchView.tsx`
- Modify: `src/renderer/src/store/useAppStore.ts`
- Test: `tests/renderer/ComponentEditor.test.tsx`, `tests/renderer/WorkbenchView.test.tsx`

**Interfaces:**
- Produces: `<ComponentEditor component onChange onSave />`.
- Produces: `<WorkbenchView />` with persisted `editorPreviewRatio`.

- [ ] **Step 1: Write failing tab and autosave tests**

```tsx
it('debounces editor changes and reports saved state', async () => {
  vi.useFakeTimers();
  render(<ComponentEditor component={fixture} />);
  fireEvent.change(screen.getByTestId('html-editor-fallback'), { target: { value: '<button>New</button>' } });
  expect(screen.getByText('Saving')).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(500);
  expect(window.componentVault.saveComponent).toHaveBeenCalledTimes(1);
});
```

Mock Monaco behind a small adapter so tests do not require its worker runtime.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/renderer/ComponentEditor.test.tsx tests/renderer/WorkbenchView.test.tsx`

Expected: FAIL because editor components are missing.

- [ ] **Step 3: Implement HTML/CSS/JavaScript tabs and metadata form**

Configure Monaco languages, dark theme, minimap off, word wrap on, format command, `Ctrl+S`, and editor model separation per component and language. Add name, description, category, tags, network policy, Save, Duplicate, and Delete controls.

- [ ] **Step 4: Implement autosave and vertical splitter**

Debounce saves by 500 ms. Show `Saving`, `Saved`, and `Save failed`; retain dirty content after failure and retry on the next change or manual save. Persist the editor/preview height ratio between `0.25` and `0.8`.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/renderer/ComponentEditor.test.tsx tests/renderer/WorkbenchView.test.tsx; npm run typecheck`

Expected: PASS, including failed-save retention.

Commit:

```powershell
git add src/renderer/src/features/editor src/renderer/src/features/shell/WorkbenchView.tsx src/renderer/src/store tests/renderer
git commit -m "feat: add component editor and workbench preview"
```

### Task 8: Gallery, Search, Tags, Ordering, and Adaptive Studio

**Files:**
- Create: `src/renderer/src/features/library/GalleryView.tsx`, `src/renderer/src/features/studio/AdaptiveStudio.tsx`
- Modify: `src/renderer/src/features/library/LibrarySidebar.tsx`, `src/renderer/src/store/useAppStore.ts`
- Test: `tests/renderer/GalleryView.test.tsx`, `tests/renderer/AdaptiveStudio.test.tsx`

**Interfaces:**
- Produces: `<GalleryView columns={1|2|3|4} />`.
- Produces: `<AdaptiveStudio ratios={[number, number, number]} />`.

- [ ] **Step 1: Write failing Gallery and Studio tests**

```tsx
it('changes Gallery to four columns and persists the setting', async () => {
  render(<GalleryView columns={2} />);
  await user.selectOptions(screen.getByLabelText('Gallery columns'), '4');
  expect(screen.getByTestId('component-grid')).toHaveStyle({ '--gallery-columns': '4' });
  expect(window.componentVault.saveAppSettings).toHaveBeenCalledWith({ galleryColumns: 4 });
});
```

Add tests for search/tag intersection, stable card ordering, component selection, and Studio ratio clamping.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/renderer/GalleryView.test.tsx tests/renderer/AdaptiveStudio.test.tsx`

Expected: FAIL because both views are missing.

- [ ] **Step 3: Implement Gallery and list operations**

Render preview thumbnails in sandboxed lazy iframes, 1–4 CSS grid columns, selected card state, empty results, search highlight, tag chips, drag ordering, and multi-select actions. Virtualize only when the library exceeds 100 items.

- [ ] **Step 4: Implement Adaptive Studio**

Render component list, ComponentEditor, and PreviewHost as three resizable panes. Persist normalized ratios, enforce usable minimum widths, and collapse the list into a drawer below 1180 px.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/renderer/GalleryView.test.tsx tests/renderer/AdaptiveStudio.test.tsx; npm run typecheck`

Expected: PASS at normal and narrow test viewports.

Commit:

```powershell
git add src/renderer/src/features/library src/renderer/src/features/studio src/renderer/src/store tests/renderer
git commit -m "feat: add gallery and adaptive studio views"
```

### Task 9: Import Dialog and Code-First Component Creation

**Files:**
- Create: `src/renderer/src/features/import/ImportDialog.tsx`
- Modify: `src/renderer/src/features/shell/AppShell.tsx`, `src/renderer/src/features/editor/ComponentEditor.tsx`
- Test: `tests/renderer/ImportDialog.test.tsx`, `tests/e2e/import.spec.ts`

**Interfaces:**
- Produces: `<ImportDialog mode="files" | "code" />`.
- Consumes: `importHtmlFiles`, `saveComponent`, and `saveLibrary` from the preload API.

- [ ] **Step 1: Write failing partial-import and code-creation tests**

```tsx
it('allows successful files to be saved when another file fails', async () => {
  mockImportResults([{ ok: true, draft }, { ok: false, fileName: 'broken.html', message: 'Decode failed' }]);
  render(<ImportDialog mode="files" />);
  await user.click(screen.getByRole('button', { name: 'HTMLファイルを選択' }));
  expect(screen.getByText('broken.html')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1件を追加' })).toBeEnabled();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/renderer/ImportDialog.test.tsx`

Expected: FAIL because the dialog is missing.

- [ ] **Step 3: Implement drag/drop, review, and large-file confirmation**

Display each candidate with editable inferred name, source filename, character count, and status. Keep successful candidates when others fail. For files above 5 MiB, show the exact file and size before retrying with explicit permission.

- [ ] **Step 4: Implement New component code mode**

Create a blank draft in the selected library and focus the HTML editor. Do not persist it until it has a non-empty name and at least one non-empty code field. Show inline validation without blocking preview.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/renderer/ImportDialog.test.tsx; npm run test:e2e -- tests/e2e/import.spec.ts; npm run typecheck`

Expected: PASS for mixed-success import and direct code creation.

Commit:

```powershell
git add src/renderer/src/features/import src/renderer/src/features/shell src/renderer/src/features/editor tests
git commit -m "feat: add file and code component creation"
```

### Task 10: Copy Actions and Standalone HTML Export/Re-import

**Files:**
- Create: `src/main/services/exportHtml.ts`
- Create: `src/renderer/src/features/export/ExportDialog.tsx`
- Modify: `src/main/ipc/registerIpc.ts`, `src/preload/index.ts`, `src/shared/contracts.ts`
- Test: `tests/unit/exportHtml.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Produces: `createStandaloneHtml(payload): Promise<string>`.
- Produces: `parseComponentVaultHtml(source): ExportPayload | null`.
- Produces: copy commands for HTML, CSS, JavaScript, CSS-linked HTML, and CSS file save.

- [ ] **Step 1: Write failing round-trip export tests**

```ts
it('round-trips Unicode component code through standalone HTML', async () => {
  const html = await createStandaloneHtml(exportPayload([{ name: '送信ボタン', html: '<button>送信</button>' }]));
  const restored = await parseComponentVaultHtml(html);
  expect(restored?.components[0].name).toBe('送信ボタン');
  expect(restored?.components[0].html).toContain('送信');
});
```

Add tests for per-component gzip/Base64 payloads, script-safe JSON escaping, version rejection, and sanitized filenames.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/unit/exportHtml.test.ts`

Expected: FAIL because export service functions are missing.

- [ ] **Step 3: Implement standalone viewer/editor generation**

Generate one offline HTML with a sidebar item list, sandboxed preview, code tabs, individual copy actions, CSS download, editable item order/name/code, add HTML files, and Save edited HTML. Embed `format: 'component-vault'` and `version: 1`; gzip each component separately and escape script-sensitive characters.

- [ ] **Step 4: Implement atomic save and app re-import**

Write to a sibling temporary file, flush, then replace the destination. On failure remove only the temporary file and retain the generated string for retry. Recognize exported bundles during import and offer merge into an existing library or create a new library.

- [ ] **Step 5: Implement copy and CSS download commands**

Use the clipboard bridge for text copy and save dialog for CSS. Generate CSS-linked HTML with a sanitized `.css` filename and preserve JavaScript only when the user chooses the full-code copy command.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:unit -- tests/unit/exportHtml.test.ts; npm run test:e2e -- tests/e2e/export.spec.ts; npm run typecheck`

Expected: PASS and the exported file works with network disabled.

Commit:

```powershell
git add src/main/services/exportHtml.ts src/main/ipc src/preload src/shared src/renderer/src/features/export tests
git commit -m "feat: export and re-import standalone libraries"
```

### Task 11: Command Palette, Undo, Recovery, and About

**Files:**
- Create: `src/renderer/src/features/commands/CommandPalette.tsx`
- Create: `src/renderer/src/features/feedback/UndoToast.tsx`
- Create: `src/renderer/src/features/about/AboutDialog.tsx`
- Create: `resources/THIRD_PARTY_NOTICES.md`
- Modify: `src/renderer/src/features/shell/AppShell.tsx`, `src/main/services/library.ts`
- Test: `tests/renderer/CommandPalette.test.tsx`, `tests/renderer/UndoToast.test.tsx`, `tests/e2e/recovery.spec.ts`

**Interfaces:**
- Produces: searchable command registry with `new`, `search`, `view`, `save`, `import`, and `export` actions.
- Produces: soft-delete token with 8-second undo window.

- [ ] **Step 1: Write failing command and undo tests**

```tsx
it('opens with Ctrl+K and switches view by command', async () => {
  render(<AppShell />);
  await user.keyboard('{Control>}k{/Control}');
  await user.type(screen.getByRole('combobox'), 'gallery');
  await user.keyboard('{Enter}');
  expect(screen.getByRole('main')).toHaveAttribute('data-view', 'gallery');
});
```

Add delete, undo-before-expiry, permanent-delete-after-expiry, and save-failure recovery tests.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- tests/renderer/CommandPalette.test.tsx tests/renderer/UndoToast.test.tsx`

Expected: FAIL because the feedback features are missing.

- [ ] **Step 3: Implement command palette and undo transaction**

Provide keyboard navigation, fuzzy filtering, clear accessible labels, and focus return. Mark deleted components with `deletedAt`, restore during the undo window, and permanently clear expired rows during idle cleanup.

- [ ] **Step 4: Add recovery and attribution surfaces**

Restore the last completed autosave after abnormal termination. About must show Component Vault version, Electron version, PropertyHTML source link, copyright, and the complete MIT license accessible from Third-Party Notices.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/renderer/CommandPalette.test.tsx tests/renderer/UndoToast.test.tsx; npm run test:e2e -- tests/e2e/recovery.spec.ts; npm run typecheck`

Expected: PASS, including relaunch recovery.

Commit:

```powershell
git add src resources tests
git commit -m "feat: add commands undo recovery and attribution"
```

### Task 12: Packaging, Documentation, and Windows Artifacts

**Files:**
- Create: `electron-builder.yml`, `README.md`
- Create: `build/icon.ico`
- Modify: `package.json`
- Test: `tests/e2e/packaged-smoke.spec.ts`

**Interfaces:**
- Produces: NSIS installer under `release/`.
- Produces: portable ZIP under `release/`.

- [ ] **Step 1: Write the packaged smoke test**

Create a test that accepts `COMPONENT_VAULT_EXECUTABLE`, launches the packaged executable with an isolated user-data directory, waits for the title `Component Vault`, creates one component, closes, relaunches, and verifies component plus window bounds are restored.

- [ ] **Step 2: Configure Electron Builder**

Set `appId: com.componentvault.desktop`, product name `Component Vault`, x64 Windows target, NSIS per-user installer, and ZIP target. Include compiled main/preload/renderer output, migrations, icon, and Third-Party Notices; exclude tests, source maps from production, and development databases.

- [ ] **Step 3: Write operator documentation**

Document prerequisites, `npm install`, dev launch, tests, package commands, data location, backups, network policy, keyboard shortcuts, import/export behavior, and artifact locations.

- [ ] **Step 4: Build and smoke-test artifacts**

Run:

```powershell
npm run test
npm run typecheck
npm run build
npm run package
$exe = Get-ChildItem -Recurse release -Filter '*.exe' | Where-Object Name -NotMatch 'uninstall' | Select-Object -First 1 -ExpandProperty FullName
$env:COMPONENT_VAULT_EXECUTABLE = $exe
npm run test:e2e -- tests/e2e/packaged-smoke.spec.ts
```

Expected: all commands exit 0; `release/` contains one installer and one portable ZIP.

- [ ] **Step 5: Commit**

```powershell
git add electron-builder.yml package.json package-lock.json README.md build resources tests/e2e/packaged-smoke.spec.ts
git commit -m "build: package Component Vault for Windows"
```

### Task 13: Final E2E, Security, Accessibility, and Visual Verification

**Files:**
- Create: `tests/e2e/security.spec.ts`, `tests/e2e/workflow.spec.ts`, `tests/e2e/accessibility.spec.ts`
- Create: `tests/visual/baselines/` through the approved screenshot update command
- Modify: only files implicated by verified failures

**Interfaces:**
- Consumes the complete application and packaged artifact.
- Produces final verification evidence for release handoff.

- [ ] **Step 1: Add end-to-end workflow coverage**

Test this exact sequence: create two libraries; import UTF-8 and Shift_JIS fixtures; create a button through HTML/CSS/JavaScript editors; verify sandbox preview; switch A→B→C; set Gallery to four columns; resize splitters and window; restart; verify all state; copy each code type; export; open exported HTML offline; re-import it.

- [ ] **Step 2: Add security and accessibility coverage**

Assert renderer and preview cannot access `require`, `process`, Electron APIs, local files, or unapproved HTTPS origins. Assert keyboard reachability, visible focus, semantic dialog roles, reduced-motion behavior, and AA contrast for primary text/action combinations.

- [ ] **Step 3: Capture approved UI states**

Capture Workbench, Gallery, Adaptive Studio, empty state, import partial failure, Error Console, Command Palette, and About at `1440x900`, plus Workbench at the minimum `960x640`. Compare against baselines and inspect every diff before accepting it.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```powershell
npm run test
npm run typecheck
npm run build
npm run test:e2e
npm run package
git diff --check
git status --short
```

Expected: every test/build/package command exits 0; only intentional artifacts or ignored release output remain; no whitespace errors.

- [ ] **Step 5: Commit final verification adjustments**

```powershell
git add src tests README.md package.json package-lock.json electron-builder.yml resources build
git diff --cached --check
git commit -m "test: verify complete Component Vault workflow"
```

Record the exact installer and ZIP paths, file sizes, test counts, and any environment-specific limitations in the final handoff.
