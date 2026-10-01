import { describe, expect, test } from "bun:test";
import { addTaskImageAttachment, applyTaskNoteDeltas, isSupportedRasterImageType, noteImageAttachmentsByItem, removeTaskImageAttachment, taskNoteDeltasNeedFullSync } from "../src/task-attachments.js";

describe("task image attachments", () => {
  test("accepts only image formats supported by the upload endpoint", () => {
    expect(["image/png", "image/jpeg", "image/gif", "image/webp", "IMAGE/PNG; charset=binary"].map(isSupportedRasterImageType))
      .toEqual([true, true, true, true, true]);
    expect(["image/svg+xml", "image/avif", "text/plain", ""].map(isSupportedRasterImageType))
      .toEqual([false, false, false, false]);
  });

  test("keeps every valid image comment, oldest first", () => {
    const notes = [
      { id: "new", item_id: "task-a", posted_at: "2026-01-03", file_attachment: { file_url: "/new", file_type: "image/jpeg", file_name: "new.jpg" } },
      { id: "other", item_id: "task-b", posted_at: "2026-01-02", file_attachment: { file_url: "/other", file_type: "image/jpeg" } },
      { id: "old", item_id: "task-a", posted_at: "2026-01-01", file_attachment: { file_url: "/old", file_type: "image/png", file_name: "old.png" } },
      { id: "deleted", item_id: "task-a", posted_at: "2026-01-04", is_deleted: true, file_attachment: { file_url: "/deleted", file_type: "image/png" } },
      { id: "text", item_id: "task-a", posted_at: "2026-01-05", file_attachment: { file_url: "/text", file_type: "text/plain" } },
      { id: "svg", item_id: "task-a", posted_at: "2026-01-06", file_attachment: { file_url: "/vector", file_type: "image/svg+xml" } }
    ];

    expect(noteImageAttachmentsByItem(notes)).toEqual(new Map([
      ["task-a", [
        { name: "old.png", type: "image/png", url: "/old", commentId: "old", postedAt: "2026-01-01" },
        { name: "new.jpg", type: "image/jpeg", url: "/new", commentId: "new", postedAt: "2026-01-03" }
      ]],
      ["task-b", [{ name: "attached-image", type: "image/jpeg", url: "/other", commentId: "other", postedAt: "2026-01-02" }]]
    ]));
    expect(noteImageAttachmentsByItem(notes).get("missing")).toBeUndefined();
  });

  test("preserves the first note when timestamps tie", () => {
    const notes = [
      { id: "first", item_id: "task", posted_at: "2026-01-01", file_attachment: { file_url: "/first", file_type: "image/png" } },
      { id: "second", item_id: "task", posted_at: "2026-01-01", file_attachment: { file_url: "/second", file_type: "image/png" } }
    ];
    expect(noteImageAttachmentsByItem(notes).get("task")?.map(item => item.commentId)).toEqual(["first", "second"]);
  });

  test("adds an older image without replacing a newer comment", () => {
    const tasks = [
      { id: "task", attachment: null, attachments: [{ name: "newer.jpg", type: "image/jpeg", url: "/newer", commentId: "newer", postedAt: "2026-01-04" }] },
      { id: "task-2", attachment: null, attachments: [] }
    ];
    const deltas = [
      { id: "old", item_id: "task-2", posted_at: "2026-01-01", file_attachment: { file_url: "/old", file_type: "image/png" } },
      { id: "latest", item_id: "task-2", posted_at: "2026-01-03", file_attachment: { file_url: "/latest", file_type: "image/jpeg" } },
      { id: "stale", item_id: "task", posted_at: "2026-01-02", file_attachment: { file_url: "/stale", file_type: "image/png" } }
    ];

    applyTaskNoteDeltas(tasks, deltas);

    expect(tasks[0]?.attachments?.map(item => item.commentId)).toEqual(["stale", "newer"]);
    expect(tasks[1]?.attachments?.map(item => item.commentId)).toEqual(["old", "latest"]);
  });

  test("removes only the deleted image and keeps the other comments", () => {
    const tasks = [{
      id: "task",
      attachment: { name: "pending.png", type: "image/png", data: "data:image/png;base64,abc" },
      attachments: [
        { name: "old.png", type: "image/png", url: "/old", commentId: "old", postedAt: "2026-01-01" },
        { name: "latest.jpg", type: "image/jpeg", url: "/latest", commentId: "latest", postedAt: "2026-01-03" }
      ]
    }];
    const deltas = [
      { id: "latest", item_id: "task", posted_at: "2026-01-03", is_deleted: true, file_attachment: { file_url: "/latest", file_type: "image/jpeg" } }
    ];

    expect(taskNoteDeltasNeedFullSync(tasks, deltas)).toBe(false);
    applyTaskNoteDeltas(tasks, deltas);
    expect(tasks[0]?.attachments?.map(item => item.commentId)).toEqual(["old"]);
    expect(tasks[0]?.attachment?.data).toBe("data:image/png;base64,abc");
    expect(removeTaskImageAttachment(tasks, "task", "old")).toBe(true);
    expect(tasks[0]?.attachments).toEqual([]);
    expect(addTaskImageAttachment(tasks, "task", { name: "added.png", type: "image/png", url: "/added", commentId: "added", postedAt: "2026-01-05" })).toBe(true);
    expect(tasks[0]?.attachments?.map(item => item.commentId)).toEqual(["added"]);
    expect(tasks[0]?.attachment).toBeNull();
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
