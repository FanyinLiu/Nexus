import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildPresenceMessage,
  type PetPerformanceCue,
  type PresenceLine,
} from '../features/pet'
import { createIdleSequenceController, type IdleSequenceController } from '../features/pet/idleSequence'
import {
  createId,
  loadAmbientPresence,
  loadLastProactivePresenceAt,
  loadPetRuntimeState,
  loadPresenceActivityAt,
  loadPresenceHistory,
  saveAmbientPresence,
  saveLastProactivePresenceAt,
  savePetRuntimeState,
  savePresenceActivityAt,
  savePresenceHistory,
} from '../lib'
import type {
  AmbientPresenceState,
  AppSettings,
  ChatMessage,
  MemoryItem,
  PetMood,
  PetTouchZone,
  PresenceHistoryItem,
  VoiceState,
  WindowView,
} from '../types'

const PRESENCE_CHECK_INTERVAL_MS = 15_000
const PROACTIVE_PRESENCE_DURATION_MS = 8_200
const PROACTIVE_PRESENCE_RETRY_DELAY_MS = 60_000

function getDefaultPetStatusText(continuousVoiceActive = false) {
  return continuousVoiceActive
    ? '连续语音已开启，你停一下我就会接着回应。'
    : '左键拖动，右键菜单，双击就能快速开口。'
}

type UsePetBehaviorContext = {
  settingsRef: React.RefObject<AppSettings>
  busyRef: React.RefObject<boolean>
  voiceStateRef: React.RefObject<VoiceState>
  continuousVoiceActiveRef: React.RefObject<boolean>
  settingsOpenRef: React.RefObject<boolean>
  inputRef: React.RefObject<string>
  messagesRef: React.RefObject<ChatMessage[]>
  memoriesRef: React.RefObject<MemoryItem[]>
  view: WindowView
}

export { getDefaultPetStatusText }

