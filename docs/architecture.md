# Architecture

Keydo is a web application with a small backend. The backend holds the Todoist credentials; the browser holds the interface and an in-memory copy of the synchronized tasks.

```text
Browser (index.html + src/*.js)
  ├── task list, detail room, capture, palette, sort and date choosers
  ├── in-memory task state, optimistic updates, selection and view rules
  └── clipboard paste → image upload
        │  same-origin JSON API, write lock
        ▼
Keydo server (src/server.ts, Bun)
  ├── host/origin checks, order lock, static files
  ├── Todoist client (src/todoist.ts)
  └── completion-recovery journal (SQLite)
        │
        ├── Todoist Sync API
        └── Todoist REST API (Smart Add, uploads, completion history)
```

## Code map

| Path | Role |
| --- | --- |
| `index.html` | The whole interface: markup, styles and the main module script (views, keys, rendering, sync wiring) |
| `src/server.ts` | HTTP server: static files, the browser-facing API, host checks, the order lock |
| `src/todoist.ts` | Todoist Sync and REST client |
| `src/completion-recovery.ts` | Journal and restore logic for reopening completed parents with their unfinished subtasks |
| `src/task-view.js` | Pure view logic: filtering, ordering, sorting, selection, restoring the last view |
| `src/task-mutations.js` | Pure state changes for optimistic edits, and reconciliation with Sync results |
| `src/task-capture.js` | Capture parsing and destination labels |
| `src/task-attachments.js`, `src/image-content.ts` | Image attachments on comments, and image type checks |
| `src/sync-*.js`, `src/order-lock.js`, `src/cross-tab-lock.js`, `src/task-action-gate.js` | Sync tokens, background sync, and the locks that keep writes from overlapping |
| `src/markdown.js` | Small, escaping Markdown renderer for notes |
| `scripts/start-tailscale.sh` | Launcher for running on a Tailscale tailnet, over HTTP or behind Tailscale Serve |

The `src/*.js` modules are plain ES modules with `.d.ts` declarations, served to the browser as is. There is no build step.

## Desktop app

Keydo runs in a desktop browser. It becomes a desktop app by being installable: a web app manifest and icons, served over tailnet-only HTTPS through Tailscale Serve, so Chrome can install it as its own window (D-018). A native shell (global shortcuts, tray, notifications) is not planned.

## State model

Todoist is the source of truth. The browser keeps an in-memory copy of the synchronized projects, sections, items (tasks), labels, notes (comments and their attachments) and the user's time zone. Only the Sync token is persisted, in session storage; browser storage otherwise holds preferences (each view's sort and the last view).

Writes are optimistic. A local operation stays visibly pending until Todoist confirms it or reports a command-level error, and a failure reverts the change with a message in the status strip.

Individual actions are applied locally immediately. A short-lived queue may batch multiple mutations into one Todoist Sync request, and repeated edits to the same field may be coalesced. Multi-select operations such as completing several tasks use explicit batch semantics and keep each operation's result.

Task siblings are displayed by Todoist's lexicographic `order_key` when every sibling has one. Reordering a migrated sibling generates a fractional key between its new neighbors and writes it with a Sync `item_update` using the latest saved Sync token. If Todoist rejects that write cursor, reload order before calculating a replacement key; do not replay the old neighbor-derived key with a full cursor. A follow-up incremental refresh reconciles the command result and advances the token after applying the response. `child_order` remains a compatibility path for sibling groups that have not migrated to order keys. If order keys cannot establish the current order, normalize them only when every sibling has a unique finite `child_order`; if neither field provides a reliable order, refuse the move rather than treating Sync payload arrival order as saved order. A hierarchy move that changes a descendant's project or section clears that descendant's sibling keys too, because previously separate child groups can merge at the destination. Local-only reorder state must not be presented as saved.

Cross-project task groups use project `order_key` lexicographically when every project key is available and all projects share a parent, with legacy `child_order` as the migration fallback for that same-parent case; keys from different parent scopes are incomparable. If metadata is incomplete or parent scopes differ, preserve payload order. Section groups should use section `order_key` lexicographically within a project. Fall back to legacy `section_order` only when a section key is unavailable, and keep unsectioned project tasks before section groups.

