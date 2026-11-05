/**
 * Background key-point generation for reminders and open-loop memories.
 *
 * This hook owns the only IO: the model call and the background-chat lease.
 * Candidate selection and current-row checks live in the key-point feature.
 * The item has already been saved by the time the effect runs, and the reply
 * is written back only when the same item still has the same text. Every
 * failure or timeout is silent; the read-time fallback covers it. No log
 * carries the item text, the prompt, the reply, or the generated key point.
 */

import { useEffect, useRef } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  acquireBackgroundChatLease,
  classifyBackgroundChatFailure,
  getBackgroundChatGate,
  recordBackgroundChatFailure,
  recordBackgroundChatSuccess,
  releaseBackgroundChatLease,
} from '../features/autonomy/backgroundChatPolicy.ts'
import {
  applyLoopKeyPoint,
  generateKeyPoint,
  isKeyPointCandidateCurrent,
  scanKeyPointCandidates,
} from '../features/reminders/keyPoint.ts'
import type {
  KeyPointCandidate,
  KeyPointScanState,
} from '../features/reminders/keyPoint.ts'
import type { AppSettings, MemoryItem, ReminderTask } from '../types'

type KeyPointSchedulerOptions = {
  enabled: boolean
  settingsRef: RefObject<AppSettings>
  reminderTasks: ReminderTask[]
  reminderTasksRef: RefObject<ReminderTask[]>
  setReminderKeyPoint: (id: string, keyPoint: string) => void
  memories: MemoryItem[]
  memoriesRef: RefObject<MemoryItem[]>
  setMemories: Dispatch<SetStateAction<MemoryItem[]>>
}

function emptyScanState(): KeyPointScanState {
  return {
    reminderTexts: new Map(),
    loopTexts: new Map(),
    attempted: new Map(),
    initialized: false,
  }
}

/** Watch both collections and fire one model request per new or edited item. */
export function useKeyPointScheduler(options: KeyPointSchedulerOptions): void {
  const scanStateRef = useRef<KeyPointScanState>(emptyScanState())
  const pendingRef = useRef<KeyPointCandidate[]>([])
  const runningRef = useRef(false)

  const {
    enabled,
    settingsRef,
    reminderTasks,
    reminderTasksRef,
    setReminderKeyPoint,
    memories,
    memoriesRef,
    setMemories,
  } = options

  useEffect(() => {
    if (!enabled) return

    const scan = scanKeyPointCandidates({
      reminderTasks,
      memories,
      state: scanStateRef.current,
    })
    scanStateRef.current = scan.state
    if (!scan.candidates.length) return

    const apply = (candidate: KeyPointCandidate, keyPoint: string) => {
      if (candidate.kind === 'reminder') {
        setReminderKeyPoint(candidate.id, keyPoint)
        return
      }
      setMemories((current) => {
        const next = applyLoopKeyPoint(current, candidate, keyPoint)
        if (next !== current) memoriesRef.current = next
        return next
      })
    }

    const runCandidate = async (candidate: KeyPointCandidate): Promise<void> => {
      const settings = settingsRef.current
      if (!settings) return
      if (candidate.kind === 'loop' && settings.memoryPaused) return
      const completeChat = window.desktopPet?.completeChat
      if (!completeChat) return

      const policy = {
        providerId: settings.apiProviderId,
        baseUrl: settings.apiBaseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      }
      if (!getBackgroundChatGate(policy).allowed) return
      const lease = acquireBackgroundChatLease()
      if (!lease) return
      try {
        await generateKeyPoint(candidate.text, {
          uiLanguage: settings.uiLanguage,
          isCurrent: () => isKeyPointCandidateCurrent(
            candidate,
            reminderTasksRef.current,
            memoriesRef.current,
          ),
          apply: (keyPoint) => apply(candidate, keyPoint),
          complete: async (prompt) => {
            try {
              const response = await completeChat({
                providerId: settings.apiProviderId,
                baseUrl: settings.apiBaseUrl,
                apiKey: settings.apiKey ?? '',
                model: settings.model,
                messages: [
                  { role: 'system', content: prompt.system },
                  { role: 'user', content: prompt.user },
                ],
                temperature: 0,
                maxTokens: 40,
                traceId: 'background:key-point',
              })
              recordBackgroundChatSuccess(policy)
              return response?.content ?? null
            } catch (error) {
              recordBackgroundChatFailure(policy, classifyBackgroundChatFailure(error))
              throw error
            }
          },
        })
      } finally {
        releaseBackgroundChatLease(lease)
      }
    }

    const drain = async (): Promise<void> => {
      pendingRef.current.push(...scan.candidates)
      if (runningRef.current) return
      runningRef.current = true
      try {
        while (pendingRef.current.length) {
          await runCandidate(pendingRef.current.shift()!)
        }
      } finally {
        runningRef.current = false
      }
    }
    void drain()
  }, [
    enabled,
    memories,
    memoriesRef,
    reminderTasks,
    reminderTasksRef,
    setMemories,
    setReminderKeyPoint,
    settingsRef,
  ])
}
