import { useEffect, useRef } from 'react'
import {
  decideBracket,
} from '../features/proactive/bracketScheduler.ts'
import { buildBracketNotification } from '../features/proactive/bracketCopy.ts'
import {
  findUndeliveredErrands,
  markDelivered,
} from '../features/agent/errandStore.ts'
import { buildErrandDeliveryBody } from '../features/agent/errandDelivery.ts'
import {
  PROACTIVE_BRACKET_STATE_STORAGE_KEY,
  loadBracketState,
  recordBracketFire,
  writeJson,
} from '../lib/storage'
import type { AppSettings } from '../types'

const POLL_INTERVAL_MS = 5 * 60_000

type UseBracketSchedulerOptions = {
  settings: AppSettings
  /** Pause scheduling while the panel is open and visible to the user. */
  panelOpen: boolean
}

/**
 * Polls every 5 min and fires an OS notification when the local time
 * lands inside the morning (7-10) or evening (21-23) bracket window
 * AND that bracket hasn't already fired today AND the relationship
 * type doesn't opt out. Pauses while the panel is open — no point
 * notifying someone who's already looking at the companion.
 *
 * Pure decision logic lives in bracketScheduler.ts; copy in
 * bracketCopy.ts. This hook is the host wiring.
 */
export function useBracketScheduler({
  settings,
  panelOpen,
}: UseBracketSchedulerOptions) {
  const liveRef = useRef({ settings, panelOpen })
  useEffect(() => {
    liveRef.current = { settings, panelOpen }
  }, [settings, panelOpen])

  useEffect(() => {
    if (!settings.proactiveBracketEnabled) return
    if (typeof window === 'undefined') return
    if (!window.desktopPet?.showProactiveNotification) return

    const tick = async () => {
      const { settings: s, panelOpen: open } = liveRef.current
      if (!s.proactiveBracketEnabled) return
      if (open) return

      const state = loadBracketState()
      const decision = decideBracket({
        enabled: true,
        nowMs: Date.now(),
        lastMorningFiredMs: state.lastMorningFiredMs,
        lastEveningFiredMs: state.lastEveningFiredMs,
        relationshipType: s.companionRelationshipType,
      })

      if (!decision.shouldFire) return

      // Morning bracket gets the "here's what I researched overnight"
      // delivery if there's an undelivered completed errand. Evening
      // bracket runs unchanged. We only deliver one errand per morning
      // — the others wait for the next day, otherwise the user gets a
      // wall of text on heavy-queue mornings.
      const result = buildBracketNotification({
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        bracket: decision.bracket,
        previousEveningTopic: null,
        lastPicks: state.lastPicks,
      })
      let notification: { title: string; body: string } = result
      let deliveredErrandId: string | null = null
      if (decision.bracket === 'morning') {
        const undelivered = findUndeliveredErrands()
        if (undelivered.length > 0) {
          const next = undelivered[0]
          notification = {
            title: notification.title,
            body: buildErrandDeliveryBody({
              uiLanguage: s.uiLanguage,
              companionName: s.companionName,
              prompt: next.prompt,
              result: next.result ?? '',
            }),
          }
          deliveredErrandId = next.id
        }
      }

      try {
        await window.desktopPet?.showProactiveNotification?.(notification)
        const fresh = loadBracketState()
        const updated = recordBracketFire(fresh, decision.bracket, Date.now())
        updated.lastPicks = { ...fresh.lastPicks, ...result.pickedIndices }
        writeJson(PROACTIVE_BRACKET_STATE_STORAGE_KEY, updated)
        if (deliveredErrandId) {
          markDelivered(deliveredErrandId)
        }
      } catch (err) {
        console.warn('[bracket] fire failed:', err)
      }
    }

    void tick()
    const id = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [settings.proactiveBracketEnabled])
}
