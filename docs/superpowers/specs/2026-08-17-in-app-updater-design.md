# Component Vault In-App Updater Design

## Goal

Allow a user running the NSIS-installed Windows application to check for, download, and apply a newer Component Vault release without leaving the application.

## Scope

- Add a manual **In-App Updater** flow to the existing Settings dialog.
- Use public GitHub Releases for `VolcaneGD/component-vault` as the only update source.
- Publish `latest.yml`, its required blockmap, and a Windows x64 NSIS installer for every update-enabled release.
- Keep the ZIP distribution explicitly outside the self-update flow.
- Release the feature as v1.0.8 and update the VOLCANE product page.

## Architecture

The main process owns `electron-updater` through a focused `UpdateService`. It configures the GitHub provider, disables automatic download, records a renderer-safe status snapshot, and forwards lifecycle events to the main application window. The renderer can only invoke the narrow IPC commands: check, download, install, and read the current status. It never receives updater objects, file paths, or arbitrary URLs.

`electron-updater` validates the update payload against `latest.yml` SHA-512 data before installation. In development or unpackaged builds, the service reports a local-build status and performs no network request. The main process calls `quitAndInstall()` only after the user explicitly requests installation.

## UX

The Settings dialog gains an **In-App Updater** section below language preferences. This is a **Status Panel**: it shows the installed version, an actionable state message, and one context-specific action. Initially the action is “Check for updates.” A detected release exposes “Download update,” with byte progress during transfer; after download it exposes “Restart and install.” The section clearly labels portable ZIP builds as manual-update-only.

The dialog remains keyboard accessible: status changes use `role="status"`, actions are native buttons, failures remain visible with a retry action, Escape/Tab focus behavior remains unchanged, and all text has Japanese and English translations.

## State Flow

1. The renderer opens Settings and requests the current update snapshot.
2. A user chooses “Check for updates.” The main process calls `checkForUpdates()`.
3. `UpdateService` sends status changes for checking, no-update, available, download progress, downloaded, or error.
4. The user explicitly starts download and, only after completion, chooses restart/install.
5. The updater replaces the NSIS-installed app during restart. A failed check or download leaves the running app unchanged and offers retry.

## Security and Failure Rules

- Accept release metadata only from the fixed public GitHub provider; renderer input cannot select an update URL or artifact.
- Use Electron updater integrity verification; do not install an update if the metadata hash fails.
- Never auto-download or auto-restart.
- Suppress update network work for unpackaged development and ZIP executions.
- Report errors as bounded user-facing messages without exposing local paths, credentials, or stack traces.

## Verification

- Unit-test update-state mapping and development/portable guards.
- Test IPC to ensure only the main frame can request update operations and renderer-visible events contain safe status data.
- Renderer-test the Settings **Status Panel** for no-update, available, progress, downloaded, and retry states in Japanese and English.
- Package v1.0.8 and verify `latest.yml`, EXE, blockmap, ZIP, notices, and checksum assets.
- Smoke-test the packaged application and verify the public GitHub Release, direct installer link, and VOLCANE product page.

## Non-Goals

- No silent or background update downloads.
- No self-update for portable ZIP builds.
- No custom update server, telemetry, or account credentials.
