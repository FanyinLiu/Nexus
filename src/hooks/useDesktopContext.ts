import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildQuietObservationSummary,
  buildDesktopContextRequest,
  formatQuietObservationForPrompt,
  saveRecentCompanionSummary,
} from '../features/context'
import { analyzeScreenWithVlm, disposeScreenOcrWorker, enqueueScreenOcr } from '../features/vision'
import {
  isDesktopContextActiveWindowAvailable,
  isDesktopContextClipboardAvailable,
  isDesktopContextScreenshotAvailable,
} from '../lib/platformProfile'
import { stripDesktopContextScreenshotPayload } from '../lib/privacy/desktopContextPrivacy'
import type { AppSettings, DesktopContextSnapshot, PlatformProfile } from '../types'

type UseDesktopContextParams = {
  settingsRef: React.RefObject<AppSettings>
  platformProfileRef?: React.RefObject<PlatformProfile | null>
}

export function useDesktopContext({ settingsRef, platformProfileRef }: UseDesktopContextParams) {
  const [initialOpenAt] = useState(() => new Date().toISOString())
  const nexusOpenSinceRef = useRef(initialOpenAt)
  const lastNexusInteractionAtRef = useRef(initialOpenAt)

  useEffect(() => {
    const markNexusInteraction = () => {
      lastNexusInteractionAtRef.current = new Date().toISOString()
    }

    document.addEventListener('pointerdown', markNexusInteraction, { capture: true })
    document.addEventListener('keydown', markNexusInteraction, { capture: true })
    document.addEventListener('touchstart', markNexusInteraction, { capture: true })

    return () => {
      document.removeEventListener('pointerdown', markNexusInteraction, { capture: true })
      document.removeEventListener('keydown', markNexusInteraction, { capture: true })
      document.removeEventListener('touchstart', markNexusInteraction, { capture: true })
      void disposeScreenOcrWorker()
    }
  }, [])

  const withCompanionAwareness = useCallback((contentSnapshot: DesktopContextSnapshot | null): DesktopContextSnapshot | null => {
    if (!contentSnapshot) return null

    const summary = buildQuietObservationSummary({
      enabled: Boolean(settingsRef.current.contextAwarenessEnabled),
      paused: !settingsRef.current.contextAwarenessEnabled
        || settingsRef.current.companionAwarenessPaused,
      nexusOpenSince: nexusOpenSinceRef.current,
      lastNexusInteractionAt: lastNexusInteractionAtRef.current,
      activeWindowTitle: contentSnapshot.activeWindowTitle,
      uiLanguage: settingsRef.current.uiLanguage,
    })
    const companionAwarenessSummary = formatQuietObservationForPrompt(summary)

    if (!companionAwarenessSummary) return contentSnapshot
    saveRecentCompanionSummary(summary!)
    return {
      ...contentSnapshot,
      companionAwarenessSummary,
    }
  }, [settingsRef])

  const loadDesktopContextSnapshot = useCallback(async (): Promise<DesktopContextSnapshot | null> => {
    const currentSettings = settingsRef.current
    if (!currentSettings.contextAwarenessEnabled) return null

    const platformProfile = platformProfileRef?.current ?? null
    const includeActiveWindow = currentSettings.activeWindowContextEnabled
      && isDesktopContextActiveWindowAvailable(platformProfile)
    const includeClipboard = currentSettings.clipboardContextEnabled
      && isDesktopContextClipboardAvailable(platformProfile)
    const includeScreenshot = currentSettings.screenContextEnabled
      && isDesktopContextScreenshotAvailable(platformProfile)

    if (!includeActiveWindow && !includeClipboard && !includeScreenshot) {
      return null
    }

    if (!window.desktopPet?.getDesktopContext) {
      return null
    }

    try {
      const desktopContextRequest = {
        ...buildDesktopContextRequest({
          includeActiveWindow,
          includeClipboard,
          includeScreenshot,
        }),
        policy: {
          activeWindow: includeActiveWindow,
          clipboard: includeClipboard,
          screenshot: includeScreenshot,
        },
      }
      const snapshot = await window.desktopPet.getDesktopContext(desktopContextRequest)

      if (
        !snapshot
        || !includeScreenshot
        || !snapshot.screenshotDataUrl
      ) {
        const strippedSnapshot = stripDesktopContextScreenshotPayload(snapshot)
        return withCompanionAwareness(strippedSnapshot)
      }

      let enrichedSnapshot = snapshot

      const ocrPromise = (async () => {
        try {
          return await enqueueScreenOcr(
            snapshot.screenshotDataUrl!,
            currentSettings.screenOcrLanguage,
          )
        } catch (error) {
          console.warn('[screen-ocr] failed to recognize screenshot text', error)
          return undefined
        }
      })()

      const vlmEnabled = currentSettings.screenVlmEnabled
        && currentSettings.screenVlmBaseUrl
        && currentSettings.screenVlmModel

      const vlmPromise = vlmEnabled
        ? (async () => {
            try {
              return await analyzeScreenWithVlm(snapshot.screenshotDataUrl!, {
                providerId: currentSettings.screenVlmProviderId,
                baseUrl: currentSettings.screenVlmBaseUrl,
                apiKey: currentSettings.screenVlmApiKey,
                model: currentSettings.screenVlmModel,
              })
            } catch (error) {
              console.warn('[screen-vlm] failed to analyze screenshot', error)
              return undefined
            }
          })()
        : Promise.resolve(undefined)

      const [screenText, vlmAnalysis] = await Promise.all([ocrPromise, vlmPromise])

      if (screenText) {
        enrichedSnapshot = { ...enrichedSnapshot, screenText }
      }

      if (vlmAnalysis) {
        enrichedSnapshot = { ...enrichedSnapshot, vlmAnalysis }
      }

      const strippedEnrichedSnapshot = stripDesktopContextScreenshotPayload(enrichedSnapshot)
      return withCompanionAwareness(strippedEnrichedSnapshot)
    } catch {
      return null
    }
  }, [platformProfileRef, settingsRef, withCompanionAwareness])

  return {
    loadDesktopContextSnapshot,
  }
}
