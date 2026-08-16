# Preview Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Light/Dark preview-canvas toggle that updates Workbench, Gallery, and Adaptive Studio in real time, then release it as Component Vault 1.0.7.

**Architecture:** Add `previewTheme` to the existing `AppSettings` contract and Zustand state. `PreviewHost` owns the shared **Theme Toggle**, so every preview consumer receives the same state without touching component code or preview security.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest, Playwright, electron-builder, GitHub Releases, Cloudflare Pages.

## Global Constraints

- `previewTheme` is exactly `light` or `dark`, defaulting to `light`.
- Persist via `saveAppSettings`; do not modify component HTML, CSS, JavaScript, CSP, protocol, sandbox, or network policy.
- Use i18n keys for Japanese and English copy.
- Publish `v1.0.7`; do not modify v1.0.6 assets or tags.

---

### Task 1: Persisted preview-theme contract

**Files:** `src/shared/contracts.ts`, `src/shared/validation.ts`, and `tests/unit/contracts.test.ts`.

**Interfaces:** Add `PreviewTheme = 'light' | 'dark'`; add `previewTheme` to `AppSettings`; default it to `light`; accept legacy saved settings without the field and reject other values.

- [ ] Step 1: Write tests that assert the default is light, legacy settings normalize to light, and `previewTheme: 'sepia'` fails `isAppSettings`.
- [ ] Step 2: Run `npm run test:unit -- tests/unit/contracts.test.ts`; expect RED because the contract is absent.
- [ ] Step 3: Add `isPreviewTheme`, set `defaultAppSettings().previewTheme` to `light`, and preserve that default in `normalizeAppSettings`.
- [ ] Step 4: Re-run `npm run test:unit -- tests/unit/contracts.test.ts`; expect GREEN.
- [ ] Step 5: Commit `src/shared/contracts.ts`, `src/shared/validation.ts`, and its test as `feat: persist preview canvas theme` after `git diff --cached --check`.

### Task 2: Shared preview Theme Toggle

**Files:** `src/renderer/src/features/preview/PreviewHost.tsx`, `src/renderer/src/app.css`, `src/renderer/src/i18n.ts`, and `tests/renderer/PreviewHost.test.tsx`.

**Interfaces:** `PreviewHost` consumes `settings.previewTheme` and `updateLayout({ previewTheme })`. It renders localized Light/Dark buttons with `aria-pressed`, and its iframe exposes `data-preview-theme`.

- [ ] Step 1: Write tests that activate `Dark preview background`, assert `data-preview-theme="dark"`, assert `saveAppSettings({ previewTheme: 'dark' })`, and assert the selected control has `aria-pressed="true"`.
- [ ] Step 2: Run `npm run test:unit -- tests/renderer/PreviewHost.test.tsx`; expect RED because the Theme Toggle is absent.
- [ ] Step 3: Render a compact **Theme Toggle** in non-compact preview headers. Call `updateLayout({ previewTheme })`; style only preview containers/frames as `#ffffff` or `#121826`; preserve iframe sandbox and source.
- [ ] Step 4: Re-run `npm run test:unit -- tests/renderer/PreviewHost.test.tsx`; expect GREEN.
- [ ] Step 5: Commit source, CSS, i18n, and tests as `feat: add preview theme toggle` after `git diff --cached --check`.

### Task 3: Cross-view synchronization

**Files:** `tests/renderer/WorkbenchView.test.tsx`, `tests/renderer/GalleryView.test.tsx`, `tests/renderer/AdaptiveStudio.test.tsx`, and `tests/e2e/workflow.spec.ts`.

**Interfaces:** Workbench, Gallery, and Adaptive Studio use `PreviewHost` without per-view state. Gallery thumbnails inherit canvas color but do not duplicate controls.

- [ ] Step 1: Add renderer assertions that seeded `previewTheme: 'dark'` yields dark attributes in Workbench, Gallery thumbnails, and Adaptive Studio.
- [ ] Step 2: Run the three renderer suites; expect RED before shared preview rendering reaches each surface.
- [ ] Step 3: Apply only integration adjustments required by the assertions; preserve lazy Gallery rendering and preview security.
- [ ] Step 4: Re-run the three renderer suites and `npm run test:e2e -- tests/e2e/workflow.spec.ts`; expect GREEN.
- [ ] Step 5: Commit test/integration slice as `test: cover shared preview themes` after `git diff --cached --check`.

### Task 4: Release Component Vault 1.0.7

**Files:** `package.json`, `README.md` if feature/version copy requires it, established Component Vault product/What's New sources under `D:\Product\VOLCANE`, and ignored generated checksum `release/Component Vault-1.0.7-x64.exe.sha256`.

**Interfaces:** Publish tag `v1.0.7` with EXE, ZIP, and checksum, then update the public Component Vault page to the direct new asset.

- [ ] Step 1: Add any missing localized copy assertion for preview-background labels.
- [ ] Step 2: Run all focused feature tests; expect GREEN.
- [ ] Step 3: Set version to `1.0.7`; run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, and `npm run package`; run packaged smoke and generate lowercase EXE SHA-256.
- [ ] Step 4: Commit release source, push `main`, create/push annotated `v1.0.7`, create GitHub Release with EXE/ZIP/checksum, and verify remote digest against local SHA-256.
- [ ] Step 5: Update, build, deploy, and HTTP-verify the portfolio product page, direct asset URL, current version, and What's New entry.
