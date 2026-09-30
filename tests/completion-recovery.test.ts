import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompletionRecovery, createCompletionJournal } from "../src/completion-recovery";
import { createTodoistClient } from "../src/todoist";

type Item = { id: string; parent_id: string | null; project_id: string; checked: boolean; completed_at: string | null; due?: { is_recurring: boolean }; is_deleted?: boolean };
function fixture() {
  const items: Item[] = [
    { id: "root", parent_id: null, project_id: "project", checked: false, completed_at: null },
    { id: "child", parent_id: "root", project_id: "project", checked: false, completed_at: null },
    { id: "grandchild", parent_id: "child", project_id: "project", checked: false, completed_at: null },
    { id: "child-two", parent_id: "root", project_id: "project", checked: false, completed_at: null },
    { id: "already-done", parent_id: "root", project_id: "project", checked: true, completed_at: "2026-09-01T00:00:00Z" }
  ];
  const reopened: string[] = [];
  const requestIds: string[] = [];
  let failId = "";
  let syncFailure = false;
  let catchupFailure = false;
  let ambiguousClose = false;
  let includeChecked = false;
  let catchupDeletedId = "";
  let closeCount = 0;
  const client = createTodoistClient({ token: "fixture-token", fetcher: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/sync")) {
      if (syncFailure) return Response.json({ error: "fixture offline" }, { status: 503 });
      const full = (init!.body as URLSearchParams).get("sync_token") === "*";
      if (!full && catchupFailure) return Response.json({ error: "fixture catch-up failure" }, { status: 503 });
      return Response.json({ full_sync: full, sync_token: "fixture-cursor", items: full
        ? items.filter(item => (includeChecked || !item.checked) && !item.is_deleted).map(item => ({ ...item }))
        : catchupDeletedId ? [{ id: catchupDeletedId, is_deleted: true }] : [] });
    }
    const match = url.pathname.match(/\/tasks\/([^/]+)(?:\/(close|reopen))?$/)!;
    const item = items.find(item => item.id === match[1] && !item.is_deleted);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    if (!match[2]) return Response.json({ ...item });
    if (match[2] === "close") {
      closeCount++;
      if (item.due?.is_recurring) return new Response(null, { status: 204 });
      const ids = new Set([item.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const child of items) if (child.parent_id && ids.has(child.parent_id) && !ids.has(child.id)) { ids.add(child.id); changed = true; }
      }
      for (const child of items) if (ids.has(child.id) && !child.checked) {
        child.checked = true; child.completed_at = "2026-09-30T12:00:00Z";
      }
      if (ambiguousClose) return Response.json({ error: "fixture lost close response" }, { status: 503 });
    } else {
      requestIds.push(new Headers(init?.headers).get("X-Request-Id")!);
      if (item.id === failId) return Response.json({ error: "fixture failure" }, { status: 503 });
      reopened.push(item.id);
      let ancestor: Item | undefined = item;
      while (ancestor) {
        ancestor.checked = false; ancestor.completed_at = null;
        ancestor = items.find(task => task.id === ancestor!.parent_id);
      }
    }
    return new Response(null, { status: 204 });
  } });
  return { items, client, reopened, requestIds, setFailure: (id: string) => { failId = id; }, setSyncFailure: () => { syncFailure = true; }, setCatchupFailure: () => { catchupFailure = true; }, setAmbiguousClose: () => { ambiguousClose = true; }, includeChecked: () => { includeChecked = true; }, setCatchupDelete: (id: string) => { catchupDeletedId = id; }, closeCount: () => closeCount };
}

