# Library Component Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make libraries expose selectable components, open an editable draft for empty libraries, and make library/tag creation and editor controls clear.

**Architecture:** `LibrarySidebar` becomes the Master-Detail navigation surface and emits callbacks for library, component, tag, and create actions. `AppShell` owns small creation dialogs and binds them to the existing Zustand store and preload save APIs. The store provides an idempotent empty-library draft entry point so all Workbench and Studio surfaces observe one consistent selection.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, Vitest, Testing Library, existing IPC bridge.

## Global Constraints

- Preserve UTF-8 Japanese text using `apply_patch` and validate affected files.
- Do not mutate the SQLite database outside existing preload IPC methods.
- Use the existing dark theme and i18n dictionary for every new user-visible label.
- Tags are labels attached to the active component; they filter component listings and are not a standalone database entity.
- Keep cross-library All components mode read-only for drag reorder.

---

### Task 1: Store-level empty-library selection safety

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`
- Test: `tests/renderer/AppShell.test.tsx`

**Interfaces:**
- Produces `ensureEditableComponent(libraryId: string): ComponentRecord` on `AppStore`.
- Consumes `beginCodeComponent(libraryId)` and current `components`, `componentsLibraryId`, and `selectedComponentId` state.

- [ ] **Step 1: Write the failing test**

```ts
it('opens one editable draft when an empty library is selected', async () => {
  // Select an empty library through AppShell and assert a draft is selected.
  expect(useAppStore.getState().selectedComponentId).toMatch(/^draft:/);
  expect(useAppStore.getState().components).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx`

Expected: FAIL because selecting an empty library leaves `selectedComponentId` null.

- [ ] **Step 3: Write minimal implementation**

```ts
ensureEditableComponent: (libraryId) => {
  const existing = get().components.find(item => item.libraryId === libraryId);
  if (existing) {
    get().setSelectedComponentId(existing.id);
    return existing;
  }
  return get().beginCodeComponent(libraryId);
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx`

Expected: PASS.

### Task 2: Master-Detail library and component navigation

**Files:**
- Modify: `src/renderer/src/features/library/LibrarySidebar.tsx`
- Modify: `src/renderer/src/features/shell/AppShell.tsx`
- Modify: `src/renderer/src/i18n.ts`
- Modify: `src/renderer/src/app.css`
- Test: `tests/renderer/AppShell.test.tsx`

**Interfaces:**
- `LibrarySidebar` receives `onSelectComponent(componentId)`, `onCreateLibrary()`, and `onCreateTag()` callbacks.
- `AppShell` selects an existing component or invokes `ensureEditableComponent` once an empty library load completes.

- [ ] **Step 1: Write failing renderer tests**

```ts
it('shows components below the selected library and opens the clicked component', async () => {
  await user.click(screen.getByRole('button', { name: 'Design library' }));
  await user.click(await screen.findByRole('button', { name: 'Open Button component' }));
  expect(screen.getByDisplayValue('<button>Save</button>')).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx`

Expected: FAIL because the sidebar only renders library buttons.

- [ ] **Step 3: Implement Master-Detail navigation**

```tsx
{isSelected && components.map(component => (
  <button key={component.id} className="library-sidebar__component" onClick={() => onSelectComponent(component.id)}>
    {component.name || t(language, 'untitledComponent')}
  </button>
))}
```

Select the first existing component after library load. For an empty scope, invoke `ensureEditableComponent` and set `viewMode` to `workbench`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx`

Expected: PASS.

### Task 3: Library and tag creation actions

**Files:**
- Create: `src/renderer/src/features/library/QuickCreateDialog.tsx`
- Modify: `src/renderer/src/features/shell/AppShell.tsx`
- Modify: `src/renderer/src/features/library/LibrarySidebar.tsx`
- Modify: `src/renderer/src/i18n.ts`
- Modify: `src/renderer/src/app.css`
- Test: `tests/renderer/AppShell.test.tsx`

**Interfaces:**
- `QuickCreateDialog` accepts `kind: 'library' | 'tag'`, `onSubmit(name: string)`, and `onClose()`.
- A library submit calls `window.componentVault.saveLibrary({ name, description: '' })`, then `acceptLibrary` and `ensureEditableComponent`.
- A tag submit merges `name.trim()` into the active component `tags`, invokes `updateComponentDraft`, and saves through `saveComponent`.

- [ ] **Step 1: Write failing tests**

```ts
it('creates a library from the Libraries plus button', async () => {
  await user.click(screen.getByRole('button', { name: 'Add library' }));
  await user.type(screen.getByLabelText('Library name'), 'Marketing');
  await user.click(screen.getByRole('button', { name: 'Create library' }));
  expect(saveLibrary).toHaveBeenCalledWith({ name: 'Marketing', description: '' });
});

it('adds a tag to the active component from the Tags plus button', async () => {
  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  await user.type(screen.getByLabelText('Tag name'), 'primary');
  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  expect(saveComponent).toHaveBeenCalledWith(expect.objectContaining({ tags: ['primary'] }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx`

Expected: FAIL because both creation controls are absent or inert.

- [ ] **Step 3: Implement dialogs and actions**

Add the two button callbacks, accessible dialogs, required-name validation, and success/failure feedback. Disable tag creation with explanatory copy only when no component is active.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx`

Expected: PASS.

### Task 4: Editor clarity and compact save control

**Files:**
- Modify: `src/renderer/src/features/editor/ComponentEditor.tsx`
- Modify: `src/renderer/src/i18n.ts`
- Modify: `src/renderer/src/app.css`
- Test: `tests/renderer/ComponentEditor.test.tsx`

**Interfaces:**
- The component-name input has a visible `component-editor__name-input` class.
- Primary save action uses `save` i18n text and `white-space: nowrap` styling.

- [ ] **Step 1: Write failing tests**

```ts
it('labels the component name input and exposes a short save action', () => {
  expect(screen.getByLabelText('Component name')).toHaveClass('component-editor__name-input');
  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/renderer/ComponentEditor.test.tsx`

Expected: FAIL because the existing save text is Save component and the input has no dedicated class.

- [ ] **Step 3: Implement the visual and copy changes**

Use the existing CSS variables for a 1px border and focus ring on only the name input. Set the primary action to `t(language, 'save')` and make its button text non-wrapping.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/renderer/ComponentEditor.test.tsx`

Expected: PASS.

### Task 5: Full regression and visual verification

**Files:**
- Test: `tests/renderer/AppShell.test.tsx`
- Test: `tests/renderer/ComponentEditor.test.tsx`

- [ ] **Step 1: Run focused renderer tests**

Run: `npm run test:unit -- tests/renderer/AppShell.test.tsx tests/renderer/ComponentEditor.test.tsx tests/renderer/WorkbenchView.test.tsx tests/renderer/AdaptiveStudio.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `npm test; npm run typecheck; npm run build; git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Verify rendered UI**

Run the Electron development app, select a populated library, select an empty library, use both plus buttons, add a tag, and inspect Workbench and Adaptive Studio at normal and compact widths.

Expected: the selected component is editable, empty-library selection opens the name and code editor, controls do not wrap, and tag helper text remains readable.
