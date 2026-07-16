import type { AppSettings } from '../../types/index.ts'
import { updateSettingsSnapshot } from './settingsStore.ts'

export function commitSettingsUpdate(
  update: (current: AppSettings) => AppSettings,
  apply: (next: AppSettings) => void,
) {
  return updateSettingsSnapshot(update, apply)
}
