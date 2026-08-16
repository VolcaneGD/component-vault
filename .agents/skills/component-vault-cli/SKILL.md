---
name: component-vault-cli
description: Use when saving, finding, importing, exporting, reordering, or editing reusable HTML components in a locally installed Component Vault library through the Component Vault CLI, including when the desktop GUI may already be open.
---

# Component Vault CLI

Use the installed `component-vault` command (or `ComponentVault.exe --cli`) as the only automation boundary. Do not open its SQLite database directly.

1. Run `component-vault agent-guide --format json` before the first command in a task. Treat its command and schema data as authoritative.
2. Resolve a user-facing library or component name with `library list`, `component list`, or `component search`; use returned IDs thereafter.
3. For every command whose guide says `revision` is `component` or `library`, first read the record and send its returned `revision` as `ifRevision` in `--input-json`.
4. Send machine input with `--input-json '<object>'` and parse the one JSON response on stdout. Keep diagnostics off stdout.
5. On `conflict`, reread the affected record, explain the newer change, and ask before replacing it. Do not retry a stale mutation.
6. Use soft delete/restore tokens; do not claim permanent removal until `component finalize-delete` succeeds.

Example: create a component from a prepared JSON payload:

```powershell
component-vault component create --input-json '{"component":{"libraryId":"<id>","name":"Primary Button","description":"","category":"Buttons","html":"<button>Save</button>","css":"","javascript":"","sourceType":"agent","originalFileName":null,"tags":["button"],"previewPolicy":{"allowScripts":false,"allowForms":false,"allowPopups":false,"externalNetworkEnabled":false,"allowedOrigins":[]}}'
```

Use `component-vault schema <command>` for the precise request shape. The CLI routes through the open GUI when available and otherwise uses its serialized local runtime.
