const ORDER_LOCK_NAME = "keydo:todoist-task-order";
let localLockTail = Promise.resolve();

export class OrderLockUnavailableError extends Error {
  constructor(message = "Could not acquire the shared task-order lock", options) {
    super(message, options);
    this.name = "OrderLockUnavailableError";
  }
}

export function withLocalOrderLock(operation) {
  const previous = localLockTail;
  let release;
  localLockTail = new Promise(resolve => { release = resolve; });
  return previous.then(operation).finally(release);
}

export async function withCrossTabOrderLock(operation, locks = globalThis.navigator?.locks, serverLock = operation => withServerOrderLock(operation), acquisitionTimeoutMs = 30_000) {
  const withServer = () => serverLock(operation);
  if (!locks || typeof locks.request !== "function") return withServer();
  let started = false;
  const controller = new AbortController();
  const acquisitionTimer = setTimeout(() => controller.abort(), acquisitionTimeoutMs);
  try {
    return await locks.request(ORDER_LOCK_NAME, { mode: "exclusive", signal: controller.signal }, () => {
      started = true;
      clearTimeout(acquisitionTimer);
      // The server lock is shared across browser origins and devices that
      // reach the same Keydo process. Web Locks add same-origin coordination.
      return withServer();
    });
  } catch (error) {
    clearTimeout(acquisitionTimer);
    // A present API can still reject lock acquisition (for example when the
    // storage bucket is unavailable). Preserve the existing operation in that
    // case, but never replay an operation that already started and failed.
    if (started) throw error;
    return withServer();
  } finally {
    clearTimeout(acquisitionTimer);
  }
}

export async function withServerOrderLock(operation, fetcher = fetch, lockUrl = "/api/todoist/order-lock", handshakeTimeoutMs = 30_000) {
  const controller = new AbortController();
  let handshakeTimer;
  let reader;
  let drain;
  let lockToken = "";
  try {
    try {
      // The order-lock endpoint holds this request open until it acquires the
      // server lock. Bound that wait so a disconnected/stalled owner cannot
      // leave every action in this tab awaiting a lock forever.
      handshakeTimer = setTimeout(() => controller.abort(), handshakeTimeoutMs);
      const response = await fetcher(lockUrl, {
        method: "POST",
        signal: controller.signal
      });
      if (!response.ok || !response.body) throw new OrderLockUnavailableError();
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let handshake = "";
      while (!handshake.includes("\n") && handshake.length < 64) {
        const { value, done } = await reader.read();
        if (done) break;
        handshake += decoder.decode(value, { stream: true });
      }
      const match = handshake.match(/^locked ([a-f0-9-]+)\n/);
      if (!match) throw new OrderLockUnavailableError();
      lockToken = match[1];
      clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    } catch (error) {
      if (error instanceof OrderLockUnavailableError) throw error;
      throw new OrderLockUnavailableError(undefined, { cause: error });
    }
    drain = (async () => {
      while (!(await reader.read()).done) {}
    })();
    return await operation(lockToken);
  } finally {
    clearTimeout(handshakeTimer);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      await drain?.catch(() => {});
    }
  }
}
