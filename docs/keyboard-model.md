# Keyboard Interaction Model

This model describes the implemented bindings, not aspirations. Keys are
**context-sensitive**: the list, the detail room, move mode, and the capture
composer each have their own small map. The key bar along the bottom of the window
always shows the keys for where the keyboard is, and `?` opens a map of the
whole keyboard. Those two and the command palette (`Ctrl+K`) are the source of
truth when in doubt.

## Principles

- Every important action has a direct keyboard path — no Tab chains.
- Tab is not a navigation key. It belongs to the browser (inputs, text
  areas); ordinary action buttons are reachable by key or by mouse. Date and
  deletion dialogs contain Tab focus so it cannot escape behind the popup.
- Single-letter shortcuts never fire while typing in an input or editor.
- The interface always shows the selected item, current view, and pending
  state; transient feedback appears as a message above the key bar.
- A key pressed on the keyboard presses the matching keycap on screen, so
  it is plain which key did what.
- `Ctrl` combinations other than `Ctrl+K`, `Ctrl+Z`, `Ctrl+Enter` and
  `Ctrl+V` are left to the browser (copy, reload, zoom).
- Optimistic updates: the UI changes immediately, Todoist syncs in the
  background, failures revert with a visible message.

## Task list

| Binding | Action |
| --- | --- |
| `↑` / `↓` | Select previous / next task. At the first task, `↑` returns the list to the top |
| `PageUp` / `PageDown` | Move selection by a page |
| `←` / `→` | Collapse / expand the selected task's subtasks |
| `1` to `5` | Go to Today, Upcoming, Priority, Inbox, Completed |
| `Space` | Complete or reopen the selected task. With tasks selected (bulk selection), complete all of them; this cannot be undone with `Z` |
| `Shift+Space` | Toggle bulk selection on the selected task |
| `Shift+↑` / `Shift+↓` | Extend bulk selection |
| `Enter`, `E` | Work on the task in the details pane (`Enter` opens commands when bulk selection exists) |
| `O` | Open the task in Todoist |
| `Delete` | Delete the task and its subtasks. Nothing is asked; a message says it was deleted and offers Undo (see Undo) |
| `T` / `Shift+T` | Move to Today / Tomorrow. A task already due that day is left as it is, and nothing is sent. See "Dates with a time or a repeat" |
| `C` | Clear due date. A repeating task stops repeating, and the message says so |
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
| `/` | Focus search and select the existing query; type to replace it or Backspace to clear it. Searches across all tasks (ignores the current view filter), except in Completed, where it searches the completed tasks. `↓` or `Enter` goes to the results; `Esc` clears the search and returns to the view it was started from |
| `N` | Capture composer (`Enter` uses Todoist Smart Add in live mode; pasted screenshots and demo mode use structured creation) |
| `Ctrl+K` | Command palette |
| `Ctrl+V` | Attach pasted screenshot to the selected task |
| `Z`, `Ctrl+Z` | Undo the last change (see Undo) |
| `?` | Keyboard map |
| `Esc` | Close panel / clear selection / clear a search / return focus |

The active keyboard task is marked separately from bulk-selected tasks. The
**Select tasks** control reveals selection checkboxes for mouse use; Shift
shortcuts reveal them automatically. **Cancel selection**, **Clear selection**,
or `Esc` dismiss selection mode, and changing views resets it. A view change always selects that view's first task and returns the page to the top, even when the previous task also appears there.

The list groups itself where its order allows: Today shows what is overdue
before what is due today, Upcoming is grouped by day and Priority by
priority. The headings go away when the view is sorted another way or
searched.

## Where you land after an action

The view only changes when you change it (sidebar, `G`, `R`, `/`). Actions
never switch views (D-017).

| After | You land on |
| --- | --- |
| Completing, rescheduling (`T`, `Shift+T`, `C`, `D`), moving (`M`) or deleting a task that then leaves the view | The task that took its place: the next one down, or the one above if it was last |
| A task changed in Todoist that leaves the view | Same as above |
| `C` (complete) in details | The list, on the task that took its place. From a drilled-in subtask: the parent's details |
| `C` (reopen) in details | Stay in details |
| Capture (`N`, `Enter`) | The same view. The new task is selected if it belongs in the view; otherwise the cursor stays put and a message says where it went |
| Opening or reloading Keydo | The last view you used (Today if its project is gone) |
| The project you are viewing is deleted | Today, with a message saying so |
| Undo brings a task back into the view | That task, unless you have moved the cursor since it left |

Completed tasks leave every view except Completed as soon as you complete
them. Capture keeps an active search too.

Reopening a parent completed through Keydo also restores the subtasks that
were unfinished when that parent was completed; already-finished children
stay finished. If Todoist only restores part of the subtree, **Completed**
keeps a **Retry reopening unfinished subtasks** entry. Use its checkbox or
`Space` to retry, including after a browser reload.

## Details

The details pane sits beside the list and always shows the selected task:
its screenshots, notes and subtasks can be read without opening anything.
`Enter` moves the keyboard into the pane. A red line appears along its top,
its key hints show, and the cursor in the list becomes an outline, so only
one place looks active. Nothing is autofocused into an editor, so the detail
keys are live immediately. These keys apply while details have the keyboard;
list-only meanings (`T`oday, `C`lear) are available there through the
command palette instead; a new task is started from the list. From inside an editor, the same section keys work
with `Alt` held.

