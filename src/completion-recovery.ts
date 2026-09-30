import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createAsyncLock } from "./order-lock.js";
import { createTodoistClient, TodoistApiError } from "./todoist";

type RecoveryEntry = { id: string; parentId: string | null; projectId: string | null; completedAt: string | null; requestId: string };
type RecoveryRecord = { entries: RecoveryEntry[]; remaining: string[]; confirmed: boolean; restoring: boolean };
type Item = { id: string; parent_id?: string | null; project_id?: string | null; checked?: boolean; is_deleted?: boolean; completed_at?: string | null; due?: { is_recurring?: boolean } | null };
type Client = ReturnType<typeof createTodoistClient>;

export class CompletionRecoveryError extends Error {
  constructor(message: string, readonly recoveryPending = false) { super(message); }
}

// This is an undo journal, not a task cache: no titles, notes or credentials.
// Open disk connections per transaction so server.stop() cannot leak handles.
export function createCompletionJournal(path: string, scope: string) {
  const memory = new Map<string, RecoveryRecord>();
  function transaction<T>(run: (db: Database) => T): T {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { create: true });
    try {
      chmodSync(path, 0o600);
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS recovery (scope TEXT NOT NULL, root_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(scope, root_id))");
      return run(db);
    } finally { db.close(); }
  }
  return {
    get(rootId: string): RecoveryRecord | null {
      if (path === ":memory:") return memory.has(rootId) ? structuredClone(memory.get(rootId)!) : null;
      return transaction(db => {
        const row = db.query("SELECT record FROM recovery WHERE scope=? AND root_id=?").get(scope, rootId) as { record: string } | null;
        return row ? JSON.parse(row.record) : null;
      });
    },
    set(rootId: string, record: RecoveryRecord) {
      if (path === ":memory:") { memory.set(rootId, structuredClone(record)); return; }
      transaction(db => db.query("INSERT INTO recovery VALUES (?, ?, ?) ON CONFLICT(scope, root_id) DO UPDATE SET record=excluded.record").run(scope, rootId, JSON.stringify(record)));
    },
    delete(rootId: string) {
      if (path === ":memory:") { memory.delete(rootId); return; }
      transaction(db => db.query("DELETE FROM recovery WHERE scope=? AND root_id=?").run(scope, rootId));
    },
    pending(): string[] {
      if (path === ":memory:") return [...memory].filter(([, record]) => record.restoring).map(([id]) => id);
      return transaction(db => (db.query("SELECT root_id, record FROM recovery WHERE scope=?").all(scope) as Array<{ root_id: string; record: string }>)
        .filter(row => JSON.parse(row.record).restoring).map(row => row.root_id));
    }
  };
}

