import type { PendingReminderDraft, PendingReminderDraftInput } from './types.ts'

export const PENDING_REMINDER_DRAFT_TTL_MS = 60_000

export function createPendingReminderDraft(
  draft: PendingReminderDraftInput,
  now = Date.now(),
): PendingReminderDraft {
  return {
    ...draft,
    createdAtMs: now,
  }
}

export function getFreshPendingReminderDraft(
  draft: PendingReminderDraft | null,
  ttlMs: number,
  now = Date.now(),
): PendingReminderDraft | null {
  if (!draft) {
    return null
  }

  if (now - draft.createdAtMs > ttlMs) {
    return null
  }

  return draft
}