export function usePetBehavior(ctx: UsePetBehaviorContext) {
  const [mood, setMood] = useState<PetMood>(() => loadPetRuntimeState().mood)
  const [gazeTarget, setGazeTarget] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [petPerformanceCue, setPetPerformanceCue] = useState<PetPerformanceCue | null>(null)
  const [petStatusText, setPetStatusText] = useState(getDefaultPetStatusText())
  const [ambientPresence, setAmbientPresence] = useState<AmbientPresenceState | null>(() => loadAmbientPresence())
  const [mascotHovered, setMascotHovered] = useState(false)
  const [petTapActive, setPetTapActive] = useState(false)
  const [petTouchZone, setPetTouchZone] = useState<PetTouchZone | null>(null)
  const [petHotspotActive, setPetHotspotActive] = useState(false)

  const moodRef = useRef<PetMood>(loadPetRuntimeState().mood)
  const idleControllerRef = useRef<IdleSequenceController | null>(null)
  const performanceCueTimerRef = useRef<number | null>(null)
  const performanceCueQueueRef = useRef<PetPerformanceCue[]>([])
  const hoverTimerRef = useRef<number | null>(null)
  const presenceHistoryRef = useRef<PresenceLine[]>(
    loadPresenceHistory().map((item) => ({
      text: item.text,
      category: item.category,
    })),
  )
  const proactivePresenceDeferredUntilRef = useRef(0)

  useEffect(() => {
    moodRef.current = mood
  }, [mood])

  useEffect(() => {
    savePetRuntimeState({ mood })
    window.desktopPet?.updateRuntimeState?.({ mood }).catch(() => undefined)
  }, [mood])

  useEffect(() => () => {
    if (performanceCueTimerRef.current) {
      window.clearTimeout(performanceCueTimerRef.current)
    }
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
    }
    performanceCueQueueRef.current = []
  }, [])

  const playNextPetPerformanceCue = useCallback(function playNextPetPerformanceCue() {
    if (performanceCueTimerRef.current) {
      window.clearTimeout(performanceCueTimerRef.current)
      performanceCueTimerRef.current = null
    }

    const nextCue = performanceCueQueueRef.current.shift()
    if (!nextCue) {
      setPetPerformanceCue(null)
      return
    }

    setPetPerformanceCue(nextCue)
    performanceCueTimerRef.current = window.setTimeout(() => {
      performanceCueTimerRef.current = null
      setPetPerformanceCue((current) => (current?.id === nextCue.id ? null : current))
      playNextPetPerformanceCue()
    }, nextCue.durationMs)
  }, [])

  const clearPetPerformanceCue = useCallback(() => {
    if (performanceCueTimerRef.current) {
      window.clearTimeout(performanceCueTimerRef.current)
      performanceCueTimerRef.current = null
    }

    performanceCueQueueRef.current = []
    setPetPerformanceCue(null)
  }, [])

  const queuePetPerformanceCue = useCallback((cues: Array<Omit<PetPerformanceCue, 'id'>> | null | undefined) => {
    if (performanceCueTimerRef.current) {
      window.clearTimeout(performanceCueTimerRef.current)
      performanceCueTimerRef.current = null
    }

    performanceCueQueueRef.current = []
    setPetPerformanceCue(null)

    if (!cues?.length) {
      return
    }

    performanceCueQueueRef.current = cues.map((cue) => ({
      ...cue,
      id: createId('pet-cue'),
    }))

    playNextPetPerformanceCue()
  }, [playNextPetPerformanceCue])

  const updatePetStatus = useCallback((text: string, duration = 2200) => {
    setPetStatusText(text)

    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
    }

    hoverTimerRef.current = window.setTimeout(() => {
      setPetStatusText(getDefaultPetStatusText(ctx.continuousVoiceActiveRef.current))
    }, duration)
  }, [ctx.continuousVoiceActiveRef])

  const dismissAmbientPresence = useCallback(() => {
    setAmbientPresence(null)
    saveAmbientPresence(null)
  }, [])

  const markPresenceActivity = useCallback((options?: { dismissAmbient?: boolean }) => {
    savePresenceActivityAt(Date.now())
    proactivePresenceDeferredUntilRef.current = 0

    if (options?.dismissAmbient ?? true) {
      dismissAmbientPresence()
    }
  }, [dismissAmbientPresence])

  const publishAmbientPresence = useCallback((line: PresenceLine, duration = PROACTIVE_PRESENCE_DURATION_MS) => {
    const now = Date.now()
    const nextPresence: AmbientPresenceState = {
      text: line.text,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + duration).toISOString(),
    }

    proactivePresenceDeferredUntilRef.current = now + duration
    saveLastProactivePresenceAt(now)
    const previousHistory = loadPresenceHistory()
    const nextHistory: PresenceHistoryItem[] = [
      {
        text: line.text,
        category: line.category,
        createdAt: nextPresence.createdAt,
      },
      ...previousHistory.map((item) => ({
        text: item.text,
        category: item.category,
        createdAt: item.createdAt,
      })),
    ].slice(0, 6)

    presenceHistoryRef.current = nextHistory.map((item) => ({
      text: item.text,
      category: item.category,
    }))
    savePresenceHistory(nextHistory)
    saveAmbientPresence(nextPresence)
    setAmbientPresence(nextPresence)
    updatePetStatus(line.text, duration)
  }, [updatePetStatus])

  // Ambient presence expiry
  useEffect(() => {
    if (!ambientPresence) return

    const remaining = Date.parse(ambientPresence.expiresAt) - Date.now()
    if (remaining <= 0) {
      dismissAmbientPresence()
      return
    }

    const timeout = window.setTimeout(() => {
      const currentPresence = loadAmbientPresence()
      if (currentPresence?.expiresAt === ambientPresence.expiresAt) {
        dismissAmbientPresence()
      }
    }, remaining)

    return () => window.clearTimeout(timeout)
  }, [ambientPresence, dismissAmbientPresence])

  // Disable proactive presence when setting is off
  useEffect(() => {
    if (ctx.settingsRef.current.proactivePresenceEnabled) return

    proactivePresenceDeferredUntilRef.current = 0
    dismissAmbientPresence()
  }, [ctx.settingsRef, dismissAmbientPresence])

  // Proactive presence interval check
  // When autonomy is enabled, this legacy random system is bypassed —
  // the proactive engine (proactiveEngine.ts) handles all ambient messages.
  useEffect(() => {
    if (ctx.view !== 'pet') return

    const interval = window.setInterval(() => {
      const now = Date.now()

      if (document.visibilityState !== 'visible') return
      if (!ctx.settingsRef.current.proactivePresenceEnabled) return
      // Autonomy proactive engine takes over when enabled
      if (ctx.settingsRef.current.autonomyEnabled) return
      if (now < proactivePresenceDeferredUntilRef.current) return
      if (loadAmbientPresence()) return

      const proactiveIntervalMs = ctx.settingsRef.current.proactivePresenceIntervalMinutes * 60_000
      if (now - loadPresenceActivityAt() < proactiveIntervalMs) return
      if (now - loadLastProactivePresenceAt() < proactiveIntervalMs) return

      if (
        ctx.busyRef.current
        || ctx.voiceStateRef.current !== 'idle'
        || ctx.continuousVoiceActiveRef.current
        || ctx.settingsOpenRef.current
        || Boolean(ctx.inputRef.current?.trim())
      ) {
        proactivePresenceDeferredUntilRef.current = now + PROACTIVE_PRESENCE_RETRY_DELAY_MS
        return
      }

      const line = buildPresenceMessage({
        settings: ctx.settingsRef.current,
        messages: ctx.messagesRef.current,
        memories: ctx.memoriesRef.current,
        mood: moodRef.current,
        recentLines: presenceHistoryRef.current,
      })

      if (!line) return

      publishAmbientPresence(line)
    }, PRESENCE_CHECK_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [
    ctx.busyRef,
    ctx.continuousVoiceActiveRef,
    ctx.inputRef,
    ctx.memoriesRef,
    ctx.messagesRef,
    ctx.settingsOpenRef,
    ctx.settingsRef,
    ctx.view,
    ctx.voiceStateRef,
    publishAmbientPresence,
  ])

  // Initialize presence activity
  useEffect(() => {
    savePresenceActivityAt(Date.now())
  }, [])

  // ── Idle animation sequence ──
  useEffect(() => {
    if (idleControllerRef.current) {
      idleControllerRef.current.stop()
    }

    const controller = createIdleSequenceController((cue) => {
      // Only queue idle animations when truly idle
      if (
        moodRef.current === 'idle'
        && !performanceCueQueueRef.current.length
        && ctx.view === 'pet'
      ) {
        queuePetPerformanceCue([cue])
      }
    })

    idleControllerRef.current = controller

    if (mood === 'idle' && ctx.view === 'pet') {
      controller.start()
    }

    return () => controller.stop()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Start/stop idle sequence based on mood
  useEffect(() => {
    const controller = idleControllerRef.current
    if (!controller) return

    if (mood === 'idle' && ctx.view === 'pet') {
      if (!controller.isRunning()) controller.start()
    } else {
      if (controller.isRunning()) controller.stop()
    }
  }, [mood, ctx.view])

  return {
    mood,
    setMood,
    moodRef,
    gazeTarget,
    setGazeTarget,
    petPerformanceCue,
    petStatusText,
    ambientPresence,
    setAmbientPresence,
    mascotHovered,
    setMascotHovered,
    petTapActive,
    setPetTapActive,
    petTouchZone,
    setPetTouchZone,
    petHotspotActive,
    setPetHotspotActive,
    presenceHistoryRef,
    updatePetStatus,
    playNextPetPerformanceCue,
    clearPetPerformanceCue,
    queuePetPerformanceCue,
    publishAmbientPresence,
    dismissAmbientPresence,
    markPresenceActivity,
  }
}
