export function createAsyncLock() {
  let held = false;
  const waiters = [];

  function makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (waiters.length) {
        const waiter = waiters.shift();
        if (waiter.cancelled) continue;
        waiter.cleanup();
        waiter.resolve(makeRelease());
        return;
      }
      held = false;
    };
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      if (!held) {
        held = true;
        return Promise.resolve(makeRelease());
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          cancelled: false,
          cleanup: () => signal?.removeEventListener("abort", onAbort),
          resolve,
          reject
        };
        const onAbort = () => {
          waiter.cancelled = true;
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          waiter.cleanup();
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.push(waiter);
      });
    }
  };
}
