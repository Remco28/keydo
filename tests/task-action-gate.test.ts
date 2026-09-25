import { describe, expect, test } from "bun:test";
import { createTaskActionGate } from "../src/task-action-gate.js";

describe("task action gate", () => {
  test("prevents overlapping actions on any shared subtree task", () => {
    const gate = createTaskActionGate();
    const releaseParentAction = gate.acquire(["parent", "child"]);
    expect(releaseParentAction).not.toBeNull();
    expect(gate.acquire(["child"])).toBeNull();
    expect(gate.acquire(["sibling"])).not.toBeNull();
  });

  test("releases all task ids once the action settles", () => {
    const gate = createTaskActionGate();
    const release = gate.acquire(["parent", "child"]);
    expect(release).not.toBeNull();
    release!();
    release!();
    expect(gate.acquire(["child"])).not.toBeNull();
  });

  test("deduplicates ids in a single reservation", () => {
    const gate = createTaskActionGate();
    const release = gate.acquire(["same", "same"]);
    expect(release).not.toBeNull();
    release!();
    expect(gate.acquire(["same"])).not.toBeNull();
  });

  test("pauses new task actions while a sync snapshot is applying", () => {
    const gate = createTaskActionGate();
    const releaseSync = gate.pause();
    expect(gate.acquire(["task"])).toBeNull();
    releaseSync();
    expect(gate.acquire(["task"])).not.toBeNull();
  });

  test("only starts a background sync pause while no task actions are active", () => {
    const gate = createTaskActionGate();
    const releaseAction = gate.acquire(["task"]);
    expect(gate.pauseIfIdle()).toBeNull();
    releaseAction!();
    const releaseSync = gate.pauseIfIdle();
    expect(releaseSync).not.toBeNull();
    expect(gate.acquire(["task"])).toBeNull();
    releaseSync!();
  });
});
