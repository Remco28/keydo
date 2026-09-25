export type CaptureProjectResolution = { name: string; id?: string } | null;

export function canCaptureInWorkspace(workspace: string, liveTodoist: boolean): boolean;

export function resolveCaptureProject(name: string, projectsById: Map<string, { id: string; name: string }>, fallbackProjectNames?: string[]): CaptureProjectResolution;

export function parseCapture(value: string, projectNames?: string[]): { title: string; project: string; priority: number; due: string };

export function appendCreatedTask<T extends { id: string }>(tasks: T[], task: T): T[];

export function mergeResolvedCreatedTask<T extends { id: string; keydoCreatePromise?: Promise<unknown> | null; attachment?: unknown }>(
  tasks: T[],
  pendingTask: T,
  syncedTask: T
): T[];

export function isDefinitiveCreateRejection(responseStatus: number, payload: unknown): boolean;

export function isCreateRateLimited(responseStatus: number, payload: unknown): boolean;

export function shouldRestoreCaptureAfterCreateFailure(result: {
  requestAttempted: boolean;
  definitelyRejected?: boolean;
  rateLimited?: boolean;
}): boolean;

export function isTodoistRateLimited(responseStatus: number, payload: unknown): boolean;

export function todoistRetryAfterSeconds(payload: unknown): number | null;
