import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetExpressionSlot } from '../models'
import type { GazeTarget } from '../components/live2d/types'
import type { SpeechLevelSource } from '../../../types/index.ts'
import { getRedactedLogErrorMessage } from '../../../lib/logRedaction'

const LEGACY_STORAGE_KEY = 'nexus:vts-auth-token'

type VTSBridgeState = 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'

type VTSBridgeInput = {
  expressionSlot: PetExpressionSlot
  speechLevel: number
  gazeTarget: GazeTarget
  isSpeaking: boolean
  isListening: boolean
}

export function useVTSBridge(
  enabled: boolean,
  port: number,
  speechLevelSource?: SpeechLevelSource,
) {
  const [state, setState] = useState<VTSBridgeState>('disconnected')
  const [modelName, setModelName] = useState('')
  const inputRef = useRef<VTSBridgeInput>({
    expressionSlot: 'idle',
    speechLevel: 0,
    gazeTarget: { x: 0, y: 0 },
    isSpeaking: false,
    isListening: false,
  })
  const lastInputSignatureRef = useRef('')

  const updateInput = useCallback((input: Partial<VTSBridgeInput>) => {
    const nextInput = {
      ...inputRef.current,
      ...input,
      gazeTarget: {
        ...inputRef.current.gazeTarget,
        ...input.gazeTarget,
      },
    }
    inputRef.current = nextInput

    const signature = [
      nextInput.expressionSlot,
      nextInput.speechLevel.toFixed(3),
      nextInput.gazeTarget.x.toFixed(3),
      nextInput.gazeTarget.y.toFixed(3),
      nextInput.isSpeaking ? '1' : '0',
      nextInput.isListening ? '1' : '0',
    ].join('|')
    if (signature === lastInputSignatureRef.current) return
    lastInputSignatureRef.current = signature

    window.desktopPet?.vtsBridgeUpdateInput?.(nextInput).catch((error) => {
      console.warn('[VTS] Failed to update bridge input:', getRedactedLogErrorMessage(error))
    })
  }, [])

  // VTS is an imperative IPC sink, so subscribe without making its PetView
  // owner render at the meter cadence. The bridge keeps the existing numeric
  // `speechLevel` payload semantics while consuming the throttled snapshot.
  useEffect(() => {
    if (!enabled || !speechLevelSource) return undefined
    const publishSnapshot = () => {
      updateInput({ speechLevel: speechLevelSource.getSnapshot() })
    }
    publishSnapshot()
    return speechLevelSource.subscribe(publishSnapshot)
  }, [enabled, speechLevelSource, updateInput])

  useEffect(() => {
    const applyStatus = (status: { state: VTSBridgeState; modelName?: string }) => {
      setState(status.state)
      setModelName(status.modelName ?? '')
    }

    window.desktopPet?.vtsBridgeStatus?.()
      .then(applyStatus)
      .catch(() => {})

    return window.desktopPet?.subscribeVtsBridgeStatus?.(applyStatus)
  }, [])

  useEffect(() => {
    if (!enabled) {
      window.desktopPet?.vtsBridgeDisconnect?.().catch(() => {})
      setState('disconnected')
      return
    }

    setState('connecting')
    void migrateLegacyAuthToken()
      .then(() => window.desktopPet?.vtsBridgeConnect?.({ port }))
      .then((status) => {
        if (!status) return
        setState(status.state)
        setModelName(status.modelName ?? '')
      })
      .catch((error) => {
        setState('error')
        console.warn('[VTS]', getRedactedLogErrorMessage(error))
      })

    return () => {
      window.desktopPet?.vtsBridgeDisconnect?.().catch(() => {})
    }
  }, [enabled, port])

  async function migrateLegacyAuthToken() {
    const legacyToken = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacyToken) return
    try {
      await window.desktopPet?.vtsBridgeMigrateLegacyToken?.(legacyToken)
    } catch (error) {
      console.warn('[VTS] Failed to migrate legacy auth token:', getRedactedLogErrorMessage(error))
    } finally {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
  }

  return { state, modelName, updateInput }
}
