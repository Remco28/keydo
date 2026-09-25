import { describe, expect, test } from "bun:test";
import { applyProjectTaskMove, applyTaskDueChange, applyTaskHierarchyMove, applyTaskOrderKeys, applyTodoistProjectDelta, applyTodoistSectionDeltas, deletedTodoistProjectIds, discardTaskEdits, isRecurringTaskCompletion, isTaskCompletionStateCurrent, reconcileTodoistProjectSnapshot, restoreMissingTasks, restoreTaskOrderFields, restoreTaskSnapshots, setTaskAttachment, retainOmittedTaskFields, retainPendingCreates, retryablePendingTaskUpdates } from "../src/task-mutations.js";
import { taskDeletionClosure, taskParentOverridesForDelta, taskRootsForDeletedProjects } from "../src/task-view.js";
import { orderTaskTree, swapSiblingTaskOrder } from "../src/task-view.js";

describe("sync order field reconciliation", () => {
  test("reconciles attachment mutations by task ID after Sync replaces task objects", () => {
    const staleTask = { id: "task-1", attachment: { commentId: "old-comment" } };
    const currentTasks = [{ id: "task-1", attachment: null as { commentId: string } | null }];
    const attachment = { commentId: "new-comment" };

    expect(setTaskAttachment(currentTasks, "task-1", attachment)).toBe(true);
    expect(currentTasks[0]?.attachment).toBe(attachment);
    expect(staleTask.attachment).toEqual({ commentId: "old-comment" });
    expect(setTaskAttachment(currentTasks, "deleted-task", null)).toBe(false);
  });

  test("preserves day_order for a same-date assignment and clears it when the date changes", () => {
    const existing = { due: "Today", dueDateKey: "2026-09-25", dueClass: "", dayOrder: 7 };

    expect(applyTaskDueChange({ ...existing }, "Today", "2026-09-25")).toMatchObject({
      due: "Today", dueDateKey: "2026-09-25", dayOrder: 7
    });
    expect(applyTaskDueChange({ ...existing }, "Tomorrow", "2026-09-26")).toMatchObject({
      due: "Tomorrow", dueDateKey: "2026-09-26", dayOrder: null
    });
  });

  test("reapplies accepted sibling keys to task objects replaced by a queued sync", () => {
    const currentTasks = [
      { id: "first", orderKey: "a0" },
      { id: "second", orderKey: "a1" }
    ];

    applyTaskOrderKeys(currentTasks, [
      { id: "first", orderKey: "a1" },
      { id: "second", orderKey: "a0" }
    ]);

    expect(orderTaskTree(currentTasks).map(task => task.id)).toEqual(["second", "first"]);
  });

  test("restores a large sibling-order snapshot by task ID", () => {
    const currentTasks = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      orderKey: `new-${index}`,
      childOrder: index + 1
    }));
    const snapshots = currentTasks.map((task, index) => ({
      id: task.id,
      orderKey: `old-${index}`,
      childOrder: index
    }));
    snapshots.push({ id: "missing-task", orderKey: "old-missing", childOrder: 0 });

    restoreTaskOrderFields(currentTasks, snapshots);

    expect(currentTasks[0]).toMatchObject({ orderKey: "old-0", childOrder: 0 });
    expect(currentTasks[9_999]).toMatchObject({ orderKey: "old-9999", childOrder: 9_999 });
  });

  test("restores a large project-move snapshot by task ID in one indexed pass", () => {
    const tasks: Array<{
      id: string;
      projectId: string;
      project: string;
      parentId: string | null;
      sectionId: string | null;
      sectionOrder: number | null;
      orderKey: string | null;
      childOrder: number | null;
      dayOrder: number | null;
    }> = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      projectId: "new",
      project: "New",
      parentId: null,
      sectionId: null,
      sectionOrder: null,
      orderKey: null,
      childOrder: null,
      dayOrder: null
    }));
    const snapshots = tasks.map((task, index) => ({
      id: task.id,
      projectId: "old",
      project: "Old",
      parentId: index ? `task-${index - 1}` : null,
      sectionId: "section",
      sectionOrder: 2,
      orderKey: `key-${index}`,
      childOrder: index + 1,
      dayOrder: index + 1
    }));

    expect(restoreTaskSnapshots(tasks, snapshots)).toBe(tasks);
    expect(tasks[0]).toMatchObject({ projectId: "old", parentId: null, orderKey: "key-0" });
    expect(tasks[9_999]).toMatchObject({ project: "Old", parentId: "task-9998", dayOrder: 10_000 });
  });

  test("restores the original list position after a move rollback without ordering fields", () => {
    const tasks = [
      { id: "first", projectId: "project", parentId: null },
      { id: "moving", projectId: "project", parentId: null },
      { id: "last", projectId: "project", parentId: null }
    ];
    const snapshots = [{ id: "moving", index: 1, projectId: "project", parentId: null }];
    const moved = applyProjectTaskMove(tasks, "moving", "destination", "Destination");
    expect(moved.map(task => task.id)).toEqual(["first", "last", "moving"]);
    restoreTaskSnapshots(moved, snapshots);
    expect(moved.map(task => task.id)).toEqual(["first", "moving", "last"]);
    expect(moved[1]).not.toHaveProperty("index");
  });

  test("preserves omitted values but applies explicit nulls", () => {
    const previous: { orderKey: string | null; childOrder: number | null; dayOrder: number | null } = { orderKey: "a1", childOrder: 4, dayOrder: 2 };
    const mapped = retainOmittedTaskFields<typeof previous>(
      { orderKey: null, childOrder: null, dayOrder: null }, previous,
      { order_key: null, child_order: null }
    );
    expect(mapped).toEqual({ orderKey: null, childOrder: null, dayOrder: 2 });
  });

  test("preserves refreshed project order metadata when an item delta omits project_id", () => {
    const previous: {
      id: string; projectId: string | null; project: string;
      projectOrderKey: string | null; projectChildOrder: number | null; projectOrderParentId: string | null;
      sectionId: string | null; parentId: string | null; orderKey: string | null; childOrder: number | null;
    } = {
      id: "task-1", projectId: "project-a", project: "A",
      projectOrderKey: "a1", projectChildOrder: 1, projectOrderParentId: null,
      sectionId: null, parentId: null, orderKey: "a0", childOrder: 1
    };
    applyTodoistProjectDelta(
      new Map([[
        "project-a",
        { id: "project-a", name: "A", orderKey: "a1", childOrder: 1, parentId: null }
      ]]),
      [previous],
      "project-a",
      { id: "project-a", order_key: "a2", child_order: 2, parent_id: "parent-a" }
    );
    const mapped = retainOmittedTaskFields(
      {
        ...previous, projectId: "inbox", project: "Inbox",
        projectOrderKey: "b0", projectChildOrder: 1, projectOrderParentId: null
      },
      previous,
      { content: "updated" }
    );
    expect(mapped).toMatchObject({
      projectId: "project-a", project: "A",
      projectOrderKey: "a2", projectChildOrder: 2, projectOrderParentId: "parent-a"
    });
  });

  test("does not retain a completed task's old sibling position after reopening", () => {
    const previous = {
      id: "task-1", completed: true, orderKey: "a0", childOrder: 1,
      projectId: "project-1", sectionId: null, parentId: "parent-1"
    };
    const reopened = retainOmittedTaskFields(
      { ...previous, completed: false },
      previous,
      { checked: false }
    );
    expect(reopened).toMatchObject({ completed: false, orderKey: null, childOrder: null });

    const serverOrdered = retainOmittedTaskFields(
      { ...previous, completed: false, orderKey: "a9", childOrder: 7 },
      previous,
      { checked: false, order_key: "a9", child_order: 7 }
    );
    expect(serverOrdered).toMatchObject({ orderKey: "a9", childOrder: 7 });
  });

  test("drops an omitted day position when an explicit due-date change moves the task to another day group", () => {
    const previous: { due: string; dueDateKey: string; orderKey: string | null; childOrder: number | null; dayOrder: number | null } = {
      due: "Today", dueDateKey: "2026-09-24", orderKey: "a1", childOrder: 4, dayOrder: 2
    };
    const changedDate = retainOmittedTaskFields<typeof previous>(
      { due: "Tomorrow", dueDateKey: "2026-09-25", orderKey: null, childOrder: null, dayOrder: null },
      previous,
      { due: { date: "2026-09-25" } }
    );
    expect(changedDate).toMatchObject({ due: "Tomorrow", dayOrder: null });

    const unchangedDate = retainOmittedTaskFields<typeof previous>(
      { due: "Today", dueDateKey: "2026-09-24", orderKey: null, childOrder: null, dayOrder: null },
      previous,
      { due: { date: "2026-09-24" } }
    );
    expect(unchangedDate.dayOrder).toBe(2);

    const recurringPrevious = { ...previous, due: "Recurring", dueDateKey: "2026-09-26" };
    const recurringMoved = retainOmittedTaskFields<typeof recurringPrevious>(
      { ...recurringPrevious, dueDateKey: "2026-09-27", dayOrder: null },
      recurringPrevious,
      { due: { date: "2026-09-27", is_recurring: true } }
    );
    expect(recurringMoved).toMatchObject({ due: "Recurring", dueDateKey: "2026-09-27", dayOrder: null });
  });

  test("does not carry sibling order keys into a different project or parent when a delta omits them", () => {
    const previous: {
      projectId: string | null; sectionId: string | null; parentId: string | null;
      sectionOrderKey: string | null; orderKey: string | null; childOrder: number | null; dayOrder: number | null;
    } = {
      projectId: "project-a", sectionId: "section-a", parentId: "parent-a",
      sectionOrderKey: "a1", orderKey: "a2", childOrder: 4, dayOrder: 2
    };
    const mapped = retainOmittedTaskFields<typeof previous>(
      {
        projectId: "project-b", sectionId: null, parentId: null,
        sectionOrderKey: null, orderKey: null, childOrder: null, dayOrder: null
      },
      previous,
      { project_id: "project-b" }
    );

    expect(mapped).toEqual({
      projectId: "project-b", sectionId: null, parentId: null,
      sectionOrderKey: null, orderKey: null, childOrder: null, dayOrder: 2
    });
  });

  test("detaches a task moved to another section when the delta omits parent_id", () => {
    const previous: {
      projectId: string; sectionId: string; parentId: string | null;
      sectionOrderKey: string | null; orderKey: string | null; childOrder: number | null; dayOrder: number | null;
    } = {
      projectId: "project-a", sectionId: "section-a", parentId: "parent-a",
      sectionOrderKey: "a1", orderKey: "a2", childOrder: 4, dayOrder: 2
    };
    const mapped = retainOmittedTaskFields(
      { ...previous, sectionId: "section-b", sectionOrderKey: "b0", parentId: null, orderKey: null, childOrder: null },
      previous,
      { section_id: "section-b" }
    );

    expect(mapped).toMatchObject({
      projectId: "project-a", sectionId: "section-b", parentId: null,
      orderKey: null, childOrder: null, dayOrder: 2
    });
  });

  test("restored order keys determine the tree order after a full payload omits them", () => {
    const previousById = new Map([
      ["first", { id: "first", projectId: "p", parentId: null, sectionId: null, orderKey: "a0", childOrder: 1 }],
      ["second", { id: "second", projectId: "p", parentId: null, sectionId: null, orderKey: "a1", childOrder: 2 }]
    ]);
    const mappedInPayloadOrder: Array<{
      id: string; projectId: string; parentId: null; sectionId: null;
      orderKey: string | null; childOrder: number | null;
    }> = [
      { id: "second", projectId: "p", parentId: null, sectionId: null, orderKey: null, childOrder: null },
      { id: "first", projectId: "p", parentId: null, sectionId: null, orderKey: null, childOrder: null }
    ];

    const reconciled = mappedInPayloadOrder.map(mapped =>
      retainOmittedTaskFields(mapped, previousById.get(mapped.id)!, {})
    );

    expect(reconciled.map(task => task.id)).toEqual(["second", "first"]);
    expect(orderTaskTree(reconciled).map(task => task.id)).toEqual(["first", "second"]);
  });

  test("preserves omitted sibling location fields instead of defaulting a partial delta to Inbox root", () => {
    const previous: {
      project: string; projectId: string | null; sectionId: string | null; sectionOrder: number | null; sectionOrderKey: string | null; parentId: string | null;
      orderKey: string | null; childOrder: number | null; dayOrder: number | null;
    } = {
      project: "Research", projectId: "project-a", sectionId: "section-a", sectionOrder: 2, sectionOrderKey: "a1", parentId: "parent-a",
      orderKey: "a2", childOrder: 4, dayOrder: 2
    };
    const mapped = retainOmittedTaskFields<typeof previous>(
      {
        project: "Inbox", projectId: "inbox-id", sectionId: null, sectionOrder: null, sectionOrderKey: null, parentId: null,
        orderKey: null, childOrder: null, dayOrder: null
      },
      previous,
      {}
    );

    expect(mapped).toEqual(previous);
  });

  test("preserves omitted task values in a partial delta while applying explicit values", () => {
    const previous: {
      title: string; description: string; priority: number; completed: boolean;
      due: string; dueClass: string; recurring: boolean;
      orderKey: string | null; childOrder: number | null; dayOrder: number | null;
    } = {
      title: "Keep this title", description: "Keep these details", priority: 3,
      completed: true, due: "Tomorrow", dueClass: "overdue", recurring: true,
      orderKey: "a1", childOrder: 4, dayOrder: 2
    };
    const mapped = retainOmittedTaskFields({
      title: "", description: "", priority: 4, completed: false,
      due: "No date", dueClass: "", recurring: false,
      orderKey: null, childOrder: null, dayOrder: null
    }, previous, { checked: false, priority: 4 });

    expect(mapped).toMatchObject({
      title: "Keep this title", description: "Keep these details", priority: 4,
      completed: false, due: "Tomorrow", dueClass: "overdue", recurring: true,
      orderKey: null, childOrder: null, dayOrder: 2
    });

    const cleared = retainOmittedTaskFields({ ...mapped, due: "No date", dueClass: "", recurring: false }, mapped, { due: null });
    expect(cleared).toMatchObject({ due: "No date", dueClass: "", recurring: false });
  });
});

