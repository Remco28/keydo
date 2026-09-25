export interface TaskImageAttachmentNote {
  id: string;
  item_id: string;
  posted_at?: string;
  is_deleted?: boolean;
  file_attachment?: {
    file_url?: string;
    file_type?: string;
    file_name?: string;
  };
}

export interface TaskImageAttachment {
  name: string;
  type: string;
  url: string;
  commentId: string;
  postedAt?: string;
}

export function noteAttachmentForItem(notes: TaskImageAttachmentNote[], itemId: string): TaskImageAttachment | null;
export function noteAttachmentsByItem(notes: TaskImageAttachmentNote[]): Map<string, TaskImageAttachment>;
export function applyTaskNoteDeltas<T extends { id: string; attachment?: TaskImageAttachment | null }>(
  tasks: T[],
  notes: TaskImageAttachmentNote[]
): T[];
export function taskNoteDeltasNeedFullSync(
  tasks: Array<{ id: string; attachment?: TaskImageAttachment | null }>,
  notes: TaskImageAttachmentNote[]
): boolean;
