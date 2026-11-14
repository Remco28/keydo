# Decision Log

This log records product and technical decisions as they are made. Proposed decisions should be revisited when prototypes or API behavior provide better evidence.

## D-001: Use Keydo as the project name

- **Status:** Accepted
- **Decision:** Use `Keydo` as the project name.
- **Rationale:** It suggests keyboard interaction and task work without making Todoist the primary brand.

## D-002: Target desktop-first keyboard interaction

- **Status:** Accepted
- **Decision:** Design for a desktop browser and keyboard operation. Phone use is out of scope.
- **Rationale:** The product is a keyboard workspace. A phone is a poor fit, and the interface is not designed around touch or a small screen.

## D-003: Keep Todoist as the system of record

- **Status:** Accepted
- **Decision:** Do not create an independent task model. Keydo should synchronize with and write back to Todoist.
- **Rationale:** This keeps the application interoperable with the user's existing Todoist account and avoids duplicating Todoist's data and permission model.

## D-004: Use Todoist Sync for local state

- **Status:** Accepted
- **Decision:** Use Todoist Sync as the primary local state-transport mechanism, with REST for specialized operations.
- **Rationale:** Sync supports incremental updates, batching, and a local-first experience. REST remains necessary for Quick Add, uploads, specialized search, and history.

## D-005: Use clipboard paste for screenshots

- **Status:** Accepted
- **Decision:** Use the operating system's screenshot and annotation tools, then accept pasted image data with `Ctrl+V`.
- **Rationale:** This avoids implementing screen capture and annotation and works with a browser application.

## D-006: Display pasted images in the task detail pane

- **Status:** Accepted
- **Decision:** Show uploaded task images inline in the task detail view at the largest practical size, before the description, with an on-demand larger viewer.
- **Rationale:** A visual should be immediately scannable. A thumbnail or attachment name that requires a separate manual open action does not provide enough value for visual context.

## D-007: Use commands as the primary extension model

- **Status:** Accepted
- **Decision:** Provide a command palette rather than relying only on fixed shortcuts. Implemented as the `Ctrl+K` palette; there is no separate typed command input.
- **Rationale:** Commands can expose advanced operations without overwhelming the initial keyboard model and provide a discoverable path for less frequent actions.

## D-008: Target the Todoist free plan

- **Status:** Accepted
- **Decision:** Treat the Todoist Beginner plan as the baseline for the first release.
- **Rationale:** The current must-have features are available on the free plan. Paid-only features should not be required for the core experience.

## D-009: Use Tailnet-only access without Keydo login

- **Status:** Accepted
- **Decision:** Keydo is initially a single-user, Tailscale-gated application reached through a Tailscale link. It does not require a separate username, password, or bearer token.
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

- **Status:** Superseded by D-015
- **Decision:** The right arrow enters the selected task's detail editor; `Tab` moves between fields and `Escape` returns to the list.
- **Rationale:** This provides a predictable list-to-details transition while keeping the task list available for navigation.
- **Superseded:** Detail is now opened with `Enter`, Tab is not a navigation key, and each detail section has a direct key (`T`/`N`/`S`/`C`).

## D-014: Keep structural moves explicit in project views

- **Status:** Accepted
- **Decision:** Use `Alt+Arrow` for reordering and indentation/outdentation in explicitly structured project views. Do not make these mutations the default behavior of flattened main or Today views.
- **Rationale:** Structural changes should be deliberate and should not surprise a user who is merely scanning a list.

## D-015: Tab-free, context-sensitive keyboard interface

- **Status:** Accepted
- **Decision:** Tab is not a navigation key in Keydo — it belongs to the browser. Every section (list, detail room, move mode, capture composer) gets direct keys instead: `T`itle, `N`otes, `D`ue date, `S` to add a subtask, `C`omplete in detail; `Shift+S` starts browsing children and arrows walk the subtask list. Ordinary action buttons stay clickable but untabbable; date and delete dialogs contain Tab focus as exceptions. Keys may change meaning per context (`T` is Today in the list, Title in detail); hint lines and the palette teach the active map.
- **Rationale:** Reaching rename via five shift-tabs proved the layout served the mouse first. Direct keys keep hands on home row and eyes on the task.

## D-016: Sorting is a per-view display choice

