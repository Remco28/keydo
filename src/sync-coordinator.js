// Allow independent Todoist mutations to run together, but never overlap a
// state-changing request with a Sync snapshot that could overwrite its result.
// Mutations that consume and advance the same Sync cursor can also be serialized.
export function createSyncCoordinator() {
  let activeMutations = 0;
  let syncActive = false;
  let queuedSyncs = 0;
  let serializedMutationTail = Promise.resolve();
  let waiters = [];

  function waitForChange() {
    return new Promise(resolve => waiters.push(resolve));
  }

  function notifyChange() {
    const ready = waiters;
    waiters = [];
    ready.forEach(resolve => resolve());
  }

  async function withMutation(operation) {
    while (syncActive || queuedSyncs > 0) await waitForChange();
    activeMutations += 1;
    try {
      return await operation();
    } finally {
      activeMutations -= 1;
      notifyChange();
    }
  }

  return {
    withMutation,

    async withSerializedMutation(operation) {
      const previous = serializedMutationTail;
      let release;
      serializedMutationTail = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        return await withMutation(operation);
      } finally {
        release();
      }
    },

    async withSync(operation, { skipIfBusy = false } = {}) {
      if (skipIfBusy && (syncActive || activeMutations > 0 || queuedSyncs > 0)) {
        return { skipped: true };
      }

      queuedSyncs += 1;
      while (syncActive || activeMutations > 0) await waitForChange();
      queuedSyncs -= 1;
      syncActive = true;
      try {
        return { skipped: false, value: await operation() };
      } finally {
        syncActive = false;
        notifyChange();
      }
    }
  };
}
