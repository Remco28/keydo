# Keyboard Interaction Model

This model describes the implemented bindings, not aspirations. Keys are
**context-sensitive**: the list, the detail room, move mode, and the capture
composer each have their own small map. The on-screen hint lines and the
command palette (`Ctrl+K`) are the source of truth when in doubt.

## Principles

- Every important action has a direct keyboard path — no Tab chains.
- Tab is not a navigation key. It belongs to the browser (inputs, text
  areas); ordinary action buttons are reachable by key or by mouse. Date and
  deletion dialogs contain Tab focus so it cannot escape behind the popup.
- Single-letter shortcuts never fire while typing in an input or editor.
- The interface always shows the selected item, current view, and pending
  state; transient feedback appears in the bottom status strip.
- Optimistic updates: the UI changes immediately, Todoist syncs in the
  background, failures revert with a visible message.

## Task list

| Binding | Action |
| --- | --- |
| `↑` / `↓` | Select previous / next task. At the first task, `↑` returns the page to the top |
| `PageUp` / `PageDown` | Move selection by a page. At the last task, `PageDown` reveals the footer |
| `Space` | Complete or reopen the selected task |
| `Shift+Space` | Toggle bulk selection on the selected task |
| `Shift+↑` / `Shift+↓` | Extend bulk selection |
| `Enter` | Open details (or commands when bulk selection exists) |
| `Delete` | Delete with confirmation |
| `T` / `Shift+T` | Move to Today / Tomorrow |
| `C` | Clear due date |
| `D` | Open the due-date chooser for the active task |
| `S` | Open details and focus Add subtask |
| `Shift+S` | Open details and focus the first existing subtask (or Add if empty) |
| `+` / `-` | Increase / decrease priority |
| `R` | Open the selected task's complete project list and clear search before reordering |
| `Alt+→` / `Alt+←` | In an unfiltered project view, indent under previous sibling / outdent one level |
| `Alt+↑` / `Alt+↓` | In an unfiltered project view, reorder among siblings |
| `M` | Move selected task to a project |
| `Shift+M` | In an unfiltered project view, move mode: pick any parent with `↑↓`, `Enter` drops, `Esc` cancels |
| `G` | Go to view / project / workspace |
| `B` | Sort the current view (see Sort chooser) |
| `/` | Search across all tasks (ignores the current view filter) |
| `N` | Capture composer (`Enter` uses Todoist Smart Add in live mode; pasted screenshots and demo mode use structured creation) |
| `Ctrl+K` | Command palette |
| `Ctrl+V` | Attach pasted screenshot to the selected task |
| `?` | Keyboard help |
| `Esc` | Close panel / clear selection / return focus |

The active keyboard task is marked separately from bulk-selected tasks. The
**Select tasks** control reveals selection checkboxes for mouse use; Shift
shortcuts reveal them automatically. **Cancel selection**, **Clear selection**,
or `Esc` dismiss selection mode, and changing views resets it. A view change always selects that view's first task and returns the page to the top, even when the previous task also appears there.

## Where you land after an action

The view only changes when you change it (sidebar, `G`, `R`, `/`). Actions
never switch views (D-017).

| After | You land on |
| --- | --- |
| Completing, rescheduling (`T`, `Shift+T`, `C`, `D`), moving (`M`) or deleting a task that then leaves the view | The task that took its place: the next one down, or the one above if it was last |
| A task changed in Todoist that leaves the view | Same as above |
| `C` (complete) in details | The list, on the task that took its place. From a drilled-in subtask: the parent's details |
| `C` (reopen) in details | Stay in details |
| Capture (`N`, `Enter`) | The same view. The new task is selected if it belongs in the view; otherwise the cursor stays put and the status strip says where it went |
| Opening or reloading Keydo | The last view you used (Today if its project is gone) |

Reopening a parent completed through Keydo also restores the subtasks that
were unfinished when that parent was completed; already-finished children
stay finished. If Todoist only restores part of the subtree, **Completed**
keeps a **Retry reopening unfinished subtasks** entry. Use its checkbox or
`Space` to retry, including after a browser reload.

