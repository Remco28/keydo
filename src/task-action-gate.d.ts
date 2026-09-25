export function createTaskActionGate(): {
  acquire(taskIds: Iterable<string>): (() => void) | null;
  pause(): () => void;
  pauseIfIdle(): (() => void) | null;
};
