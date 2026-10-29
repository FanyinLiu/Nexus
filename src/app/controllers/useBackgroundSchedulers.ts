import { useAwayNotificationScheduler } from '../../hooks/useAwayNotificationScheduler.ts'
import { useBracketScheduler } from '../../hooks/useBracketScheduler.ts'
import { useErrandScheduler } from '../../hooks/useErrandScheduler.ts'
import { useFutureCapsuleScheduler } from '../../hooks/useFutureCapsuleScheduler.ts'
import { useGuidanceAnalysisScheduler } from '../../hooks/useGuidanceAnalysisScheduler.ts'
import { useLetterScheduler } from '../../hooks/useLetterScheduler.ts'
import { useOpenArcScheduler } from '../../hooks/useOpenArcScheduler.ts'
import type { AppSettings, ChatMessage, DailyMemoryStore, MemoryItem } from '../../types'

type UseBackgroundSchedulersOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  dailyMemories?: DailyMemoryStore
  panelCollapsed: boolean
  /** Renderer-level scheduler switch; defaults on for isolated callers/tests. */
  enabled?: boolean
  /** Explicit owner switch kept separate from feature/settings enablement. */
  runtimeOwner?: boolean
}

export function useBackgroundSchedulers({
  settings,
  messages,
  memories,
  dailyMemories = {},
  panelCollapsed,
  enabled = true,
  runtimeOwner = true,
}: UseBackgroundSchedulersOptions) {
  const panelOpen = !panelCollapsed
  const schedulerEnabled = enabled && runtimeOwner

  useAwayNotificationScheduler({
    settings,
    messages,
    panelOpen,
    enabled: schedulerEnabled,
  })

  useBracketScheduler({
    settings,
    panelOpen,
    enabled: schedulerEnabled,
  })

  useLetterScheduler({
    settings,
    messages,
    memories,
    dailyMemories,
    enabled: schedulerEnabled,
  })

  useErrandScheduler({ settings, enabled: schedulerEnabled })
  useFutureCapsuleScheduler({ settings, enabled: schedulerEnabled })
  useOpenArcScheduler({ settings, enabled: schedulerEnabled })
  useGuidanceAnalysisScheduler({ enabled: schedulerEnabled })
}
