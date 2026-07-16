import type { AppSettings } from '../types/index.ts'

type ContextAwarenessSettings = Pick<AppSettings, 'contextAwarenessEnabled'>

export type CommitSettingsDraftInput = {
  committed: ContextAwarenessSettings
  draft: AppSettings
  onSave: (settings: AppSettings) => Promise<void>
  onContextAwarenessDisabled: () => void
}

export function shouldPurgeRecentCompanionData(
  committed: ContextAwarenessSettings,
  draft: ContextAwarenessSettings,
): boolean {
  return committed.contextAwarenessEnabled && !draft.contextAwarenessEnabled
}

/**
 * Runs destructive awareness cleanup only after the real Settings save action.
 * Draft toggles and draft discard never call this boundary.
 */
export async function commitSettingsDraft({
  committed,
  draft,
  onSave,
  onContextAwarenessDisabled,
}: CommitSettingsDraftInput): Promise<void> {
  await onSave(draft)
  if (shouldPurgeRecentCompanionData(committed, draft)) {
    onContextAwarenessDisabled()
  }
}
