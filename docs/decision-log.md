# Decision Log

This log records product and technical decisions as they are made. Proposed decisions should be revisited when prototypes or API behavior provide better evidence.

## D-001: Use Keydo as the project name

- **Status:** Accepted
- **Decision:** Use `Keydo` as the project name.
- **Rationale:** It suggests keyboard interaction and task work without making Todoist the primary brand.

## D-002: Target desktop-first keyboard interaction

- **Status:** Accepted
- **Decision:** Design first for desktop use and keyboard operation.
- **Rationale:** The primary problem is making Todoist actions faster on a desktop. Mobile interaction is not an initial design constraint.

## D-003: Keep Todoist as the system of record

- **Status:** Accepted
- **Decision:** Do not create an independent task model. Keydo should synchronize with and write back to Todoist.
- **Rationale:** This keeps the application interoperable with the user's existing Todoist account and avoids duplicating Todoist's data and permission model.

## D-004: Use Todoist Sync for local state

- **Status:** Proposed
- **Decision:** Use Todoist Sync as the primary local state-transport mechanism, with REST for specialized operations.
- **Rationale:** Sync supports incremental updates, batching, and a local-first experience. REST remains necessary for Quick Add, uploads, specialized search, and history.

## D-005: Use clipboard paste for screenshots

- **Status:** Accepted
- **Decision:** Use the operating system's screenshot and annotation tools, then accept pasted image data with `Ctrl+V`.
- **Rationale:** This avoids implementing screen capture and annotation and works with a browser application.

## D-006: Display pasted images in the task detail pane

- **Status:** Proposed
- **Decision:** Show uploaded task images inline in the selected-task detail area, with an on-demand larger viewer.
- **Rationale:** A file that requires a separate manual open action does not provide enough value. Inline visibility makes visual context immediately useful.

## D-007: Use commands as the primary extension model

- **Status:** Proposed
- **Decision:** Provide a command input and command palette rather than relying only on fixed shortcuts.
- **Rationale:** Commands can expose advanced operations without overwhelming the initial keyboard model and provide a discoverable path for less frequent actions.

## D-008: Target the Todoist free plan

- **Status:** Accepted
- **Decision:** Treat the Todoist Beginner plan as the baseline for the first release.
- **Rationale:** The current must-have features are available on the free plan. Paid-only features should not be required for the core experience.

## D-009: Use Tailnet-only access without Keydo login

- **Status:** Accepted
- **Decision:** Keydo is initially a single-user, Tailscale-gated application reached through the TeamRemco launchpad. It does not require a separate username, password, or bearer token.
- **Rationale:** The user is the sole Tailnet user and does not want to manage application credentials. Todoist OAuth remains the separate account authorization and must be handled securely.

## D-010: Use an optimistic interaction model

- **Status:** Accepted
- **Decision:** Apply individual task changes to the local interface immediately, then synchronize them to Todoist in the background.
- **Rationale:** Perceived speed is more important than waiting for a network round trip. Syncing, saved, and error states must remain visible.

## D-011: Batch or coalesce background mutations

- **Status:** Accepted
- **Decision:** Use batching underneath the interface for bursts of mutations and multi-select operations, while preserving independent operation results and retries.
- **Rationale:** The user should receive immediate feedback without sacrificing efficient synchronization or hiding individual failures.

## D-012: Use a list-first task interaction

- **Status:** Accepted
- **Decision:** Show the task list first, navigate with arrow keys, use `Space` to complete or reopen the selected task, and show its details in a right-hand pane.
- **Rationale:** This keeps the primary task queue visible while allowing selection and completion without opening a task dialog.

## D-013: Enter detail editing with the right arrow

- **Status:** Accepted
- **Decision:** The right arrow enters the selected task's detail editor; `Tab` moves between fields and `Escape` returns to the list.
- **Rationale:** This provides a predictable list-to-details transition while keeping the task list available for navigation.

## D-014: Keep structural moves explicit in project views

- **Status:** Accepted
- **Decision:** Use `Alt+Arrow` for reordering and indentation/outdentation in explicitly structured project views. Do not make these mutations the default behavior of flattened main or Today views.
- **Rationale:** Structural changes should be deliberate and should not surprise a user who is merely scanning a list.

## Open decisions

- Browser-only application versus packaged desktop application
- Backend hosting and OAuth credential storage
- Whether project deletion is required or whether archive/move is sufficient
- Exact priority and date commands
- Exact subtask indentation and ordering semantics
- Whether the initial interface is a three-pane layout, a list with an overlay, or a command-first single pane
