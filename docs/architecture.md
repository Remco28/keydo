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

Writes should use optimistic updates where safe. A local operation should remain visibly pending until Todoist confirms it or reports a command-level error.

## Sync strategy

Use Todoist Sync for the primary state transport:

1. Perform a full initial sync.
2. Persist the returned sync token.
3. Request incremental updates on startup, reconnect, and at a controlled interval.
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

The UI should support an image preview, full-size viewer, and file fallback. It should not assume that the clipboard contains a filesystem path; browsers generally expose image data directly.

## Security boundary

The API client should not expose long-lived Todoist credentials to untrusted browser code. The preferred deployment boundary is:

```text
Browser → Keydo backend → Todoist
```

For a local-only application, the backend may run on the user's machine. OAuth tokens and refresh tokens should use the operating system's credential storage when the application is packaged as a desktop application.

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

## Deployment questions still open

- Hosted web application versus local-first application
- Browser-only versus packaged desktop shell
- Local database technology
- OAuth application registration and credential storage
- Whether image uploads should remain task comments or gain a Keydo-specific metadata layer
