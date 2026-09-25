import { describe, expect, test } from "bun:test";
import { appendCreatedTask, canCaptureInWorkspace, isCreateRateLimited, isDefinitiveCreateRejection, isTodoistRateLimited, mergeResolvedCreatedTask, parseCapture, resolveCaptureProject, shouldRestoreCaptureAfterCreateFailure, todoistRetryAfterSeconds } from "../src/task-capture.js";
import { orderTaskTree } from "../src/task-view.js";

describe("quick capture project resolution", () => {
  const projects = new Map([
    ["project-1", { id: "project-1", name: "Launch plan" }],
    ["inbox-1", { id: "inbox-1", name: "Inbox" }]
  ]);

  test("matches project names without case sensitivity and keeps the canonical name", () => {
    expect(resolveCaptureProject("launch PLAN", projects)).toEqual({ name: "Launch plan", id: "project-1" });
  });

  test("parses the longest known multiword project after the hash marker", () => {
    expect(parseCapture("Call Alex tomorrow #launch plan p1", ["Launch", "Launch plan"]))
      .toEqual({ title: "Call Alex", project: "Launch plan", priority: 4, due: "Tomorrow" });
  });

  test("keeps ordinary title words after a known one-word project", () => {
    expect(parseCapture("Call Alex #Home about the shelf", ["Home"]))
      .toEqual({ title: "Call Alex about the shelf", project: "Home", priority: 1, due: "Today" });
  });

  test("uses Inbox when no project id is available", () => {
    expect(resolveCaptureProject("Inbox", new Map())).toEqual({ name: "Inbox" });
  });

  test("resolves a unique demo project from existing task names without assigning an ID", () => {
    expect(resolveCaptureProject("Launch plan", new Map(), ["Launch plan", "Home"]))
      .toEqual({ name: "Launch plan" });
  });

  test("places a confirmed capture last among same-project siblings when response order fields are absent", () => {
    const existing = { id: "existing", project: "Launch plan", projectId: "project-1", parentId: null, sectionId: null, orderKey: "a0", childOrder: 1 };
    const otherProject = { id: "other", project: "Inbox", projectId: "inbox-1", parentId: null, sectionId: null, orderKey: "a0", childOrder: 1 };
    const created = { id: "created", project: "Launch plan", projectId: "project-1", parentId: null, sectionId: null, orderKey: null, childOrder: null };
    const beforeResponse = [created, existing, otherProject];

    expect(orderTaskTree(appendCreatedTask(beforeResponse, created)).map(task => task.id))
      .toEqual(["existing", "created", "other"]);
  });

  test("rejects an unknown project instead of silently routing it to Inbox", () => {
    expect(resolveCaptureProject("Missing", projects)).toBeNull();
  });

  test("rejects ambiguous same-name projects instead of capturing into the wrong one", () => {
    const duplicateNames = new Map([
      ["project-1", { id: "project-1", name: "Research" }],
      ["project-2", { id: "project-2", name: "Research" }]
    ]);
    expect(resolveCaptureProject("Research", duplicateNames)).toBeNull();
  });

  test("replaces a synced duplicate with the pending row when create replay resolves its ID", () => {
    const createPromise = Promise.resolve();
    type CaptureTask = { id: string; title: string; orderKey?: string; keydoCreatePromise?: Promise<unknown> | null; attachment?: unknown };
    const pending: CaptureTask = { id: "temporary", title: "Call Alex", keydoCreatePromise: createPromise, attachment: null };
    const synced: CaptureTask = { id: "task-1", title: "Call Alex", orderKey: "a0", keydoCreatePromise: null, attachment: { commentId: "note-1" } };
    const another: CaptureTask = { id: "another", title: "Keep me" };

    const result = mergeResolvedCreatedTask([pending, synced, another], pending, synced);

    expect(result).toEqual([another, { id: "task-1", title: "Call Alex", orderKey: "a0", keydoCreatePromise: createPromise, attachment: { commentId: "note-1" } }]);
    expect(result.filter(task => task.id === "task-1")).toHaveLength(1);
  });
});

describe("quick capture workspace support", () => {
  test("keeps Work capture in demo mode but blocks it with live Todoist data", () => {
    expect(canCaptureInWorkspace("Personal", true)).toBe(true);
    expect(canCaptureInWorkspace("Work", false)).toBe(true);
    expect(canCaptureInWorkspace("Work", true)).toBe(false);
  });
});

describe("quick capture create failure classification", () => {
  test("restores capture drafts only when retrying cannot duplicate an uncertain create", () => {
    expect(shouldRestoreCaptureAfterCreateFailure({ requestAttempted: false })).toBe(true);
    expect(shouldRestoreCaptureAfterCreateFailure({ requestAttempted: true, definitelyRejected: true })).toBe(true);
    expect(shouldRestoreCaptureAfterCreateFailure({ requestAttempted: true, rateLimited: true })).toBe(true);
    expect(shouldRestoreCaptureAfterCreateFailure({ requestAttempted: true })).toBe(false);
  });

  test("treats proxied Todoist 4xx responses as definitive rejections", () => {
    expect(isDefinitiveCreateRejection(502, { status: 400 })).toBe(true);
    expect(isDefinitiveCreateRejection(502, { status: 403 })).toBe(true);
    expect(isDefinitiveCreateRejection(422, { command_rejected: true })).toBe(true);
  });

  test("keeps rate limits, conflicts, and server failures retryable or uncertain", () => {
    expect(isDefinitiveCreateRejection(502, { status: 429 })).toBe(false);
    expect(isDefinitiveCreateRejection(409, { error: "The shared task-state lock is no longer active" })).toBe(false);
    expect(isDefinitiveCreateRejection(502, { error: "Todoist task creation failed" })).toBe(false);
  });

  test("identifies proxied and command-level rate limits and exposes retry guidance", () => {
    expect(isCreateRateLimited(502, { status: 429, details: { error_extra: { retry_after: 4 } } })).toBe(true);
    expect(isCreateRateLimited(422, { command_rejected: true, details: { http_code: 429, error_extra: { retry_after: 2 } } })).toBe(true);
    expect(isTodoistRateLimited(422, { command_rejected: true, details: [{ uuid: "order-command", result: { http_code: 429 } }] })).toBe(true);
    expect(isDefinitiveCreateRejection(422, { command_rejected: true, details: { http_code: 429 } })).toBe(false);
    expect(todoistRetryAfterSeconds({ status: 429, details: { error_extra: { retry_after: 2.2 } } })).toBe(3);
    expect(todoistRetryAfterSeconds({ details: [{ uuid: "order-command", result: { http_code: 429, error_extra: { retry_after: 6 } } }] })).toBe(6);
    expect(todoistRetryAfterSeconds({ status: 400, details: { error_extra: { retry_after: 6 } } })).toBeNull();
    expect(todoistRetryAfterSeconds({ status: 429, details: { error_extra: { retry_after: 0 } } })).toBeNull();
  });
});