## Detail room

Opening a task (`Enter`) focuses the detail room itself, so the detail keys
are live immediately — nothing is autofocused into an editor. These keys
apply while the detail room is open; list-only meanings (`T`oday, `C`lear,
`N`ew) are available there through the command palette instead. From inside
an editor, the same section keys work with `Alt` held.

| Binding | Action |
| --- | --- |
| `T` | Edit the task title |
| `N` | Edit notes |
| `D` | Open the due-date chooser |
| `S` | Focus Add subtask; type a title and press Enter |
| `Shift+S` | Jump to the first subtask (or Add if empty) |
| `↑` / `↓` on a subtask | Walk the subtask list |
| `Enter` on a subtask | Drill into that subtask |
| `C` | Complete (returns to the list, or to the parent from a drilled-in subtask) or reopen (stays) |
| `Alt+T` / `Alt+N` / `Alt+D` / `Alt+S` / `Alt+C` | Same keys, usable while editing; `Alt+Shift+S` browses subtasks |
| `Ctrl+Enter` | Save title/notes |
| `Esc` | Return to the list |

Subtasks are full tasks: each level carries its own notes, photos, and
children. Drilling in keeps the editing context; `Esc` always returns to
the list selection.

After adding a subtask, the composer clears and keeps focus so another child
can be added immediately. `Esc` leaves the input; a second `Esc` returns to
the list.

The compact **Detail shortcuts** disclosure contains the section-key map.
Plain/empty notes use one column; formatted notes show a rendered preview.
**Show/Hide preview** overrides that presentation until the task is reopened.
Attachments keep the preview visible, including every image comment on the
task. `Ctrl+Enter` saves and restores focus to the task list.

## Due-date chooser

`D` works in both the list and details; `Alt+D` opens it while editing a
title or notes. It affects the task named in the popup, not bulk selection.

| Binding | Action |
| --- | --- |
| `↑` / `↓`, then `Enter` | Choose and apply an option |
| `T` | Today |
| `Y` | Tomorrow |
| `D` | Specific date; choose/type the date, then `Enter` or Apply |
| `C` | Clear date |
| `Esc` / Cancel / backdrop click | Close without changes and restore context focus |

Today/Tomorrow use the existing account-timezone-aware date mutation path.
The specific-date input is validated before applying. Existing `T`,
`Shift+T`, and `C` list shortcuts remain available.

## Sort chooser

`B` in the list, the **Sort** button in the view header, or `Ctrl+K` → "Sort…"
opens it. Each view remembers its own sort (all project views share one); the
header shows the active sort when it differs from Keydo order. Sorting is
display-only and never changes order in Todoist. Subtasks stay under their
parent. Search results are not sorted.

| Binding | Action |
| --- | --- |
| `D` | Due date (soonest first; undated tasks last in either direction) |
| `P` | Priority (P1 first; ties by due date) |
| `T` | Title (A–Z, numbers in natural order) |
| `J` | Project name |
| `A` | Date added (newest first) |
| `M` | Keydo order — the view's built-in order |
| `R`, or the active key again | Reverse direction |
| `↑` / `↓`, then `Enter` | Choose and apply |
| `Esc` / Cancel / backdrop click | Close without changes |

Defaults: Priority sorts by priority, Upcoming by due date, other views use
Keydo order. In a sorted project view, `Alt+Arrow` and `Shift+M` refuse with a
hint to switch back to Keydo order (`B`, then `M`).

## Capture composer

| Binding | Action |
| --- | --- |
| `N` | Open the composer |
| Type + optional image paste | Title with natural input (`Call Alex tomorrow #Launch p1`), screenshot chip with remove |
| `Enter` | Create task and upload the screenshot as a comment. You stay in the current view |
| `Esc` | Cancel |

## Command palette

`Ctrl+K` opens all commands; `G` opens the goto section; `M` opens the
move-to-project section, which lists live projects for the selected task.
`↑↓` navigate, `Enter` runs, `Esc` closes.
