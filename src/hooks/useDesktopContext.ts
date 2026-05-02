import { useCallback, useEffect } from 'react'
import {
  buildDesktopContextRequest,
} from '../features/context'
import { analyzeScreenWithVlm, disposeScreenOcrWorker, enqueueScreenOcr } from '../features/vision'
import {
  isDesktopContextActiveWindowAvailable,
  isDesktopContextClipboardAvailable,
  isDesktopContextScreenshotAvailable,
} from '../lib/platformProfile'
import type { AppSettings, DesktopContextSnapshot, PlatformProfile } from '../types'

type UseDesktopContextParams = {
  settingsRef: React.RefObject<AppSettings>
  platformProfileRef?: React.RefObject<PlatformProfile | null>
}

export function useDesktopContext({ settingsRef, platformProfileRef }: UseDesktopContextParams) {
  useEffect(() => {
    return () => {
      void disposeScreenOcrWorker()
    }
  }, [])

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
        return snapshot
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

      return enrichedSnapshot
    } catch {
      return null
    }
  }, [platformProfileRef, settingsRef])

  return {
    loadDesktopContextSnapshot,
  }
}
