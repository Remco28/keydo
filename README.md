# Keydo

Keydo is a desktop-first, keyboard-first task workspace designed around Todoist. It aims to make common task operations fast and direct while preserving Todoist as the system of record.

## Why Keydo

Todoist provides a capable task model, but many useful operations require opening views, dialogs, or editors. Keydo is intended to make the common operations available from a selected task or command input:

- Add and move tasks without navigating through task dialogs
- Change priority and move tasks to Today or Tomorrow with one action
- Search and filter the local task set quickly
- Preview Markdown descriptions beside the task list
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

The runnable web-app shell is in place. It serves the interactive prototype, exposes health/configuration endpoints, and performs a server-side Todoist Sync when configured. The browser hydrates real Todoist tasks when `TODOIST_ACCESS_TOKEN` is available, refreshes incrementally when the app returns online or becomes visible, and polls every minute while visible. It otherwise remains in demo mode. In live mode, all synced tasks currently appear in the Personal workspace; Work/Personal classification has no agreed rule yet, so the separate Work workspace is demo-only. Chosen-date entry, OAuth, and persistent local task storage also remain future implementation slices.

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

For HTTPS through Tailscale Serve, an operator with permission to run `sudo tailscale` can proxy the local server to a tailnet-only HTTPS port. The direct MagicDNS route requires no elevated permission and is reachable only through the Tailnet.

The server accepts requests only for its configured bind hostname, loopback aliases, and any extra names in the comma-separated `KEYDO_ALLOWED_HOSTS` setting. The Tailscale launcher fills that setting with the node's Tailscale IPv4 address and MagicDNS name. If you bind the server to a custom hostname, add that name explicitly.

The server exposes `GET /api/config`, `POST /api/todoist/sync`, and `POST /api/todoist/tasks` for task creation/mutation. Non-GET Todoist API requests require an `Origin` header whose full origin matches the request origin. Task creation and all task mutations—including ordinary task-field updates—plus Sync snapshots, attachment uploads, and comment deletion require the token from `POST /api/todoist/order-lock` in the `X-Keydo-Order-Lock` header. The lock response starts with `locked <token>` and streams until the operation ends; if that stream disconnects, the server rejects later writes from that token and waits for already accepted calls to finish before releasing the lock. The browser-facing Sync endpoint is read-only and accepts only `syncToken` and `resourceTypes`; task writes use dedicated routes. Image attachments upload via `POST /api/todoist/tasks/:id/attachments` (multipart `file`, PNG/JPEG/GIF/WebP only, 5 MB limit), which stores the file through Todoist uploads and links it as a task comment; comments are removed with `DELETE /api/todoist/comments/:id`. Boot sync includes the `notes` resource so saved attachments reappear after reload.

OAuth is Todoist authorization, not a Keydo username/password login. The user would approve Keydo on Todoist, and the server would exchange the authorization code for a refreshable Todoist token. Tailscale remains the access boundary; OAuth is only for obtaining Todoist API access.

Run validation with:

```bash
bun test
bun run typecheck
```

## Documentation

- [Product brief](docs/product-brief.md)
- [Todoist capability assessment](docs/todoist-capabilities.md)
- [Keyboard interaction model](docs/keyboard-model.md)
- [Architecture proposal](docs/architecture.md)
- [Decision log](docs/decision-log.md)
