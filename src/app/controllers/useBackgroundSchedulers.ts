import { useAwayNotificationScheduler } from '../../hooks/useAwayNotificationScheduler.ts'
import { useBracketScheduler } from '../../hooks/useBracketScheduler.ts'
import { useDreamSurfacing } from '../../hooks/useDreamSurfacing.ts'
import { useErrandScheduler } from '../../hooks/useErrandScheduler.ts'
import { useFutureCapsuleScheduler } from '../../hooks/useFutureCapsuleScheduler.ts'
import { useGuidanceAnalysisScheduler } from '../../hooks/useGuidanceAnalysisScheduler.ts'
import { useLetterScheduler } from '../../hooks/useLetterScheduler.ts'
import { useOpenArcScheduler } from '../../hooks/useOpenArcScheduler.ts'
import type { CompanionNoticePayload } from '../../hooks/chat/types.ts'
import type { AppSettings, ChatMessage, DailyMemoryStore, FocusState, MemoryItem } from '../../types'

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
  /** Shared chat/bubble path so bracket lines reach the default V2 surface. */
  pushCompanionNotice?: (payload: CompanionNoticePayload) => Promise<void>
  busyRef?: React.RefObject<boolean>
  focusState?: FocusState
}

export function useBackgroundSchedulers({
  settings,
  messages,
  memories,
  dailyMemories = {},
  panelCollapsed,
  enabled = true,
  runtimeOwner = true,
  pushCompanionNotice,
  busyRef,
  focusState,
}: UseBackgroundSchedulersOptions) {
  const panelOpen = !panelCollapsed
  const schedulerEnabled = enabled && runtimeOwner

  useAwayNotificationScheduler({
    settings,
    messages,
    panelOpen,
    enabled: schedulerEnabled,
  })

  // Without a chat bridge there is nowhere to show the bracket; keep the
  // hook disabled instead of falling back to an OS toast only.
  useBracketScheduler({
    settings,
    messages,
    memories,
    panelCollapsed,
    enabled: schedulerEnabled && Boolean(pushCompanionNotice),
    pushCompanionNotice: pushCompanionNotice ?? (async () => undefined),
    busyRef,
    focusState,
  })

  useLetterScheduler({
    settings,
    messages,
    memories,
    dailyMemories,
    focusState,
    enabled: schedulerEnabled,
  })

  // Lowest-priority morning open: event follow-ups, letters, and the bracket
  // are all checked inside the pure decision before a dream is mentioned.
  useDreamSurfacing({
    settings,
    messages,
    memories,
    panelCollapsed,
    enabled: schedulerEnabled && Boolean(pushCompanionNotice),
    pushCompanionNotice: pushCompanionNotice ?? (async () => undefined),
    busyRef,
    focusState,
  })

  useErrandScheduler({ settings, enabled: schedulerEnabled })
  useFutureCapsuleScheduler({ settings, enabled: schedulerEnabled })
  useOpenArcScheduler({ settings, enabled: schedulerEnabled })
  useGuidanceAnalysisScheduler({ enabled: schedulerEnabled })
}
