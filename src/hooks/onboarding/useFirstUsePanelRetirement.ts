/**
 * One-time retirement of the transient first-use panel.
 *
 * The hook owns the timers, refs and event listeners; the decision itself is
 * pure (`shouldRetireFirstUsePanel`). A hidden pristine panel is destroyed by
 * the main process, so the request is two-phase: the first close starts a
 * pending confirmation, and the main process sends a nonce back for a fresh
 * safety check before destroying the window.
 */
import { useCallback, useEffect, useRef } from 'react'

import {
  hasOpenFirstUsePanelTransientSurface,
  shouldRetireFirstUsePanel,
  type FirstUsePanelSurfaceQuery,
} from '../../features/onboarding/firstUseGuideHost.ts'

const RETIRE_CONFIRMATION_DELAY_MS = 250

type ClosePanelOptions = { retireFirstUse: true; nonce?: string }
type ClosePanel = (options: ClosePanelOptions) => Promise<unknown> | undefined
type BooleanRef = { current: boolean }

export type UseFirstUsePanelRetirementOptions = {
  /** True only in the panel whose launch was still onboarding-pending. */
  enabled: boolean
  onboardingPending: boolean
  onboardingOpen: boolean
  settingsOpen: boolean
  busy: boolean
  busyRef?: BooleanRef
  hasDraft: boolean
  hasPendingImage: boolean
  hasUserMessage: boolean
  voiceState?: string
  continuousVoiceActive?: boolean
  continuousVoiceActiveRef?: BooleanRef
  petRuntimeContinuousVoiceActive?: boolean
  /** Required: an offline pet owns reminder fallback, so the panel must stay. */
  petRuntimeOnline: boolean
  closePanel?: ClosePanel
  /** Test seam; production reads the document. */
  surfaceRoot?: () => FirstUsePanelSurfaceQuery | null
}

export function useFirstUsePanelRetirement({
  enabled,
  onboardingPending,
  onboardingOpen,
  settingsOpen,
  busy,
  busyRef,
  hasDraft,
  hasPendingImage,
  hasUserMessage,
  voiceState,
  continuousVoiceActive,
  continuousVoiceActiveRef,
  petRuntimeContinuousVoiceActive,
  petRuntimeOnline,
  closePanel,
  surfaceRoot,
}: UseFirstUsePanelRetirementOptions) {
  const pristineRef = useRef(false)
  const eligibleRef = useRef(false)
  const requestNonceRef = useRef<string | null>(null)
  const confirmTimerRef = useRef<number | null>(null)
  const previousPendingRef = useRef(onboardingPending)
  const retireIfHiddenRef = useRef<() => void>(() => {})
  const handleRetireCheckRef = useRef<(payload: { nonce?: unknown }) => void>(() => {})

  const requestClose = useCallback((options: ClosePanelOptions) => {
    const invoke = closePanel
      ?? ((next: ClosePanelOptions) => window.desktopPet?.closePanel?.(next))
    void invoke(options)?.catch(() => undefined)
  }, [closePanel])
  const hasOpenSurface = useCallback(() => hasOpenFirstUsePanelTransientSurface(
    surfaceRoot
      ? surfaceRoot()
      : (typeof document === 'undefined' ? null : document),
  ), [surfaceRoot])
  const voiceActiveNow = useCallback(() => (
    (voiceState ?? 'idle') !== 'idle'
    || continuousVoiceActiveRef?.current === true
    || continuousVoiceActive === true
    || petRuntimeContinuousVoiceActive === true
  ), [
    continuousVoiceActive,
    continuousVoiceActiveRef,
    petRuntimeContinuousVoiceActive,
    voiceState,
  ])

  useEffect(() => {
    const wasPending = previousPendingRef.current
    previousPendingRef.current = onboardingPending
    if (enabled && wasPending && !onboardingPending) {
      eligibleRef.current = true
    }
  }, [enabled, onboardingPending])

  useEffect(() => {
    const pristine = shouldRetireFirstUsePanel({
      firstUsePanel: enabled,
      onboardingPending,
      onboardingOpen,
      settingsOpen,
      busy,
      hasDraft,
      hasPendingImage,
      hasUserMessage,
      voiceActive: voiceActiveNow(),
      petRuntimeOnline,
    })
    pristineRef.current = pristine
    if (!pristine) eligibleRef.current = false

    retireIfHiddenRef.current = () => {
      if (!enabled || document.visibilityState !== 'hidden') return
      if (!eligibleRef.current) return
      // The first hide after completion consumes the one-time eligibility even
      // when the panel is not pristine. A later empty state must never re-arm it.
      eligibleRef.current = false
      if (!pristineRef.current || busyRef?.current === true || voiceActiveNow()) return
      if (hasOpenSurface()) return
      requestClose({ retireFirstUse: true })
    }
    handleRetireCheckRef.current = (payload) => {
      const nonce = typeof payload?.nonce === 'string' ? payload.nonce : ''
      if (!nonce || requestNonceRef.current) return
      requestNonceRef.current = nonce
      confirmTimerRef.current = window.setTimeout(() => {
        if (requestNonceRef.current !== nonce) return
        const safe = pristineRef.current
          && busyRef?.current !== true
          && !voiceActiveNow()
          && document.visibilityState === 'hidden'
          && !hasOpenSurface()
        requestNonceRef.current = null
        confirmTimerRef.current = null
        if (!safe) return
        requestClose({ retireFirstUse: true, nonce })
      }, RETIRE_CONFIRMATION_DELAY_MS)
    }
    retireIfHiddenRef.current()
  }, [
    busy,
    busyRef,
    enabled,
    hasDraft,
    hasOpenSurface,
    hasPendingImage,
    hasUserMessage,
    onboardingOpen,
    onboardingPending,
    petRuntimeOnline,
    requestClose,
    settingsOpen,
    voiceActiveNow,
  ])

  useEffect(() => {
    if (!enabled) return undefined
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data as { type?: unknown, nonce?: unknown } | null
      if (data?.type !== 'nexus:first-use-panel-retire-check') return
      handleRetireCheckRef.current({ nonce: data.nonce })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    const handleVisibilityChange = () => retireIfHiddenRef.current()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [enabled])

  useEffect(() => () => {
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    requestNonceRef.current = null
  }, [])
}
