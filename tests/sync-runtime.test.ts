import { describe, expect, test } from "bun:test";
import { backgroundSyncAction, createCoalescedSyncRunner } from "../src/sync-runtime.js";

describe("background sync lifecycle", () => {
  test("retries initial setup after startup failure while online and visible", () => {
    expect(backgroundSyncAction({ configured: true, liveTodoist: false, online: true, visible: true })).toBe("initialize");
    expect(backgroundSyncAction({ configured: null, liveTodoist: false, online: true, visible: true })).toBe("initialize");
  });

  test("uses incremental refresh after the initial live snapshot", () => {
    expect(backgroundSyncAction({ configured: true, liveTodoist: true, online: true, visible: true })).toBe("refresh");
  });

  test("does not call Todoist while offline or hidden", () => {
    expect(backgroundSyncAction({ configured: true, liveTodoist: false, online: false, visible: true })).toBeNull();
    expect(backgroundSyncAction({ configured: true, liveTodoist: true, online: true, visible: false })).toBeNull();
  });

  test("does not schedule sync when Todoist is not configured", () => {
    expect(backgroundSyncAction({ configured: false, liveTodoist: false, online: true, visible: true })).toBeNull();
  });
});

describe("coalesced background sync triggers", () => {
  test("shares one in-flight refresh and permits a later refresh", async () => {
    let finish!: (value: string) => void;
    const firstResult = new Promise<string>(resolve => { finish = resolve; });
    let calls = 0;
    const run = createCoalescedSyncRunner(() => {
      calls += 1;
      return calls === 1 ? firstResult : "later";
    });

    const first = run();
    const overlapping = run();
    await Promise.resolve();
    expect(calls).toBe(1);
    finish("synced");
    await expect(Promise.all([first, overlapping])).resolves.toEqual(["synced", "synced"]);
    await expect(run()).resolves.toBe("later");
    expect(calls).toBe(2);
  });

  test("releases the in-flight slot after a failed refresh so retry can run", async () => {
    let calls = 0;
    const run = createCoalescedSyncRunner(() => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return true;
    });

    await expect(run()).rejects.toThrow("temporary failure");
    await expect(run()).resolves.toBe(true);
    expect(calls).toBe(2);
  });
});
