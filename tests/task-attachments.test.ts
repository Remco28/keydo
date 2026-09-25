import { describe, expect, test } from "bun:test";
import { applyTaskNoteDeltas, noteAttachmentForItem, noteAttachmentsByItem, taskNoteDeltasNeedFullSync } from "../src/task-attachments.js";

describe("task image attachments", () => {
  test("keeps the newest valid image note per task", () => {
    const notes = [
      { id: "new", item_id: "task-a", posted_at: "2026-01-03", file_attachment: { file_url: "/new", file_type: "image/jpeg", file_name: "new.jpg" } },
      { id: "other", item_id: "task-b", posted_at: "2026-01-02", file_attachment: { file_url: "/other", file_type: "image/jpeg" } },
      { id: "old", item_id: "task-a", posted_at: "2026-01-01", file_attachment: { file_url: "/old", file_type: "image/png" } },
      { id: "deleted", item_id: "task-a", posted_at: "2026-01-04", is_deleted: true, file_attachment: { file_url: "/deleted", file_type: "image/png" } },
      { id: "text", item_id: "task-a", posted_at: "2026-01-05", file_attachment: { file_url: "/text", file_type: "text/plain" } },
      { id: "svg", item_id: "task-a", posted_at: "2026-01-06", file_attachment: { file_url: "/vector", file_type: "image/svg+xml" } }
    ];

    expect(noteAttachmentsByItem(notes)).toEqual(new Map([
      ["task-a", { name: "new.jpg", type: "image/jpeg", url: "/new", commentId: "new", postedAt: "2026-01-03" }],
      ["task-b", { name: "attached-image", type: "image/jpeg", url: "/other", commentId: "other", postedAt: "2026-01-02" }]
    ]));
    expect(noteAttachmentForItem(notes, "task-a")).toEqual({
      name: "new.jpg", type: "image/jpeg", url: "/new", commentId: "new", postedAt: "2026-01-03"
    });
    expect(noteAttachmentForItem(notes, "missing")).toBeNull();
  });

  test("preserves the first note when timestamps tie", () => {
    const notes = [
      { id: "first", item_id: "task", posted_at: "2026-01-01", file_attachment: { file_url: "/first", file_type: "image/png" } },
      { id: "second", item_id: "task", posted_at: "2026-01-01", file_attachment: { file_url: "/second", file_type: "image/png" } }
    ];
    expect(noteAttachmentsByItem(notes).get("task")).toMatchObject({ commentId: "first", postedAt: "2026-01-01" });
  });

  test("applies note deltas by timestamp and retains a newer existing attachment", () => {
    const tasks = [
      { id: "task", attachment: { name: "newer.jpg", type: "image/jpeg", url: "/newer", commentId: "newer", postedAt: "2026-01-04" } },
      { id: "task-2", attachment: null }
    ];
    const deltas = [
      { id: "old", item_id: "task-2", posted_at: "2026-01-01", file_attachment: { file_url: "/old", file_type: "image/png" } },
      { id: "latest", item_id: "task-2", posted_at: "2026-01-03", file_attachment: { file_url: "/latest", file_type: "image/jpeg" } },
      { id: "stale", item_id: "task", posted_at: "2026-01-02", file_attachment: { file_url: "/stale", file_type: "image/png" } }
    ];

    applyTaskNoteDeltas(tasks, deltas);

    expect(tasks[0]?.attachment?.commentId).toBe("newer");
    expect(tasks[1]?.attachment?.commentId).toBe("latest");
  });

  test("promotes another surviving image when the current newest note is deleted", () => {
    const tasks = [{
      id: "task",
      attachment: { name: "latest.jpg", type: "image/jpeg", url: "/latest", commentId: "latest", postedAt: "2026-01-03" }
    }];
    const deltas = [
      { id: "old", item_id: "task", posted_at: "2026-01-01", file_attachment: { file_url: "/old", file_type: "image/png" } },
      { id: "latest", item_id: "task", posted_at: "2026-01-03", is_deleted: true, file_attachment: { file_url: "/latest", file_type: "image/jpeg" } }
    ];

    expect(taskNoteDeltasNeedFullSync(tasks, deltas)).toBe(false);
    applyTaskNoteDeltas(tasks, deltas);
    expect(tasks[0]?.attachment?.commentId).toBe("old");
  });

  test("requests a full note snapshot when deleting the current image without a replacement delta", () => {
    const tasks = [{
      id: "task",
      attachment: { name: "latest.jpg", type: "image/jpeg", url: "/latest", commentId: "latest", postedAt: "2026-01-03" }
    }];
    const deltas = [
      { id: "latest", item_id: "task", posted_at: "2026-01-03", is_deleted: true, file_attachment: { file_url: "/latest", file_type: "image/jpeg" } }
    ];

    expect(taskNoteDeltasNeedFullSync(tasks, deltas)).toBe(true);
    expect(taskNoteDeltasNeedFullSync(tasks, [{
      id: "unrelated", item_id: "other-task", is_deleted: true
    }])).toBe(false);
  });
});
