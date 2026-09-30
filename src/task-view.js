import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

function projectIdentity(task) {
  return task.projectId ?? task.project ?? null;
}

export function sameTaskSiblingGroup(a, b) {
  return projectIdentity(a) === projectIdentity(b)
    && (a.sectionId ?? null) === (b.sectionId ?? null)
    && (a.parentId ?? null) === (b.parentId ?? null);
}

export function isUnfilteredProjectView(view, query) {
  return view === "project" && !String(query ?? "").trim();
}

export function isTaskInProject(task, projectId, projectName) {
  return projectId
    ? task.projectId === projectId
    : !task.projectId && task.project === projectName;
}

export function filterTasksByWorkspaceAndQuery(items, workspace, query = "") {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  return items.filter(task => task.workspace === workspace
    && (!normalizedQuery || `${task.title ?? ""} ${task.project ?? ""} ${task.description ?? ""}`.toLowerCase().includes(normalizedQuery)));
}

export function isCompleteProjectOrderView(items, view, query, project, workspace) {
  if (!isUnfilteredProjectView(view, query)) return false;
  const projectTasks = items.filter(task => projectIdentity(task) === project);
  const identities = new Set(projectTasks.map(projectIdentity));
  return identities.size === 1 && projectTasks.every(task => task.workspace === workspace);
}

export function isCurrentTaskSelection(items, requestedId, selectedId) {
  return Boolean(requestedId && selectedId === requestedId && items.some(task => task.id === requestedId));
}

export function isCurrentTaskTarget(items, requestedId, targetId) {
  return Boolean(requestedId && targetId === requestedId && items.some(task => task.id === requestedId));
}

export function removeTaskSelectionIds(selectedIds, removedIds) {
  return new Set([...selectedIds].filter(id => !removedIds.has(id)));
}

export function retainExistingTaskIds(items, requestedIds) {
  const existingIds = new Set(items.map(task => task.id));
  return requestedIds.filter(id => existingIds.has(id));
}

export function selectionIndexAfterMove(items, selectedId, delta) {
  if (!items.length) return -1;
  const selectedIndex = items.findIndex(task => task.id === selectedId);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : delta < 0 ? items.length : -1;
  return Math.max(0, Math.min(items.length - 1, currentIndex + delta));
}

function hasUsableOrderKeys(siblings) {
  if (!siblings.every(task => typeof task.orderKey === "string" && /^[0-9A-Za-z]+$/.test(task.orderKey))
    || new Set(siblings.map(task => task.orderKey)).size !== siblings.length) return false;
  return siblings.every(task => {
    try {
      generateKeyBetween(null, task.orderKey);
      return true;
    } catch {
      return false;
    }
  });
}

function hasUsableChildOrders(siblings) {
  return siblings.every(task => Number.isFinite(task.childOrder))
    && new Set(siblings.map(task => task.childOrder)).size === siblings.length;
}

export function isHiddenByCollapse(task, parentById, collapsedIds, visibleIds) {
  let parentId = task.parentId;
  const seen = new Set();
  while (parentId && !seen.has(parentId)) {
    if (collapsedIds.has(parentId) && visibleIds.has(parentId)) return true;
    seen.add(parentId);
    parentId = parentById.get(parentId)?.parentId;
  }
  return false;
}

export function taskDepth(task, parentById, visibleIds) {
  let depth = 0;
  let parentId = task.parentId;
  const seen = new Set();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    if (visibleIds.has(parentId)) depth += 1;
    if (depth === 3) break;
    parentId = parentById.get(parentId)?.parentId;
  }
  return depth;
}

export function taskParentIdsWithChildren(items) {
  const parentIds = new Set();
  for (const task of items) {
    if (task.parentId != null) parentIds.add(task.parentId);
  }
  return parentIds;
}

