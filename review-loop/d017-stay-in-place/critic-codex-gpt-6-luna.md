codex
## Findings

1. **HIGH — Sync deletion loses the old cursor position before the new rule can use it.**  
   Location: [PLAN.md](/home/frank/Projects/keydo/review-loop/d017-stay-in-place/PLAN.md:52) and [index.html](/home/frank/Projects/keydo/index.html:1340).  
   If Todoist deletes the selected task, `reconcileSyncedTaskInteractions()` calls `reconcileTaskSelection()` before rendering. That helper replaces the deleted selection with the first task in the global `tasks` list. `renderTaskList()` then sees a valid selection, so it never calls `selectionAfterRemoval`. The user lands on the first task rather than the deleted task’s successor. The plan’s claim that sync deltas need no special handling is incorrect; preserve the old selected ID through reconciliation or pass the removal context to the selection rule.

2. **MEDIUM — The documented project-deletion fallback changes the view without user navigation.**  
   Location: [PLAN.md](/home/frank/Projects/keydo/review-loop/d017-stay-in-place/PLAN.md:118) and [index.html](/home/frank/Projects/keydo/index.html:1196).  
   While viewing a project, if sync reports that project deleted, `applyTodoistProjects()` changes the active project to Inbox. That contradicts D-017’s “view only changes when the user changes it” rule. The plan calls this an existing behavior limit, but D-017 only specifies a fallback for a missing project at startup; it does not grant an in-session exception.

3. **MEDIUM — The planned demo browser tests cannot exercise the live Smart Add path.**  
   Location: [PLAN.md](/home/frank/Projects/keydo/review-loop/d017-stay-in-place/PLAN.md:104) and [tests/ui.browser.ts](/home/frank/Projects/keydo/tests/ui.browser.ts:8).  
   The planned browser tests use demo mode. In demo mode, `createSmartTask()` delegates to `createQuickTask()`, so those tests will not run the live Smart Add code that currently switches to the created task’s project at [index.html](/home/frank/Projects/keydo/index.html:2926). Tests of exact create in demo mode could pass while live Smart Add still changes the view. Add a live-mode fixture or mocked Todoist test for Smart Add, including a task assigned to another project.

## Code paths covered by the plan

The planned selection rule is a reasonable fit for optimistic completion, due-date changes, project moves, and deletion **when the selected ID remains available until `renderTaskList()` runs**. The delete section correctly identifies the need to stop preselecting a global-list neighbor at [index.html](/home/frank/Projects/keydo/index.html:2227). The detail completion callback also needs to be wired to the detail key, button, and palette paths listed in the plan.

The key gap is sync reconciliation above. I found no other concrete mismatch in the described render paths worth adding.

Office check-in could not be recorded: the supplied read-only filesystem rejected both `office begin` and `office peek`. No project files were changed.
tokens used
81,051
## Findings

1. **HIGH — Sync deletion loses the old cursor position before the new rule can use it.**  
   Location: [PLAN.md](/home/frank/Projects/keydo/review-loop/d017-stay-in-place/PLAN.md:52) and [index.html](/home/frank/Projects/keydo/index.html:1340).  
   If Todoist deletes the selected task, `reconcileSyncedTaskInteractions()` calls `reconcileTaskSelection()` before rendering. That helper replaces the deleted selection with the first task in the global `tasks` list. `renderTaskList()` then sees a valid selection, so it never calls `selectionAfterRemoval`. The user lands on the first task rather than the deleted task’s successor. The plan’s claim that sync deltas need no special handling is incorrect; preserve the old selected ID through reconciliation or pass the removal context to the selection rule.

2. **MEDIUM — The documented project-deletion fallback changes the view without user navigation.**  
   Location: [PLAN.md](/home/frank/Projects/keydo/review-loop/d017-stay-in-place/PLAN.md:118) and [index.html](/home/frank/Projects/keydo/index.html:1196).  
   While viewing a project, if sync reports that project deleted, `applyTodoistProjects()` changes the active project to Inbox. That contradicts D-017’s “view only changes when the user changes it” rule. The plan calls this an existing behavior limit, but D-017 only specifies a fallback for a missing project at startup; it does not grant an in-session exception.

3. **MEDIUM — The planned demo browser tests cannot exercise the live Smart Add path.**  
   Location: [PLAN.md](/home/frank/Projects/keydo/review-loop/d017-stay-in-place/PLAN.md:104) and [tests/ui.browser.ts](/home/frank/Projects/keydo/tests/ui.browser.ts:8).  
   The planned browser tests use demo mode. In demo mode, `createSmartTask()` delegates to `createQuickTask()`, so those tests will not run the live Smart Add code that currently switches to the created task’s project at [index.html](/home/frank/Projects/keydo/index.html:2926). Tests of exact create in demo mode could pass while live Smart Add still changes the view. Add a live-mode fixture or mocked Todoist test for Smart Add, including a task assigned to another project.

## Code paths covered by the plan

The planned selection rule is a reasonable fit for optimistic completion, due-date changes, project moves, and deletion **when the selected ID remains available until `renderTaskList()` runs**. The delete section correctly identifies the need to stop preselecting a global-list neighbor at [index.html](/home/frank/Projects/keydo/index.html:2227). The detail completion callback also needs to be wired to the detail key, button, and palette paths listed in the plan.

The key gap is sync reconciliation above. I found no other concrete mismatch in the described render paths worth adding.

Office check-in could not be recorded: the supplied read-only filesystem rejected both `office begin` and `office peek`. No project files were changed.
