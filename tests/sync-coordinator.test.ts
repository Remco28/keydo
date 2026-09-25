import { describe, expect, test } from "bun:test";
import { createSyncCoordinator } from "../src/sync-coordinator.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("sync coordinator", () => {
  test("waits for in-flight mutations before taking a sync snapshot", async () => {
    const coordinator = createSyncCoordinator();
    const mutation = deferred<void>();
    const order: string[] = [];
    const write = coordinator.withMutation(async () => {
      order.push("write-start");
      await mutation.promise;
      order.push("write-end");
    });
    const sync = coordinator.withSync(async () => { order.push("sync"); });

    await Promise.resolve();
    expect(order).toEqual(["write-start"]);
    mutation.resolve();
    await Promise.all([write, sync]);
    expect(order).toEqual(["write-start", "write-end", "sync"]);
  });

  test("keeps the sync fence through optimistic task ID reconciliation", async () => {
    const coordinator = createSyncCoordinator();
    const response = deferred<{ id: string }>();
    const task = { id: "temporary-id" };
    const order: string[] = [];
    const create = coordinator.withMutation(async () => {
      const created = await response.promise;
      task.id = created.id;
      order.push(`reconciled:${task.id}`);
    });
    const sync = coordinator.withSync(async () => {
      order.push(`snapshot:${task.id}`);
    });

    await Promise.resolve();
    expect(order).toEqual([]);
    response.resolve({ id: "todoist-id" });
    await Promise.all([create, sync]);
    expect(order).toEqual(["reconciled:todoist-id", "snapshot:todoist-id"]);
  });

  test("makes mutations wait until an active sync has applied", async () => {
    const coordinator = createSyncCoordinator();
    const sync = deferred<void>();
    const order: string[] = [];
    const refresh = coordinator.withSync(async () => {
      order.push("sync-start");
      await sync.promise;
      order.push("sync-end");
    });
    const write = coordinator.withMutation(async () => { order.push("write"); });

    await Promise.resolve();
    expect(order).toEqual(["sync-start"]);
    sync.resolve();
    await Promise.all([refresh, write]);
    expect(order).toEqual(["sync-start", "sync-end", "write"]);
  });

  test("serializes cursor-consuming mutations while preserving their coordinator fence", async () => {
    const coordinator = createSyncCoordinator();
    const firstMutation = deferred<void>();
    const firstStarted = deferred<void>();
    const order: string[] = [];
    const first = coordinator.withSerializedMutation(async () => {
      order.push("first-start");
      firstStarted.resolve();
      await firstMutation.promise;
      order.push("first-end");
    });
    await firstStarted.promise;
    const second = coordinator.withSerializedMutation(async () => { order.push("second"); });
    const sync = coordinator.withSync(async () => { order.push("sync"); });

    expect(order).toEqual(["first-start"]);
    firstMutation.resolve();
    await Promise.all([first, second, sync]);
    expect(order).toEqual(["first-start", "first-end", "sync", "second"]);
  });

  test("serializes create and reorder commands that share the Todoist Sync cursor", async () => {
    const coordinator = createSyncCoordinator();
    const createStarted = deferred<void>();
    const finishCreate = deferred<void>();
    const order: string[] = [];
    const create = coordinator.withSerializedMutation(() => coordinator.withMutation(async () => {
      order.push("create-start");
      createStarted.resolve();
      await finishCreate.promise;
      order.push("create-end");
    }));
    await createStarted.promise;
    const reorder = coordinator.withSerializedMutation(() => coordinator.withMutation(async () => {
      order.push("reorder");
    }));

    expect(order).toEqual(["create-start"]);
    finishCreate.resolve();
    await Promise.all([create, reorder]);
    expect(order).toEqual(["create-start", "create-end", "reorder"]);
  });

  test("skips background sync rather than competing with mutations", async () => {
    const coordinator = createSyncCoordinator();
    const mutation = deferred<void>();
    const write = coordinator.withMutation(() => mutation.promise);
    const refresh = await coordinator.withSync(async () => "unexpected", { skipIfBusy: true });

    expect(refresh).toEqual({ skipped: true });
    mutation.resolve();
    await write;
  });

  test("releases the coordinator when an operation fails", async () => {
    const coordinator = createSyncCoordinator();
    await expect(coordinator.withSync(async () => { throw new Error("sync failed"); })).rejects.toThrow("sync failed");
    await expect(coordinator.withMutation(async () => "write recovered")).resolves.toBe("write recovered");
  });
});
