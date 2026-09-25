const supportedRasterTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function isImageAttachmentNote(note) {
  const fileType = note?.file_attachment?.file_type;
  const mediaType = typeof fileType === "string" ? fileType.split(";", 1)[0].trim().toLowerCase() : "";
  return Boolean(note && !note.is_deleted
    && note.file_attachment?.file_url
    && supportedRasterTypes.has(mediaType));
}

function attachmentFromNote(note) {
  return {
    name: note.file_attachment.file_name || "attached-image",
    type: note.file_attachment.file_type,
    url: note.file_attachment.file_url,
    commentId: note.id,
    postedAt: note.posted_at
  };
}

export function noteAttachmentForItem(notes, itemId) {
  let latest = null;
  for (const note of notes ?? []) {
    if (!isImageAttachmentNote(note) || note.item_id !== itemId) continue;
    if (!latest || String(note.posted_at ?? "").localeCompare(String(latest.posted_at ?? "")) > 0) latest = note;
  }
  return latest ? attachmentFromNote(latest) : null;
}

export function noteAttachmentsByItem(notes) {
  const latestByItem = new Map();
  for (const note of notes ?? []) {
    if (!isImageAttachmentNote(note) || !note.item_id) continue;
    const latest = latestByItem.get(note.item_id);
    if (!latest || String(note.posted_at ?? "").localeCompare(String(latest.posted_at ?? "")) > 0) {
      latestByItem.set(note.item_id, note);
    }
  }
  return new Map([...latestByItem].map(([itemId, note]) => [itemId, attachmentFromNote(note)]));
}

export function applyTaskNoteDeltas(tasks, notes) {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  for (const note of notes ?? []) {
    if (!note?.is_deleted || !note.item_id) continue;
    const task = tasksById.get(note.item_id);
    if (task?.attachment?.commentId === note.id) task.attachment = null;
  }
  for (const [itemId, attachment] of noteAttachmentsByItem(notes)) {
    const task = tasksById.get(itemId);
    if (!task) continue;
    const currentPostedAt = task.attachment?.postedAt;
    if (currentPostedAt && attachment.postedAt && currentPostedAt >= attachment.postedAt) continue;
    task.attachment = attachment;
  }
  return tasks;
}

export function taskNoteDeltasNeedFullSync(tasks, notes) {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const replacementItemIds = new Set(noteAttachmentsByItem(notes).keys());
  return (notes ?? []).some(note => note?.is_deleted
    && note.item_id
    && tasksById.get(note.item_id)?.attachment?.commentId === note.id
    && !replacementItemIds.has(note.item_id));
}
