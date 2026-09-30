# Keydo

Keydo is a desktop-first, keyboard-first task workspace designed around Todoist. It aims to make common task operations fast and direct while preserving Todoist as the system of record.

## Why Keydo

Todoist provides a capable task model, but many useful operations require opening views, dialogs, or editors. Keydo is intended to make the common operations available from a selected task or command input:

- Add and move tasks without navigating through task dialogs
- Change priority and move tasks to Today or Tomorrow with one action
- Search and filter the local task set quickly
- Read and edit notes with an optional Markdown preview in task details
- Create and manage subtasks with direct keyboard commands
- Attach screenshots by pasting them from the operating system clipboard
- Use command-based actions for less frequent operations

## Product principles

- **Keyboard first:** Every important operation has a discoverable keyboard path.
- **Todoist remains authoritative:** Keydo does not introduce a competing task model.
- **Fast by default:** The shortest interaction should be the normal path, not a special power-user path.
- **Visible context:** The selected task, its description, and its attachments should be visible without opening a modal.
- **Safe destructive actions:** Deletion should be distinguishable from moving, archiving, and completing.
- **Desktop scope first:** The primary target is a desktop browser; mobile is not an initial design constraint.

## Current status

The runnable web app includes a polished list and task-detail workspace, exposes health/configuration endpoints, and performs a server-side Todoist Sync when configured. The browser hydrates real Todoist tasks when `TODOIST_ACCESS_TOKEN` is available, refreshes incrementally when the app returns online or becomes visible, and polls every minute while visible. It otherwise remains in demo mode. In live mode, all synced tasks currently appear in the Personal workspace; Work/Personal classification has no agreed rule yet, so the separate Work workspace is demo-only. Task details include a due-date picker. In live mode, Quick Capture uses Todoist Smart Add for natural-language dates and times; Create exact retains the structured path, and pasted screenshots use that path. OAuth and persistent local task storage remain future implementation slices.

## Development

Requires Bun.

```bash
bun install
cp .env.example .env
bun run dev
```

Bun loads `.env` automatically. Keep the real `.env` file local; it is ignored by Git. `TODOIST_ACCESS_TOKEN` is sufficient for the current local Sync slice. The `TODOIST_CLIENT_*` and redirect/scope variables are reserved for the OAuth slice.

The app is available at `http://127.0.0.1:7710` by default. To bind it to this machine's current Tailscale IPv4 address, run `bun run start:tailscale` and open `http://<tailscale-hostname>:7710` from a device on the Tailnet.

For this machine, the current Tailnet URL is `http://frank-hp-elitedesk-800-g5-desktop-mini.taild9032.ts.net:7710`. The `start:tailscale` script discovers the current Tailscale IPv4 address automatically, so it follows the node if its address changes.

For HTTPS through Tailscale Serve, keep Keydo bound to loopback, set `KEYDO_ALLOWED_HOSTS` to the node's MagicDNS hostname, set `KEYDO_TRUST_TAILSCALE_SERVE=true`, and run `tailscale serve --bg 7710`. Keydo trusts Tailscale's forwarded host and HTTPS scheme only when the proxy connects from loopback, and refuses to start proxy-trust mode on a non-loopback bind. Direct HTTP access via the node's Tailscale IP uses `bun run start:tailscale` and is reachable only through the Tailnet.

The server accepts requests only for its configured bind hostname, loopback aliases, and any extra names in the comma-separated `KEYDO_ALLOWED_HOSTS` setting. The Tailscale launcher adds the node's Tailscale IPv4 address and MagicDNS name to the server's allowed hosts. If you bind the server to a custom hostname, add that name to `KEYDO_ALLOWED_HOSTS`.

