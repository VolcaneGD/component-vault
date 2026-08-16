# Component Vault Agent CLI

Component Vault exposes a local JSON CLI for Codex and other agents. It uses
the already-open desktop process as the database writer; when the GUI is not
running, one headless command obtains the same operation lock and service
layer. Do not access `%APPDATA%\Component Vault\component-vault.sqlite`
directly.

```powershell
component-vault agent-guide --format json
component-vault schema "component update"
```

Use the JSON guide as the sole source of command names and schemas. Pass each
request with `--input-json`; successful and failed commands both write exactly
one JSON object to stdout. Existing-record mutations require the matching
`ifRevision` value from a fresh read. A `conflict` response means another GUI
or agent edit won; reread and ask before replacing it.

The repository skill at `.agents/skills/component-vault-cli` applies this
workflow automatically when a natural-language task asks an agent to save or
manage a reusable HTML component.
