/**
 * en translation dictionary — assembled from per-namespace modules.
 * Split so individual files stay under the source-size budget and can be
 * reviewed/edited without loading a 2600-line monolith.
 */
import type { TranslationDictionary } from '../../../types/i18n.ts'
import { enCore } from './core.ts'
import { enSettingsShell } from './settings-shell.ts'
import { enSettingsMemory } from './settings-memory.ts'
import { enSettingsConsole } from './settings-console.ts'
import { enSettingsHistory } from './settings-history.ts'
import { enSettingsChat } from './settings-chat.ts'
import { enSettingsIntegrations } from './settings-integrations.ts'
import { enSettingsVoice } from './settings-voice.ts'
import { enSettingsWindow } from './settings-window.ts'
import { enSettingsModel } from './settings-model.ts'
import { enProvider } from './provider.ts'
import { enVoice } from './voice.ts'
import { enChat } from './chat.ts'
import { enOnboarding } from './onboarding.ts'
import { enPanel } from './panel.ts'
import { enIntegration } from './integration.ts'

export const enMessages = {
  ...enCore,
  ...enSettingsShell,
  ...enSettingsMemory,
  ...enSettingsConsole,
  ...enSettingsHistory,
  ...enSettingsChat,
  ...enSettingsIntegrations,
  ...enSettingsVoice,
  ...enSettingsWindow,
  ...enSettingsModel,
  ...enProvider,
  ...enVoice,
  ...enChat,
  ...enOnboarding,
  ...enPanel,
  ...enIntegration,
} satisfies TranslationDictionary
