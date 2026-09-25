import { describe, expect, test } from "bun:test";
import { OrderLockUnavailableError, withCrossTabOrderLock, withLocalOrderLock, withServerOrderLock } from "../src/cross-tab-lock.js";
import { createAsyncLock } from "../src/order-lock.js";

function serverFallback() {
  const lock = createAsyncLock();
  return async <T>(operation: (token: string) => Promise<T> | T) => {
    const release = await lock.acquire();
    try { return await operation("server-test-token"); } finally { release(); }
  };
}

function createLockManager() {
  let tail = Promise.resolve();
  return {
    request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      return previous.then(callback).finally(release);
    }
  };
}

describe("cross-tab order lock", () => {
  test("local demo lock serializes asynchronous operations without a server", async () => {
    let finishFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
    const order: string[] = [];
    const first = withLocalOrderLock(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    });
    const second = withLocalOrderLock(() => { order.push("second"); });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  test("waits for a complete streamed server-lock handshake and cancels it on release", async () => {
    let cancelled = false;
    let requestedUrl = "";
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("locked 123e4567-e89b-12d3-"));
        queueMicrotask(() => controller.enqueue(new TextEncoder().encode("a456-426614174000\n")));
      },
      cancel() { cancelled = true; }
    });
    let operationToken = "";
    const value = await withServerOrderLock(token => { operationToken = token; return 42; }, async input => {
      requestedUrl = String(input);
      return new Response(responseBody, { status: 200 });
    }, "/test-order-lock");

    expect(value).toBe(42);
    expect(operationToken).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(requestedUrl).toBe("/test-order-lock");
    expect(cancelled).toBe(true);
  });

  test("does not run an order operation when the shared lock cannot be acquired", async () => {
    let operationStarted = false;
    await expect(withServerOrderLock(() => { operationStarted = true; }, async () => {
      throw new Error("server unavailable");
    })).rejects.toBeInstanceOf(OrderLockUnavailableError);
    expect(operationStarted).toBe(false);
  });

  test("bounds a stalled server-lock handshake and never starts the operation", async () => {
    let operationStarted = false;
    await expect(withServerOrderLock(() => { operationStarted = true; }, (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }), "/test-order-lock", 1)).rejects.toBeInstanceOf(OrderLockUnavailableError);
    expect(operationStarted).toBe(false);
  });

  test("holds an exclusive lock through the asynchronous operation", async () => {
    const locks = createLockManager();
    let finishFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
    const order: string[] = [];
    const first = withCrossTabOrderLock(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    }, locks, operation => operation("server-test-token"));
    const second = withCrossTabOrderLock(() => { order.push("second"); }, locks, operation => operation("server-test-token"));

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  test("runs the operation when Web Locks are unavailable", async () => {
    await expect(withCrossTabOrderLock(() => "done", undefined, operation => operation("server-test-token"))).resolves.toBe("done");
  });

  test("serializes same-page operations when Web Locks are unavailable", async () => {
    let finishFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
    const order: string[] = [];
    const fallback = serverFallback();
    const first = withCrossTabOrderLock(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    }, undefined, fallback);
    const second = withCrossTabOrderLock(() => { order.push("second"); }, undefined, fallback);

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  test("falls back when lock acquisition rejects before the operation starts", async () => {
    const locks = { request: async () => { throw new Error("storage unavailable"); } };
    let calls = 0;
    const operation = () => { calls += 1; return "done"; };
    await expect(withCrossTabOrderLock(operation, locks, callback => callback("server-test-token"))).resolves.toBe("done");
    expect(calls).toBe(1);
  });

  test("bounds a queued Web Lock request and falls back to the shared server lock", async () => {
    let aborted = false;
    let operationCalls = 0;
    const locks = {
      request<T>(_name: string, options: { signal?: AbortSignal }, _callback: () => Promise<T> | T): Promise<T> {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
    };
    const result = await withCrossTabOrderLock(() => { operationCalls += 1; return "saved"; }, locks, operation => operation("server-token"), 1);

    expect(result).toBe("saved");
    expect(aborted).toBe(true);
    expect(operationCalls).toBe(1);
  });

  test("does not replay an operation that fails while holding the lock", async () => {
    const locks = { request: async <T>(_name: string, _options: { mode: "exclusive" }, callback: () => T | Promise<T>): Promise<T> => callback() };
    let calls = 0;
    const operation = () => { calls += 1; throw new Error("write failed"); };
    await expect(withCrossTabOrderLock(operation, locks, callback => callback("server-test-token"))).rejects.toThrow("write failed");
    expect(calls).toBe(1);
  });
});