| Binding | Action |
| --- | --- |
| `T` | Edit the task title |
| `N` | Edit notes |
| `D` | Open the due-date chooser |
| `S` | Focus Add subtask; type a title and press Enter |
| `Shift+S` | Jump to the first subtask (or Add if empty) |
| `↑` / `↓` on a subtask | Walk the subtask list |
| `Enter` on a subtask | Drill into that subtask |
| `←` | From any subtask, back to its parent |
| `+` / `-`, `M`, `O`, `G` | As in the list: priority, move to a project, open in Todoist, go to |
| `C` | Complete (returns to the list, or to the parent from a drilled-in subtask) or reopen (stays) |
| `Alt+T` / `Alt+N` / `Alt+D` / `Alt+S` / `Alt+C` | Same keys, usable while editing; `Alt+Shift+S` browses subtasks |
| `Ctrl+Enter` | Save title/notes |
| `Esc` | Return to the list |

In the Completed view the pane shows the selected task to read; `Space`
reopens it. The command list (`Ctrl+K`) shows a key beside a command only
where that key runs it, so in details it shows the detail keys. Reorder in
project, Clear date and the command list have no button of their own in the
list header or the pane: use `R`, `D` then `C`, and `Ctrl+K`.

Subtasks are full tasks: each level carries its own notes, photos, and
children. Drilling in keeps the editing context; `Esc` always returns to
the list selection.

After adding a subtask, the composer clears and keeps focus so another child
can be added immediately. `Esc` leaves the input; a second `Esc` returns to
the list.

While reading, the notes are shown rendered. While details have the
keyboard, the notes editor takes their place; formatted notes also show a
live preview under it, and **Show/Hide preview** overrides that until the
task is reopened. Screenshots have their own section above the notes and
show every image comment on the task. `Ctrl+Enter` saves and restores focus
to the task list.

## Due-date chooser

`D` works in both the list and details; `Alt+D` opens it while editing a
title or notes. It affects the task named in the popup, not bulk selection.

| Binding | Action |
| --- | --- |
| `↑` / `↓`, then `Enter` | Choose and apply an option |
| `T` | Today |
| `Y` | Tomorrow |
| `W` | Next week (the coming Monday) |
| `D`, or `→` on "Pick a date" | Pick a date: type it, or walk the calendar, then `Enter` or Apply |
| `←` / `→`, `↑` / `↓` in the date field | Move the calendar by a day, by a week |
| `PageUp` / `PageDown` in the date field | Move the calendar by a month |
| `C` | Clear date |
| `Esc` / Cancel / backdrop click | Close without changes and restore context focus |

The calendar beside the choices shows the month of the picked date; a click
on a day applies it. Today/Tomorrow use the existing account-timezone-aware
date mutation path.
The specific-date input is validated before applying. Existing `T`,
`Shift+T`, and `C` list shortcuts remain available.

### Dates with a time or a repeat

Keydo shows days, not times, but it keeps them. Moving a task that has a time
of day (`T`, `Shift+T`, the date chooser, Move selected tasks to Today) keeps
the same time on the new day, in the task's own time zone. If that time cannot
be placed on the new day (a clock change makes it not exist), the task is left
as it is and a message says so.

A repeating task is not moved: Keydo can only write a day, which would replace
the repeat. The message says so; `O` opens the task in Todoist, where the next
date can be moved with the repeat kept. In a bulk move, repeating tasks are
left out and counted in the message. Clearing the date (`C`) is different: it
removes the due date and the repeat, as asked.

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

## Undo

`Z` or `Ctrl+Z` takes back the last change of these kinds: completing a
task, a new due date, a new priority, deleting a task. The message that
follows such a change carries an **Undo** button, and stays, for the 12
seconds in which it can be taken back. The button names what it would undo
(**Undo delete**, **Undo date**), because later messages carry it too.

For a completion, a date or a priority, undo runs the opposite action through
the same path as the key that would do it by hand, after the change it
reverses has finished saving. Before putting an old date or priority back,
Keydo reads Todoist: if the task has been changed since, in another window or
on a phone, undo leaves it alone and says so. If Todoist cannot be read, or
Keydo is busy saving something else, nothing is undone, the offer stays, and
`Z` can be pressed again.

A delete is different, because Todoist cannot bring a deleted task back.
`Delete` hides the task and its subtasks at once and says so, but the delete
itself is only sent to Todoist when the 12 seconds are over, or as soon as
you make another change, whichever comes first: no other task is changed
while one is only hidden (typing in a title or notes is the exception, and
does not send it). `Z` before then puts the task back exactly as it was. If Todoist then refuses the delete, the
task returns to the list with a message. One delete is held at a time:
deleting a second task sends the first. Closing or reloading Keydo inside the
12 seconds means the delete is never sent, and the task is there next time.
Another window keeps showing the task until the delete is sent, and a subtask
added to it there in the meantime is deleted with it.

Not undoable: moving to a project, reordering, creating, edits to titles and
notes, bulk actions, completing a repeating task, and changing the date of a
task that repeats or has a due time (a date alone cannot put those back). Any
of these withdraws an earlier undo offer once it goes ahead, so **Undo** never
refers to an older change than the one just made. A key press that changes
nothing, or is refused, leaves the offer alone.

## Keyboard map

`?` opens a picture of the keyboard with what each key does, for a list and
for details (`←` / `→` switch between them). Pressing a key shows it on the
map. `?` or `Esc` closes it.

## Command palette

`Ctrl+K` opens all commands; `G` opens the goto section; `M` opens the
move-to-project section, which lists live projects for the selected task.
`↑↓` navigate, `Enter` runs, `Esc` closes.
