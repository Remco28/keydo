export function restoreTaskOrderFields(tasks, snapshots) {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  for (const snapshot of snapshots) {
    const task = tasksById.get(snapshot.id);
    if (!task) continue;
    task.childOrder = snapshot.childOrder;
    task.orderKey = snapshot.orderKey;
  }
  return tasks;
}

export function sameTaskDueGroup(a, b) {
  return (a.dueDateKey ?? a.due) === (b.dueDateKey ?? b.due);
}

export function applyTaskDueChange(task, due, dueDateKey) {
  if (!sameTaskDueGroup(task, { due, dueDateKey })) task.dayOrder = null;
  task.due = due;
  task.dueDateKey = dueDateKey;
  task.dueClass = "";
  return task;
}

export function restoreTaskSnapshots(tasks, snapshots) {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const indexedSnapshots = [];
  for (const snapshot of snapshots) {
    const task = tasksById.get(snapshot.id);
    if (task) {
      const { index, ...fields } = snapshot;
      Object.assign(task, fields);
      if (Number.isInteger(index) && index >= 0) indexedSnapshots.push({ task, index });
    }
  }
  if (indexedSnapshots.length) {
    const restoredIds = new Set(indexedSnapshots.map(({ task }) => task.id));
    const taskAtIndex = new Map(indexedSnapshots.map(entry => [entry.index, entry.task]));
    const remaining = tasks.filter(task => !restoredIds.has(task.id));
    let targetLength = tasks.length;
    for (const index of taskAtIndex.keys()) targetLength = Math.max(targetLength, index + 1);
    const restored = [];
    let remainingIndex = 0;
    for (let index = 0; index < targetLength; index += 1) {
      if (taskAtIndex.has(index)) restored.push(taskAtIndex.get(index));
      else if (remainingIndex < remaining.length) restored.push(remaining[remainingIndex++]);
    }
    while (remainingIndex < remaining.length) restored.push(remaining[remainingIndex++]);
    tasks.length = 0;
    for (const task of restored) tasks.push(task);
  }
  return tasks;
}

export function applyTaskOrderKeys(tasks, updates) {
  const orderKeys = new Map(updates.map(({ id, orderKey }) => [id, orderKey]));
  for (const task of tasks) {
    if (orderKeys.has(task.id)) task.orderKey = orderKeys.get(task.id);
  }
  return tasks;
}

export function setTaskAttachment(tasks, taskId, attachment) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return false;
  task.attachment = attachment;
  return true;
}

export function isTaskCompletionStateCurrent(task, observedCompleted) {
  return Boolean(task && typeof observedCompleted === "boolean" && task.completed === observedCompleted);
}

export function isRecurringTaskCompletion(task, completing) {
  return Boolean(completing && task?.recurring);
}

