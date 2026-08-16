# Context Menu Design

## Goal

Expose the existing component deletion workflow and common library/component actions through an accessible **Context Menu** in the left navigation.

## Interaction

- Right-clicking a component opens actions for Open, Rename, Duplicate, and Delete.
- Right-clicking a library opens actions for Open, Rename, and Delete.
- The same menu can be opened from the keyboard with `Shift+F10` or the Menu key.
- Rename uses a focused dialog and persists through the existing save APIs.
- Component Delete calls the existing soft-delete store action so the Undo toast remains available.
- Library Delete requires explicit confirmation and states that its components will be deleted with it.

## Safety

- The context target is selected before a command runs, so actions never apply to an unrelated current selection.
- A library delete clears stale component selection and reloads the remaining scope after persistence succeeds.
- Menus close on Escape, outside click, selection, or deletion; rename and confirm dialogs retain the user input on persistence errors.

## Validation

- Renderer tests cover pointer and keyboard opening, rename persistence, component soft deletion, and library delete confirmation.
- Existing unit tests, typecheck, and production build remain green.