export function canNestTask(items, taskId, targetId) {
  if (!taskId || !targetId || taskId === targetId) return false;
  const parentById = new Map(items.map(task => [task.id, task]));
  if (!parentById.has(taskId) || !parentById.has(targetId)) return false;
  if (projectIdentity(parentById.get(taskId)) !== projectIdentity(parentById.get(targetId))) return false;
  let parentId = targetId;
  const seen = new Set();
  while (parentId && !seen.has(parentId)) {
    if (parentId === taskId) return false;
    seen.add(parentId);
    parentId = parentById.get(parentId)?.parentId;
  }
  return true;
}

export function projectVisibleTree(matchingTasks, collapsedIds, allTasks = matchingTasks) {
  const parentById = new Map(allTasks.map(task => [task.id, task]));
  const matchingIds = new Set(matchingTasks.map(task => task.id));
  const hiddenByAncestor = new Map();
  function isHidden(task) {
    if (hiddenByAncestor.has(task.id)) return hiddenByAncestor.get(task.id);
    const path = [task.id];
    const seen = new Set([task.id]);
    let parentId = task.parentId;
    let hidden = false;
    while (parentId && !seen.has(parentId)) {
      if (collapsedIds.has(parentId) && matchingIds.has(parentId)) {
        hidden = true;
        break;
      }
      if (hiddenByAncestor.has(parentId)) {
        hidden = hiddenByAncestor.get(parentId);
        break;
      }
      seen.add(parentId);
      path.push(parentId);
      parentId = parentById.get(parentId)?.parentId;
    }
    for (const id of path) hiddenByAncestor.set(id, hidden);
    return hidden;
  }
  return matchingTasks.filter(task => !isHidden(task));
}

export function includeTaskDescendants(allTasks, matchingTasks) {
  const included = new Set(matchingTasks.map(task => task.id));
  const children = new Map();
  for (const task of allTasks) {
    if (!task.parentId || task.completed) continue;
    if (!children.has(task.parentId)) children.set(task.parentId, []);
    children.get(task.parentId).push(task.id);
  }
  const pending = [...included];
  while (pending.length) {
    for (const id of children.get(pending.pop()) ?? []) {
      if (included.has(id)) continue;
      included.add(id);
      pending.push(id);
    }
  }
  return allTasks.filter(task => included.has(task.id));
}

export function makeSiblingReorder(siblings, taskId, direction) {
  const currentIndex = siblings.findIndex(task => task.id === taskId);
  if (currentIndex < 0 || (direction !== "up" && direction !== "down")) return null;
  const usableOrderKeys = hasUsableOrderKeys(siblings);
  if (!usableOrderKeys && !hasUsableChildOrders(siblings)) return null;
  const ordered = [...siblings];
  const [task] = ordered.splice(currentIndex, 1);
  const insertionIndex = currentIndex + (direction === "up" ? -1 : 1);
  if (insertionIndex < 0 || insertionIndex > ordered.length) return null;
  const lowerKey = ordered[insertionIndex - 1]?.orderKey ?? null;
  const upperKey = ordered[insertionIndex]?.orderKey ?? null;
  try {
    if (usableOrderKeys) {
      const orderKey = generateKeyBetween(lowerKey, upperKey);
      ordered.splice(insertionIndex, 0, { ...task, orderKey });
      return { orderKey, ordered, updates: [{ id: taskId, orderKey }] };
    }
    ordered.splice(insertionIndex, 0, task);
    const keys = generateNKeysBetween(null, null, ordered.length);
    const normalized = ordered.map((item, index) => ({ ...item, orderKey: keys[index] }));
    return {
      orderKey: keys[insertionIndex],
      ordered: normalized,
      updates: normalized.map(item => ({ id: item.id, orderKey: item.orderKey }))
    };
  } catch {
    return null;
  }
}

export function swapSiblingTaskOrder(items, taskId, targetId) {
  const taskIndex = items.findIndex(task => task.id === taskId);
  const targetIndex = items.findIndex(task => task.id === targetId);
  if (taskIndex < 0 || targetIndex < 0 || taskIndex === targetIndex) return null;
  const task = { ...items[taskIndex] };
  const target = { ...items[targetIndex] };
  if (!sameTaskSiblingGroup(task, target)) return null;

  [task.childOrder, target.childOrder] = [target.childOrder, task.childOrder];
  [task.orderKey, target.orderKey] = [target.orderKey, task.orderKey];
  const reordered = [...items];
  reordered[taskIndex] = target;
  reordered[targetIndex] = task;
  return orderTaskTree(reordered);
}

