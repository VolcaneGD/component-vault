# Component Vault Agent CLI Design

## Goal

Expose every Component Vault library and component operation through a safe,
scriptable CLI. Agents such as Codex translate a user's natural-language
request into these deterministic commands; the desktop application does not
attempt to parse natural language itself.

The CLI must safely operate against the same user library while the desktop
application is open. It must never silently overwrite a newer GUI or agent
edit.

## Non-goals

- No network listener, cloud service, or remotely reachable API.
- No natural-language parser embedded in the application.
- No direct database writes that bypass Component Vault validation.
- No silent merge after a revision conflict.

## Architecture

### Local broker

The Electron main process owns a per-user Windows named-pipe broker while the
desktop application is running. The pipe endpoint name contains the current
Windows user identity and a random per-installation capability token stored
only in the application's user-data directory with user-only permissions.

The CLI first discovers the local broker. It authenticates each request with
that token, sends a newline-delimited JSON request, and receives exactly one
JSON response. The broker invokes the existing `LibraryService` and related
services, so GUI and CLI calls share validation, transactions, soft-delete
rules, export limits, and preview-policy rules.

After a successful mutation, the main process broadcasts a typed library
change event to renderer windows. The renderer reloads the changed library
unless it has an unsaved local draft; in that case it presents a non-destructive
stale-data state and requires the user to save or reload deliberately.

### Headless fallback

If no GUI broker is available, the CLI launches the same application runtime in
`--cli` mode. The headless process obtains an exclusive, user-scoped operation
lock, opens the regular application database, performs one command through the
same service layer, closes the database, and releases the lock.

The GUI takes the same operation lock before opening the database and starts
the broker only after it owns that lock. Therefore a CLI never directly opens
the database while a GUI broker owns it. A bounded retry with explicit
`database-busy` JSON output handles startup/shutdown races; no command guesses
or retries a write indefinitely.

## Command contract

The installed command is `component-vault`. Every command supports `--json`;
machine-readable JSON is the default when stdout is not an interactive TTY.
Exit codes are stable: `0` success, `2` validation/usage, `3` not found, `4`
conflict, `5` busy/unavailable, and `1` unexpected failure.

Supported command families:

- `library list|get|create|update|delete`
- `component list|get|search|create|update|delete|restore|reorder`
- `import` and `export`
- `settings get|set`
- `agent-guide` and `schema`

Create accepts component code through `--html`, `--css`, and `--javascript`,
or through `--*-file` and standard input. Update accepts a component ID and a
required `--if-revision` value. Delete and reorder likewise require an expected
revision for every affected record. IDs and revisions are always returned by
read and mutation responses.

The service adds a monotonically changing library revision. Component updates
continue to check `updatedAt`; library-level actions such as reorder check the
library revision. A stale revision produces an error response containing
`code: "conflict"`, the current record or library revision, and no mutation.

## Agent discovery

The CLI exposes one source of truth for both documentation and automation:

```text
component-vault agent-guide --format json
component-vault agent-guide --format markdown
component-vault schema <command>
component-vault <command> --help
```

`agent-guide --format json` returns a versioned manifest describing every
command, option, JSON input/output schema, exit code, capability requirement,
revision requirement, and conflict recovery sequence. The Markdown rendering
contains natural-language-to-command examples, including creating a button
from an agent's current workspace files.

The repository also distributes a Codex skill that instructs an agent to read
the live JSON manifest before its first Component Vault command, resolve names
with `list`/`search`, pass revisions on mutation, and present conflicts rather
than overwriting user work. The skill does not duplicate a fixed command list;
the live manifest remains authoritative.

## Safety behaviour

- The named pipe is local, user-scoped, capability-authenticated, and rejects
  malformed/oversized requests.
- Only allowlisted command names and schemas are dispatched.
- No command enables preview network access without explicit preview-policy
  fields that pass the existing origin validation.
- Commands emit JSON only to stdout. Human diagnostics go to stderr.
- Import and export retain their existing parser, size, encoding, and sandbox
  limits.
- Destructive operations use the existing soft-delete/undo token flow. Final
  removal requires an explicit finalize command and matching token.

## Tests and release gate

Tests will prove:

1. The CLI lists, creates, reads, updates, searches, imports, exports, and
   deletes components through the real service contract.
2. A GUI-held broker serializes CLI mutations and renderer change events cause
   a safe refresh.
3. A stale component or library revision returns `conflict` without modifying
   stored data.
4. The headless fallback cannot race the GUI lock and reports bounded busy
   errors during handoff.
5. Unauthorized, malformed, oversized, and unknown-pipe requests are rejected.
6. The agent manifest validates against every registered command and the Codex
   skill points only to live discovery commands.
7. Packaged Windows smoke coverage exercises the installed CLI and a GUI-open
   CLI update.

The feature will be released as a new patch version only after unit, Electron,
packaged CLI, typecheck, build, and Windows package verification pass. The
GitHub Release and the VOLCANE product page will then be updated together.