export function createCompletionRecovery(client: Client, journal: ReturnType<typeof createCompletionJournal>) {
  // A browser-held lease also allows concurrent bulk calls. Serialize their
  // discovery/journal/write sequences without reacquiring that outer lease.
  const lock = createAsyncLock();
  async function serial<T>(run: () => Promise<T>) {
    const release = await lock.acquire();
    try { return await run(); } finally { release(); }
  }
  async function activeSnapshot() {
    const full = await client.sync({ syncToken: "*", resourceTypes: ["items"] });
    if (full.full_sync !== true || !Array.isArray(full.items) || !full.sync_token) throw new Error("Incomplete completion snapshot");
    const delta = await client.sync({ syncToken: full.sync_token, resourceTypes: ["items"] });
    if (!Array.isArray(delta.items) || !delta.sync_token || delta.full_sync === true) throw new Error("Incomplete completion catch-up");
    const byId = new Map<string, Item>();
    for (const item of full.items as Item[]) if (item?.id) byId.set(item.id, item);
    for (const item of delta.items as Item[]) if (item?.id) byId.set(item.id, { ...byId.get(item.id), ...item });
    const items = [...byId.values()].filter(item => !item.is_deleted);
    if (items.some(item => typeof item.checked !== "boolean")) throw new Error("Incomplete task completion state");
    return items;
  }
  async function getItem(id: string): Promise<Item | null> {
    try {
      const item = await client.getTask(id) as Item | null;
      if (!item || item.id !== id || typeof item.checked !== "boolean") throw new Error("Invalid completion task response");
      return item.is_deleted ? null : item;
    } catch (error) {
      if (error instanceof TodoistApiError && error.status === 404) return null;
      throw error;
    }
  }
  function unchanged(item: Item, entry: RecoveryEntry) {
    return (item.parent_id ?? null) === entry.parentId && (item.project_id ?? null) === entry.projectId
      && (!item.checked || item.completed_at === entry.completedAt);
  }
  return {
    complete(rootId: string) {
      return serial(async () => {
        const items = await activeSnapshot();
        const root = items.find(item => item.id === rootId && !item.checked);
        const previous = journal.get(rootId);
        if (!root) {
          const current = await getItem(rootId);
          if (current?.checked) {
            if (previous && !previous.confirmed) throw new CompletionRecoveryError("Task completed, but subtask recovery could not be confirmed");
            return; // Duplicate close must not replace the undo record.
          }
          throw new Error("Task changed before completion");
        }
        if (previous?.restoring) throw new CompletionRecoveryError("Finish reopening subtasks before completing this task again", true);
        if (root.due?.is_recurring) { journal.delete(rootId); await client.completeTask(rootId); return; }
        const children = new Map<string, Item[]>();
        for (const item of items) if (item.parent_id) {
          const siblings = children.get(item.parent_id) ?? []; siblings.push(item); children.set(item.parent_id, siblings);
        }
        const subtree: Item[] = [];
        const seen = new Set<string>();
        const queue = [{ item: root, finishedAncestor: false }];
        for (let i = 0; i < queue.length; i++) {
          const { item, finishedAncestor } = queue[i];
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (!item.checked) {
            if (finishedAncestor) throw new CompletionRecoveryError("Reopen the completed intermediate task before completing this parent");
            subtree.push(item);
          }
          for (const child of children.get(item.id) ?? []) queue.push({ item: child, finishedAncestor: finishedAncestor || Boolean(item.checked) });
        }
        if (subtree.length === 1) { journal.delete(rootId); await client.completeTask(rootId); return; }
        const record: RecoveryRecord = {
          entries: subtree.map(item => ({ id: item.id, parentId: item.parent_id ?? null, projectId: item.project_id ?? null, completedAt: null, requestId: crypto.randomUUID() })),
          remaining: subtree.map(item => item.id), confirmed: false, restoring: false
        };
        journal.set(rootId, record); // Fail closed before a destructive cascade if storage fails.
        await client.completeTask(rootId);
        // Exact completion timestamps bind recovery to this generation. If
        // confirmation fails, retain the prepared record but do not guess.
        for (const entry of record.entries) {
          const item = await getItem(entry.id);
          if (!item?.checked || !item.completed_at || !unchanged(item, { ...entry, completedAt: item.completed_at })) {
            throw new CompletionRecoveryError("Task completed, but subtask recovery could not be confirmed");
          }
          entry.completedAt = item.completed_at;
        }
        record.confirmed = true;
        journal.set(rootId, record);
      });
    },
    reopen(rootId: string) {
      return serial(async () => {
        const record = journal.get(rootId);
        if (!record) {
          await client.reopenTask(rootId);
          const verified = await getItem(rootId);
          if (!verified || verified.checked) throw new Error("Task reopen could not be verified");
          return;
        }
        if (!record.confirmed) throw new CompletionRecoveryError("Cannot safely restore subtasks from an unconfirmed completion");
        const currentRoot = await getItem(rootId);
        if (currentRoot && !currentRoot.checked && !record.restoring) {
          // Another client reopened the parent; do not revive an old cascade
          // after an unrelated subsequent edit.
          journal.delete(rootId); return;
        }
        // Validate restored ancestors too: they may have been moved or
        // completed again while an interrupted recovery was waiting.
        for (const entry of record.entries) {
          const item = await getItem(entry.id);
          if (!item || !unchanged(item, entry)) throw new CompletionRecoveryError("Task hierarchy or completion changed · automatic subtask recovery cancelled", record.restoring);
        }
        record.restoring = true;
        journal.set(rootId, record);
        try {
          for (const entry of record.entries) if (record.remaining.includes(entry.id)) {
            const item = await getItem(entry.id);
            if (!item || !unchanged(item, entry)) throw new Error("Task changed during subtask recovery");
            if (item.checked) await client.reopenTask(entry.id, entry.requestId);
            const verified = await getItem(entry.id);
            if (!verified || verified.checked || !unchanged(verified, entry)) throw new Error("Subtask reopen could not be verified");
            record.remaining = record.remaining.filter(id => id !== entry.id);
            journal.set(rootId, record);
          }
          journal.delete(rootId);
        } catch {
          throw new CompletionRecoveryError("Some subtasks could not reopen · retry recovery from Completed", true);
        }
      });
    },
    async pendingTasks() {
      const items: Array<Record<string, unknown>> = [];
      for (const id of journal.pending()) {
        const task = await getItem(id);
        if (task) items.push({ ...task, keydo_reopen_pending: true });
      }
      return items;
    },
    forget(rootId: string) { journal.delete(rootId); }
  };
}
