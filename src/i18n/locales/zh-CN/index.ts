/**
 * zh-CN translation dictionary — assembled from per-namespace modules.
 * Split so individual files stay under the source-size budget and can be
 * reviewed/edited without loading a 2600-line monolith.
 */
import { zhCNCore } from './core.ts'
import { zhCNSettingsShell } from './settings-shell.ts'
import { zhCNSettingsMemory } from './settings-memory.ts'
import { zhCNSettingsConsole } from './settings-console.ts'
import { zhCNSettingsHistory } from './settings-history.ts'
import { zhCNSettingsChat } from './settings-chat.ts'
import { zhCNSettingsIntegrations } from './settings-integrations.ts'
import { zhCNSettingsVoice } from './settings-voice.ts'
import { zhCNSettingsWindow } from './settings-window.ts'
import { zhCNSettingsModel } from './settings-model.ts'
import { zhCNProvider } from './provider.ts'
import { zhCNVoice } from './voice.ts'
import { zhCNChat } from './chat.ts'
import { zhCNOnboarding } from './onboarding.ts'
import { zhCNPanel } from './panel.ts'
import { zhCNIntegration } from './integration.ts'

export const zhCNMessages = {
  ...zhCNCore,
  ...zhCNSettingsShell,
  ...zhCNSettingsMemory,
  ...zhCNSettingsConsole,
  ...zhCNSettingsHistory,
  ...zhCNSettingsChat,
  ...zhCNSettingsIntegrations,
  ...zhCNSettingsVoice,
  ...zhCNSettingsWindow,
  ...zhCNSettingsModel,
  ...zhCNProvider,
  ...zhCNVoice,
  ...zhCNChat,
  ...zhCNOnboarding,
  ...zhCNPanel,
  ...zhCNIntegration,
} satisfies Record<string, string>