export function orderTaskTree(items) {
  const originalIndex = new Map(items.map((task, index) => [task.id, index]));
  const ids = new Set(items.map(task => task.id));
  const children = new Map();
  const roots = [];
  for (const task of items) {
    const parentId = task.parentId && ids.has(task.parentId) ? task.parentId : null;
    if (parentId) {
      if (!children.has(parentId)) children.set(parentId, new Map());
      const groups = children.get(parentId);
      const groupKey = JSON.stringify([projectIdentity(task), task.sectionId ?? null]);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(task);
    } else {
      roots.push(task);
    }
  }

  function sortSiblings(siblings) {
    const hasOrderKeys = hasUsableOrderKeys(siblings);
    const hasChildOrders = hasUsableChildOrders(siblings);
    return siblings.sort((a, b) => {
      if (hasOrderKeys && a.orderKey !== b.orderKey) return a.orderKey < b.orderKey ? -1 : 1;
      if (!hasOrderKeys && hasChildOrders && a.childOrder !== b.childOrder) return a.childOrder - b.childOrder;
      return originalIndex.get(a.id) - originalIndex.get(b.id);
    });
  }

  function orderedSiblingGroups(groups) {
    groups = [...groups];
    const projectPositions = new Map();
    const projectOrderKeys = new Map();
    const projectChildOrders = new Map();
    const projectParentIds = new Map();
    const sectionOrdering = new Map();
    let nextProjectPosition = 0;
    for (const group of groups) {
      const project = projectIdentity(group[0]);
      if (!projectPositions.has(project)) {
        projectPositions.set(project, nextProjectPosition++);
        projectOrderKeys.set(project, group[0].projectOrderKey);
        projectChildOrders.set(project, group[0].projectChildOrder);
        projectParentIds.set(project, group[0].projectOrderParentId ?? null);
      }
      if (group[0].sectionId != null) {
        if (!sectionOrdering.has(project)) sectionOrdering.set(project, { keys: [], orders: [] });
        const ordering = sectionOrdering.get(project);
        ordering.keys.push(group[0].sectionOrderKey);
        ordering.orders.push(group[0].sectionOrder);
      }
    }
    const allProjectKeyValues = [...projectOrderKeys.values()];
    const oneProjectParent = new Set(projectParentIds.values()).size <= 1;
    const allProjectKeysUsable = oneProjectParent && allProjectKeyValues.every(key => typeof key === "string" && key.length > 0)
      && new Set(allProjectKeyValues).size === allProjectKeyValues.length;
    const allProjectOrdersUsable = oneProjectParent && [...projectChildOrders.values()].every(order => Number.isFinite(order))
      && new Set(projectChildOrders.values()).size === projectChildOrders.size;
    const sectionOrderingMode = new Map([...sectionOrdering].map(([project, ordering]) => {
      const keysUsable = ordering.keys.every(key => typeof key === "string" && key.length > 0)
        && new Set(ordering.keys).size === ordering.keys.length;
      const ordersUsable = ordering.orders.every(Number.isFinite)
        && new Set(ordering.orders).size === ordering.orders.length;
      return [project, keysUsable ? "keys" : ordersUsable ? "legacy" : "input"];
    }));
    return groups.sort((a, b) => {
      const firstA = a[0];
      const firstB = b[0];
      const projectA = projectIdentity(firstA);
      const projectB = projectIdentity(firstB);
      const projectDifference = allProjectKeysUsable && projectOrderKeys.get(projectA) !== projectOrderKeys.get(projectB)
        ? (projectOrderKeys.get(projectA) < projectOrderKeys.get(projectB) ? -1 : 1)
        : !allProjectKeysUsable && allProjectOrdersUsable && projectChildOrders.get(projectA) !== projectChildOrders.get(projectB)
          ? projectChildOrders.get(projectA) - projectChildOrders.get(projectB)
          : projectPositions.get(projectA) - projectPositions.get(projectB);
      if (projectDifference) return projectDifference;
      if (firstA.sectionId == null || firstB.sectionId == null) {
        if (firstA.sectionId == null && firstB.sectionId != null) return -1;
        if (firstB.sectionId == null && firstA.sectionId != null) return 1;
      }
      const sectionMode = sectionOrderingMode.get(projectA) ?? "input";
      if (sectionMode === "keys" && firstA.sectionOrderKey !== firstB.sectionOrderKey) {
        return firstA.sectionOrderKey < firstB.sectionOrderKey ? -1 : 1;
      }
      if (sectionMode === "legacy" && firstA.sectionOrder !== firstB.sectionOrder) {
        return firstA.sectionOrder - firstB.sectionOrder;
      }
      return originalIndex.get(firstA.id) - originalIndex.get(firstB.id);
    });
  }

  const ordered = [];
  const visited = new Set();
  function visit(start) {
    const pending = [start];
    while (pending.length) {
      const task = pending.pop();
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      ordered.push(task);
      const descendants = [];
      for (const group of orderedSiblingGroups(children.get(task.id)?.values() ?? [])) {
        descendants.push(...sortSiblings(group));
      }
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        pending.push(descendants[index]);
      }
    }
  }
  const rootGroups = new Map();
  for (const task of roots) {
    const groupKey = JSON.stringify([projectIdentity(task), task.sectionId ?? null]);
    if (!rootGroups.has(groupKey)) rootGroups.set(groupKey, []);
    rootGroups.get(groupKey).push(task);
  }
  for (const group of orderedSiblingGroups(rootGroups.values())) {
    for (const task of sortSiblings(group)) visit(task);
  }
  for (const task of items) {
    if (!visited.has(task.id)) visit(task);
  }
  return ordered;
}

