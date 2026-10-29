# Blind solver report (Claude Opus 5.5, Plan agent; given the problem and D-017 only, not PLAN.md)

Key points, condensed from the full report:

1. Two places jump to the top: `renderTaskList` (index.html:1737) and
   `reconcileTaskSelection` (src/task-view.js:785, after sync, picks `items[0]`
   of the global array). Make `renderTaskList` the single place that picks a
   replacement; `reconcileTaskSelection` should keep the missing id.
2. Helper `replacementSelection(previousIds, anchorId, availableIds)` scanning
   the old order; remember `{ids, selectedId}` only on renders where the
   selection is visible; clear on setView, search input, openProjectForReorder.
3. Delete: stop choosing a neighbour at index.html:2227 and 2243; the 2243
   one can pull the cursor after the user moved. Boot sets `selectedId = tasks[0]`
   (index.html:1656); should be null.
4. Failure reverts (2117, 3471, 3743, bulk, delete rollback 2261/2269) should
   only move the cursor back if it is still on the replacement.
5. Focus: innerHTML replaces the focused row; refocus the selected row when
   focus was on a row/body; never steal from capture input, editor, dialogs.
6. `C` in details: callback at the optimistic step inside
   toggleCompleteWithOrderLock; re-check detailEditing/selectedId; Project and
   Inbox views keep completed rows visible (visibleTasks line 1706 has no
   `!completed`), so the replacement must be chosen explicitly.
7. Capture: delete the view assignments (2927-2929, 2981); decide visibility at
   the optimistic step; the destination must be in the final toast (later
   toasts overwrite earlier ones); `openQuickCapture` clears the search
   (2702-2703), which is itself a view change.
8. Existing bug: `loadSortPreferences()` runs during `state` setup before
   `const SORT_STORAGE_KEY` is initialised (TDZ), the catch swallows it, so
   sort choices are lost on every reload. Don't copy the pattern.
9. `reconcileTodoistProjectSnapshot` names a restored project "Inbox" at boot.
10. Not covered by D-017: a project deleted mid-session silently switches to
    Inbox (1196-1198, 1323-1326). Suggest Today plus a message.
11. New src/*.js files need a route in src/server.ts; put helpers in existing
    modules.
