import type { SettingsSectionId } from './settingsDrawerSupport'
import type { PetModelDefinition } from '../features/pet'
import { getWebSearchProviderPreset } from '../lib/webSearchProviders'
import { getApiProviderPreset } from '../lib'
import { pickTranslatedUiText } from '../lib/uiLanguage'
import type { AppSettings, DailyMemoryEntry, DebugConsoleEvent, MemoryItem, UiLanguage } from '../types'
import type { TranslationKey } from '../types/i18n'

export type SettingsSectionDescriptionMap = Record<SettingsSectionId, string>

export type SettingsSectionMetaEntry = {
  eyebrow: string
  glyph: string
  description: string
  preview: string[]
}

export type SettingsSectionMetaMap = Record<SettingsSectionId, SettingsSectionMetaEntry>

type Translator = (
  key: Parameters<typeof pickTranslatedUiText>[1],
  params?: Parameters<typeof pickTranslatedUiText>[2],
) => string

export type BuildSettingsSectionMetaInput = {
  ti: Translator
  uiLanguage: UiLanguage
  draft: AppSettings
  petModel: PetModelDefinition | undefined
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  chatMessageCount: number
  liveTranscript: string
  debugConsoleEvents: DebugConsoleEvent[]
  continuousVoiceActive: boolean
  clickThroughEnabled: boolean
}

export function buildSettingsSectionDescriptions(ti: Translator): SettingsSectionDescriptionMap {
  return {
    console: ti('settings.section_desc.console'),
    model: ti('settings.section_desc.model'),
    chat: ti('settings.section_desc.chat'),
    history: ti('settings.section_desc.history'),
    memory: ti('settings.section_desc.memory'),
    lorebooks: ti('settings.section_desc.lorebooks'),
    voice: ti('settings.section_desc.voice'),
    window: ti('settings.section_desc.window'),
    integrations: ti('settings.section_desc.integrations'),
    tools: ti('settings.section_desc.tools'),
    autonomy: ti('settings.section_desc.autonomy'),
  }
}

export function buildSettingsSectionMeta(input: BuildSettingsSectionMetaInput): {
  descriptions: SettingsSectionDescriptionMap
  meta: SettingsSectionMetaMap
} {
  const {
    ti,
    draft,
    petModel,
    memories,
    dailyMemoryEntries,
    chatMessageCount,
    liveTranscript,
    debugConsoleEvents,
    continuousVoiceActive,
    clickThroughEnabled,
  } = input

  const descriptions = buildSettingsSectionDescriptions(ti)
  const textProvider = getApiProviderPreset(draft.apiProviderId)

  const meta: SettingsSectionMetaMap = {
    console: {
      eyebrow: ti('settings.section_eyebrow.console'),
      glyph: 'console',
      description: descriptions.console,
      preview: [
        liveTranscript ? ti('settings.preview.console.live_transcript') : ti('settings.preview.console.waiting_for_voice'),
        `${debugConsoleEvents.length} ${ti('settings.preview.metrics.events')}`,
      ],
    },
    model: {
      eyebrow: ti('settings.section_eyebrow.model'),
      glyph: 'model',
      description: descriptions.model,
      preview: [
        textProvider.label,
        draft.model || ti('settings.preview.model.no_model'),
      ],
    },
    chat: {
      eyebrow: ti('settings.section_eyebrow.chat'),
      glyph: 'chat',
      description: descriptions.chat,
      preview: [
        draft.companionName || ti('settings.preview.chat.unnamed'),
        petModel?.label ? ti(petModel.label as TranslationKey) : ti('settings.preview.chat.no_live2d'),
        draft.characterProfiles.length
          ? ti('settings.preview.chat.profile_count', { count: draft.characterProfiles.length })
          : '',
      ].filter(Boolean),
    },
    history: {
      eyebrow: ti('settings.section_eyebrow.history'),
      glyph: 'history',
      description: descriptions.history,
      preview: [
        `${chatMessageCount} ${ti('settings.preview.metrics.messages')}`,
        ti('settings.preview.history.actions'),
      ],
    },
    memory: {
      eyebrow: ti('settings.section_eyebrow.memory'),
      glyph: 'memory',
      description: descriptions.memory,
      preview: [
        `${memories.length} ${ti('settings.preview.metrics.memories')}`,
        `${dailyMemoryEntries.length} ${ti('settings.preview.metrics.daily_notes')}`,
      ],
    },
    lorebooks: {
      eyebrow: ti('settings.section_eyebrow.lorebooks'),
      glyph: 'memory',
      description: descriptions.lorebooks,
      preview: [
        ti('settings.preview.lorebooks.tagline_1'),
        ti('settings.preview.lorebooks.tagline_2'),
      ],
    },
    voice: {
      eyebrow: ti('settings.section_eyebrow.voice'),
      glyph: 'voice',
      description: descriptions.voice,
      preview: [
        draft.continuousVoiceModeEnabled
          ? ti('settings.preview.voice.continuous_on')
          : ti('settings.preview.voice.continuous_off'),
        continuousVoiceActive
          ? ti('settings.preview.voice.live_session')
          : ti('settings.preview.voice.standing_by'),
      ],
    },
    window: {
      eyebrow: ti('settings.section_eyebrow.window'),
      glyph: 'window',
      description: descriptions.window,
      preview: [
        petModel?.label ? ti(petModel.label as TranslationKey) : ti('settings.preview.window.desktop_pet'),
        clickThroughEnabled
          ? ti('settings.preview.window.click_through_on')
          : ti('settings.preview.window.interactive'),
      ],
    },
    integrations: {
      eyebrow: ti('settings.section_eyebrow.integrations'),
      glyph: 'integrations',
      description: descriptions.integrations,
      preview: [
        draft.mcpServers.length
          ? ti('settings.preview.integrations.mcp_count', { count: draft.mcpServers.length })
          : ti('settings.preview.integrations.mcp_pending'),
        // Game-module status preview removed — minecraft / factorio are
        // hidden in v0.3.x (see registry.ts hidden flag). When games come
        // back, restore the `games_enabled` / `games_idle` preview line.
      ],
    },
    tools: {
      eyebrow: ti('settings.section_eyebrow.tools'),
      glyph: 'tools',
      description: descriptions.tools,
      preview: [
        draft.toolWebSearchEnabled
          ? `${getWebSearchProviderPreset(draft.toolWebSearchProviderId).label}`
          : ti('settings.preview.tools.search_off'),
        draft.toolWeatherEnabled
          ? ti('settings.preview.tools.weather_on')
          : ti('settings.preview.tools.weather_off'),
      ],
    },
    autonomy: {
      eyebrow: ti('settings.section_eyebrow.autonomy'),
      glyph: 'autonomy',
      description: descriptions.autonomy,
      preview: [
        draft.autonomyEnabled ? ti('settings.preview.autonomy.on') : ti('settings.preview.autonomy.off'),
        draft.autonomyEnabled && draft.autonomyDreamEnabled
          ? ti('settings.preview.autonomy.dream_on')
          : ti('settings.preview.autonomy.dream_off'),
      ],
    },
  }

  return { descriptions, meta }
}