export function orderTasksByDayOrder(items) {
  const originalIndex = new Map(items.map((task, index) => [task.id, index]));
  const taskById = new Map(items.map(task => [task.id, task]));
  const children = new Map();
  const roots = [];
  for (const task of items) {
    if (task.parentId == null || !taskById.has(task.parentId)) {
      roots.push(task);
      continue;
    }
    if (!children.has(task.parentId)) children.set(task.parentId, []);
    children.get(task.parentId).push(task);
  }

  function sortByDayOrder(group) {
    return group.sort((a, b) => {
      const aOverdue = a.dueClass === "overdue";
      const bOverdue = b.dueClass === "overdue";
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      const aDate = typeof a.dueDateKey === "string" ? a.dueDateKey : null;
      const bDate = typeof b.dueDateKey === "string" ? b.dueDateKey : null;
      const dateDifference = aDate && bDate
        ? aDate === bDate ? 0 : aDate < bDate ? -1 : 1
        : aDate ? -1 : bDate ? 1 : 0;
      if (aOverdue && bOverdue) {
        if (dateDifference) return dateDifference;
        const aHasPriority = Number.isFinite(a.priority);
        const bHasPriority = Number.isFinite(b.priority);
        if (aHasPriority !== bHasPriority) return aHasPriority ? -1 : 1;
        if (aHasPriority && a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // day_order belongs to Today/Upcoming placement, not the overdue list.
        return originalIndex.get(a.id) - originalIndex.get(b.id);
      }
      const aOrder = a.dayOrder;
      const bOrder = b.dayOrder;
      if (typeof aOrder === "number" && typeof bOrder === "number" && aOrder !== bOrder) return aOrder - bOrder;
      if (typeof aOrder === "number" && typeof bOrder !== "number") return -1;
      if (typeof aOrder !== "number" && typeof bOrder === "number") return 1;
      if (dateDifference) return dateDifference;
      return originalIndex.get(a.id) - originalIndex.get(b.id);
    });
  }

  const ordered = [];
  const visited = new Set();
  function visit(start) {
    const pending = [start];
    while (pending.length) {
      const task = pending.pop();
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      ordered.push(task);
      const descendants = sortByDayOrder(children.get(task.id) ?? []);
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        pending.push(descendants[index]);
      }
    }
  }
  for (const root of sortByDayOrder(roots)) visit(root);
  // Malformed cycles have no root; retain every task once, in input order.
  for (const task of items) visit(task);
  return ordered;
}

