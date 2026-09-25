export type TaskViewTask = {
  id: string;
  project?: string | null;
  parentId?: string | null;
  orderKey?: string | null;
  childOrder?: number | null;
  projectId?: string | null;
  projectOrderKey?: string | null;
  projectChildOrder?: number | null;
  projectOrderParentId?: string | null;
  sectionId?: string | null;
  sectionOrder?: number | null;
  sectionOrderKey?: string | null;
};

export function sameTaskSiblingGroup(a: TaskViewTask, b: TaskViewTask): boolean;

export function isUnfilteredProjectView(view: string, query: string): boolean;
export function isTaskInProject(task: TaskViewTask & { project?: string | null }, projectId: string | null, projectName: string): boolean;
export function filterTasksByWorkspaceAndQuery<T extends TaskViewTask & { workspace?: string; title?: string; description?: string }>(items: T[], workspace: string, query?: string): T[];
export function isCompleteProjectOrderView(
  items: Array<TaskViewTask & { workspace?: string; project?: string | null }>,
  view: string,
  query: string,
  projectIdentity: string,
  workspace: string
): boolean;

export function isCurrentTaskSelection(items: TaskViewTask[], requestedId: string | null, selectedId: string | null): boolean;
export function isCurrentTaskTarget(items: TaskViewTask[], requestedId: string | null, targetId: string | null): boolean;
export function removeTaskSelectionIds(selectedIds: Set<string>, removedIds: Set<string>): Set<string>;
export function retainExistingTaskIds(items: TaskViewTask[], requestedIds: string[]): string[];
export function selectionIndexAfterMove(items: TaskViewTask[], selectedId: string | null, delta: number): number;

export function isHiddenByCollapse(
  task: TaskViewTask,
  parentById: Map<string, TaskViewTask>,
  collapsedIds: Set<string>,
  visibleIds: Set<string>
): boolean;

export function taskDepth(
  task: TaskViewTask,
  parentById: Map<string, TaskViewTask>,
  visibleIds: Set<string>
): number;

export function taskParentIdsWithChildren(items: TaskViewTask[]): Set<string>;

export function canNestTask(items: TaskViewTask[], taskId: string, targetId: string): boolean;

export function projectVisibleTree<T extends TaskViewTask>(
  matchingTasks: T[],
  collapsedIds: Set<string>,
  allTasks?: T[]
): T[];

export function makeSiblingReorder<T extends TaskViewTask & { orderKey?: string | null }>(
  siblings: T[],
  taskId: string,
  direction: "up" | "down"
): { orderKey: string; ordered: T[]; updates: Array<{ id: string; orderKey: string }> } | null;

export function orderTaskTree<T extends TaskViewTask>(items: T[]): T[];

export function orderTasksByDayOrder<T extends {
  id: string;
  parentId?: string | null;
  dayOrder?: number | null;
  dueClass?: string;
  dueDateKey?: string | null;
  priority?: number;
}>(items: T[]): T[];
export function dueDateKeyForRelativeLabel(label: string, now?: Date, timeZone?: string): string | null;
export function todoistDueDateKey(due: { date?: string | null } | null | undefined, timeZone?: string): string | null;
export function dueStateForDateKey(dateKey: string | null | undefined, recurring?: boolean, now?: Date, timeZone?: string): { due: string; dueClass: string };
export function refreshTaskDueStates<T extends { dueDateKey?: string | null; recurring?: boolean; due?: string; dueClass?: string }>(items: T[], now?: Date, timeZone?: string): boolean;

export function swapSiblingTaskOrder<T extends TaskViewTask>(
  items: T[],
  taskId: string,
  targetId: string
): T[] | null;

export function taskSubtreeIds(items: TaskViewTask[], taskId: string): Set<string>;
export function validTaskNestTargets(items: TaskViewTask[], taskId: string, candidates: TaskViewTask[]): TaskViewTask[];
export function taskSubtreeIdsByRoot(items: TaskViewTask[], rootIds: string[]): Map<string, Set<string>>;

export function taskDeletionClosure(
  items: TaskViewTask[],
  deletedRoots: Iterable<string>,
  parentOverrides?: Map<string, string | null>
): Set<string>;

export function taskRootsForDeletedProjects<T extends TaskViewTask & { projectId?: string | null }>(
  items: T[],
  deletedProjectIds: Iterable<string>,
  deltas?: Array<{ id?: string; is_deleted?: boolean; project_id?: string | null }>
): string[];

export function taskRootsForDeletedSections<T extends TaskViewTask & { sectionId?: string | null; projectId?: string | null }>(
  items: T[],
  deletedSectionIds: Iterable<string>,
  deltas?: Array<{ id?: string; is_deleted?: boolean; project_id?: string | null; section_id?: string | null }>,
  deletedProjectIds?: Iterable<string>
): string[];

export function taskParentOverridesForDelta<T extends TaskViewTask & { projectId?: string | null }>(
  items: T[],
  deltas: Array<{ id?: string; is_deleted?: boolean; parent_id?: string | null; project_id?: string | null }>,
  defaultProjectId?: string | null
): Map<string, string | null>;

export function setTaskSubtreeCompletion<T extends TaskViewTask & { completed: boolean }>(
  items: T[],
  taskId: string,
  completed: boolean,
  preserveDescendants?: boolean
): Set<string>;

export function setTaskAncestorCompletion<T extends TaskViewTask & { completed: boolean }>(
  items: T[],
  taskId: string,
  completed: boolean
): Set<string>;

export function taskOutdentDestination(
  task: Pick<TaskViewTask, "projectId" | "sectionId">,
  grandparentId: string | null
): { parent_id: string } | { section_id: string } | { project_id: string } | null;

export function selectedTaskRoots(
  items: TaskViewTask[],
  selectedIds: Set<string>,
  activeOnly?: boolean,
  preserveRecurringDescendants?: boolean
): string[];

export function reconcileTaskSelection<T extends TaskViewTask>(
  items: T[],
  selectedId: string | null,
  selectedIds: Set<string>
): { selectedId: string | null; selectedIds: Set<string>; selectionChanged: boolean };

export function taskRangeIds(items: TaskViewTask[], anchorId: string, endId: string): string[];
