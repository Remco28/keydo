import { describe, expect, test } from "bun:test";
import { createAsyncLock } from "../src/order-lock.js";

describe("server task-order lock", () => {
  test("grants one caller at a time and hands off in queue order", async () => {
    const lock = createAsyncLock();
    const releaseFirst = await lock.acquire();
    const order: string[] = [];
    const second = lock.acquire().then(release => { order.push("second"); return release; });
    const third = lock.acquire().then(release => { order.push("third"); return release; });

    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst();
    const releaseSecond = await second;
    expect(order).toEqual(["second"]);
    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual(["second", "third"]);
    releaseThird();
  });

  test("removes a cancelled waiter without releasing the active lock", async () => {
    const lock = createAsyncLock();
    const releaseFirst = await lock.acquire();
    const controller = new AbortController();
    const cancelled = lock.acquire(controller.signal);
    const next = lock.acquire();
    controller.abort();

    await expect(cancelled).rejects.toThrow();
    let acquired = false;
    void next.then(() => { acquired = true; });
    await Promise.resolve();
    expect(acquired).toBe(false);
    releaseFirst();
    const releaseNext = await next;
    expect(acquired).toBe(true);
    releaseNext();
  });
});
