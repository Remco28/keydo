# Plan: actions keep you in your view and place (D-017)

*Kept by the review-loop skill (light review). Safe to delete this folder once the work is done.*

## Problem

Keydo is a keyboard-first Todoist client (single page: `index.html`, helpers in
`src/*.js`). Three things break the user's flow:

1. Capture (`N`, `Enter`) changes the view. Smart Add jumps to the new task's
   project (`index.html` ~2926), which is Inbox when no `#project` is typed. The
   user almost never uses projects, so every capture drops them into Inbox.
   Exact create jumps to Today or Upcoming (~2981).
2. When the selected task leaves the view (completed, rescheduled, moved,
   deleted, or changed by sync), `renderTaskList` (~1737) resets the cursor to
   `filtered[0]`, the top of the list. Delete picks a neighbour from the global
   `tasks` array (~2227), not the visible list, so it can also end at the top.
3. A reload always opens Today.

## Decisions (made by the human, recorded as D-017 in docs/decision-log.md)

- The view only changes when the user changes it: sidebar, `G`, `R`, `/`, Completed.
- When the selected task leaves the view, the cursor goes to the task that took
  its place: next one down, or the one above if it was last. Never the top.
- `C` in details completes and returns to the list with the next task selected;
  from a drilled-in subtask it returns to the parent's details. Reopen stays.
- Capture stays in the current view. If the new task belongs in it, select it;
  otherwise keep the cursor and say in the status strip where it went.
- Opening Keydo resumes the last view (project, workspace). Project gone: Today.

## Design

### 1. Keeping your place (one rule, in one place)

- New pure helper in `src/task-view.js`:
  `selectionAfterRemoval(previousIds, selectedId, visibleIds) -> id | null`.
  Find `selectedId` in `previousIds`; walk forward for the first id that is in
  `visibleIds`; else walk backward; else `visibleIds[0] ?? null`. If
  `selectedId` is not in `previousIds`, return `visibleIds[0] ?? null`.
  Walking the old order skips a completed parent's whole subtree naturally.
- `renderTaskList` keeps `state.place = { key, ids }`, updated on every render
  where the selected task is visible. `key` is
  `workspace|view|projectId|project|query` so a view change or a new search
  never reuses an old list (those still select the first task, as today).
- When the selected task is not visible (and the existing detail-editing guard
  does not apply), and `state.place.key` equals the current key, select
  `selectionAfterRemoval(place.ids, selectedId, filteredIds)`; otherwise
  `filtered[0]` as now.
- Delete stops choosing its own neighbour from `tasks`; it leaves the selection
  on the deleted id and the rule above picks the neighbour. Its failure/revert
  path keeps restoring the original id.
- Bulk actions, `T`/`Shift+T`/`C`/`D`, `M`, recurring completions and sync
  deltas all go through the same render path, so they need no special code.

### 2. Completing from details

- `toggleComplete(taskId, { onApplied })`: `toggleCompleteWithOrderLock` calls
  `onApplied(completed)` right after the optimistic `render()` (live and demo),
  i.e. only once all guards (order lock, pending edits flush, action gate)
  passed. Refused completions never navigate.
- `completeFromDetail()` is used by every completion entry point while the
  detail room is open: `C`, `Alt+C`, the Complete button, and palette
  `task:complete`. In `onApplied`, if `completed` and the detail room still
  shows the same task:
  - drilled in (`detailReturnId` set and that task exists): select it, clear
    `detailReturnId`, stay in details, focus the detail pane;
  - otherwise `leaveDetail()`; the place rule selects the next task.
  Reopening (`completed === false`) does nothing extra.
- A later Todoist failure reverts the task as today; the cursor stays where it
  went.

### 3. Capture stays in the view

- Smart Add (~2926) and exact create (~2981) no longer assign `state.view`,
  `state.project` or `state.projectId`.
- After creating, if the new task is in `visibleTasks()` select it (as now);
  otherwise keep the previous selection and make the success toast name the
  destination, e.g. "Added to Inbox · syncing to Todoist".
- Exact create's failure path already restores `previousSelectedId`; check it
  still does when the selection never moved.

### 4. Resume the last view

- `localStorage` key `keydo.lastView.v1`: `{ view, project, projectId, workspace }`.
  Written by `setView`, `openProjectForReorder` and `switchWorkspace`. Search is
  not a view and is not stored.
- Pure helper (`src/task-view.js` or a small new module)
  `resolveStoredView(stored, { liveTodoist, projectsById, projectNames })`:
  rejects malformed data; a `project` view must match an existing project (by id
  in live mode, by name in demo mode) or falls back to `today`; in live mode the
  workspace is forced to `Personal` (Work is demo-only).
- Applied once at boot: in demo mode before the first visible render; in live
  mode after the full sync has filled `projectsById` (in `loadRuntimeState`), and
  the project name comes from `projectsById`, not from
  `reconcileTodoistProjectSnapshot` (which names it "Inbox" at boot because its
  previous project map is empty). If boot sync fails, still apply it with the
  project check failing to `today`.

## Tests

- Unit (`tests/task-view.test.ts`): `selectionAfterRemoval` (middle, last,
  subtree removed, several removed, not in previous list, empty);
  `resolveStoredView` (each fallback).
- Browser (`tests/ui.browser.ts`, demo mode): complete a middle task (next is
  selected), complete the last (previous), `Shift+T` out of Today, delete, `C`
  in details (back in list on next), `C` on a drilled-in subtask (parent
  details), capture that fits the view (selected, view unchanged), capture that
  does not (view and cursor unchanged, toast names project), reload resumes a
  project view.
- Update any existing browser checks that assumed the old jumps.
- `bun test`, `bun run typecheck`, `bun run test:browser`.

## Known limits (not changing)

- Drill-in remembers only one level (`detailReturnId`), as today.
- A task that stays in the view but moves (e.g. rescheduled in a due-sorted
  Upcoming) keeps the cursor on it, wherever it moves.
- Deleting the project you are viewing mid-session still falls back to Inbox
  (existing `applyTodoistProjects` behaviour).