In Today and Upcoming, use Todoist `day_order` for tasks with a manual daily position. Overdue tasks are not part of that manual ordering; keep them ahead of current-day tasks and order them by due date. Recompute relative Today/overdue labels from stored due dates on render and background triggers so a midnight rollover does not depend on Todoist emitting a delta. A project move invalidates project/section/parent sibling keys, but preserves `day_order` because changing a task's project does not change its due-date group.

Structural nesting targets must belong to the same Todoist project ID as the source task. Project display names are not unique identities and cannot safely authorize cross-project hierarchy changes.

Before release, verify with a controlled Todoist account whether moving a parent task through the [Move Task API](https://developer.todoist.com/api/v1/) also moves its descendants across projects or sections. The API describes moving the addressed task but does not specify descendant behavior. Keydo optimistically moves the whole local subtree and then reconciles from Sync; do not treat subtree moves as integration-verified until that behavior is checked.

Project state and project views are keyed by Todoist project ID. Display names are labels only; same-name projects remain distinct in navigation and ordering, and a quick-capture project name that matches more than one project is rejected rather than routed arbitrarily.

Sync command writes that use the saved cursor are serialized through one mutation queue, including task creation and ordering. Each multi-request order normalization also chains the cursor returned by each command batch. This avoids overlapping cursor-consuming writes and prevents a later batch from starting from an older cursor.

If task creation receives an HTTP 400 that identifies the saved Sync token as invalid, retry the same idempotent command once with `sync_token="*"`; keep command UUIDs stable across cursor fallback and ambiguous transport retries. Do not treat unrelated HTTP 400 responses as cursor failures. For order-key writes, do not replay the neighbor-derived keys against a full cursor: stop, reload the current order, and require a fresh user action. Subsequent order chunks must use the cursor returned by the accepted batch.

If a Sync order batch returns a command-level 429, stop before submitting later chunks. Earlier chunks may already have applied, so propagate the rejection and reconcile from Todoist before a retry. Show Todoist's `retry_after` guidance when available; do not automatically replay the user's reorder.

Structural writes must serialize across browser tabs, origins, and devices that connect to the same Keydo server. The browser first queues same-origin work with Web Locks, bounded to 30 seconds; if that lock is unavailable or times out, it falls back to the server lock, whose acquisition handshake has the same bound. The browser holds `/api/todoist/order-lock` while it syncs, calculates, and applies an order or membership change. The server-issued token is required by structural write routes and is revoked when the stream ends; requests already accepted under the token keep the lock queued until they finish. If the stream is lost, later writes with that token fail instead of racing a new lock owner.

Every Todoist Sync snapshot also holds the shared order lock, including startup, periodic, reconnect, and post-mutation reads. This prevents a snapshot in another tab or device from overlapping a write and applying stale task state. All task edits and attachment/comment writes use the same lock so every Sync-visible mutation is fenced. The server rejects Sync requests and Sync-visible writes without a live lock token.

## Sync strategy

Todoist Sync is the primary state transport:

1. Perform a full initial sync.
2. Apply the response, then persist its sync token so a failed application can be retried.
3. Request incremental updates on startup, when the app returns online or becomes visible, and once per minute while visible.
4. Reconcile failures by running another incremental sync.

Todoist REST is used for Smart Add (Quick Add), uploads and completed-task history.

## Server API

The browser talks only to the Keydo server, never to Todoist directly.

- `GET /api/health` and `GET /api/config` report status and whether Todoist is configured.
- `POST /api/todoist/sync` is read-only: it accepts only `syncToken` and `resourceTypes`, and returns only `user.tz_info` from the user resource.
- `GET /api/todoist/completed` lists recently completed tasks for the Completed view.
- Task writes use dedicated routes: `POST /api/todoist/tasks` (structured create), `POST /api/todoist/tasks/quick` (Smart Add), `POST /api/todoist/tasks/:id` (update, move, complete, reopen, delete, and a single order-key reorder) and `POST /api/todoist/task-order` (batched order updates).
- `POST /api/todoist/tasks/:id/attachments` takes a multipart `file` (PNG, JPEG, GIF or WebP, up to 5 MB), uploads it to Todoist and links it as a task comment. `DELETE /api/todoist/comments/:id` removes one.
- `GET /api/todoist/files?url=…` proxies attachment images from Todoist's file host, so the browser can show them without the token.

Every non-GET Todoist route requires an `Origin` header that matches the request's own origin. Sync snapshots and every Sync-visible write also require the token from `POST /api/todoist/order-lock` in the `X-Keydo-Order-Lock` header. The lock response starts with `locked <token>` and streams for as long as the operation holds the lock; if the stream disconnects, the server rejects later writes with that token and waits for already accepted calls to finish before releasing it.

## Completion recovery

Completing a Todoist parent also completes its subtasks, but Todoist's reopen restores only the task itself and its ancestors. Keydo records the unfinished subtree before completing a parent, then restores those subtasks when the parent is reopened. Subtasks that were already finished stay finished, recurring parents keep Todoist's recurrence behavior, and bulk completion is covered too.

The journal lives in `data/completion-recovery.sqlite` (or `KEYDO_RECOVERY_DB`), scoped to the token and API base. It holds only task and hierarchy IDs, completion timestamps and recovery progress, and survives reloads and restarts. Before restoring, recovery verifies task identities, hierarchy and completion timestamps; external edits or unconfirmed completion responses cancel automatic recovery rather than revive unrelated work. A partial recovery stays in **Completed** as **Retry reopening unfinished subtasks**. Completions made before the journal existed, or outside Keydo, keep Todoist's single-task reopen.

## Paste and attachment flow

The browser paste handler inspects `ClipboardEvent.clipboardData.items` for an image item. If one is present, it:

1. Read the image as a `Blob`.
2. Validate its type and size.
3. Upload it through the Todoist upload API.
4. Create a task comment containing the returned attachment reference.
5. Update the local state optimistically and reconcile after sync.

The task detail view gives images priority over text, shows them at the largest practical size, and offers a full-size viewer. Browsers expose pasted image data directly, so no file path is involved.

## Security boundary

The Todoist token never reaches the browser:

```text
Browser → Keydo server → Todoist
```

Keydo has no login of its own. The network is the access boundary: the server binds to loopback by default, and the intended deployment is a private Tailscale tailnet (D-009).

Validate the request `Host` against an explicit allowlist before serving any route. Comparing `Origin` only with the request URL is insufficient: DNS rebinding can make both reflect an attacker-controlled hostname. The default server accepts its bind hostname and loopback aliases; deployments can add names with `KEYDO_ALLOWED_HOSTS`, and the Tailscale launcher supplies its node IP and MagicDNS name through `KEYDO_TAILSCALE_HOSTS`. Tailscale Serve proxy headers are trusted only when explicitly enabled and the backend is bound to loopback; validate the forwarded host against the same allowlist and require the forwarded scheme to be HTTPS.

The Todoist Sync `user` resource contains credentials and profile data. The server returns only `user.tz_info` to the browser and marks Sync snapshots `no-store`. The authenticated attachment proxy is restricted to same-origin embedding, and the app shell denies framing.

## Markdown

Task descriptions are Markdown-capable text, rendered by Keydo's own small renderer (`src/markdown.js`). It escapes all HTML and only links `http`, `https` and `mailto` URLs. Notes are edited as source with a live, read-only preview beside them.

## Failure and conflict handling

Keydo handles:

- Expired access tokens
- Per-command Sync failures
- Attachment upload failures
- Rate limits and retry-after responses
- Network loss during optimistic updates
- Todoist changes made from another client
- Resource deletions and invalid references

A failed local operation is reverted with a visible message rather than disappearing silently.

Sync command results that explicitly reject a command are returned to the browser as definitive failures, separate from transport errors where the command may have committed. Retrying a definitive rejection cannot make it succeed and can waste requests; ambiguous writes should reuse their command UUIDs and reconcile with Sync before another user attempt.

## Open questions

- OAuth: application registration and where refresh tokens are stored
- Whether pasted images should stay task comments or gain Keydo-specific metadata
