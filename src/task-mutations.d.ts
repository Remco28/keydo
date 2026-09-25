export function restoreTaskOrderFields<T extends { id: string; childOrder?: number | null; orderKey?: string | null }>(
  tasks: T[],
  snapshots: Array<{ id: string; childOrder?: number | null; orderKey?: string | null }>
): T[];
export function setTaskAttachment<T extends { id: string; attachment?: unknown }>(tasks: T[], taskId: string, attachment: T["attachment"] | null): boolean;

export function sameTaskDueGroup(
  a: { due?: string; dueDateKey?: string | null },
  b: { due?: string; dueDateKey?: string | null }
): boolean;
export function applyTaskDueChange<T extends { due?: string; dueDateKey?: string | null; dueClass?: string; dayOrder?: number | null }>(
  task: T,
  due: string,
  dueDateKey: string | null
): T;

export function restoreTaskSnapshots<T extends { id: string }, S extends Partial<T> & { id: string; index?: number }>(
  tasks: T[],
  snapshots: S[]
): T[];

export function applyTaskOrderKeys<T extends { id: string; orderKey?: string | null }>(
  tasks: T[],
  updates: Array<{ id: string; orderKey: string }>
): T[];

export function isTaskCompletionStateCurrent<T extends { completed?: boolean }>(task: T | undefined, observedCompleted: boolean): boolean;
export function isRecurringTaskCompletion(task: { recurring?: boolean } | undefined, completing: boolean): boolean;

export function retainOmittedTaskFields<T extends {
  title?: string;
  description?: string;
  priority?: number;
  completed?: boolean;
  due?: string;
  dueClass?: string;
  recurring?: boolean;
  orderKey?: string | null;
  childOrder?: number | null;
  dayOrder?: number | null;
  project?: string;
  projectId?: string | null;
  projectOrderKey?: string | null;
  projectChildOrder?: number | null;
  projectOrderParentId?: string | null;
  sectionId?: string | null;
  sectionOrder?: number | null;
  sectionOrderKey?: string | null;
  parentId?: string | null;
}>(
  mapped: T,
  previous: T,
  source: {
    order_key?: unknown;
    child_order?: unknown;
    day_order?: unknown;
    content?: unknown;
    description?: unknown;
    priority?: unknown;
    checked?: unknown;
    due?: unknown;
    project_id?: unknown;
    section_id?: unknown;
    parent_id?: unknown;
  }
): T;

export function restoreMissingTasks<T extends { id: string }>(
  tasks: T[],
  removedEntries: Array<{ item: T; index: number }>
): T[];

export function applyProjectTaskMove<T extends {
  id: string;
  parentId?: string | null;
  project?: string;
  projectId?: string | null;
  projectOrderKey?: string | null;
  projectChildOrder?: number | null;
  projectOrderParentId?: string | null;
  sectionId?: string | null;
  sectionOrder?: number | null;
  sectionOrderKey?: string | null;
  orderKey?: string | null;
  childOrder?: number | null;
  dayOrder?: number | null;
}>(tasks: T[], taskId: string, projectId: string, projectName: string, projectOrderKey?: string | null, projectChildOrder?: number | null, projectOrderParentId?: string | null): T[];

export function applyTaskHierarchyMove<T extends {
  id: string;
  parentId?: string | null;
  project?: string;
  projectId?: string | null;
  sectionId?: string | null;
  sectionOrder?: number | null;
  sectionOrderKey?: string | null;
  orderKey?: string | null;
  childOrder?: number | null;
}>(tasks: T[], taskId: string, parentId: string | null): T[];

export function retainPendingCreates<M extends { id: string }, E extends { id: string; keydoCreatePromise?: Promise<unknown> }>(
  mappedTasks: M[],
  existingTasks: E[]
): Array<M | E>;

export function applyTodoistProjectDelta<T extends { projectId?: string | null; project?: string; projectOrderKey?: string | null; projectChildOrder?: number | null; projectOrderParentId?: string | null }>(
  projectsById: Map<string, { id: string; name: string; orderKey?: string | null; childOrder?: number | null; parentId?: string | null }>,
  tasks: T[],
  selectedProjectId: string | null,
  project: { id: string; name?: string; is_deleted?: boolean; order_key?: string | null; child_order?: number | null; parent_id?: string | null }
): string | null;

export function applyTodoistSectionDeltas(
  sectionOrders: Map<string, number>,
  sectionOrderKeys: Map<string, string>,
  sections: Array<{ id?: string; is_deleted?: boolean; section_order?: number | null; order_key?: string | null }>
): { sectionOrders: Map<string, number>; sectionOrderKeys: Map<string, string> };

export function reconcileTodoistProjectSnapshot(
  previousProjectsById: Map<string, { id: string; name: string; orderKey?: string | null; childOrder?: number | null; parentId?: string | null }>,
  selectedProjectId: string | null,
  projects: Array<{ id: string; name: string; is_deleted?: boolean; order_key?: string | null; child_order?: number | null; parent_id?: string | null }>
): { projectsById: Map<string, { id: string; name: string; orderKey: string | null; childOrder: number | null; parentId: string | null }>; selectedProjectId: string | null; selectedProject: string };

export function deletedTodoistProjectIds(
  projectsById: Map<string, { id: string; parentId?: string | null }>,
  deltas?: Array<{ id?: string; is_deleted?: boolean; parent_id?: string | null }>
): Set<string>;

export function discardTaskEdits<T extends { keydoSaveTimer?: unknown; keydoPendingUpdates?: Record<string, unknown>; keydoSendingUpdates?: unknown; keydoDeleted?: boolean }>(
  task: T,
  cancelTimer?: (timer: unknown) => void
): boolean;
export function retryablePendingTaskUpdates<T extends {
  keydoDeleted?: boolean;
  keydoSavePromise?: unknown;
  keydoPendingUpdates?: Record<string, unknown>;
  keydoUpdateAutoRetryCount?: number;
}>(tasks: T[], maxAttempts?: number): T[];
