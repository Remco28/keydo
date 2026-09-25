# Architecture Proposal

## Current proposal

Build Keydo as a desktop-oriented web application backed by a local synchronization layer and Todoist.

```text
Keydo UI
  ├── task list and selected-task detail
  ├── command/search input
  └── paste/upload workflow
        │
        ▼
Keydo application layer
  ├── local state and sync engine
  ├── command handlers
  ├── Markdown rendering
  └── attachment handling
        │
        ├── Todoist Sync API
        ├── Todoist REST API
        └── Todoist OAuth
```

The implementation language, framework, and packaging strategy remain open.

## Why a web interface is viable

The primary workflow does not require a terminal or a native screen-capture implementation. A browser can:

- Receive pasted image data from the operating system clipboard
- Render a keyboard-navigable application
- Use OAuth redirects and authenticated API requests through a backend
- Display local task state and Markdown previews

A native desktop shell can be added later for global shortcuts, background sync, system notifications, or a more integrated window experience. It should not be required for the first screenshot-paste workflow.

## State model

Todoist should remain the source of truth. Keydo should maintain a local representation of synchronized resources sufficient to render the UI quickly.

Initial local resource groups:

- Tasks
- Projects
- Sections
- Labels
- Comments and attachment metadata
- User settings needed for the interface
- Sync token and synchronization state

Writes should use optimistic updates where safe. A local operation should remain visibly pending until Todoist confirms it or reports a command-level error. The UI should expose the state of each pending operation without waiting for the network round trip.

Individual actions should be applied locally immediately. A short-lived queue may batch multiple mutations into one Todoist Sync request, and repeated edits to the same field may be coalesced. Multi-select operations such as completing several tasks should use explicit batch semantics. The application must preserve per-operation results and expose a retry path for failures.

Task siblings should be displayed by Todoist's lexicographic `order_key` when every sibling has one. Reordering a migrated sibling generates a fractional key between its new neighbors and writes it with a Sync `item_update` using the latest saved Sync token. If Todoist rejects that write cursor, reload order before calculating a replacement key; do not replay the old neighbor-derived key with a full cursor. A follow-up incremental refresh reconciles the command result and advances the token after applying the response. `child_order` remains a compatibility path for sibling groups that have not migrated to order keys. If order keys cannot establish the current order, normalize them only when every sibling has a unique finite `child_order`; if neither field provides a reliable order, refuse the move rather than treating Sync payload arrival order as saved order. A hierarchy move that changes a descendant's project or section clears that descendant's sibling keys too, because previously separate child groups can merge at the destination. Local-only reorder state must not be presented as saved.

Cross-project task groups should use project `order_key` lexicographically when every project key is available and all projects share a parent, with legacy `child_order` as the migration fallback for that same-parent case; keys from different parent scopes are incomparable. If metadata is incomplete or parent scopes differ, preserve payload order. Section groups should use section `order_key` lexicographically within a project. Fall back to legacy `section_order` only when a section key is unavailable, and keep unsectioned project tasks before section groups.

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

Use Todoist Sync for the primary state transport:

1. Perform a full initial sync.
2. Apply the response, then persist its sync token so a failed application can be retried.
3. Request incremental updates on startup, when the app returns online or becomes visible, and once per minute while visible.
4. Treat webhooks as invalidation signals rather than authoritative data.
5. Reconcile failures by running another incremental sync.

Use Todoist REST for specialized operations such as Quick Add, filter queries, completed history, uploads, and detailed activity data.

## Paste and attachment flow

The browser paste handler should inspect `ClipboardEvent.clipboardData.items` for an image item. If present, it should:

1. Read the image as a `Blob`.
2. Validate its type and size.
3. Upload it through the Todoist upload API.
4. Create a task comment containing the returned attachment reference.
5. Update the local state optimistically and reconcile after sync.

The UI should give images priority over text in the task detail view, display them at the largest practical size for immediate visual scanning, and provide a full-size viewer and file fallback. It should not assume that the clipboard contains a filesystem path; browsers generally expose image data directly.

## Security boundary

The API client should not expose long-lived Todoist credentials to untrusted browser code. The preferred deployment boundary is:

```text
Browser → Keydo backend → Todoist
```

For a local-only application, the backend may run on the user's machine. OAuth tokens and refresh tokens should use the operating system's credential storage when the application is packaged as a desktop application.

Validate the request `Host` against an explicit allowlist before serving any route. Comparing `Origin` only with the request URL is insufficient: DNS rebinding can make both reflect an attacker-controlled hostname. The default server accepts its bind hostname and loopback aliases; deployments can add names with `KEYDO_ALLOWED_HOSTS`, and the Tailscale launcher supplies its node IP and MagicDNS name through `KEYDO_TAILSCALE_HOSTS`. Tailscale Serve proxy headers are trusted only when explicitly enabled and the backend is bound to loopback; validate the forwarded host against the same allowlist and require the forwarded scheme to be HTTPS.

The Todoist Sync `user` resource contains credentials and profile data. The server returns only `user.tz_info` to the browser and marks Sync snapshots `no-store`. The authenticated attachment proxy is restricted to same-origin embedding, and the app shell denies framing.

## Markdown

Task descriptions are stored as Markdown-capable text. Rendering belongs in Keydo. The renderer must sanitize unsafe HTML, links, and embedded content before displaying the preview.

Markdown preview should be read-only initially. Editing can use a source editor with a separate preview mode.

## Failure and conflict handling

The application should explicitly handle:

- Expired access tokens
- Per-command Sync failures
- Attachment upload failures
- Rate limits and retry-after responses
- Network loss during optimistic updates
- Todoist changes made from another client
- Resource deletions and invalid references

A failed local operation should remain visible in a retryable state rather than disappearing silently.

Sync command results that explicitly reject a command are returned to the browser as definitive failures, separate from transport errors where the command may have committed. Retrying a definitive rejection cannot make it succeed and can waste requests; ambiguous writes should reuse their command UUIDs and reconcile with Sync before another user attempt.

## Deployment questions still open

- Hosted web application versus local-first application
- Browser-only versus packaged desktop shell
- Local database technology
- OAuth application registration and credential storage
- Whether image uploads should remain task comments or gain a Keydo-specific metadata layer
