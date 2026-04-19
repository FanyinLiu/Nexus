import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, ChatMessage, MemoryItem, PetMood, PresenceCategory, TranslationKey } from '../../types'
import { shorten } from '../../lib/common'

type Translator = (key: TranslationKey, params?: Parameters<typeof pickTranslatedUiText>[2]) => string

export type PresenceLine = {
  text: string
  category: PresenceCategory
}

type PresenceContext = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  mood: PetMood
  recentLines?: PresenceLine[]
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function getTimePresenceLines(userName: string, ti: Translator) {
  const hour = new Date().getHours()

  if (hour < 5) {
    return [
      ti('presence.time.deep_night.1', { userName }),
      ti('presence.time.deep_night.2', { userName }),
    ]
  }

  if (hour < 11) {
    return [
      ti('presence.time.morning.1', { userName }),
      ti('presence.time.morning.2', { userName }),
    ]
  }

  if (hour < 14) {
    return [
      ti('presence.time.noon.1', { userName }),
      ti('presence.time.noon.2', { userName }),
    ]
  }

  if (hour < 18) {
    return [
      ti('presence.time.afternoon.1', { userName }),
      ti('presence.time.afternoon.2', { userName }),
    ]
  }

  return [
    ti('presence.time.evening.1', { userName }),
    ti('presence.time.evening.2', { userName }),
  ]
}

function pickPresenceLine(candidates: PresenceLine[], recentLines: PresenceLine[]) {
  const recentTexts = new Set(recentLines.map((line) => line.text))
  const lastCategory = recentLines[0]?.category

  const withoutRecentText = candidates.filter((line) => !recentTexts.has(line.text))
  const withoutRecentCategory = withoutRecentText.filter((line) => line.category !== lastCategory)

  return pickRandom(
    withoutRecentCategory.length
      ? withoutRecentCategory
      : withoutRecentText.length
        ? withoutRecentText
        : candidates,
  )
}

export function buildPresenceMessage({
  settings,
  messages,
  memories,
  mood,
  recentLines = [],
}: PresenceContext) {
  const ti: Translator = (key, params) => pickTranslatedUiText(settings.uiLanguage, key, params)
  const recentUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  const latestMemory = memories[0]
  const candidates = [
    ...getTimePresenceLines(settings.userName, ti).map((text) => ({
      text,
      category: 'time' as const,
    })),
    ...(latestMemory
      ? [
          {
            text: ti('presence.memory.continue', { memory: shorten(latestMemory.content, 20) }),
            category: 'memory' as const,
          },
          {
            text: ti('presence.memory.remember', { memory: shorten(latestMemory.content, 20) }),
            category: 'memory' as const,
          },
        ]
      : []),
    ...(recentUserMessage
      ? [
          {
            text: ti('presence.recent.continue', { content: shorten(recentUserMessage.content, 20) }),
            category: 'recent' as const,
          },
          {
            text: ti('presence.recent.ask', { content: shorten(recentUserMessage.content, 20) }),
            category: 'recent' as const,
          },
        ]
      : []),
    ...(mood === 'happy'
      ? [
          { text: ti('presence.mood.happy_1'), category: 'mood' as const },
          { text: ti('presence.mood.happy_2'), category: 'mood' as const },
        ]
      : []),
    ...(mood === 'thinking'
      ? [{ text: ti('presence.mood.thinking'), category: 'mood' as const }]
      : []),
    ...(mood === 'sleepy'
      ? [{ text: ti('presence.mood.sleepy', { userName: settings.userName }), category: 'mood' as const }]
      : []),
    {
      text: ti('presence.neutral.stuck', { userName: settings.userName }),
      category: 'neutral' as const,
    },
    {
      text: ti('presence.neutral.standby', { companionName: settings.companionName }),
      category: 'neutral' as const,
    },
  ]

  return pickPresenceLine(candidates, recentLines)
}