describe("completion recovery", () => {
  test("restores only unfinished descendants, including grandchildren", async () => {
    const f = fixture();
    const journal = createCompletionJournal(":memory:", "account");
    const recovery = createCompletionRecovery(f.client, journal);
    await recovery.complete("root");
    expect(f.items.map(item => item.checked)).toEqual([true, true, true, true, true]);
    await recovery.reopen("root");
    expect(f.items.map(item => item.checked)).toEqual([false, false, false, false, true]);
    expect(f.reopened).toEqual(["root", "child", "child-two", "grandchild"]);
    expect(journal.get("root")).toBeNull();
  });

  test("survives a server restart and isolates account scopes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keydo-recovery-"));
    try {
      const path = join(dir, "recovery.sqlite");
      const f = fixture();
      await createCompletionRecovery(f.client, createCompletionJournal(path, "account-a")).complete("root");
      expect(createCompletionJournal(path, "account-b").get("root")).toBeNull();
      await createCompletionRecovery(f.client, createCompletionJournal(path, "account-a")).reopen("root");
      expect(f.items.map(item => item.checked)).toEqual([false, false, false, false, true]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("keeps progress on partial failure and safely retries with stable request IDs", async () => {
    const f = fixture();
    const journal = createCompletionJournal(":memory:", "account");
    const recovery = createCompletionRecovery(f.client, journal);
    await recovery.complete("root");
    f.setFailure("grandchild");
    await expect(recovery.reopen("root")).rejects.toThrow();
    expect(journal.pending()).toEqual(["root"]);
    expect(f.items.map(item => item.checked)).toEqual([false, false, true, false, true]);
    const failedRequestId = f.requestIds.at(-1);
    f.setFailure("");
    await recovery.reopen("root");
    expect(f.requestIds.at(-1)).toBe(failedRequestId);
    expect(f.reopened).toEqual(["root", "child", "child-two", "grandchild"]);
    expect(journal.pending()).toEqual([]);
  });

  test("does not overwrite recovery on a duplicate close", async () => {
    const f = fixture();
    const recovery = createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account"));
    await recovery.complete("root");
    await recovery.complete("root");
    await recovery.reopen("root");
    expect(f.closeCount()).toBe(1);
    expect(f.items[1].checked).toBe(false);
  });

  test("does not complete when Sync discovery or durable capture fails", async () => {
    const f = fixture();
    const journal = createCompletionJournal(":memory:", "account");
    f.setSyncFailure();
    await expect(createCompletionRecovery(f.client, journal).complete("root")).rejects.toThrow();
    expect(f.closeCount()).toBe(0);
    const healthy = fixture();
    journal.set = () => { throw new Error("disk full"); };
    await expect(createCompletionRecovery(healthy.client, journal).complete("root")).rejects.toThrow("disk full");
    expect(healthy.closeCount()).toBe(0);
  });

  test("applies catch-up deletions before capturing descendants", async () => {
    const f = fixture();
    f.setCatchupDelete("child");
    f.items.find(item => item.id === "child")!.is_deleted = true;
    const journal = createCompletionJournal(":memory:", "account");
    await createCompletionRecovery(f.client, journal).complete("root");
    expect(journal.get("root")!.entries.map(entry => entry.id)).toEqual(["root", "child-two"]);
  });

  test("recurring roots retain child state and do not create cascade recovery", async () => {
    const f = fixture(); f.items[0].due = { is_recurring: true };
    const journal = createCompletionJournal(":memory:", "account");
    await createCompletionRecovery(f.client, journal).complete("root");
    expect(journal.get("root")).toBeNull();
    expect(f.items.map(item => item.checked)).toEqual([false, false, false, false, true]);
  });

  test("refuses to restore a moved child or a different completion generation", async () => {
    for (const kind of ["move", "recomplete"] as const) {
      const f = fixture();
      const recovery = createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account"));
      await recovery.complete("root");
      if (kind === "move") f.items[1].parent_id = null;
      else f.items[1].completed_at = "2026-10-01T12:00:00Z";
      await expect(recovery.reopen("root")).rejects.toThrow("changed");
      expect(f.reopened).toEqual([]);
    }
  });

  test("without a recovery record, only reopens the requested task", async () => {
    const f = fixture();
    await f.client.completeTask("root");
    await createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account")).reopen("root");
    expect(f.reopened).toEqual(["root"]);
    expect(f.items.map(item => item.checked)).toEqual([false, true, true, true, true]);
  });

  test("bulk roots keep independent recovery records under concurrent requests", async () => {
    const f = fixture();
    f.items.push({ id: "second-root", parent_id: null, project_id: "project", checked: false, completed_at: null },
      { id: "second-child", parent_id: "second-root", project_id: "project", checked: false, completed_at: null });
    const recovery = createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account"));
    await Promise.all([recovery.complete("root"), recovery.complete("second-root")]);
    await recovery.reopen("root");
    expect(f.items.find(item => item.id === "second-child")!.checked).toBe(true);
    await recovery.reopen("second-root");
    expect(f.items.filter(item => item.checked).map(item => item.id)).toEqual(["already-done"]);
  });

  test("fails closed when incremental catch-up is unavailable", async () => {
    const f = fixture(); f.setCatchupFailure();
    const recovery = createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account"));
    await expect(recovery.complete("root")).rejects.toThrow();
    expect(f.closeCount()).toBe(0);
  });

  test("retains ambiguous close evidence without guessing a recovery generation", async () => {
    const f = fixture(); f.setAmbiguousClose();
    const journal = createCompletionJournal(":memory:", "account");
    const recovery = createCompletionRecovery(f.client, journal);
    await expect(recovery.complete("root")).rejects.toThrow();
    expect(journal.get("root")!.confirmed).toBe(false);
    await expect(recovery.reopen("root")).rejects.toThrow("unconfirmed");
    expect(f.reopened).toEqual([]);
  });

  test("refuses a recovery that would reopen an already-finished intermediate ancestor", async () => {
    const f = fixture(); f.includeChecked();
    f.items[1].checked = true;
    f.items[1].completed_at = "2026-09-01T00:00:00Z";
    const recovery = createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account"));
    await expect(recovery.complete("root")).rejects.toThrow("intermediate");
    expect(f.closeCount()).toBe(0);
  });

  test("does not resurrect descendants after another client reopened the parent", async () => {
    const f = fixture();
    const journal = createCompletionJournal(":memory:", "account");
    const recovery = createCompletionRecovery(f.client, journal);
    await recovery.complete("root");
    await f.client.reopenTask("root");
    await recovery.reopen("root");
    expect(f.reopened).toEqual(["root"]);
    expect(f.items[1].checked).toBe(true);
    expect(journal.get("root")).toBeNull();
  });

  test("partial retry validates ancestors already restored on the previous attempt", async () => {
    const f = fixture();
    const recovery = createCompletionRecovery(f.client, createCompletionJournal(":memory:", "account"));
    await recovery.complete("root"); f.setFailure("grandchild");
    await expect(recovery.reopen("root")).rejects.toThrow();
    f.setFailure("");
    f.items[0].checked = true; f.items[0].completed_at = "2026-10-01T00:00:00Z";
    await expect(recovery.reopen("root")).rejects.toThrow("changed");
    expect(f.items[2].checked).toBe(true);
  });

  test("interrupted recovery progress and pending retry survive a server restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keydo-recovery-"));
    try {
      const path = join(dir, "recovery.sqlite");
      const f = fixture();
      const first = createCompletionRecovery(f.client, createCompletionJournal(path, "account"));
      await first.complete("root"); f.setFailure("grandchild");
      await expect(first.reopen("root")).rejects.toThrow();
      const journal = createCompletionJournal(path, "account");
      expect(journal.pending()).toEqual(["root"]);
      const resumed = createCompletionRecovery(f.client, journal);
      expect((await resumed.pendingTasks()).map(item => item.id)).toEqual(["root"]);
      f.setFailure(""); await resumed.reopen("root");
      expect(f.items.filter(item => item.checked).map(item => item.id)).toEqual(["already-done"]);
      expect(journal.pending()).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