// Delta payloads may omit unchanged values; explicit values still win. Order
// metadata is retained only when the task stays in the same sibling group.
export function retainOmittedTaskFields(mapped, previous, source) {
  for (const [localField, sourceField] of [
    ["title", "content"], ["description", "description"],
    ["priority", "priority"], ["completed", "checked"]
  ]) {
    if (!Object.hasOwn(source, sourceField)) mapped[localField] = previous[localField];
  }
  if (!Object.hasOwn(source, "due")) {
    mapped.due = previous.due;
    mapped.dueDateKey = previous.dueDateKey;
    mapped.dueClass = previous.dueClass;
    mapped.recurring = previous.recurring;
  }

  const projectChanged = Object.hasOwn(source, "project_id")
    && (mapped.projectId ?? null) !== (previous.projectId ?? null);
  const sectionChanged = Object.hasOwn(source, "section_id")
    && (mapped.sectionId ?? null) !== (previous.sectionId ?? null);
  if (!Object.hasOwn(source, "project_id") && Object.hasOwn(previous, "projectId")) {
    mapped.projectId = previous.projectId ?? null;
    if (Object.hasOwn(previous, "project")) mapped.project = previous.project;
    for (const field of ["projectOrderKey", "projectChildOrder", "projectOrderParentId"]) {
      if (Object.hasOwn(previous, field)) mapped[field] = previous[field];
    }
  }
  if (!Object.hasOwn(source, "section_id") && Object.hasOwn(previous, "sectionId")) {
    mapped.sectionId = projectChanged ? null : previous.sectionId ?? null;
    if (Object.hasOwn(previous, "sectionOrder")) mapped.sectionOrder = projectChanged ? null : previous.sectionOrder ?? null;
    if (Object.hasOwn(previous, "sectionOrderKey")) mapped.sectionOrderKey = projectChanged ? null : previous.sectionOrderKey ?? null;
  }
  if (!Object.hasOwn(source, "parent_id") && Object.hasOwn(previous, "parentId")) {
    // Moving a child to another project or section makes it a root task in
    // the destination. Otherwise, an omitted parent field means unchanged.
    mapped.parentId = projectChanged || sectionChanged ? null : previous.parentId ?? null;
  }

  // Omitted order values remain useful only while the task stays among the
  // same siblings. A move without these optional values must not reuse the
  // position it had in its previous group.
  const hasSiblingGroup = ["projectId", "project", "parentId", "sectionId"]
    .some(field => Object.hasOwn(mapped, field) && Object.hasOwn(previous, field));
  const previousProject = previous.projectId ?? previous.project ?? null;
  const mappedProject = mapped.projectId ?? mapped.project ?? null;
  const siblingGroupChanged = hasSiblingGroup && (
    previousProject !== mappedProject
    || (previous.parentId ?? null) !== (mapped.parentId ?? null)
    || (previous.sectionId ?? null) !== (mapped.sectionId ?? null)
  );
  // Todoist reopens a task at the end of its parent list. Do not retain the
  // completed task's former sibling position when the response omits keys.
  // Todoist day ordering is scoped to a due-date group. If an explicit due
  // change arrives without day_order, the previous position belongs to the
  // old date and must not leak into the new group.
  const dueGroupChanged = Object.hasOwn(source, "due") && !sameTaskDueGroup(mapped, previous);
  const taskReopened = Object.hasOwn(source, "checked") && source.checked === false && previous.completed === true;
  for (const [localField, sourceField] of [["orderKey", "order_key"], ["childOrder", "child_order"], ["dayOrder", "day_order"]]) {
    if (!Object.hasOwn(source, sourceField)) {
      const keyBelongsToSiblingGroup = localField === "orderKey" || localField === "childOrder";
      mapped[localField] = ((siblingGroupChanged || taskReopened) && keyBelongsToSiblingGroup) || (localField === "dayOrder" && dueGroupChanged)
        ? null
        : previous[localField] ?? null;
    }
  }
  return mapped;
}

export function restoreMissingTasks(tasks, removedEntries) {
  const presentIds = new Set(tasks.map(task => task.id));
  const afterTaskId = new Map();
  let firstMissing = null;
  let precedingId = null;
  for (const entry of removedEntries) {
    const id = entry.item.id;
    if (presentIds.has(id)) {
      precedingId = id;
      continue;
    }
    presentIds.add(id);
    if (precedingId === null) firstMissing = { entry, insertAt: Math.min(entry.index, tasks.length) };
    else {
      if (!afterTaskId.has(precedingId)) afterTaskId.set(precedingId, []);
      afterTaskId.get(precedingId).push(entry.item);
    }
    precedingId = id;
  }
  if (!firstMissing && afterTaskId.size === 0) return tasks;

  const restored = [];
  function appendAfter(anchorId) {
    const pending = [...(afterTaskId.get(anchorId) ?? [])].reverse();
    while (pending.length) {
      const item = pending.pop();
      restored.push(item);
      const children = afterTaskId.get(item.id) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
    }
  }
  for (let index = 0; index <= tasks.length; index += 1) {
    if (firstMissing?.insertAt === index) {
      restored.push(firstMissing.entry.item);
      appendAfter(firstMissing.entry.item.id);
    }
    if (index === tasks.length) break;
    const task = tasks[index];
    restored.push(task);
    appendAfter(task.id);
  }
  tasks.length = 0;
  for (const task of restored) tasks.push(task);
  return tasks;
}