The server exposes `GET /api/config`, `POST /api/todoist/sync`, `POST /api/todoist/tasks` for structured task creation, and `POST /api/todoist/tasks/quick` for Todoist Smart Add. Non-GET Todoist API requests require an `Origin` header whose full origin matches the request origin. Task creation and all task mutations—including ordinary task-field updates—plus Sync snapshots, attachment uploads, and comment deletion require the token from `POST /api/todoist/order-lock` in the `X-Keydo-Order-Lock` header. The lock response starts with `locked <token>` and streams until the operation ends; if that stream disconnects, the server rejects later writes from that token and waits for already accepted calls to finish before releasing the lock. The browser-facing Sync endpoint is read-only and accepts only `syncToken` and `resourceTypes`; task writes use dedicated routes. Image attachments upload via `POST /api/todoist/tasks/:id/attachments` (multipart `file`, PNG/JPEG/GIF/WebP only, 5 MB limit), which stores the file through Todoist uploads and links it as a task comment; comments are removed with `DELETE /api/todoist/comments/:id`. Boot sync includes the `notes` resource so saved attachments reappear after reload.

OAuth is Todoist authorization, not a Keydo username/password login. The user would approve Keydo on Todoist, and the server would exchange the authorization code for a refreshable Todoist token. Tailscale remains the access boundary; OAuth is only for obtaining Todoist API access.

Run validation with:

```bash
bun test
bun run typecheck
bun run test:browser
```

The browser suite requires installed Chrome/Chromium (or `KEYDO_TEST_BROWSER` pointing to its executable). It exercises keyboard and mouse flows in an isolated demo server and checks completion recovery against an explicitly fake Todoist upstream; it never uses live credentials. Desktop/narrow screenshots are captured in a temporary artifact directory. Set `KEYDO_BROWSER_ARTIFACTS` to choose that directory.

### Completion recovery

Completing an ordinary Todoist parent also completes its subtasks. Native Todoist reopen restores only the requested task and its ancestors. Keydo records the unfinished subtree before completing it, then explicitly restores those unfinished descendants when you reopen the parent. Previously finished subtasks stay finished; recurring parents retain Todoist's normal recurrence behavior. This also covers bulk completion.

The server keeps an account-token/API-scoped undo journal in `data/completion-recovery.sqlite` (override with `KEYDO_RECOVERY_DB`). It contains only task/hierarchy IDs, completion timestamps and recovery progress—not task content or credentials—and survives browser reloads and server restarts. Keep this gitignored data directory when deploying updates. Tests use an isolated in-memory journal or scratch database.

Partial recovery stays available in **Completed** as **Retry reopening unfinished subtasks**, even when the parent is already active. Recovery verifies task identities, hierarchy and completion timestamps before restoring; external edits or unconfirmed completion responses can cancel automatic recovery rather than revive unrelated completed work. Completions predating this journal or made outside Keydo retain native single-task reopen behavior: Keydo does not infer unfinished children from the recent-completions feed.

### Interface

- Warm neutral surfaces, larger task titles, and consistent spacing keep the list readable.
- Teal marks the active keyboard task and primary actions; bulk-selected tasks use a separate treatment. Selection checkboxes appear only when selecting, via **Select tasks** or the existing Shift shortcuts.
- Task details keep plain/empty notes in one column. Formatted notes show a preview automatically; **Show/Hide preview** provides an override. Attachments remain visible even when text preview was hidden.
- Notes grow with their content up to a bounded editor height. Detail shortcuts are collapsed by default, and header controls open help and commands.
- The layout reflows on narrow screens without changing the desktop-first keyboard model.
- **D** opens a quick due-date chooser in the list or details. **S** focuses Add subtask, and **Shift+S** browses existing children. While editing a title or notes, use **Alt+D / Alt+S**.

## Documentation

- [Fieldnotes round 1: first startup attempt](human_feedback/round-01-first-real-test/index.html)
- [Fieldnotes round 2: retry after server refresh](human_feedback/round-02-after-server-restart/index.html)
- [Fieldnotes round 3: task creation and subtasks](human_feedback/round-03-task-creation-and-subtasks/index.html)
- [Fieldnotes round 4: save and detail retest](human_feedback/round-04-save-fix-retest/index.html)
- [Fieldnotes round 5: keyboard flow and completed tasks](human_feedback/round-05-keyboard-and-recovery/index.html)
- [Fieldnotes round 6: collapse, dates, and Smart Add](human_feedback/round-06-collapse-dates-smart-add/index.html)
- [Product brief](docs/product-brief.md)
- [Todoist capability assessment](docs/todoist-capabilities.md)
- [Keyboard interaction model](docs/keyboard-model.md)
- [Architecture proposal](docs/architecture.md)
- [Decision log](docs/decision-log.md)
