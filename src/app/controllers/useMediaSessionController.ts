import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import type { ChatMessageTone, MediaSessionSnapshot } from '../../types'

type UseMediaSessionControllerOptions = {
  view: 'pet' | 'panel'
  appendSystemMessage: (content: string, tone?: ChatMessageTone) => void
}

export function useMediaSessionController({
  view,
  appendSystemMessage,
}: UseMediaSessionControllerOptions) {
  const { t } = useTranslation()
  const [mediaSession, setMediaSession] = useState<MediaSessionSnapshot | null>(null)
  const [musicActionBusy, setMusicActionBusy] = useState(false)
  const [dismissedMusicSessionKey, setDismissedMusicSessionKey] = useState('')
  const [pollingActive, setPollingActive] = useState(false)

  const refreshMediaSession = useCallback(async () => {
    if (!window.desktopPet?.getSystemMediaSession) {
      return null
    }

    try {
      const snapshot = await window.desktopPet.getSystemMediaSession()
      if (!snapshot || snapshot.ok === false || !snapshot.hasSession) {
        return null
      }

      return snapshot
    } catch {
      return null
    }
  }, [])

  const handleMediaSessionControl = useCallback(async (
    action: 'play' | 'pause' | 'toggle' | 'next' | 'previous',
  ) => {
    if (!window.desktopPet?.controlSystemMediaSession) {
      return
    }

    setMusicActionBusy(true)
    setPollingActive(true)

    try {
      const result = await window.desktopPet.controlSystemMediaSession({ action })
      if (result.ok !== true && result.message) {
        appendSystemMessage(t('chat.media_session.control_noop', { reason: result.message }), 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('chat.media_session.control_failed_generic')
      appendSystemMessage(t('chat.media_session.control_failed_system', { error: errorMessage }), 'error')
    } finally {
      const snapshot = await refreshMediaSession()
      setMediaSession(snapshot)
      setMusicActionBusy(false)
    }
  }, [appendSystemMessage, refreshMediaSession, t])

  useEffect(() => {
    if (view !== 'pet' || !pollingActive) {
      setMediaSession(null)
      return
    }

    let disposed = false
    let timerId: number | null = null

    const poll = async () => {
      const snapshot = await refreshMediaSession()
      if (disposed) {
        return
      }

      setMediaSession(snapshot)

      if (!snapshot?.hasSession) {
        setPollingActive(false)
        return
      }

      const nextDelay = snapshot?.isPlaying ? 1_400 : 2_600
      timerId = window.setTimeout(() => {
        void poll()
      }, nextDelay)
    }

    void poll()

    return () => {
      disposed = true
      if (timerId !== null) {
        window.clearTimeout(timerId)
      }
    }
  }, [refreshMediaSession, view, pollingActive])

  useEffect(() => {
    if (mediaSession?.sessionKey || !dismissedMusicSessionKey) {
      return
    }

    setDismissedMusicSessionKey('')
  }, [dismissedMusicSessionKey, mediaSession])

  const dismissCurrentMediaSession = useCallback(() => {
    const activeMediaSessionKey = mediaSession?.sessionKey
      ?? [mediaSession?.sourceAppUserModelId, mediaSession?.title, mediaSession?.artist]
        .filter((value): value is string => Boolean(value))
        .join('|')

    if (!activeMediaSessionKey) {
      return
    }

    setDismissedMusicSessionKey(activeMediaSessionKey)
  }, [mediaSession])

  const startMediaPolling = useCallback(() => {
    setDismissedMusicSessionKey('')
    setPollingActive(true)
  }, [])

  return {
    mediaSession,
    musicActionBusy,
    dismissedMusicSessionKey,
    handleMediaSessionControl,
    dismissCurrentMediaSession,
    startMediaPolling,
  }
}
