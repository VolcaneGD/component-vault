# Preview Theme Toggle Design

## Goal

Let users inspect every Component Vault preview on either a light or dark
canvas without changing the component's HTML, CSS, JavaScript, or security
policy.

## Interaction

Use a shared **Theme Toggle** in each preview header. It exposes two explicit,
accessible choices: Light and Dark. Activating either choice immediately
updates all visible preview frames in Workbench, Gallery, and Adaptive Studio.
The selected choice is represented with `aria-pressed` and is keyboard
operable.

## State

Store one application-wide `previewTheme` setting (`light` or `dark`). Its
default is `light`; changes persist through the existing settings service and
are restored at startup. There is no per-component or per-view override.

## Rendering Boundary

Apply the canvas color to the sandboxed iframe element and its containing
preview surface only. Do not inject styles into component markup and do not
modify preview protocol, sandbox, CSP, or network-permission behavior. This
preserves component fidelity while providing a dependable inspection surface.

## Testing and Release

Add renderer tests for state synchronization, persistence calls, and accessible
toggle behavior across the three preview hosts. Add an end-to-end visual
interaction check for light and dark canvas styles. Bump the desktop app to
`1.0.7`, package and smoke-test the Windows artifacts, publish a GitHub Release,
and update the Component Vault portfolio page and What's New entry.
