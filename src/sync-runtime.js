export function backgroundSyncAction({ configured, liveTodoist, online, visible }) {
  if (configured === false || !online || !visible) return null;
  return liveTodoist ? "refresh" : "initialize";
}

export function createCoalescedSyncRunner(run) {
  let active = null;
  return async function runCoalesced() {
    if (active) return active;
    const operation = Promise.resolve().then(run);
    active = operation;
    try {
      return await operation;
    } finally {
      if (active === operation) active = null;
    }
  };
}
