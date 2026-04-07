import type { AppSettings } from '../../types/index.ts'
import { getSettingsSnapshot, setSettingsSnapshot } from './settingsStore.ts'

export async function commitSettingsUpdate(
  update: (current: AppSettings) => AppSettings,
  apply: (next: AppSettings) => void,
) {
  const currentSettings = getSettingsSnapshot()
  const nextSettings = update(currentSettings)

  apply(nextSettings)
  await setSettingsSnapshot(nextSettings)

  return nextSettings
}