export function applyProjectTaskMove(tasks, taskId, projectId, projectName, projectOrderKey = null, projectChildOrder = null, projectOrderParentId = null) {
  const movedRoot = tasks.find(task => task.id === taskId);
  if (!movedRoot) return tasks;
  const childrenByParent = new Map();
  for (const task of tasks) {
    if (!task.parentId) continue;
    if (!childrenByParent.has(task.parentId)) childrenByParent.set(task.parentId, []);
    childrenByParent.get(task.parentId).push(task.id);
  }
  const movedIds = new Set();
  const pending = [taskId];
  while (pending.length) {
    const currentId = pending.pop();
    if (movedIds.has(currentId)) continue;
    movedIds.add(currentId);
    for (const childId of childrenByParent.get(currentId) ?? []) pending.push(childId);
  }
  for (const task of tasks) {
    if (!movedIds.has(task.id)) continue;
    task.project = projectName;
    task.projectId = projectId;
    task.projectOrderKey = projectOrderKey;
    task.projectChildOrder = projectChildOrder;
    task.projectOrderParentId = projectOrderParentId;
    task.sectionId = null;
    task.sectionOrder = null;
    task.sectionOrderKey = null;
    task.orderKey = null;
    task.childOrder = null;
  }
  movedRoot.parentId = null;
  return [...tasks.filter(task => task.id !== taskId), movedRoot];
}

export function applyTaskHierarchyMove(tasks, taskId, parentId) {
  const movedTask = tasks.find(task => task.id === taskId);
  if (!movedTask) return tasks;
  const destination = parentId == null ? null : tasks.find(task => task.id === parentId);
  if (destination) {
    const childrenByParent = new Map();
    for (const task of tasks) {
      if (!task.parentId) continue;
      if (!childrenByParent.has(task.parentId)) childrenByParent.set(task.parentId, []);
      childrenByParent.get(task.parentId).push(task.id);
    }
    const subtreeIds = new Set([taskId]);
    const pending = [taskId];
    while (pending.length) {
      const currentId = pending.pop();
      for (const childId of childrenByParent.get(currentId) ?? []) {
        if (subtreeIds.has(childId)) continue;
        subtreeIds.add(childId);
        pending.push(childId);
      }
    }
    for (const task of tasks) {
      if (!subtreeIds.has(task.id)) continue;
      const projectChanged = (task.projectId ?? null) !== (destination.projectId ?? null);
      const sectionChanged = (task.sectionId ?? null) !== (destination.sectionId ?? null);
      task.project = destination.project;
      task.projectId = destination.projectId ?? null;
      task.sectionId = destination.sectionId ?? null;
      task.sectionOrder = destination.sectionOrder ?? null;
      task.sectionOrderKey = destination.sectionOrderKey ?? null;
      if (projectChanged || sectionChanged) {
        task.orderKey = null;
        task.childOrder = null;
      }
    }
  }
  movedTask.parentId = parentId;
  movedTask.orderKey = null;
  movedTask.childOrder = null;
  return [...tasks.filter(task => task.id !== taskId), movedTask];
}

export function retainPendingCreates(mappedTasks, existingTasks) {
  const mappedIds = new Set(mappedTasks.map(task => task.id));
  return [
    ...mappedTasks,
    ...existingTasks.filter(task => task.keydoCreatePromise && !mappedIds.has(task.id))
  ];
}

export function applyTodoistProjectDelta(projectsById, tasks, selectedProjectId, project) {
  if (!project?.id) return selectedProjectId;
  if (project.is_deleted) {
    projectsById.delete(project.id);
    return selectedProjectId === project.id ? null : selectedProjectId;
  }

  const previous = projectsById.get(project.id) ?? {};
  const name = typeof project.name === "string" && project.name ? project.name : previous.name;
  if (typeof name !== "string" || !name) return selectedProjectId;
  const next = { ...previous, id: project.id, name };
  if (Object.hasOwn(project, "order_key")) next.orderKey = typeof project.order_key === "string" ? project.order_key : null;
  if (Object.hasOwn(project, "child_order")) next.childOrder = typeof project.child_order === "number" ? project.child_order : null;
  if (Object.hasOwn(project, "parent_id")) next.parentId = project.parent_id ?? null;
  projectsById.set(project.id, next);
  for (const task of tasks) {
    if (task.projectId === project.id) {
      task.project = next.name;
      task.projectOrderKey = next.orderKey ?? null;
      task.projectChildOrder = next.childOrder ?? null;
      task.projectOrderParentId = next.parentId ?? null;
    }
  }
  return selectedProjectId;
}