export function dueDateKeyForRelativeLabel(label, now = new Date(), timeZone) {
  if (label !== "Today" && label !== "Tomorrow") return null;
  const today = localIsoDate(now, timeZone);
  if (label === "Today") return today;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

// Todoist represents fixed-timezone due datetimes as UTC timestamps, while
// floating due dates use the user's wall-clock date without a timezone. Keep
// floating/full-day dates as written; convert only absolute timestamps to the
// calendar day Keydo displays in the user's local timezone.
export function todoistDueDateKey(due, timeZone) {
  const value = due?.date;
  if (typeof value !== "string" || !value) return null;
  const datePart = value.slice(0, 10);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return datePart;

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return datePart;
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {})
  };
  const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(instant);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function localIsoDate(date, timeZone) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone
      }).formatToParts(date);
      const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${fields.year}-${fields.month}-${fields.day}`;
    } catch {
      // Invalid or unavailable account zone falls back to the device zone.
    }
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dueStateForDateKey(dateKey, recurring = false, now = new Date(), timeZone) {
  if (typeof dateKey !== "string" || !dateKey) return { due: "No date", dueClass: "" };
  const date = dateKey.slice(0, 10);
  const today = localIsoDate(now, timeZone);
  const tomorrow = dueDateKeyForRelativeLabel("Tomorrow", now, timeZone);
  if (date === today) return { due: "Today", dueClass: "" };
  if (date === tomorrow) return { due: "Tomorrow", dueClass: "" };
  if (recurring) return { due: "Recurring", dueClass: "" };
  const displayDate = new Date(`${date}T00:00:00`);
  return {
    due: displayDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    dueClass: date < today ? "overdue" : ""
  };
}

export function refreshTaskDueStates(items, now = new Date(), timeZone) {
  let changed = false;
  const today = localIsoDate(now, timeZone);
  const tomorrow = dueDateKeyForRelativeLabel("Tomorrow", now, timeZone);
  for (const task of items) {
    if (typeof task.dueDateKey !== "string") continue;
    const date = task.dueDateKey.slice(0, 10);
    const recurring = task.recurring === true;
    const dateRelativeLabelIsStale = date === today
      ? task.due !== "Today" || task.dueClass !== ""
      : date === tomorrow
        ? task.due !== "Tomorrow" || task.dueClass !== ""
        : recurring
          ? task.due !== "Recurring" || task.dueClass !== ""
          : date < today
            ? task.dueClass !== "overdue" || task.due === "Today" || task.due === "Tomorrow" || task.due === "Recurring"
            : task.dueClass === "overdue" || task.due === "Today" || task.due === "Tomorrow" || task.due === "Recurring";
    if (!dateRelativeLabelIsStale) continue;
    const dueState = dueStateForDateKey(task.dueDateKey, task.recurring === true, now, timeZone);
    if (task.due !== dueState.due || task.dueClass !== dueState.dueClass) {
      task.due = dueState.due;
      task.dueClass = dueState.dueClass;
      changed = true;
    }
  }
  return changed;
}

function taskChildrenByParent(items) {
  const childrenByParent = new Map();
  for (const task of items) {
    if (!task.parentId) continue;
    if (!childrenByParent.has(task.parentId)) childrenByParent.set(task.parentId, []);
    childrenByParent.get(task.parentId).push(task.id);
  }
  return childrenByParent;
}

function collectTaskSubtreeIds(childrenByParent, taskId) {
  const ids = new Set([taskId]);
  const pending = [taskId];
  while (pending.length) {
    const parentId = pending.pop();
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      pending.push(childId);
    }
  }
  return ids;
}

export function taskSubtreeIds(items, taskId) {
  return collectTaskSubtreeIds(taskChildrenByParent(items), taskId);
}

export function validTaskNestTargets(items, taskId, candidates) {
  const taskIds = new Set(items.map(task => task.id));
  if (!taskIds.has(taskId)) return [];
  const source = items.find(task => task.id === taskId);
  const sourceProject = projectIdentity(source);
  const subtreeIds = collectTaskSubtreeIds(taskChildrenByParent(items), taskId);
  return candidates.filter(task => taskIds.has(task.id)
    && !subtreeIds.has(task.id)
    && projectIdentity(task) === sourceProject);
}

// rootIds should be disjoint roots (as returned by selectedTaskRoots). Build
// the child index only once so bulk operations do not rescan every task per root.
export function taskSubtreeIdsByRoot(items, rootIds) {
  const childrenByParent = taskChildrenByParent(items);
  return new Map(rootIds.map(rootId => [rootId, collectTaskSubtreeIds(childrenByParent, rootId)]));
}

export function taskDeletionClosure(items, deletedRoots, parentOverrides = new Map()) {
  const deleted = new Set(deletedRoots);
  const parentById = new Map(items.map(task => [task.id, task.parentId ?? null]));
  for (const [taskId, parentId] of parentOverrides) parentById.set(taskId, parentId);
  const childrenByParent = new Map();
  for (const [taskId, parentId] of parentById) {
    if (!parentId) continue;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(taskId);
  }
  const pending = [...deleted];
  while (pending.length) {
    const parentId = pending.pop();
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (deleted.has(childId)) continue;
      deleted.add(childId);
      pending.push(childId);
    }
  }
  return deleted;
}

// Deleting a project also deletes its tasks and subprojects. Incremental Sync
// may identify that cascade through the project tombstone; preserve a task
// explicitly moved out in the same delta and let the parent override detach it
// from the deleted subtree.
export function taskRootsForDeletedProjects(items, deletedProjectIds, deltas = []) {
  const deletedProjects = new Set(deletedProjectIds);
  if (!deletedProjects.size) return [];
  const tasksById = new Map(items.map(task => [task.id, task]));
  const movedOutIds = new Set(deltas
    .filter(delta => delta?.id && Object.hasOwn(delta, "project_id") && !deletedProjects.has(delta.project_id ?? null))
    .map(delta => delta.id));
  const roots = items
    .filter(task => deletedProjects.has(task.projectId ?? null) && !movedOutIds.has(task.id))
    .filter(task => {
      const parent = tasksById.get(task.parentId);
      return !parent || !deletedProjects.has(parent.projectId ?? null);
    })
    .map(task => task.id);
  for (const delta of deltas) {
    if (delta?.id && !delta.is_deleted && deletedProjects.has(delta.project_id ?? null)) roots.push(delta.id);
  }
  return [...new Set(roots)];
}

export function taskRootsForDeletedSections(items, deletedSectionIds, deltas = [], deletedProjectIds = []) {
  const deletedSections = new Set(deletedSectionIds);
  if (!deletedSections.size) return [];
  const tasksById = new Map(items.map(task => [task.id, task]));
  const deletedProjects = new Set(deletedProjectIds);
  const movedOutIds = new Set();
  for (const delta of deltas) {
    if (!delta?.id) continue;
    const task = tasksById.get(delta.id);
    const movedToAnotherSection = Object.hasOwn(delta, "section_id")
      && !deletedSections.has(delta.section_id ?? null);
    const movedToSurvivingProject = Object.hasOwn(delta, "project_id")
      && (delta.project_id ?? null) !== (task?.projectId ?? null)
      && !deletedProjects.has(delta.project_id ?? null);
    if (movedToAnotherSection || movedToSurvivingProject) movedOutIds.add(delta.id);
  }
  const roots = items
    .filter(task => deletedSections.has(task.sectionId ?? null) && !movedOutIds.has(task.id))
    .filter(task => {
      const parent = tasksById.get(task.parentId);
      return !parent || !deletedSections.has(parent.sectionId ?? null);
    })
    .map(task => task.id);
  for (const delta of deltas) {
    if (delta?.id && !delta.is_deleted && deletedSections.has(delta.section_id ?? null)) roots.push(delta.id);
  }
  return [...new Set(roots)];
}

export function taskParentOverridesForDelta(items, deltas, defaultProjectId = null) {
  const taskById = new Map(items.map(task => [task.id, task]));
  const overrides = new Map();
  for (const delta of deltas) {
    if (!delta?.id || delta.is_deleted) continue;
    if (Object.hasOwn(delta, "parent_id")) {
      overrides.set(delta.id, delta.parent_id ?? null);
      continue;
    }
    const task = taskById.get(delta.id);
    if (!task?.parentId) continue;
    const projectChanged = Object.hasOwn(delta, "project_id")
      && (delta.project_id ?? defaultProjectId ?? null) !== (task.projectId ?? null);
    const sectionChanged = Object.hasOwn(delta, "section_id")
      && (delta.section_id ?? null) !== (task.sectionId ?? null);
    if (projectChanged || sectionChanged) overrides.set(delta.id, null);
  }
  return overrides;
}

export function setTaskSubtreeCompletion(items, taskId, completed, preserveDescendants = false) {
  const subtreeIds = taskSubtreeIds(items, taskId);
  for (const task of items) {
    if (subtreeIds.has(task.id) && (!preserveDescendants || task.id === taskId)) task.completed = completed;
  }
  return subtreeIds;
}

export function setTaskAncestorCompletion(items, taskId, completed) {
  const taskById = new Map(items.map(task => [task.id, task]));
  const changedIds = new Set();
  const seen = new Set([taskId]);
  let parentId = taskById.get(taskId)?.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = taskById.get(parentId);
    if (!parent) break;
    parent.completed = completed;
    changedIds.add(parent.id);
    parentId = parent.parentId;
  }
  return changedIds;
}

export function taskOutdentDestination(task, grandparentId) {
  if (grandparentId) return { parent_id: grandparentId };
  if (task.sectionId) return { section_id: task.sectionId };
  if (task.projectId) return { project_id: task.projectId };
  return null;
}

export function selectedTaskRoots(items, selectedIds, activeOnly = false, preserveRecurringDescendants = false) {
  const selected = items.filter(task => selectedIds.has(task.id) && (!activeOnly || !task.completed));
  const selectedSet = new Set(selected.map(task => task.id));
  const parentById = new Map(items.map(task => [task.id, task]));
  const hasSelectedAncestorById = new Map();
  const roots = [];
  for (const task of selected) {
    let parentId = task.parentId;
    const seen = new Set();
    const path = [];
    let hasSelectedAncestor = false;
    while (parentId && !seen.has(parentId)) {
      const parent = parentById.get(parentId);
      if (selectedSet.has(parentId) && (!preserveRecurringDescendants || !parent?.recurring)) {
        hasSelectedAncestor = true;
        break;
      }
      if (hasSelectedAncestorById.has(parentId)) {
        hasSelectedAncestor = hasSelectedAncestorById.get(parentId);
        break;
      }
      seen.add(parentId);
      path.push(parentId);
      parentId = parent?.parentId;
    }
    for (const id of path) hasSelectedAncestorById.set(id, hasSelectedAncestor);
    if (!hasSelectedAncestor) roots.push(task.id);
  }
  return roots;
}

export function reconcileTaskSelection(items, selectedId, selectedIds) {
  const taskIds = new Set(items.map(task => task.id));
  return {
    selectedId: taskIds.has(selectedId) ? selectedId : items[0]?.id ?? null,
    selectedIds: new Set([...selectedIds].filter(id => taskIds.has(id))),
    selectionChanged: !taskIds.has(selectedId)
  };
}

export function taskRangeIds(items, anchorId, endId) {
  const anchorIndex = items.findIndex(task => task.id === anchorId);
  const endIndex = items.findIndex(task => task.id === endId);
  if (anchorIndex < 0 || endIndex < 0) return [];
  return items.slice(Math.min(anchorIndex, endIndex), Math.max(anchorIndex, endIndex) + 1).map(task => task.id);
}
