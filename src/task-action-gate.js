// Prevent conflicting asynchronous actions from being started against the
// same task subtree before earlier optimistic changes have settled.
export function createTaskActionGate() {
  const pending = new Set();
  let paused = 0;

  return {
    acquire(taskIds) {
      const ids = [...new Set(taskIds)];
      if (paused || ids.some(id => pending.has(id))) return null;
      ids.forEach(id => pending.add(id));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        ids.forEach(id => pending.delete(id));
      };
    },

    pause() {
      paused += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        paused = Math.max(0, paused - 1);
      };
    },

    pauseIfIdle() {
      if (paused || pending.size) return null;
      return this.pause();
    }
  };
}
