# Keyboard Interaction Model

This model describes the implemented bindings, not aspirations. Keys are
**context-sensitive**: the list, the detail room, move mode, and the capture
composer each have their own small map. The on-screen hint lines and the
command palette (`Ctrl+K`) are the source of truth when in doubt.

## Principles

- Every important action has a direct keyboard path — no Tab chains.
- Tab is not a navigation key. It belongs to the browser (inputs, text
  areas); action buttons are reachable by key or by mouse, never by tabbing.
- Single-letter shortcuts never fire while typing in an input or editor.
- The interface always shows the selected item, current view, and pending
  state; transient feedback appears in the bottom status strip.
- Optimistic updates: the UI changes immediately, Todoist syncs in the
  background, failures revert with a visible message.

## Task list

| Binding | Action |
| --- | --- |
| `↑` / `↓` | Select previous / next task |
| `PageUp` / `PageDown` | Move selection by a page |
| `Space` | Complete or reopen the selected task |
| `Shift+Space` | Toggle bulk selection on the selected task |
| `Shift+↑` / `Shift+↓` | Extend bulk selection |
| `Enter` | Open details (or commands when bulk selection exists) |
| `Delete` | Delete with confirmation |
| `T` / `Shift+T` | Move to Today / Tomorrow |
| `C` | Clear due date |
| `+` / `-` | Increase / decrease priority |
| `Alt+→` / `Alt+←` | In an unfiltered project view, indent under previous sibling / outdent one level |
| `Alt+↑` / `Alt+↓` | In an unfiltered project view, reorder among siblings |
| `M` | Move selected task to a project |
| `Shift+M` | In an unfiltered project view, move mode: pick any parent with `↑↓`, `Enter` drops, `Esc` cancels |
| `G` | Go to view / project / workspace |
| `/` | Search across all tasks (ignores the current view filter) |
| `N` | Capture composer (type + optional pasted screenshot, `Enter` creates) |
| `Ctrl+K` | Command palette |
| `Ctrl+V` | Attach pasted screenshot to the selected task |
| `?` | Keyboard help |
| `Esc` | Close panel / clear selection / return focus |

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
| `S` | Jump to the first subtask |
| `↑` / `↓` on a subtask | Walk the subtask list |
| `Enter` on a subtask | Drill into that subtask |
| `C` | Complete or reopen the task |
| `Alt+T` / `Alt+N` / `Alt+S` / `Alt+C` | Same section keys, usable while editing |
| `Ctrl+Enter` | Save title/notes |
| `Esc` | Return to the list |

Subtasks are full tasks: each level carries its own notes, photos, and
children. Drilling in keeps the editing context; `Esc` always returns to
the list selection.

## Capture composer

| Binding | Action |
| --- | --- |
| `N` | Open the composer |
| Type + optional image paste | Title with natural input (`Call Alex tomorrow #Launch p1`), screenshot chip with remove |
| `Enter` | Create task and upload the screenshot as a comment |
| `Esc` | Cancel |

## Command palette

`Ctrl+K` opens all commands; `G` opens the goto section; `M` opens the
move-to-project section, which lists live projects for the selected task.
`↑↓` navigate, `Enter` runs, `Esc` closes.
