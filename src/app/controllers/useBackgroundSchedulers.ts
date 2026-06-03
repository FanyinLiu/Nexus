import { useAwayNotificationScheduler } from '../../hooks/useAwayNotificationScheduler'
import { useBracketScheduler } from '../../hooks/useBracketScheduler.ts'
import { useErrandScheduler } from '../../hooks/useErrandScheduler.ts'
import { useFutureCapsuleScheduler } from '../../hooks/useFutureCapsuleScheduler.ts'
import { useGuidanceAnalysisScheduler } from '../../hooks/useGuidanceAnalysisScheduler.ts'
import { useLetterScheduler } from '../../hooks/useLetterScheduler.ts'
import { useOpenArcScheduler } from '../../hooks/useOpenArcScheduler.ts'
import type { AppSettings, ChatMessage, MemoryItem } from '../../types'

type UseBackgroundSchedulersOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  panelCollapsed: boolean
}

export function useBackgroundSchedulers({
  settings,
  messages,
  memories,
  panelCollapsed,
}: UseBackgroundSchedulersOptions) {
  const panelOpen = !panelCollapsed

  useAwayNotificationScheduler({
    settings,
    messages,
    panelOpen,
  })

  useBracketScheduler({
    settings,
    panelOpen,
  })

  useLetterScheduler({
    settings,
    messages,
    memories,
    panelOpen,
  })

  useErrandScheduler({ settings })
  useFutureCapsuleScheduler({ settings })
  useOpenArcScheduler({ settings })
  useGuidanceAnalysisScheduler()
}
