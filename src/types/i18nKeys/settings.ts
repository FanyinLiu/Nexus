import type { SettingsShellTranslationKey } from './settingsShell.ts'
import type { SettingsConsoleTranslationKey } from './settingsConsole.ts'
import type { SettingsCompanionTranslationKey } from './settingsCompanion.ts'
import type { SettingsMemoryTranslationKey } from './settingsMemory.ts'
import type { SettingsChatTranslationKey } from './settingsChat.ts'
import type { SettingsHistoryTranslationKey } from './settingsHistory.ts'
import type { SettingsConnectionsTranslationKey } from './settingsConnections.ts'
import type { SettingsAutonomyTranslationKey } from './settingsAutonomy.ts'

export type SettingsTranslationKey =
  | SettingsShellTranslationKey
  | SettingsConsoleTranslationKey
  | SettingsCompanionTranslationKey
  | SettingsMemoryTranslationKey
  | SettingsChatTranslationKey
  | SettingsHistoryTranslationKey
  | SettingsConnectionsTranslationKey
  | SettingsAutonomyTranslationKey