describe("hierarchy order mutation", () => {
  test("updates section order maps from partial deltas and drops explicit null or deleted keys", () => {
    const sectionOrders = new Map([["section-a", 1], ["section-b", 2], ["section-deleted", 9]]);
    const sectionOrderKeys = new Map([["section-a", "a0"], ["section-b", "a1"], ["section-deleted", "z0"]]);

    applyTodoistSectionDeltas(sectionOrders, sectionOrderKeys, [
      { id: "section-a", order_key: "a2" },
      { id: "section-b", order_key: null, section_order: null },
      { id: "section-c", section_order: 3, order_key: "a3" },
      { id: "section-deleted", is_deleted: true }
    ]);

    expect(sectionOrders).toEqual(new Map([["section-a", 1], ["section-c", 3]]));
    expect(sectionOrderKeys).toEqual(new Map([["section-a", "a2"], ["section-c", "a3"]]));
  });

  test("project rename deltas replace stale names in task labels and the selected view", () => {
    const projectsById = new Map([
      ["project-1", { id: "project-1", name: "Old name" }],
      ["project-2", { id: "project-2", name: "Old name" }]
    ]);
    const tasks = [
      { id: "task-1", projectId: "project-1", project: "Old name" },
      { id: "task-2", projectId: "project-2", project: "Old name" }
    ];

    const selectedProjectId = applyTodoistProjectDelta(projectsById, tasks, "project-1", { id: "project-1", name: "New name" });

    expect(projectsById).toEqual(new Map([
      ["project-1", { id: "project-1", name: "New name" }],
      ["project-2", { id: "project-2", name: "Old name" }]
    ]));
    expect(tasks.map(task => task.project)).toEqual(["New name", "Old name"]);
    expect(selectedProjectId).toBe("project-1");

    const deletedProjectId = applyTodoistProjectDelta(projectsById, tasks, "project-1", { id: "project-1", is_deleted: true });
    expect(projectsById).toEqual(new Map([["project-2", { id: "project-2", name: "Old name" }]]));
    expect(deletedProjectId).toBeNull();
  });

  test("project tombstones include subproject descendants and delete cascaded tasks", () => {
    const projectsById = new Map([
      ["project-a", { id: "project-a", name: "A", parentId: null }],
      ["project-b", { id: "project-b", name: "B", parentId: "project-a" }],
      ["project-c", { id: "project-c", name: "C", parentId: "project-b" }],
      ["project-other", { id: "project-other", name: "Other", parentId: null }]
    ]);
    const deletedProjectIds = deletedTodoistProjectIds(projectsById, [{ id: "project-a", is_deleted: true }]);
    expect(deletedProjectIds).toEqual(new Set(["project-a", "project-b", "project-c"]));
    expect(deletedTodoistProjectIds(projectsById, [
      { id: "project-a", is_deleted: true },
      { id: "project-b", parent_id: null }
    ])).toEqual(new Set(["project-a"]));

    const tasks = [
      { id: "root", projectId: "project-a", parentId: null },
      { id: "child", projectId: "project-a", parentId: "root" },
      { id: "moved", projectId: "project-b", parentId: "child" },
      { id: "moved-child", projectId: "project-b", parentId: "moved" },
      { id: "other", projectId: "project-other", parentId: null }
    ];
    const deltas = [{ id: "moved", project_id: "project-other" }];
    const roots = taskRootsForDeletedProjects(tasks, deletedProjectIds, deltas);
    const parentOverrides = taskParentOverridesForDelta(tasks, deltas);
    expect(roots).toEqual(["root"]);
    expect(taskDeletionClosure(tasks, roots, parentOverrides)).toEqual(new Set(["root", "child"]));
    expect(taskRootsForDeletedProjects([], deletedProjectIds, [
      { id: "created-during-delete", project_id: "project-c" }
    ])).toEqual(["created-during-delete"]);
  });

  test("project order deltas preserve omitted fields and refresh task ordering metadata", () => {
    const projectsById = new Map([["project-1", { id: "project-1", name: "Roadmap", orderKey: "a0", childOrder: 1, parentId: "parent" }]]);
    const tasks = [{ id: "task-1", projectId: "project-1", project: "Roadmap", projectOrderKey: "a0", projectChildOrder: 1, projectOrderParentId: "parent" }];
    applyTodoistProjectDelta(projectsById, tasks, "project-1", { id: "project-1", order_key: "a1" });
    expect(projectsById.get("project-1")).toEqual({ id: "project-1", name: "Roadmap", orderKey: "a1", childOrder: 1, parentId: "parent" });
    expect(tasks[0]).toMatchObject({ project: "Roadmap", projectOrderKey: "a1", projectChildOrder: 1, projectOrderParentId: "parent" });
    applyTodoistProjectDelta(projectsById, tasks, "project-1", { id: "project-1", order_key: null, child_order: null });
    expect(tasks[0]).toMatchObject({ projectOrderKey: null, projectChildOrder: null, projectOrderParentId: "parent" });
  });

  test("full project snapshots preserve IDs across renames and same-name projects", () => {
    const previousProjectsById = new Map([["project-1", { id: "project-1", name: "Old name" }]]);
    const renamed = reconcileTodoistProjectSnapshot(previousProjectsById, "project-1", [
      { id: "project-1", name: "New name" },
      { id: "project-2", name: "New name" }
    ]);
    expect(renamed).toEqual({
      projectsById: new Map([
        ["project-1", { id: "project-1", name: "New name", orderKey: null, childOrder: null, parentId: null }],
        ["project-2", { id: "project-2", name: "New name", orderKey: null, childOrder: null, parentId: null }]
      ]),
      selectedProjectId: "project-1",
      selectedProject: "New name"
    });

    const deleted = reconcileTodoistProjectSnapshot(previousProjectsById, "project-1", [
      { id: "project-2", name: "Other project" }
    ]);
    expect(deleted.selectedProject).toBe("Inbox");
    expect(deleted.selectedProjectId).toBeNull();

    const initial = reconcileTodoistProjectSnapshot(new Map(), null, [
      { id: "project-2", name: "Other project" },
      { id: "inbox-id", name: "Inbox" }
    ]);
    expect(initial.selectedProject).toBe("Inbox");
    expect(initial.selectedProjectId).toBe("inbox-id");
  });

  test("cancels a completion toggle when sync changed the state the user saw", () => {
    expect(isTaskCompletionStateCurrent({ completed: false }, false)).toBe(true);
    expect(isTaskCompletionStateCurrent({ completed: true }, false)).toBe(false);
    expect(isTaskCompletionStateCurrent(undefined, false)).toBe(false);
  });

  test("applies recurring-task completion recovery only when closing, not reopening", () => {
    const recurring = { recurring: true };
    expect(isRecurringTaskCompletion(recurring, true)).toBe(true);
    expect(isRecurringTaskCompletion(recurring, false)).toBe(false);
    expect(isRecurringTaskCompletion({ recurring: false }, true)).toBe(false);
  });

  test("hierarchy moves use destination-last placement and discard the source sibling key", () => {
    const tasks = [
      { id: "moving", parentId: null, childOrder: 1, orderKey: "a0" },
      { id: "target", parentId: null, childOrder: 2, orderKey: "a1" },
      { id: "existing-child", parentId: "target", childOrder: 1, orderKey: "a0" },
      { id: "moving-child", parentId: "moving", childOrder: 1, orderKey: "a0" }
    ];

    const moved = orderTaskTree(applyTaskHierarchyMove(tasks, "moving", "target"));

    expect(moved.map(task => task.id)).toEqual(["target", "existing-child", "moving", "moving-child"]);
    expect(moved.find(task => task.id === "moving")).toMatchObject({ parentId: "target", childOrder: null, orderKey: null });
    expect(moved.find(task => task.id === "moving-child")).toMatchObject({ parentId: "moving", childOrder: 1, orderKey: "a0" });
  });

  test("nesting into another section moves the whole subtree into the target placement and can roll back", () => {
    const tasks = [
      { id: "source", project: "Project", projectId: "project-1", sectionId: "section-old", sectionOrder: 1, sectionOrderKey: "a1", parentId: null, childOrder: 2, orderKey: "a1" },
      { id: "source-child", project: "Project", projectId: "project-1", sectionId: "section-old", sectionOrder: 1, sectionOrderKey: "a1", parentId: "source", childOrder: 1, orderKey: "a0" },
      { id: "target", project: "Project", projectId: "project-1", sectionId: "section-new", sectionOrder: 2, sectionOrderKey: "a0", parentId: null, childOrder: 1, orderKey: "a0" },
      { id: "target-child", project: "Project", projectId: "project-1", sectionId: "section-new", sectionOrder: 2, sectionOrderKey: "a0", parentId: "target", childOrder: 1, orderKey: "a0" }
    ];
    const subtree = new Set(["source", "source-child"]);
    const snapshots = tasks.filter(task => subtree.has(task.id)).map(task => ({
      id: task.id,
      project: task.project,
      projectId: task.projectId,
      parentId: task.parentId,
      sectionId: task.sectionId,
      sectionOrder: task.sectionOrder,
      sectionOrderKey: task.sectionOrderKey,
      childOrder: task.childOrder,
      orderKey: task.orderKey
    }));

    const moved = applyTaskHierarchyMove(tasks, "source", "target");
    expect(moved.find(task => task.id === "source")).toMatchObject({ parentId: "target", sectionId: "section-new", sectionOrder: 2, sectionOrderKey: "a0", orderKey: null, childOrder: null });
    expect(moved.find(task => task.id === "source-child")).toMatchObject({
      parentId: "source", sectionId: "section-new", sectionOrder: 2, sectionOrderKey: "a0", orderKey: null, childOrder: null
    });
    expect(orderTaskTree(moved).map(task => task.id)).toEqual(["target", "target-child", "source", "source-child"]);
    restoreTaskSnapshots(moved, snapshots);
    expect(moved.find(task => task.id === "source")).toMatchObject({ parentId: null, sectionId: "section-old", sectionOrder: 1, sectionOrderKey: "a1", childOrder: 2, orderKey: "a1" });
    expect(moved.find(task => task.id === "source-child")).toMatchObject({ parentId: "source", sectionId: "section-old", sectionOrder: 1, sectionOrderKey: "a1" });
  });

  test("rebuilds descendant sibling order when a section move merges child groups", () => {
    const tasks = orderTaskTree([
      { id: "source", projectId: "project-1", sectionId: "section-old", sectionOrder: 1, parentId: null, orderKey: "a0", childOrder: 1 },
      { id: "late-child", projectId: "project-1", sectionId: "section-late", sectionOrder: 2, parentId: "source", orderKey: "a0", childOrder: 1 },
      { id: "early-child", projectId: "project-1", sectionId: "section-early", sectionOrder: 1, parentId: "source", orderKey: "a0", childOrder: 2 },
      { id: "target", projectId: "project-1", sectionId: "section-new", sectionOrder: 3, parentId: null, orderKey: "a1", childOrder: 2 }
    ]);

    const moved = orderTaskTree(applyTaskHierarchyMove(tasks, "source", "target"));

    expect(moved.map(task => task.id)).toEqual(["target", "source", "early-child", "late-child"]);
    expect(moved.filter(task => task.parentId === "source").every(task => task.orderKey === null && task.childOrder === null)).toBe(true);
  });

  test("restores a cloned optimistic swap by task ID after recovery sync fails", () => {
    const original = [
      { id: "a", parentId: null, childOrder: 1, orderKey: null },
      { id: "a-child", parentId: "a", childOrder: 1, orderKey: null },
      { id: "b", parentId: null, childOrder: 2, orderKey: null },
      { id: "b-child", parentId: "b", childOrder: 1, orderKey: null }
    ];
    const snapshots = [original[0], original[2]].map(task => ({ id: task.id, childOrder: task.childOrder, orderKey: task.orderKey }));
    const reordered = swapSiblingTaskOrder(original, "b", "a")!;

    expect(reordered).not.toBe(original);
    const restored = orderTaskTree(restoreTaskOrderFields(reordered, snapshots));
    expect(restored.map(task => task.id)).toEqual(["a", "a-child", "b", "b-child"]);
    expect(restored.find(task => task.id === "a")?.childOrder).toBe(1);
    expect(restored.find(task => task.id === "b")?.childOrder).toBe(2);
  });

});

