# Library Component Navigation Design

## Goal

Make the left navigation unambiguous: libraries are containers, components are selectable items inside the selected library, and an empty library immediately opens an editable draft.

## Interaction Design

- Use a **Master-Detail** navigation pattern. The library list remains the master scope selector; the selected library expands to show its component list.
- Selecting a component sets the active component and opens it in the current editor surface.
- Selecting an empty library creates an unsaved code draft for that library and switches to Workbench so the name, HTML, CSS, and JavaScript fields are immediately editable.
- The Libraries plus button opens a small library-creation dialog. A successful submit adds, selects, and loads the new library.
- The Tags plus button opens a small tag-creation dialog. A created tag is added to the selected draft or active component and is selected as an active filter only after it is saved to that component.
- Tag helper copy explains that tags are labels used to filter components. An empty tag collection displays an explicit empty-state hint.

## Visual Design

- The component name field receives a visible border, focus ring, and label so it is distinguishable from the surrounding editor chrome.
- The primary save label is shortened to Save / 保存 and uses `white-space: nowrap` to prevent wrapping in compact panes.
- Existing dark-theme colors, spacing, sidebar hierarchy, and responsive Studio drawer behavior remain intact.

## Safety and State Rules

- Do not create a second draft when the selected empty library already has an active draft.
- A library switch must not overwrite a dirty component from another library; it can only create a fresh draft after the target scope has loaded and is confirmed empty.
- Tag creation must update the draft/component through the existing draft-update and save flow; no direct database mutation is introduced for tags.
- Cross-library all-components mode remains readable and cannot reorder cards across libraries.

## Validation

- Renderer tests prove library component selection, empty-library draft creation, library creation, tag creation, and the abbreviated save action.
- Typecheck and full unit tests must pass.
- Rendered UI verification covers Workbench and Adaptive Studio at a normal desktop width and a compact width.
