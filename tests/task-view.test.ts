import { describe, expect, test } from "bun:test";
import { canNestTask, isCurrentTaskSelection, isCurrentTaskTarget, isCompleteProjectOrderView, isTaskInProject, isUnfilteredProjectView, filterTasksByWorkspaceAndQuery, retainExistingTaskIds, selectionIndexAfterMove, makeSiblingReorder, orderTaskTree, orderTasksByDayOrder, dueDateKeyForRelativeLabel, todoistDueDateKey, dueStateForDateKey, refreshTaskDueStates, projectVisibleTree, reconcileTaskSelection, removeTaskSelectionIds, sameTaskSiblingGroup, selectedTaskRoots, setTaskAncestorCompletion, setTaskSubtreeCompletion, swapSiblingTaskOrder, taskDeletionClosure, taskRootsForDeletedProjects, taskRootsForDeletedSections, taskParentOverridesForDelta, taskDepth, taskOutdentDestination, taskParentIdsWithChildren, taskRangeIds, taskSubtreeIds, taskSubtreeIdsByRoot, validTaskNestTargets } from "../src/task-view.js";

const hierarchy = [
  { id: "parent", parentId: null },
  { id: "child", parentId: "parent" },
  { id: "grandchild", parentId: "child" }
];

describe("task view hierarchy", () => {
  test("workspace search never returns matching tasks from another workspace", () => {
    const tasks = [
      { id: "personal", title: "Plan launch", project: "Roadmap", description: "", workspace: "Personal" },
      { id: "work", title: "Plan launch", project: "Roadmap", description: "", workspace: "Work" }
    ];

    expect(filterTasksByWorkspaceAndQuery(tasks, "Personal", "launch").map(task => task.id)).toEqual(["personal"]);
    expect(filterTasksByWorkspaceAndQuery(tasks, "Work", "").map(task => task.id)).toEqual(["work"]);
  });

  test("structural editing requires an unfiltered project view", () => {
    expect(isUnfilteredProjectView("project", "")).toBe(true);
    expect(isUnfilteredProjectView("project", "   ")).toBe(true);
    expect(isUnfilteredProjectView("project", "search")).toBe(false);
    expect(isUnfilteredProjectView("today", "")).toBe(false);
  });

  test("structural editing requires every task in the project to be inside the active workspace", () => {
    const tasks = [
      { id: "visible", project: "Personal", workspace: "Personal" },
      { id: "hidden-sibling", project: "Personal", workspace: "Work" },
      { id: "unrelated", project: "Work notes", workspace: "Work" }
    ];

    expect(isCompleteProjectOrderView(tasks, "project", "", "Personal", "Personal")).toBe(false);
    expect(isCompleteProjectOrderView([tasks[0]!, tasks[2]!], "project", "", "Personal", "Personal")).toBe(true);
    expect(isCompleteProjectOrderView(tasks, "project", "search", "Personal", "Personal")).toBe(false);
  });

  test("same-name Todoist projects do not form one reorderable project view", () => {
    const tasks = [
      { id: "first", project: "Shared name", projectId: "project-a", workspace: "Personal" },
      { id: "second", project: "Shared name", projectId: "project-b", workspace: "Personal" }
    ];

    expect(isCompleteProjectOrderView(tasks, "project", "", "Shared name", "Personal")).toBe(false);
    expect(isCompleteProjectOrderView([tasks[0]!], "project", "", "project-a", "Personal")).toBe(true);
    expect(tasks.filter(task => isTaskInProject(task, "project-a", "Shared name")).map(task => task.id)).toEqual(["first"]);
    expect(isTaskInProject({ id: "demo", project: "Shared name" }, null, "Shared name")).toBe(true);
    expect(isTaskInProject({ id: "live", project: "Shared name", projectId: "project-a" }, null, "Shared name")).toBe(false);
  });

  test("a delayed action cannot transfer to a replacement selection after sync", () => {
    const tasks = [{ id: "replacement" }];
    expect(isCurrentTaskSelection(tasks, "requested", "replacement")).toBe(false);
    expect(isCurrentTaskSelection(tasks, "requested", "requested")).toBe(false);
    expect(isCurrentTaskSelection([...tasks, { id: "requested" }], "requested", "requested")).toBe(true);
    expect(isCurrentTaskSelection([{ id: "created-task" }], "created-task", "created-task")).toBe(true);
    expect(isCurrentTaskSelection([{ id: "created-task" }, ...tasks], "created-task", "replacement")).toBe(false);
  });

  test("filters bulk action IDs against the latest task snapshot", () => {
    expect(retainExistingTaskIds([{ id: "kept" }, { id: "also-kept" }], ["kept", "deleted", "also-kept"]))
      .toEqual(["kept", "also-kept"]);
    expect(retainExistingTaskIds([], ["deleted"])).toEqual([]);
  });

  test("a delayed delete cannot proceed after its confirmation target is canceled or retargeted", () => {
    const tasks = [{ id: "requested" }, { id: "other" }];
    expect(isCurrentTaskTarget(tasks, "requested", "requested")).toBe(true);
    expect(isCurrentTaskTarget(tasks, "requested", null)).toBe(false);
    expect(isCurrentTaskTarget(tasks, "requested", "other")).toBe(false);
    expect(isCurrentTaskTarget([{ id: "other" }], "requested", "requested")).toBe(false);
  });

  test("reconciles selection after sync removes tasks", () => {
    const result = reconcileTaskSelection([{ id: "remaining" }], "deleted", new Set(["deleted", "remaining"]));
    expect(result).toEqual({ selectedId: "remaining", selectedIds: new Set(["remaining"]), selectionChanged: true });
  });

  test("keeps a valid current selection across sync", () => {
    const tasks = [{ id: "first" }, { id: "selected" }];
    expect(reconcileTaskSelection(tasks, "selected", new Set(["selected"]))).toEqual({
      selectedId: "selected",
      selectedIds: new Set(["selected"]),
      selectionChanged: false
    });
  });

  test("moves into the visible list from the nearest edge when selection is filtered out", () => {
    const items = [{ id: "first" }, { id: "second" }, { id: "third" }];
    expect(selectionIndexAfterMove(items, "hidden", 1)).toBe(0);
    expect(selectionIndexAfterMove(items, "hidden", -1)).toBe(2);
    expect(selectionIndexAfterMove(items, "second", 1)).toBe(2);
    expect(selectionIndexAfterMove(items, "second", -1)).toBe(0);
    expect(selectionIndexAfterMove([], "hidden", 1)).toBe(-1);
  });

  test("removes only the captured bulk selection and preserves later selections", () => {
    expect(removeTaskSelectionIds(new Set(["requested", "selected-while-waiting"]), new Set(["requested"])))
      .toEqual(new Set(["selected-while-waiting"]));
  });

  test("builds a range in either direction from a stable anchor", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(taskRangeIds(items, "b", "d")).toEqual(["b", "c", "d"]);
    expect(taskRangeIds(items, "d", "b")).toEqual(["b", "c", "d"]);
    expect(taskRangeIds(items, "missing", "b")).toEqual([]);
  });

  test("a collapsed parent hidden by the active filter does not hide a matching child", () => {
    expect(projectVisibleTree([hierarchy[1]], new Set(["parent"]), hierarchy)).toEqual([hierarchy[1]]);
  });

  test("a collapsed parent in the view hides its descendants", () => {
    expect(projectVisibleTree(hierarchy, new Set(["parent"]), hierarchy).map(task => task.id)).toEqual(["parent"]);
  });

  test("resolves visibility for a deep child-first hierarchy", () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index === 0 ? null : `task-${index - 1}`
    })).reverse();

    expect(projectVisibleTree(tasks, new Set(), tasks)).toHaveLength(10_000);
    expect(projectVisibleTree(tasks, new Set(["task-0"]), tasks).map(task => task.id)).toEqual(["task-0"]);
  });

  test("depth counts only ancestors that appear in the current view", () => {
    const parentById = new Map(hierarchy.map(task => [task.id, task]));
    expect(taskDepth(hierarchy[2], parentById, new Set(["grandchild"]))).toBe(0);
    expect(taskDepth(hierarchy[2], parentById, new Set(["parent", "child", "grandchild"]))).toBe(2);
  });

  test("depth stops walking once the UI depth cap is reached", () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index === 0 ? null : `task-${index - 1}`
    }));
    const parentById = new Map(tasks.map(task => [task.id, task]));
    let checks = 0;
    const visibleIds = { has() { checks += 1; return true; } } as unknown as Set<string>;

    expect(taskDepth(tasks[tasks.length - 1]!, parentById, visibleIds)).toBe(3);
    expect(checks).toBe(3);
  });

  test("builds tree-toggle parent IDs in one pass", () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index ? `task-${index - 1}` : null
    }));

    const parentIds = taskParentIdsWithChildren(tasks);

    expect(parentIds).toHaveLength(9_999);
    expect(parentIds.has("task-0")).toBe(true);
    expect(parentIds.has("task-9999")).toBe(false);
  });

  test("malformed parent cycles terminate safely", () => {
    const cycle = [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }];
    expect(projectVisibleTree(cycle, new Set(), cycle)).toEqual(cycle);
    expect(taskDepth(cycle[0], new Map(cycle.map(task => [task.id, task])), new Set(["a", "b"]))).toBe(2);
  });

  test("nesting requires a different task outside the moved task's subtree", () => {
    expect(canNestTask(hierarchy, "child", "parent")).toBe(true);
    expect(canNestTask(hierarchy, "child", "grandchild")).toBe(false);
    expect(canNestTask(hierarchy, "child", "child")).toBe(false);
    expect(canNestTask(hierarchy, "missing", "parent")).toBe(false);
  });

  test("nesting cannot cross Todoist project IDs when project names match", () => {
    const tasks = [
      { id: "source", project: "Shared name", projectId: "project-a", parentId: null },
      { id: "target", project: "Shared name", projectId: "project-b", parentId: null }
    ];

    expect(canNestTask(tasks, "source", "target")).toBe(false);
    expect(validTaskNestTargets(tasks, "source", tasks)).toEqual([]);
  });

  test("filters move-mode targets against the source subtree", () => {
    expect(validTaskNestTargets(hierarchy, "child", hierarchy).map(task => task.id)).toEqual(["parent"]);
    expect(validTaskNestTargets(hierarchy, "missing", hierarchy)).toEqual([]);
    expect(validTaskNestTargets(hierarchy, "child", [{ id: "outside" }])).toEqual([]);
  });

  test("filters targets for a large move tree in one subtree pass", () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index ? `task-${index - 1}` : null
    }));
    tasks.push({ id: "outside", parentId: null });

    expect(validTaskNestTargets(tasks, "task-0", tasks).map(task => task.id)).toEqual(["outside"]);
  });

  test("reorders one sibling by generating a key between its new neighbors", () => {
    const siblings = [
      { id: "a", orderKey: "a0" },
      { id: "b", orderKey: "a1" },
      { id: "c", orderKey: "a2" }
    ];
    const move = makeSiblingReorder(siblings, "c", "up");
    expect(move).not.toBeNull();
    expect(move!.orderKey > "a0" && move!.orderKey < "a1").toBe(true);
    expect(move!.ordered.map(task => task.id)).toEqual(["a", "c", "b"]);
    expect(siblings[2].orderKey).toBe("a2");
  });

  test("rejects boundary moves and normalizes invalid keys only when child order is reliable", () => {
    const siblings = [{ id: "a", orderKey: "a0" }, { id: "b", orderKey: "a1" }];
    expect(makeSiblingReorder(siblings, "a", "up")).toBeNull();
    expect(makeSiblingReorder(siblings, "b", "down")).toBeNull();
    for (const invalid of [
      [{ id: "a", orderKey: "a0", childOrder: 1 }, { id: "b", childOrder: 2 }, { id: "c", orderKey: "a2", childOrder: 3 }],
      [{ id: "a", orderKey: "a0", childOrder: 1 }, { id: "b", orderKey: "a0", childOrder: 2 }, { id: "c", orderKey: "a2", childOrder: 3 }],
      [{ id: "a", orderKey: "a0", childOrder: 1 }, { id: "b", orderKey: "a!", childOrder: 2 }, { id: "c", orderKey: "a2", childOrder: 3 }]
    ]) {
      const normalized = makeSiblingReorder(invalid, "c", "up");
      expect(normalized?.ordered.map(task => task.id)).toEqual(["a", "c", "b"]);
      expect(normalized?.updates.map(update => update.id)).toEqual(["a", "c", "b"]);
      expect(normalized?.updates.every(update => typeof update.orderKey === "string" && update.orderKey.length > 0)).toBe(true);
      expect(new Set(normalized?.updates.map(update => update.orderKey)).size).toBe(3);
    }
  });

  test("refuses normalization when neither order keys nor unique child order establish sibling order", () => {
    expect(makeSiblingReorder([
      { id: "a", orderKey: null },
      { id: "b", orderKey: null },
      { id: "c", orderKey: null }
    ], "c", "up")).toBeNull();
    expect(makeSiblingReorder([
      { id: "a", orderKey: null, childOrder: 1 },
      { id: "b", orderKey: null, childOrder: 1 },
      { id: "c", orderKey: null, childOrder: 3 }
    ], "c", "up")).toBeNull();
  });

  test("keeps input order when sibling child_order values are duplicated", () => {
    const tasks = [
      { id: "c", parentId: null, projectId: "p", orderKey: null, childOrder: 3 },
      { id: "a", parentId: null, projectId: "p", orderKey: null, childOrder: 1 },
      { id: "b", parentId: null, projectId: "p", orderKey: null, childOrder: 1 }
    ];

    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["c", "a", "b"]);
  });

  test("orders section groups by fractional section keys ahead of legacy section numbers", () => {
    const tasks = [
      { id: "section-b", projectId: "p", sectionId: "b", sectionOrder: 1, sectionOrderKey: "a1", parentId: null },
      { id: "root", projectId: "p", sectionId: null, sectionOrder: null, sectionOrderKey: null, parentId: null },
      { id: "section-a", projectId: "p", sectionId: "a", sectionOrder: 2, sectionOrderKey: "a0", parentId: null }
    ];

    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["root", "section-a", "section-b"]);
  });

  test("orders cross-project root groups by project keys, then legacy child order", () => {
    const tasks = [
      { id: "later", projectId: "p2", projectOrderKey: "a1", projectChildOrder: 1, parentId: null },
      { id: "earlier", projectId: "p1", projectOrderKey: "a0", projectChildOrder: 2, parentId: null }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["earlier", "later"]);

    const legacy = tasks.map(task => ({ ...task, projectOrderKey: null }));
    expect(orderTaskTree(legacy).map(task => task.id)).toEqual(["later", "earlier"]);
  });

  test("keeps payload order when cross-project order metadata is incomplete", () => {
    const tasks = [
      { id: "later", projectId: "p2", projectOrderKey: "a1", parentId: null },
      { id: "earlier", projectId: "p1", projectOrderKey: null, parentId: null }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["later", "earlier"]);
  });

  test("does not compare project order keys across different parents", () => {
    const tasks = [
      { id: "parent-two", projectId: "p2", projectOrderKey: "a0", projectOrderParentId: "other", parentId: null },
      { id: "parent-one", projectId: "p1", projectOrderKey: "a1", projectOrderParentId: "root", parentId: null }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["parent-two", "parent-one"]);
  });

  test("falls back to legacy section order when fractional section keys are unavailable", () => {
    const tasks = [
      { id: "section-b", projectId: "p", sectionId: "b", sectionOrder: 2, sectionOrderKey: null, parentId: null },
      { id: "section-a", projectId: "p", sectionId: "a", sectionOrder: 1, sectionOrderKey: null, parentId: null }
    ];

    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["section-a", "section-b"]);
  });

  test("uses one section-order scheme for the whole project when metadata is mixed", () => {
    const tasks = [
      { id: "section-a", projectId: "p", sectionId: "a", sectionOrder: 3, sectionOrderKey: "a0", parentId: null },
      { id: "section-b", projectId: "p", sectionId: "b", sectionOrder: 1, sectionOrderKey: "a1", parentId: null },
      { id: "section-c", projectId: "p", sectionId: "c", sectionOrder: 1, sectionOrderKey: null, parentId: null }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["section-a", "section-b", "section-c"]);
  });

  test("fallback sibling swaps keep each subtree together", () => {
    const tasks = [
      { id: "a", parentId: null, projectId: "p", sectionId: null, childOrder: 1, orderKey: null },
      { id: "a-child", parentId: "a", projectId: "p", sectionId: null, childOrder: 1, orderKey: null },
      { id: "b", parentId: null, projectId: "p", sectionId: null, childOrder: 2, orderKey: null },
      { id: "b-child", parentId: "b", projectId: "p", sectionId: null, childOrder: 1, orderKey: null }
    ];

    const reordered = swapSiblingTaskOrder(tasks, "b", "a");

    expect(reordered?.map(task => task.id)).toEqual(["b", "b-child", "a", "a-child"]);
    expect(tasks.map(task => task.id)).toEqual(["a", "a-child", "b", "b-child"]);
    expect(tasks.map(task => task.childOrder)).toEqual([1, 1, 2, 1]);
  });

  test("refuses to swap tasks from different sibling groups", () => {
    const tasks = [
      { id: "a", parentId: null, projectId: "p1", childOrder: 1 },
      { id: "b", parentId: null, projectId: "p2", childOrder: 2 }
    ];
    expect(swapSiblingTaskOrder(tasks, "a", "b")).toBeNull();
  });

  test("uses project names to separate sibling groups without Todoist ids", () => {
    const taskA = { id: "a", project: "Project A", parentId: null, childOrder: 1 };
    const taskB = { id: "b", project: "Project B", parentId: null, childOrder: 2 };
    expect(sameTaskSiblingGroup(taskA, taskB)).toBe(false);
    expect(orderTaskTree([
      { id: "a-later", project: "Project A", parentId: null, orderKey: "a2" },
      { id: "b-first", project: "Project B", parentId: null, orderKey: "a0" },
      { id: "a-first", project: "Project A", parentId: null, orderKey: "a1" }
    ]).map(task => task.id)).toEqual(["a-first", "a-later", "b-first"]);
  });

  test("keeps an optimistic capture in its resolved Todoist project group", () => {
    const existingTask = { id: "existing", project: "Research", projectId: "project-1", parentId: null };
    const pendingCapture = { id: "pending", project: "Research", projectId: "project-1", parentId: null };

    expect(sameTaskSiblingGroup(existingTask, pendingCapture)).toBe(true);
  });

  test("uses Todoist order keys consistently when every sibling has one", () => {
    const tasks = [
      { id: "c", parentId: null, projectId: "p", sectionId: null, orderKey: "a2", childOrder: 1 },
      { id: "a", parentId: null, projectId: "p", sectionId: null, orderKey: "a0", childOrder: 3 },
      { id: "b", parentId: null, projectId: "p", sectionId: null, orderKey: "a1", childOrder: 2 }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["a", "b", "c"]);
  });

  test("orders a hierarchy deeper than the JavaScript call stack", () => {
    const tasks = Array.from({ length: 20_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index === 0 ? null : `task-${index - 1}`,
      orderKey: "a0"
    }));

    expect(orderTaskTree(tasks)).toHaveLength(20_000);
  });

  test("orders a deep day list without recursive traversal", () => {
    const tasks = Array.from({ length: 20_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index === 0 ? null : `task-${index - 1}`,
      dayOrder: index
    }));

    expect(orderTasksByDayOrder(tasks)).toHaveLength(20_000);
  });

  test("orders root section groups by Todoist section order, independent of task arrival order", () => {
    const tasks = [
      { id: "later-section-task", projectId: "p", sectionId: "later", sectionOrder: 2, orderKey: "a0" },
      { id: "unsectioned-task", projectId: "p", sectionId: null, sectionOrder: null, orderKey: "a0" },
      { id: "earlier-section-task", projectId: "p", sectionId: "earlier", sectionOrder: 1, orderKey: "a0" }
    ];

    expect(orderTaskTree(tasks).map(task => task.id)).toEqual([
      "unsectioned-task", "earlier-section-task", "later-section-task"
    ]);
  });

  test("orders child groups independently when their parent has children in multiple sections", () => {
    const tasks = [
      { id: "parent", projectId: "p", parentId: null, orderKey: "a0" },
      { id: "later-child", projectId: "p", parentId: "parent", sectionId: "later", sectionOrder: 2, orderKey: "a0" },
      { id: "earlier-child", projectId: "p", parentId: "parent", sectionId: "earlier", sectionOrder: 1, orderKey: "a0" }
    ];

    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["parent", "earlier-child", "later-child"]);
  });

  test("places tasks with unknown day_order after known Today and Upcoming positions", () => {
    const tasks = [
      { id: "unknown-a", dayOrder: null },
      { id: "second", dayOrder: 2 },
      { id: "first", dayOrder: 1 },
      { id: "unknown-b", dayOrder: null }
    ];
    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual([
      "first", "second", "unknown-a", "unknown-b"
    ]);
  });

  test("keeps overdue tasks ahead of manual day positions and sorts overdue dates oldest first", () => {
    const tasks = [
      { id: "today-later", dayOrder: 8, dueClass: "", dueDateKey: "2026-09-25" },
      { id: "overdue-recent", dayOrder: 1, dueClass: "overdue", dueDateKey: "2026-09-24" },
      { id: "today-first", dayOrder: 2, dueClass: "", dueDateKey: "2026-09-25" },
      { id: "overdue-oldest", dayOrder: 9, dueClass: "overdue", dueDateKey: "2026-09-20" }
    ];

    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual([
      "overdue-oldest", "overdue-recent", "today-first", "today-later"
    ]);
  });

  test("does not use stale day_order to sort overdue tasks with the same date and priority", () => {
    const tasks = [
      { id: "arrived-first", dueClass: "overdue", dueDateKey: "2026-09-20", priority: 2, dayOrder: 10 },
      { id: "arrived-second", dueClass: "overdue", dueDateKey: "2026-09-20", priority: 2, dayOrder: 1 }
    ];

    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual(["arrived-first", "arrived-second"]);
  });

  test("uses a consistent date-first order when overdue date metadata is incomplete", () => {
    const overdue = [
      { id: "missing-date", dueClass: "overdue", dueDateKey: null, priority: 4 },
      { id: "newer-date", dueClass: "overdue", dueDateKey: "2026-09-21", priority: 4 },
      { id: "older-date", dueClass: "overdue", dueDateKey: "2026-09-20", priority: 1 }
    ];
    expect(orderTasksByDayOrder(overdue).map(task => task.id)).toEqual(["older-date", "newer-date", "missing-date"]);
  });

  test("keeps dated unordered tasks together ahead of unordered tasks without dates", () => {
    const tasks = [
      { id: "no-date-first", dayOrder: null, dueDateKey: null },
      { id: "later", dayOrder: null, dueDateKey: "2026-09-26" },
      { id: "earlier", dayOrder: null, dueDateKey: "2026-09-25" }
    ];
    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual(["earlier", "later", "no-date-first"]);
  });

  test("sorts tasks outside Todoist's day-order window by due date after known positions", () => {
    const tasks = [
      { id: "later-unordered", dayOrder: null, dueDateKey: "2027-02-10" },
      { id: "second-position", dayOrder: 2, dueDateKey: "2026-09-25" },
      { id: "earlier-unordered", dayOrder: null, dueDateKey: "2027-01-10" },
      { id: "first-position", dayOrder: 1, dueDateKey: "2026-09-24" },
      { id: "no-date", dayOrder: null, dueDateKey: null }
    ];
    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual([
      "first-position", "second-position", "earlier-unordered", "later-unordered", "no-date"
    ]);
  });

  test("maps optimistic relative due labels to stable local calendar-day keys", () => {
    const now = new Date(2026, 11, 31, 23, 30);
    expect(dueDateKeyForRelativeLabel("Today", now)).toBe("2026-12-31");
    expect(dueDateKeyForRelativeLabel("Tomorrow", now)).toBe("2027-01-01");
    expect(dueDateKeyForRelativeLabel("No date", now)).toBeNull();
  });

  test("maps fixed-timezone Todoist timestamps to the displayed local day", () => {
    expect(todoistDueDateKey({ date: "2026-09-26T02:00:00Z" }, "America/New_York")).toBe("2026-09-25");
    expect(todoistDueDateKey({ date: "2026-09-26T10:00:00.000000" }, "America/New_York")).toBe("2026-09-26");
    expect(todoistDueDateKey({ date: "2026-09-26" }, "America/New_York")).toBe("2026-09-26");
  });

  test("recalculates Today and overdue state across midnight without a Sync delta", () => {
    const tasks = [
      { id: "yesterday", due: "Today", dueDateKey: "2026-09-24", dueClass: "", recurring: false, dayOrder: 9 },
      { id: "today", due: "Tomorrow", dueDateKey: "2026-09-25", dueClass: "", recurring: false, dayOrder: 1 }
    ];

    expect(refreshTaskDueStates(tasks, new Date(2026, 8, 25, 12))).toBe(true);
    expect(tasks[0].due).not.toBe("Today");
    expect(tasks.map(task => task.dueClass)).toEqual(["overdue", ""]);
    expect(tasks[1].due).toBe("Today");
    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual(["yesterday", "today"]);
    expect(refreshTaskDueStates(tasks, new Date(2026, 8, 25, 12))).toBe(false);
  });

  test("keeps recurring tasks out of the overdue group as their date passes", () => {
    expect(dueStateForDateKey("2026-09-24", true, new Date(2026, 8, 25, 12))).toEqual({ due: "Recurring", dueClass: "" });
  });

  test("keeps a task's subtasks with it while sorting Day/Upcoming siblings", () => {
    const tasks = [
      { id: "child", parentId: "parent", dayOrder: 4 },
      { id: "second-root", parentId: null, dayOrder: 2 },
      { id: "parent", parentId: null, dayOrder: 1 }
    ];

    expect(orderTasksByDayOrder(tasks).map(task => task.id)).toEqual([
      "parent", "child", "second-root"
    ]);
  });

  test("falls back to child order for the whole group if an order key is missing", () => {
    const tasks = [
      { id: "a", parentId: null, projectId: "p", sectionId: null, orderKey: "a2", childOrder: 1 },
      { id: "c", parentId: null, projectId: "p", sectionId: null, orderKey: "a0", childOrder: 2 },
      { id: "b", parentId: null, projectId: "p", sectionId: null, orderKey: null, childOrder: 0 }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["b", "a", "c"]);
  });

  test("falls back to child order when a sibling has an empty order key", () => {
    const tasks = [
      { id: "a", parentId: null, projectId: "p", sectionId: null, orderKey: "", childOrder: 1 },
      { id: "b", parentId: null, projectId: "p", sectionId: null, orderKey: "", childOrder: 2 }
    ];
    const reordered = swapSiblingTaskOrder(tasks, "b", "a");

    expect(reordered?.map(task => task.id)).toEqual(["b", "a"]);
  });

  test("falls back to child order when sibling keys are duplicated", () => {
    const tasks = [
      { id: "a", parentId: null, projectId: "p", sectionId: null, orderKey: "a0", childOrder: 2 },
      { id: "b", parentId: null, projectId: "p", sectionId: null, orderKey: "a0", childOrder: 1 }
    ];
    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["b", "a"]);
    expect(swapSiblingTaskOrder(tasks, "a", "b")?.map(task => task.id)).toEqual(["a", "b"]);
  });

  test("normalizes sibling keys in persisted child order when order keys are malformed", () => {
    const tasks = [
      { id: "a", parentId: null, projectId: "p", sectionId: null, orderKey: "Z", childOrder: 1 },
      { id: "b", parentId: null, projectId: "p", sectionId: null, orderKey: "a", childOrder: 2 }
    ];

    expect(orderTaskTree(tasks).map(task => task.id)).toEqual(["a", "b"]);
    const move = makeSiblingReorder(tasks, "a", "down");
    expect(move?.ordered.map(task => task.id)).toEqual(["b", "a"]);
    expect(move?.updates.map(update => update.id)).toEqual(["b", "a"]);
    expect(move!.updates[0]!.orderKey < move!.updates[1]!.orderKey).toBe(true);
    expect(swapSiblingTaskOrder(tasks, "a", "b")?.map(task => task.id)).toEqual(["b", "a"]);
  });

  test("deleting a task identifies every descendant without including siblings", () => {
    const tasks = [
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
      { id: "grandchild", parentId: "child" },
      { id: "sibling", parentId: null }
    ];
    expect(taskSubtreeIds(tasks, "root")).toEqual(new Set(["root", "child", "grandchild"]));
    expect(taskSubtreeIds(tasks, "child")).toEqual(new Set(["child", "grandchild"]));
    expect(taskDeletionClosure(tasks, ["root"])).toEqual(new Set(["root", "child", "grandchild"]));
    expect(taskDeletionClosure(tasks, ["root"], new Map([["child", null]]))).toEqual(new Set(["root"]));
  });

  test("finds deep descendants even when task records arrive child-first", () => {
    const tasks = Array.from({ length: 1_500 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index === 0 ? null : `task-${index - 1}`
    })).reverse();

    expect(taskSubtreeIds(tasks, "task-0").size).toBe(1_500);
    expect(taskDeletionClosure(tasks, ["task-0"]).size).toBe(1_500);
  });

  test("includes a task introduced in the same delta when its deleted parent is gone", () => {
    const tasks = [{ id: "root", parentId: null }];
    const parentOverrides = new Map([["new-child", "root"]]);
    expect(taskDeletionClosure(tasks, ["root"], parentOverrides)).toEqual(new Set(["root", "new-child"]));
  });

  test("recomputes a confirmed deletion from the latest subtree after a queued snapshot", () => {
    const latestTasks = [
      { id: "root", parentId: null },
      { id: "old-child", parentId: "root" },
      { id: "new-child", parentId: "root" },
      { id: "moved-child", parentId: null }
    ];
    expect(taskDeletionClosure(latestTasks, ["root"])).toEqual(new Set(["root", "old-child", "new-child"]));
  });

  test("keeps a child moved to another project when its old parent is deleted in the same delta", () => {
    const tasks = [
      { id: "old-parent", projectId: "project-a", parentId: null },
      { id: "moving-child", projectId: "project-a", parentId: "old-parent" },
      { id: "other-child", projectId: "project-a", parentId: "old-parent" }
    ];
    const deltas = [
      { id: "old-parent", is_deleted: true },
      { id: "moving-child", project_id: "project-b" }
    ];
    const parentOverrides = taskParentOverridesForDelta(tasks, deltas);

    expect(parentOverrides).toEqual(new Map([["moving-child", null]]));
    expect(taskDeletionClosure(tasks, ["old-parent"], parentOverrides))
      .toEqual(new Set(["old-parent", "other-child"]));
  });

  test("keeps a child moved to another section when its old section is deleted in the same delta", () => {
    const tasks = [
      { id: "section-root", projectId: "project-a", sectionId: "section-a", parentId: null },
      { id: "old-child", projectId: "project-a", sectionId: "section-a", parentId: "section-root" },
      { id: "moving-child", projectId: "project-a", sectionId: "section-a", parentId: "section-root" },
      { id: "moving-grandchild", projectId: "project-a", sectionId: "section-a", parentId: "moving-child" }
    ];
    const deltas = [{ id: "moving-child", section_id: "section-b" }];
    const roots = taskRootsForDeletedSections(tasks, ["section-a"], deltas);
    const parentOverrides = taskParentOverridesForDelta(tasks, deltas);

    expect(roots).toEqual(["section-root"]);
    expect(parentOverrides).toEqual(new Map([["moving-child", null]]));
    expect(taskDeletionClosure(tasks, roots, parentOverrides))
      .toEqual(new Set(["section-root", "old-child"]));

    const movedProjectRoot = [
      { id: "project-root", projectId: "project-a", sectionId: "section-a", parentId: null },
      { id: "project-child", projectId: "project-a", sectionId: "section-a", parentId: "project-root" }
    ];
    expect(taskRootsForDeletedSections(movedProjectRoot, ["section-a"], [
      { id: "project-root", project_id: "project-b" }
    ])).toEqual([]);
    expect(taskRootsForDeletedSections([], ["section-a"], [
      { id: "created-during-delete", section_id: "section-a" }
    ])).toEqual(["created-during-delete"]);
  });

  test("completing a parent marks every subtask complete", () => {
    const tasks = [
      { id: "root", parentId: null, completed: false },
      { id: "child", parentId: "root", completed: false },
      { id: "grandchild", parentId: "child", completed: false },
      { id: "sibling", parentId: null, completed: false }
    ];
    setTaskSubtreeCompletion(tasks, "root", true);
    expect(tasks.map(task => task.completed)).toEqual([true, true, true, false]);
  });

  test("recurring task completion preserves descendant state by default", () => {
    const tasks = [
      { id: "recurring", parentId: null, completed: false, recurring: true },
      { id: "active-child", parentId: "recurring", completed: false },
      { id: "done-child", parentId: "recurring", completed: true }
    ];
    setTaskSubtreeCompletion(tasks, "recurring", true, true);
    expect(tasks.map(task => task.completed)).toEqual([true, false, true]);
  });

  test("reopening a child marks its ancestor chain active without changing siblings", () => {
    const tasks = [
      { id: "root", parentId: null, completed: true },
      { id: "child", parentId: "root", completed: true },
      { id: "grandchild", parentId: "child", completed: false },
      { id: "sibling", parentId: null, completed: true }
    ];
    const changed = setTaskAncestorCompletion(tasks, "grandchild", false);
    expect(changed).toEqual(new Set(["root", "child"]));
    expect(tasks.map(task => task.completed)).toEqual([false, false, false, true]);
  });

  test("reapplies a confirmed parent completion by ID after list reconciliation", () => {
    const reconciledTasks = [
      { id: "root", parentId: null, completed: false },
      { id: "child", parentId: "root", completed: false },
      { id: "sibling", parentId: null, completed: false }
    ];

    setTaskSubtreeCompletion(reconciledTasks, "root", true);
    expect(reconciledTasks.map(task => task.completed)).toEqual([true, true, false]);
  });

  test("outdenting preserves section membership at the project root", () => {
    expect(taskOutdentDestination({ projectId: "project-1", sectionId: "section-1" }, null)).toEqual({ section_id: "section-1" });
    expect(taskOutdentDestination({ projectId: "project-1", sectionId: null }, null)).toEqual({ project_id: "project-1" });
    expect(taskOutdentDestination({ projectId: "project-1", sectionId: "section-1" }, "parent-1")).toEqual({ parent_id: "parent-1" });
    expect(taskOutdentDestination({ projectId: null, sectionId: null }, null)).toBeNull();
  });

  test("bulk completion selects active roots and avoids duplicate descendant requests", () => {
    const tasks = [
      { id: "root", parentId: null, completed: false },
      { id: "child", parentId: "root", completed: false },
      { id: "done", parentId: null, completed: true },
      { id: "independent", parentId: null, completed: false }
    ];
    expect(selectedTaskRoots(tasks, new Set(["root", "child", "done", "independent"]), true)).toEqual(["root", "independent"]);
  });

  test("bulk completion keeps selected descendants beneath recurring roots", () => {
    const tasks = [
      { id: "recurring", parentId: null, completed: false, recurring: true },
      { id: "child", parentId: "recurring", completed: false },
      { id: "grandchild", parentId: "child", completed: false },
      { id: "ordinary", parentId: null, completed: false },
      { id: "ordinary-child", parentId: "ordinary", completed: false }
    ];
    const selected = new Set(tasks.map(task => task.id));
    expect(selectedTaskRoots(tasks, selected, true)).toEqual(["recurring", "ordinary"]);
    expect(selectedTaskRoots(tasks, selected, true, true)).toEqual(["recurring", "child", "ordinary"]);
    expect(selectedTaskRoots(tasks, new Set(["recurring", "grandchild"]), true, true)).toEqual(["recurring", "grandchild"]);
  });

  test("finds selected roots once for a deep child-first hierarchy", () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => ({
      id: `task-${index}`,
      parentId: index === 0 ? null : `task-${index - 1}`,
      completed: false
    })).reverse();
    const selected = new Set(tasks.map(task => task.id));

    expect(selectedTaskRoots(tasks, selected)).toEqual(["task-0"]);
    expect(selectedTaskRoots(tasks, selected, true)).toEqual(["task-0"]);
    expect(taskSubtreeIdsByRoot(tasks, ["task-0"]).get("task-0")?.size).toBe(10_000);

    tasks.find(task => task.id === "task-0")!.completed = true;
    expect(selectedTaskRoots(tasks, selected, true)).toEqual(["task-1"]);
  });
});