- **Status:** Accepted
- **Decision:** `B` opens a sort chooser for the current view: due date, priority, title, project, date added, or Keydo order (the view's built-in order), and either direction. Each view remembers its own sort in the browser; all project views share one. Sorting never writes order back to Todoist. Subtasks stay under their parent and are sorted among their siblings. Priority defaults to priority, Upcoming to due date, everything else to Keydo order. Search results keep their existing order. In a project view, structural moves (`Alt+Arrow`, `Shift+M`) only work in Keydo order, because the moves are relative to Todoist's order, not the order on screen.
- **Rationale:** Views list everything in a category, but the useful order depends on the moment. Keeping sort local respects D-003 (Todoist is authoritative) and D-014 (structural moves stay explicit).

## D-017: Actions keep you where you are

- **Status:** Accepted
- **Decision:** The view only changes when the user changes it: the sidebar, `G`, `R` (reorder in project), `/` search, or Completed. No other action changes the view. Specifically:
  - **The cursor keeps its place.** When the selected task leaves the view (completed, rescheduled, moved, deleted, or changed in Todoist), the cursor goes to the task that took its place: the next task down, or the one above if it was last. It never jumps to the top of the list.
  - **Completing from details returns to the list.** `C` in details completes the task and returns to the list with the next task selected. If you drilled into a subtask, it returns to the parent's details instead. Reopening with `C` stays in details.
  - **Capture stays in the current view.** Both Smart Add and exact create keep the current view. If the new task belongs in it, it is selected; otherwise the cursor stays where it was and the status strip names where the task went (for example, "Added to Inbox").
  - **Opening Keydo resumes the last view**, including its project and workspace. If that project no longer exists, it opens Today.
  - **Completed tasks leave every view except Completed** straight away, including Inbox and project views, which used to keep them struck through until the next full sync.
  - **If the project you are viewing is deleted**, Keydo opens Today and says so in the status strip.
- **Rationale:** Capture used to jump to the new task's project, which for a user who rarely sets `#project` meant being dropped into Inbox mid-task. Completing or moving a task reset the cursor to the top of the list, so working down a list meant finding your place again after every action. Keeping the view and the place lets a list be processed top to bottom with no navigation.

## D-018: Desktop app through browser install, not a native shell

- **Status:** Accepted
- **Decision:** Keydo stays a web application, made installable: a web app manifest and icons, served over HTTPS through a Tailnet-only Tailscale Serve entry. Chrome installs it as its own window with its own dock icon. Keydo does not get a native shell (Electron, Tauri) and is not rewritten.
- **Rationale:** The pain was finding Keydo among browser tabs, especially on GNOME, which groups every browser window under one icon. An installed app fixes that with no change to how Keydo works. A native shell would add a global capture hotkey, a tray icon and notifications, at the cost of packaging and a second runtime; none of those are wanted now. A Chrome shortcut window over plain HTTP was rejected as a poor experience.

## D-019: Three panes, a key bar, and colours from the logo

- **Status:** Accepted
- **Decision:** The interface is three panes that fill the window: views and projects on the left, the task list in the middle, and the selected task's details on the right, with a key bar along the bottom.
  - **Details follow the cursor.** The details pane always shows the selected task, so reading it needs no key. `Enter` moves the keyboard into the pane; the pane then shows a red line and its key hints, and the list cursor becomes an outline. This replaces the detail room that took over the page.
  - **The key bar shows the keys for where the keyboard is** (list, details, a selection, an editor, a dialog), and `?` opens a map of the whole keyboard. Every on-screen keycap presses when its real key is pressed. These replace the scattered hint lines and the shortcut list.
  - **Colours come from the logo:** navy ink, keycap white and key red, in a light and a dark theme that follow the system until one is chosen. Red is the accent and also marks overdue dates and priority 1; focus rings are navy so a focused field never reads as an error. Every design value is a named variable at the top of `index.html`.
  - **Finishing a task is marked:** the checkbox pops, the title is struck through, the rows below slide up, and the day's count advances. Motion is short (110, 200 and 480 ms) and is skipped when the system asks for reduced motion. Sound is off unless turned on.
  - **Undo.** `Z` takes back a completion, a new date or a new priority, by running the opposite action. Changes that cannot be reversed faithfully (move, a repeating task, a due time) are not offered. Delete became undoable in D-020.
  - **New keys:** `1` to `5` for the views, `Z` for undo, `W` for next week and arrow keys for a calendar in the date chooser, `←` to go from a subtask back to its parent.
  - **Order of the Today view.** Overdue tasks are listed before tasks due today, so the two can carry headings. This is display only, like sorting (D-016).
  - **The browser keeps its `Ctrl` shortcuts.** Single-letter keys no longer fire with `Ctrl` held, so `Ctrl+C`, `Ctrl+R` and zoom work as they do everywhere else.
- **Rationale:** The earlier layout was a centred column that left most of a desktop window empty, hid projects behind `G`, and replaced the list with the details. A keyboard-first tool should use the window, show where the keyboard is, and teach its keys in place. The mockup that proposed this was reviewed and approved before it was built.

## D-020: Delete is undoable, not confirmed

- **Status:** Accepted
- **Decision:** `Delete` no longer asks "Delete this task?". The task and its subtasks leave the list at once, a message says *Deleted "Title"*, and **Undo** (`Z`) is offered for 12 seconds, as for a completion. It must never delete silently.
  - Todoist cannot restore a deleted task, so Keydo holds the real delete back until the offer ends and only hides the task until then. Undo therefore puts back the same task, with its subtasks, notes and screenshots.
  - If the delete cannot be sent, or Todoist refuses it, the task returns to the list with a message.
  - One delete is held at a time. Closing or reloading inside the 12 seconds means the task is not deleted. Another window shows the task until the delete is sent.
- **Also decided with it:** undo of a date or a priority reads Todoist first and leaves a newer change alone; `Esc` clears a search and returns to the view; `T` in details selects the title again; a date in another year shows its year.
- **Rationale:** A question before every delete slows the common case and still allows a slip on `Enter`. An undo that is always offered protects the same mistake without the question. These came out of the review of D-019.

## Open decisions

- OAuth: application registration and credential storage
- Whether project deletion is required or whether archive/move is sufficient
