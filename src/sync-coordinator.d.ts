export function createSyncCoordinator(): {
  withMutation<T>(operation: () => Promise<T> | T): Promise<T>;
  withSerializedMutation<T>(operation: () => Promise<T> | T): Promise<T>;
  withSync<T>(
    operation: () => Promise<T> | T,
    options?: { skipIfBusy?: boolean }
  ): Promise<{ skipped: true } | { skipped: false; value: T }>;
};