export function applyTodoistSectionDeltas(sectionOrders, sectionOrderKeys, sections) {
  for (const section of sections ?? []) {
    if (!section?.id) continue;
    if (section.is_deleted) {
      sectionOrders.delete(section.id);
      sectionOrderKeys.delete(section.id);
      continue;
    }
    if (Object.hasOwn(section, "section_order")) {
      if (typeof section.section_order === "number") sectionOrders.set(section.id, section.section_order);
      else sectionOrders.delete(section.id);
    }
    if (Object.hasOwn(section, "order_key")) {
      if (typeof section.order_key === "string") sectionOrderKeys.set(section.id, section.order_key);
      else sectionOrderKeys.delete(section.id);
    }
  }
  return { sectionOrders, sectionOrderKeys };
}

export function reconcileTodoistProjectSnapshot(previousProjectsById, selectedProjectId, projects) {
  const projectsById = new Map((projects ?? [])
    .filter(project => project && !project.is_deleted && project.id && project.name)
    .map(project => [project.id, {
      id: project.id,
      name: project.name,
      orderKey: typeof project.order_key === "string" ? project.order_key : null,
      childOrder: typeof project.child_order === "number" ? project.child_order : null,
      parentId: project.parent_id ?? null
    }]));
  const previousSelectionExists = selectedProjectId && previousProjectsById.has(selectedProjectId);
  const selectedProject = previousSelectionExists
    ? projectsById.get(selectedProjectId)?.name ?? null
    : [...projectsById.values()].find(project => project.name.toLowerCase() === "inbox")?.name ?? null;
  const selectedId = selectedProjectId && projectsById.has(selectedProjectId)
    ? selectedProjectId
    : [...projectsById.values()].find(project => project.name.toLowerCase() === "inbox")?.id ?? null;
  return {
    projectsById,
    selectedProjectId: selectedId,
    selectedProject: selectedProject ?? "Inbox"
  };
}

export function deletedTodoistProjectIds(projectsById, deltas) {
  const projectDeltas = new Map((deltas ?? []).filter(project => project?.id).map(project => [project.id, project]));
  const deleted = new Set((deltas ?? [])
    .filter(project => project?.id && project.is_deleted)
    .map(project => project.id));
  if (!deleted.size) return deleted;
  for (const project of projectsById.values()) {
    let currentId = project.id;
    const seen = new Set();
    while (currentId && !seen.has(currentId)) {
      if (deleted.has(currentId)) {
        deleted.add(project.id);
        break;
      }
      seen.add(currentId);
      const delta = projectDeltas.get(currentId);
      currentId = Object.hasOwn(delta ?? {}, "parent_id")
        ? delta.parent_id ?? null
        : projectsById.get(currentId)?.parentId ?? null;
    }
  }
  return deleted;
}

export function discardTaskEdits(task, cancelTimer = clearTimeout) {
  const hasUnsavedEdits = Object.keys(task.keydoPendingUpdates || {}).length > 0
    || Object.keys(task.keydoSendingUpdates || {}).length > 0;
  if (task.keydoSaveTimer !== undefined && task.keydoSaveTimer !== null) cancelTimer(task.keydoSaveTimer);
  task.keydoSaveTimer = null;
  task.keydoPendingUpdates = {};
  task.keydoSendingUpdates = null;
  task.keydoUpdateAutoRetryCount = 0;
  task.keydoDeleted = true;
  return hasUnsavedEdits;
}

export function retryablePendingTaskUpdates(tasks, maxAttempts = 3) {
  return tasks.filter(task => !task.keydoDeleted
    && !task.keydoSavePromise
    && Object.keys(task.keydoPendingUpdates || {}).length > 0
    && (task.keydoUpdateAutoRetryCount ?? 0) < maxAttempts);
}
