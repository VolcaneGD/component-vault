# Component Vault

Component Vault is a local-first Windows desktop workspace for collecting, editing, previewing, and exporting reusable HTML components. Its three workspace patterns are Workbench (A), Gallery (B), and Adaptive Studio (C).

## Requirements

- Windows 10 or Windows 11, x64
- Node.js 22 or newer and npm 10 or newer for development
- Python 3 with Pillow only when regenerating `build/icon.ico`; the generated icon is already committed

## Development

Install exact locked dependencies and start Electron:

```powershell
npm ci
npm run dev
```

Run the deterministic checks:

```powershell
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

`npm run test:e2e` includes browser and development-Electron coverage. The packaged smoke test is skipped unless `COMPONENT_VAULT_EXECUTABLE` names a packaged executable.

## Windows packages

Create the x64 per-user NSIS installer and portable ZIP:

```powershell
npm run package
```

Create only the unpacked application directory:

```powershell
npm run package:dir
```

Artifacts are written to `release/`:

- `Component.Vault-<version>-x64.exe` - assisted, per-user NSIS installer
- `Component.Vault-<version>-x64.zip` - portable application archive
- `win-unpacked/ComponentVault.exe` - unpacked executable produced by `package:dir` or as package staging

The build packages only compiled `out/` code and production dependencies. Database migration routines are compiled into `out/main/index.js`; source maps, tests, source files, development databases, backups, `.serena`, and `.superpowers` are excluded. `THIRD_PARTY_NOTICES.md` is placed beside the packaged application resources.

To verify an unpacked or installed artifact with isolated data:

```powershell
$env:COMPONENT_VAULT_EXECUTABLE = (Resolve-Path 'release\win-unpacked\ComponentVault.exe')
npm run test:e2e -- tests/e2e/packaged-smoke.spec.ts
Remove-Item Env:COMPONENT_VAULT_EXECUTABLE
```

No packaging command publishes or uploads artifacts.

## In-app updates

The NSIS-installed app checks GitHub Releases only when you choose **Settings → App updates → Check for updates**. If a newer signed release is available, choose **Download update**, then **Restart and install**. Downloads are never automatic.

The portable ZIP intentionally remains manual-update-only. Download the current ZIP or NSIS installer from the release page when you want to update a portable copy.

## Data and backups

Normal installations store user data in `%APPDATA%\Component Vault`:

- `component-vault.sqlite` - libraries, components, tags, preview policies, settings
- `component-vault.sqlite-wal` and `component-vault.sqlite-shm` - SQLite working files while the app is open
- `window-state.json` - last normal window position, size, and maximized state
- `component-vault.sqlite.<timestamp>.backup` - automatic pre-migration backup when an existing database is upgraded

Close Component Vault before taking a manual backup, then copy the whole `%APPDATA%\Component Vault` directory. Restore only while the app is closed. Portable ZIP distribution does not make the data portable: it uses the same per-user application-data directory unless launched with a Chromium `--user-data-dir=<path>` argument for testing.

## Network and preview safety

Component Vault is local-first and does not require network access. Component previews run in an isolated Electron frame with scripts, forms, popups, and external requests denied by default. External HTTPS requests are enabled only for an individual component after its preview policy is explicitly enabled and origins are allowlisted. HTTP, local files, Electron APIs, Node.js APIs, top-level navigation, and unapproved origins remain blocked. Links opened by application commands use the system browser.

## Keyboard operation

- `Ctrl+K` opens the Command Palette outside text and code editors.
- `Ctrl+S` saves the current component while focus is in its editor.
- Arrow keys, `Home`, and `End` move through code tabs and supported component lists.
- `Enter` runs the highlighted Command Palette action.
- `Escape` closes the Command Palette and modal dialogs.
- `Tab` and `Shift+Tab` move through controls and remain trapped inside open modal dialogs.

## Agent CLI

Codex and other local agents can manage the same library through the safe local
CLI, even while the desktop application is open. Start with the live guide:

```powershell
ComponentVault.exe --cli agent-guide --format json
ComponentVault.exe --cli schema component update
```

The installed `component-vault` launcher provides the same interface. Send
commands with `--input-json`; stdout contains exactly one JSON response. Read
the target record immediately before an update, delete, or reorder and pass
its returned `revision` as `ifRevision`. On `conflict`, do not overwrite the
newer GUI or agent edit—read it again and ask for a decision. See
[docs/agent-cli.md](docs/agent-cli.md) for the safety contract.

## Import and export

Import accepts one or more `.html` or `.htm` files and presents every candidate for review before it is added. UTF-8 and supported legacy encodings such as Shift_JIS are detected; ambiguous or oversized files require explicit review or confirmation. A Component Vault export can be merged into an existing library or restored as a new library.

Export writes a standalone UTF-8 HTML library that works offline, contains the selected components, and can be re-imported by Component Vault. Preview permissions are retained, but the standalone viewer continues to sandbox component execution. Keep an exported HTML library as an exchange or backup artifact; use the application-data backup procedure for a complete operational backup.

## License and attribution

Component Vault is distributed under the [ISC License](LICENSE). It is inspired by PropertyHTML; third-party license and attribution details are in [resources/THIRD_PARTY_NOTICES.md](resources/THIRD_PARTY_NOTICES.md).
