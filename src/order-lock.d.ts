export function createAsyncLock(): {
  acquire(signal?: AbortSignal): Promise<() => void>;
};
