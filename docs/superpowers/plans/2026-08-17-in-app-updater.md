# In-App Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let NSIS-installed Component Vault users safely update from GitHub Releases inside Settings.

**Architecture:** A main-process `UpdateService` wraps `electron-updater` and exposes safe status snapshots through IPC. Settings renders a **Status Panel** with explicit check, download, and restart/install actions. electron-builder produces `latest.yml`, NSIS installer, and blockmap for every release.

**Tech Stack:** Electron 43, electron-updater 6, electron-builder, React 19, TypeScript, Vitest, Playwright, GitHub Releases, Cloudflare Pages.

## Global Constraints

- Use only public `VolcaneGD/component-vault` GitHub Releases.
- Never auto-download or auto-restart; the user triggers each action.
- Disable updating in unpackaged and ZIP/portable runs.
- Renderer API never exposes updater objects, URLs, filesystem paths, credentials, or stack traces.
- Preserve Japanese/English text with UTF-8-safe `apply_patch` editing.
- Publish a new v1.0.8 release without altering v1.0.7.

### Task 1: Implement main-process update service

**Files:**

- Create: `src/main/update/updateService.ts`
- Modify: `src/shared/contracts.ts`, `src/main/index.ts`, `package.json`, `package-lock.json`, `electron-builder.yml`
- Test: `tests/unit/updateService.test.ts`

**Interfaces:**

```ts
export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unsupported';
export interface UpdateSnapshot { state: UpdateState; currentVersion: string; availableVersion?: string; percent?: number; message?: string; }
export interface UpdateService { getSnapshot(): UpdateSnapshot; check(): Promise<UpdateSnapshot>; download(): Promise<UpdateSnapshot>; install(): void; }
```

- [ ] **Step 1: Write failing service tests**

```ts
it('does not contact GitHub from an unpackaged build', async () => {
  const updater = fakeUpdater();
  const service = createUpdateService({ updater, currentVersion: '1.0.8', isPackaged: false, isPortable: false });
  await expect(service.check()).resolves.toMatchObject({ state: 'unsupported' });
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- tests/unit/updateService.test.ts`

Expected: FAIL because `createUpdateService` does not exist.

- [ ] **Step 3: Implement the smallest safe service**

Install `electron-updater`; set `autoDownload = false`; bind updater events to bounded snapshots; guard unpackaged/portable builds; download only from `download()`; and call `quitAndInstall()` only from `install()`. Set a fixed GitHub provider and `Component.Vault-${version}-${arch}.${ext}` artifact names so `latest.yml` matches release assets.

- [ ] **Step 4: Verify GREEN**

Run: `npm run test:unit -- tests/unit/updateService.test.ts`

