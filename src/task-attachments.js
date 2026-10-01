const supportedRasterTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isSupportedRasterImageType(value) {
  const mediaType = typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
  return supportedRasterTypes.has(mediaType);
}

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

function compareImageAttachments(a, b) {
  return String(a.postedAt ?? "").localeCompare(String(b.postedAt ?? ""))
    || String(a.commentId ?? "").localeCompare(String(b.commentId ?? ""));
}

export function noteImageAttachmentsByItem(notes) {
  const grouped = new Map();
  for (const note of notes ?? []) {
    if (!isImageAttachmentNote(note) || !note.item_id) continue;
    const list = grouped.get(note.item_id) ?? [];
    list.push(attachmentFromNote(note));
    grouped.set(note.item_id, list);
  }
  for (const list of grouped.values()) list.sort(compareImageAttachments);
  return grouped;
}

export function addTaskImageAttachment(tasks, taskId, image) {
  const task = tasks.find(item => item.id === taskId);
  if (!task || !image) return false;
  const current = Array.isArray(task.attachments) ? task.attachments : [];
  task.attachments = [...current.filter(item => item.commentId !== image.commentId), image].sort(compareImageAttachments);
  if (!task.attachment?.commentId || task.attachment.commentId === image.commentId) task.attachment = null;
  return true;
}

export function removeTaskImageAttachment(tasks, taskId, commentId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return false;
  if (!commentId || commentId === "local") {
    if (task.attachment && !task.attachment.commentId) task.attachment = null;
    return true;
  }
  if (Array.isArray(task.attachments)) task.attachments = task.attachments.filter(item => item.commentId !== commentId);
  if (task.attachment?.commentId === commentId) task.attachment = null;
  return true;
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
    if (!note?.item_id) continue;
    const task = tasksById.get(note.item_id);
    if (!task) continue;
    const current = Array.isArray(task.attachments)
      ? task.attachments.slice()
      : task.attachment?.commentId ? [{ ...task.attachment }] : [];
    if (note.is_deleted) {
      task.attachments = current.filter(item => item.commentId !== note.id);
      if (task.attachment?.commentId === note.id) task.attachment = null;
      continue;
    }
    if (!isImageAttachmentNote(note)) continue;
    const next = attachmentFromNote(note);
    task.attachments = [...current.filter(item => item.commentId !== next.commentId), next].sort(compareImageAttachments);
    if (task.attachment?.commentId) task.attachment = null;
  }
  return tasks;
}

export function taskNoteDeltasNeedFullSync(tasks, notes) {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  return (notes ?? []).some(note => {
    if (!note?.is_deleted || !note.item_id) return false;
    const task = tasksById.get(note.item_id);
    // A stored comment list can drop one image. A lone legacy attachment cannot
    // reveal an older comment that this incremental payload does not include.
    if (!task || Array.isArray(task.attachments) || task.attachment?.commentId !== note.id) return false;
    return !noteImageAttachmentsByItem(notes).has(note.item_id);
  });
}
