# Component Vault Archive Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stretched Component Vault website card mark with a polished archive-and-save icon, ship the matching Windows application icon, and publish the corrected v1.0.1 release.

**Architecture:** Create one square raster master showing a `</>` component card entering an archive tray with a saved checkmark. Convert it into the multi-size Windows ICO and a web PNG. The portfolio consumes the PNG through the existing card-image `<img>` pattern; source and portfolio are then versioned and released independently.

**Tech Stack:** built-in image generation, Pillow, Electron Builder, Vitest, Hexo, Cloudflare Pages, GitHub Releases.

## Global Constraints

- Preserve the dark, object-led visual language of Quota Glance.
- Use only the literal `</>` as icon text; no gradients, glow, watermark, or unrelated labels.
- Use `apply_patch` for text files that may contain Japanese.
- Keep v1.0.0 immutable; publish the corrected upload as v1.0.1.
- Ensure the declared ISC license is included in the Windows distribution before publishing.

---

### Task 1: Create and validate the archive icon artwork

**Files:**
- Create: `build/component-vault-archive-icon.png`
- Modify: `tests/unit/iconAsset.test.ts`

**Interfaces:**
- Produces: a square PNG used as the ICO conversion source and the portfolio asset.

- [ ] **Step 1: Add the failing icon assertion**

```ts
it('contains the archive icon source for website and Windows packaging', () => {
  expect(existsSync(resolve('build/component-vault-archive-icon.png'))).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the asset is absent**

Run: `npx vitest run tests/unit/iconAsset.test.ts --reporter=verbose`

- [ ] **Step 3: Generate one square icon master**

Use the built-in image generator with: dark navy rounded-square canvas; a cyan `</>` component card descending into a shallow archive tray; compact mint checkmark; flat geometric vector-like finish; no text other than `</>`; no gradient, glow, watermark, or photorealism.

- [ ] **Step 4: Copy the chosen PNG into `build/component-vault-archive-icon.png` and inspect it**

Use the image viewer to confirm the card, tray, and check are legible at full size and preserve generous padding.

- [ ] **Step 5: Run the focused test and commit the asset test**

Run: `npx vitest run tests/unit/iconAsset.test.ts --reporter=verbose`

### Task 2: Produce the matching Windows icon

**Files:**
- Modify: `build/icon.ico`
- Modify: `tests/unit/iconAsset.test.ts`

**Interfaces:**
- Consumes: `build/component-vault-archive-icon.png`.
- Produces: `build/icon.ico` with 16, 24, 32, 48, 64, 128, and 256 pixel entries.

- [ ] **Step 1: Convert the source PNG to the required ICO entries with Pillow**

Create each exact square size with high-quality Lanczos resampling and save one ICO containing all seven sizes.

- [ ] **Step 2: Inspect 16px and 256px ICO extraction**

Confirm that the card/tray silhouette is still readable at 16px and has no stretched aspect ratio.

- [ ] **Step 3: Run the focused icon test**

Run: `npx vitest run tests/unit/iconAsset.test.ts --reporter=verbose`

### Task 3: Fix the public Card Grid and product page

**Files:**
- Create: `D:\Product\VOLCANE\source\public\component-vault-icon.png`
- Modify: `D:\Product\VOLCANE\source\index.html`
- Modify: `D:\Product\VOLCANE\source\component-vault.html`

**Interfaces:**
- Consumes: `build/component-vault-archive-icon.png`.
- Produces: home and product pages that use the same square image asset.

- [ ] **Step 1: Write a failing source assertion**

```powershell
if ((Get-Content -Raw source/index.html) -notmatch 'component-vault-icon.png') { throw 'Card does not use the icon asset.' }
```

- [ ] **Step 2: Run it and confirm it fails on the placeholder div**

Run: the PowerShell assertion above from `D:\Product\VOLCANE`.

- [ ] **Step 3: Copy the artwork into `source/public` and replace both placeholder marks with semantic `img` elements**

Use `alt="Component Vault icon: saved HTML component"`. Remove the placeholder-specific CSS so the existing `.card-image img { object-fit: cover; }` pattern controls the Card Grid image.

- [ ] **Step 4: Build the portfolio and run the source assertion**

Run: `npm run clean; npm run build`

- [ ] **Step 5: Inspect the desktop and narrow live preview**

Verify the Card Grid card image is filled without vertical stretching and the product page uses the same icon.

### Task 4: Package a license-complete v1.0.1 Windows release

**Files:**
- Create: `LICENSE`
- Modify: `electron-builder.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Create: `tests/unit/licensePackaging.test.ts`

**Interfaces:**
- Produces: v1.0.1 EXE and ZIP containing the ISC license, the new ICO, and SHA-256 text files.

- [ ] **Step 1: Write a failing packaging-license test**

```ts
expect(existsSync(resolve('LICENSE'))).toBe(true);
expect(readFileSync(resolve('electron-builder.yml'), 'utf8')).toContain('from: LICENSE');
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run tests/unit/licensePackaging.test.ts --reporter=verbose`

- [ ] **Step 3: Add the ISC license and bundle it as an extra resource**

Set the application version to `1.0.1` in the manifest and lockfile; add matching changelog and README attribution text.

- [ ] **Step 4: Run all application verification and package**

Run: `npm test; npm run typecheck; npm run package`

- [ ] **Step 5: Verify packaged resources and hashes**

Confirm `release/win-unpacked/resources/LICENSE` exists; calculate SHA-256 for both `Component Vault-1.0.1-x64.exe` and ZIP; write conventional `.sha256` files.

### Task 5: Publish v1.0.1 and update the portfolio

**Files:**
- Modify: `D:\Product\VOLCANE\source\component-vault.html`
- Modify: `D:\Product\VOLCANE\source\index.html`
- Modify: `D:\Product\VOLCANE\source\_data\projects.json`

**Interfaces:**
- Consumes: verified v1.0.1 release asset names and SHA-256 digest.
- Produces: public GitHub Release and Cloudflare Pages product page that point to v1.0.1.

- [ ] **Step 1: Verify both repositories' identity, remote, and dirty state**

Run the Publish Windows App preflight, including `git config --local user.name`, `git config --local user.email`, `git log -1 --format='%an <%ae>'`, remote tag lookup, and release lookup.

- [ ] **Step 2: Commit and push only source release changes**

Run `git diff --cached --check`, verify `VOLCANE <volcane.gd@gmail.com>`, then push using the credential-manager account authorized for `VolcaneGD`.

- [ ] **Step 3: Create annotated tag and GitHub Release v1.0.1**

Attach EXE, ZIP, and both SHA-256 files. Verify the tag target, nonzero asset sizes, remote EXE digest, and checksum-file contents.

- [ ] **Step 4: Update portfolio copy and direct links with real v1.0.1 hashes**

Update current version, direct EXE/ZIP links, SHA-256, and **What's New**. Preserve the card's new image element.

- [ ] **Step 5: Build, deploy, and verify public URLs**

Run `npm run clean; npm run build; npx wrangler pages deploy public --project-name volcane`; verify both product and homepage HTTP responses, visible v1.0.1 text, and the final EXE redirect/200 response.