Expected: PASS for unpackaged/portable guards, user-initiated download, progress, and restart/install.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/main/update/updateService.ts src/shared/contracts.ts src/main/index.ts package.json package-lock.json electron-builder.yml tests/unit/updateService.test.ts
git diff --cached --check
git commit -m "feat: add safe update service"
```

### Task 2: Add restricted IPC and preload update bridge

**Files:**

- Modify: `src/main/ipc/registerIpc.ts`, `src/preload/index.ts`, `src/shared/contracts.ts`, `src/shared/ipcChannels.ts`
- Test: `tests/unit/updateIpc.test.ts`

**Interfaces:**

```ts
getUpdateStatus(): Promise<UpdateSnapshot>;
checkForUpdates(): Promise<UpdateSnapshot>;
downloadUpdate(): Promise<UpdateSnapshot>;
installUpdate(): Promise<void>;
onUpdateStatus(listener: (snapshot: UpdateSnapshot) => void): () => void;
```

- [ ] **Step 1: Write failing IPC test**

```ts
it('rejects update commands from a non-main frame', async () => {
  const handler = registeredHandler(IPC_CHANNELS.appUpdateCheck);
  await expect(handler({ senderFrame: { parent: {} } })).rejects.toThrow('main frame');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- tests/unit/updateIpc.test.ts`

Expected: FAIL because update IPC channels are unregistered.

- [ ] **Step 3: Implement restricted IPC**

Pass `UpdateService` into `registerIpcHandlers`, require the existing main-frame guard for each update command, forward only `UpdateSnapshot` through `webContents.send`, and expose the five narrow preload methods with listener cleanup.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm run test:unit -- tests/unit/updateIpc.test.ts`

Run:

```powershell
git add src/main/ipc/registerIpc.ts src/preload/index.ts src/shared/contracts.ts src/shared/ipcChannels.ts tests/unit/updateIpc.test.ts
git diff --cached --check
git commit -m "feat: expose update controls through IPC"
```

### Task 3: Render the Settings Status Panel

**Files:**

- Create: `src/renderer/src/features/settings/UpdatePanel.tsx`
- Modify: `src/renderer/src/features/settings/SettingsDialog.tsx`, `src/renderer/src/i18n.ts`, `src/renderer/src/app.css`
- Test: `tests/renderer/UpdatePanel.test.tsx`, `tests/renderer/Localization.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

```tsx
it('offers download only after an available update is reported', async () => {
  render(<UpdatePanel language="en" />);
  await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download update' })).toBeVisible());
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- tests/renderer/UpdatePanel.test.tsx`

Expected: FAIL because `UpdatePanel` does not exist.

- [ ] **Step 3: Implement the accessible panel**

Place the panel below language preferences. It displays installed and available versions, uses `role="status"`, displays native progress, disables in-flight actions, offers retry after safe errors, subscribes/unsubscribes updater events, and contains complete Japanese/English translations.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm run test:unit -- tests/renderer/UpdatePanel.test.tsx tests/renderer/Localization.test.tsx`

Run:

```powershell
git add src/renderer/src/features/settings/UpdatePanel.tsx src/renderer/src/features/settings/SettingsDialog.tsx src/renderer/src/i18n.ts src/renderer/src/app.css tests/renderer/UpdatePanel.test.tsx tests/renderer/Localization.test.tsx
git diff --cached --check
git commit -m "feat: add in-app updater settings panel"
```

### Task 4: Verify, package, and publish v1.0.8

**Files:**

- Modify: `package.json`, `package-lock.json`, `README.md` when feature copy needs updating
- Modify: `D:\Product\VOLCANE\source\component-vault.html`, `D:\Product\VOLCANE\source\index.html`, `D:\Product\VOLCANE\source\_data\projects.json`
- Test: `tests/e2e/update.spec.ts`

- [ ] **Step 1: Write failing update UI E2E test**

```ts
test('shows a check action without auto-downloading', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Current version');
});
```

- [ ] **Step 2: Verify RED then GREEN**

Run: `npx playwright test tests/e2e/update.spec.ts --workers=1`

Expected before Task 3: FAIL because the Status Panel is absent. Expected after Task 3: PASS.

- [ ] **Step 3: Run final application checks**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run package
$env:COMPONENT_VAULT_EXECUTABLE = (Resolve-Path 'release/win-unpacked/ComponentVault.exe')
npx playwright test tests/e2e/packaged-smoke.spec.ts --workers=1
Remove-Item Env:COMPONENT_VAULT_EXECUTABLE
```

Inspect nonzero v1.0.8 installer, ZIP, blockmap, `latest.yml`, bundled notices, and SHA-256 text naming the installer.

- [ ] **Step 4: Commit and publish application**

Set v1.0.8, explicitly stage release-source files, verify `VOLCANE <volcane.gd@gmail.com>`, push `main`, create/push annotated `v1.0.8`, then attach EXE, ZIP, blockmap, `latest.yml`, and checksum to the GitHub Release. Verify tag target and remote assets.

- [ ] **Step 5: Update and deploy product page**

Update version, direct links, SHA-256, updater explanation, and **What's New**. Build and push the portfolio with the required author identity, deploy through `npx wrangler pages deploy public --project-name volcane`, then check the live page (HTTP 200) and both download redirects.