describe("full sync reconciliation", () => {
  test("project moves invalidate sibling order but preserve Today and Upcoming positions", () => {
    const tasks = [
      { id: "other-project", project: "Old", projectId: "old", parentId: null, sectionId: "old-section", orderKey: "a0", childOrder: 1, dayOrder: 2 },
      { id: "parent", project: "Old", projectId: "old", parentId: null, sectionId: "old-section", orderKey: "a1", childOrder: 2, dayOrder: 3 },
      { id: "moving", project: "Old", projectId: "old", parentId: "parent", sectionId: "old-section", orderKey: "a2", childOrder: 3, dayOrder: 4 },
      { id: "child", project: "Old", projectId: "old", parentId: "moving", sectionId: "old-section", orderKey: "a3", childOrder: 4, dayOrder: 5 }
    ];

    const moved = applyProjectTaskMove(tasks, "moving", "new", "New");

    expect(moved.map(task => task.id)).toEqual(["other-project", "parent", "child", "moving"]);
    expect(moved.find(task => task.id === "moving")).toMatchObject({
      project: "New", projectId: "new", parentId: null, sectionId: null, orderKey: null, childOrder: null, dayOrder: 4
    });
    expect(moved.find(task => task.id === "child")).toMatchObject({
      project: "New", projectId: "new", parentId: "moving", sectionId: null, orderKey: null, childOrder: null, dayOrder: 5
    });
  });

  test("moves a deep child-first subtree without losing descendants", () => {
    const chain = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      project: "Old",
      projectId: "old",
      parentId: index === 0 ? null : `task-${index - 1}`,
      orderKey: `key-${index}`
    })).reverse();
    chain.push({ id: "unrelated", project: "Old", projectId: "old", parentId: null, orderKey: "other" });

    const moved = applyProjectTaskMove(chain, "task-0", "new", "New");
    const movedSubtree = moved.filter(task => task.id.startsWith("task-"));

    expect(movedSubtree).toHaveLength(10_000);
    expect(movedSubtree.every(task => task.projectId === "new" && task.orderKey === null)).toBe(true);
    expect(moved.find(task => task.id === "task-0")?.parentId).toBeNull();
    expect(moved.find(task => task.id === "task-9999")?.parentId).toBe("task-9998");
    expect(moved.find(task => task.id === "unrelated")?.projectId).toBe("old");
  });

  test("delete rollback restores only missing IDs when sync already restored some tasks", () => {
    const restoredBySync = [{ id: "a" }, { id: "b", fromSync: true }, { id: "after" }];
    const removed = [
      { item: { id: "a", source: "optimistic" }, index: 0 },
      { item: { id: "b", source: "optimistic" }, index: 1 },
      { item: { id: "c", source: "optimistic" }, index: 2 }
    ];

    const result = restoreMissingTasks(restoredBySync, removed);

    expect(result).toBe(restoredBySync);
    expect(result.map(task => task.id)).toEqual(["a", "b", "c", "after"]);
    expect(result.filter(task => task.id === "b")).toHaveLength(1);
    expect(result.find(task => task.id === "b")?.fromSync).toBe(true);
  });

  test("restores a deep removed subtree in one ordered pass", () => {
    const removed = Array.from({ length: 10_000 }, (_, index) => ({
      item: { id: `task-${index}` },
      index
    }));
    const partial = [{ id: "task-0", fromSync: true }, { id: "after" }];

    const result = restoreMissingTasks(partial, removed);

    expect(result).toHaveLength(10_001);
    expect(result[0]).toMatchObject({ id: "task-0", fromSync: true });
    expect(result[9_998]?.id).toBe("task-9998");
    expect(result[9_999]?.id).toBe("task-9999");
    expect(result[10_000]?.id).toBe("after");
    expect(result.filter(task => task.id === "task-0")).toHaveLength(1);
  });

  test("keeps optimistic tasks whose create request has not returned yet", () => {
    const pending = { id: "temporary-id", keydoCreatePromise: Promise.resolve() };
    const existing = { id: "task-1" };
    expect(retainPendingCreates([{ id: "task-1" }], [pending, existing])).toEqual([{ id: "task-1" }, pending]);
  });

  test("does not duplicate a pending task already present in the snapshot", () => {
    const pending = { id: "task-1", keydoCreatePromise: Promise.resolve() };
    expect(retainPendingCreates([{ id: "task-1", title: "from sync" }], [pending])).toEqual([{ id: "task-1", title: "from sync" }]);
  });

  test("cancels queued edits and marks a remotely deleted task", () => {
    let cancelledTimer: unknown;
    const task = { keydoSaveTimer: 42, keydoPendingUpdates: { content: "stale" }, keydoSendingUpdates: { description: "in flight" } };
    const hadUnsavedEdits = discardTaskEdits(task, timer => { cancelledTimer = timer; });
    expect(cancelledTimer).toBe(42);
    expect(hadUnsavedEdits).toBe(true);
    expect(task).toMatchObject({ keydoSaveTimer: null, keydoPendingUpdates: {}, keydoSendingUpdates: null, keydoDeleted: true });
  });

  test("retries only pending edits without an in-flight save and caps automatic attempts", () => {
    const retryable = { id: "retryable", keydoPendingUpdates: { content: "draft" }, keydoUpdateAutoRetryCount: 2 };
    const inFlight = { id: "in-flight", keydoPendingUpdates: { content: "draft" }, keydoSavePromise: Promise.resolve() };
    const exhausted = { id: "exhausted", keydoPendingUpdates: { content: "draft" }, keydoUpdateAutoRetryCount: 3 };
    const deleted = { id: "deleted", keydoPendingUpdates: { content: "draft" }, keydoDeleted: true };
    const empty = { id: "empty", keydoPendingUpdates: {} };

    expect(retryablePendingTaskUpdates([retryable, inFlight, exhausted, deleted, empty])).toEqual([retryable]);
  });

  test("reports when a deleted task has no local edits to discard", () => {
    expect(discardTaskEdits({})).toBe(false);
  });
});
