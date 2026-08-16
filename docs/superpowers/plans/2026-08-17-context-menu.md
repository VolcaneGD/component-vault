# Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible right-click actions for libraries and components without bypassing existing safe persistence and undo behavior.

**Architecture:** LibrarySidebar owns the positioned Context Menu and emits semantic callbacks. AppShell owns dialogs and persistence through the Zustand store and preload APIs. The store gains one library-delete action that resets stale UI state only after the delete API succeeds.

**Tech Stack:** React 19, TypeScript, Zustand, Testing Library, Vitest.

## Global Constraints

- Component deletion must continue using the soft-delete/Undo workflow.
- Library deletion must require explicit confirmation.
- Japanese and English text must use `i18n.ts` keys.
- Use `apply_patch` for files containing Japanese text.

---

### Task 1: Define renderer behavior with failing tests

**Files:**
- Modify: `tests/renderer/AppShell.test.tsx`
- Modify: `tests/renderer/GalleryView.test.tsx`

**Interfaces:**
- Consumes: `LibrarySidebar` entries for library and component selection.
- Produces: regression coverage for Context Menu opening, rename, soft delete, and confirmed library deletion.

- [ ] **Step 1: Write failing menu tests**

```tsx
await user.pointer({ target: screen.getByRole('button', { name: 'Button' }), keys: '[MouseRight]' });
expect(screen.getByRole('menu')).toBeVisible();
await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx --reporter=dot`

Expected: FAIL because no context menu or rename dialog exists.

### Task 2: Implement menu, dialogs, and safe store actions

**Files:**
- Create: `src/renderer/src/features/library/ContextActionDialog.tsx`
- Modify: `src/renderer/src/features/library/LibrarySidebar.tsx`
- Modify: `src/renderer/src/features/shell/AppShell.tsx`
- Modify: `src/renderer/src/store/useAppStore.ts`
- Modify: `src/renderer/src/i18n.ts`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Produces `onContextAction(target, action)` from LibrarySidebar.
- Consumes `saveLibrary`, `saveComponent`, `deleteComponent`, and `deleteLibrary` through AppShell/store.

- [ ] **Step 1: Implement the minimal accessible Context Menu**

```tsx
<div role="menu" onKeyDown={onMenuKeyDown} style={{ left: position.x, top: position.y }}>
  <button role="menuitem" onClick={() => onAction('rename')}>Rename</button>
</div>
```

- [ ] **Step 2: Implement focused rename and destructive-confirmation dialogs**

```tsx
await onConfirm({ ...library, name });
await onDelete(component.id);
```

- [ ] **Step 3: Add the library delete store action after API success**

```ts
await window.componentVault.deleteLibrary(libraryId);
set({ libraries: remainingLibraries, selectedLibraryId: null, components: [] });
```

- [ ] **Step 4: Re-run focused tests and verify GREEN**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx tests/renderer/GalleryView.test.tsx --reporter=dot`

Expected: PASS.

### Task 3: Verify the complete interaction surface

**Files:**
- Modify: `tests/e2e/workflow.spec.ts` if the concise menu labels change an existing browser assertion.

- [ ] **Step 1: Run full deterministic unit verification**

Run: `npm run test:unit -- --no-file-parallelism`

Expected: PASS.

- [ ] **Step 2: Run typecheck and production build**

Run: `npm run typecheck; npm run build`

Expected: PASS.

- [ ] **Step 3: Inspect the staged diff and checkpoint**

Run: `git diff --cached --check`

Expected: no whitespace errors.
