import { useCallback, useEffect, useRef, useState } from 'react'
import { VTSClient } from './vtsClient'
import type { PetExpressionSlot } from '../models'
import type { GazeTarget } from '../components/live2d/types'

const NEXUS_PARAMS = [
  { id: 'NexusMouthOpen', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusMouthRound', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusMouthNarrow', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusSmile', min: -1, max: 1, defaultValue: 0 },
  { id: 'NexusCheek', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusBrowForm', min: -1, max: 1, defaultValue: 0 },
  { id: 'NexusBreath', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusAngleX', min: -30, max: 30, defaultValue: 0 },
  { id: 'NexusAngleY', min: -30, max: 30, defaultValue: 0 },
  { id: 'NexusAngleZ', min: -30, max: 30, defaultValue: 0 },
  { id: 'NexusBodyAngleX', min: -10, max: 10, defaultValue: 0 },
  { id: 'NexusEyeX', min: -1, max: 1, defaultValue: 0 },
  { id: 'NexusEyeY', min: -1, max: 1, defaultValue: 0 },
] as const

const LEGACY_STORAGE_KEY = 'nexus:vts-auth-token'
const INJECT_INTERVAL_MS = 33 // ~30fps

type VTSBridgeState = 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'

type VTSBridgeInput = {
  expressionSlot: PetExpressionSlot
  speechLevel: number
  gazeTarget: GazeTarget
  isSpeaking: boolean
  isListening: boolean
}

export function useVTSBridge(enabled: boolean, port: number) {
  const [state, setState] = useState<VTSBridgeState>('disconnected')
  const [modelName, setModelName] = useState('')
  const clientRef = useRef<VTSClient | null>(null)
  const inputRef = useRef<VTSBridgeInput>({
    expressionSlot: 'idle',
    speechLevel: 0,
    gazeTarget: { x: 0, y: 0 },
    isSpeaking: false,
    isListening: false,
  })
  const smoothedRef = useRef({ gazeX: 0, gazeY: 0, speechLevel: 0 })
  const lastExpressionRef = useRef<PetExpressionSlot>('idle')
  const hotkeyMapRef = useRef<Map<string, string>>(new Map())
  const injectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const updateInput = useCallback((input: Partial<VTSBridgeInput>) => {
    Object.assign(inputRef.current, input)
  }, [])

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.disconnect()
      clientRef.current = null
      if (injectTimerRef.current) clearInterval(injectTimerRef.current)
      setState('disconnected')
      return
    }

    setState('connecting')
    const client = new VTSClient(port, {
      onConnect: () => void initAuth(client),
      onDisconnect: () => {
        setState('disconnected')
        if (injectTimerRef.current) clearInterval(injectTimerRef.current)
      },
      onError: (err) => {
        setState('error')
        console.warn('[VTS]', err)
      },
    })
    clientRef.current = client
    client.connect()

    return () => {
      client.disconnect()
      if (injectTimerRef.current) clearInterval(injectTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, port])

  async function initAuth(client: VTSClient) {
    try {
      const stored = await loadStoredAuthToken()
      if (stored) {
        const ok = await client.authenticate(stored)
        if (ok) { await onAuthenticated(client); return }
      }
      setState('auth_needed')
      const token = await client.requestAuthToken()
      await storeAuthToken(token)
      const ok = await client.authenticate(token)
      if (!ok) { setState('error'); return }
      await onAuthenticated(client)
    } catch {
      setState('error')
    }
  }

  async function loadStoredAuthToken() {
    const legacyToken = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacyToken) {
      await storeAuthToken(legacyToken)
      return legacyToken
    }

    try {
      return await window.desktopPet?.vtsAuthTokenGet?.() ?? ''
    } catch (error) {
      console.warn('[VTS] Failed to read auth token from vault', error)
      return ''
    }
  }

  async function storeAuthToken(token: string) {
    try {
      await window.desktopPet?.vtsAuthTokenStore?.(token)
    } catch (error) {
      console.warn('[VTS] Failed to persist auth token in vault', error)
    } finally {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
  }

  async function onAuthenticated(client: VTSClient) {
    try {
      for (const param of NEXUS_PARAMS) {
        await client.createParameter(param.id, param.min, param.max, param.defaultValue)
      }

      const hotkeys = await client.getHotkeys()
      const map = new Map<string, string>()
      for (const hk of hotkeys) {
        const lower = hk.name.toLowerCase()
        map.set(lower, hk.hotkeyID)
      }
      hotkeyMapRef.current = map

      const model = await client.getCurrentModel()
      setModelName(model.modelLoaded ? model.modelName : '')

      setState('ready')
      startParameterInjection(client)
    } catch {
      setState('error')
    }
  }

  function startParameterInjection(client: VTSClient) {
    if (injectTimerRef.current) clearInterval(injectTimerRef.current)
    injectTimerRef.current = setInterval(() => {
      if (!client.authenticated) return
      const input = inputRef.current
      const smooth = smoothedRef.current
      const seconds = performance.now() / 1000

      const gazeRate = input.expressionSlot === 'thinking' ? 0.08 : 0.16
      smooth.gazeX += (input.gazeTarget.x - smooth.gazeX) * gazeRate
      smooth.gazeY += (input.gazeTarget.y - smooth.gazeY) * gazeRate

      // Rise faster than fall for snappy lip-sync
      const slTarget = input.speechLevel
      smooth.speechLevel += (slTarget - smooth.speechLevel) *
        (slTarget > smooth.speechLevel ? 0.34 : 0.2)
      const mouth = smooth.speechLevel < 0.015 ? 0 : smooth.speechLevel

      let gazeX = smooth.gazeX
      let gazeY = smooth.gazeY
      let angleZ = Math.sin(seconds * 0.95) * 0.65
      const bodyAngleX = Math.sin(seconds * 0.82) * 0.55 + gazeX * 1.9
      let smile = 0
      let cheek = 0
      let brow = 0
      let breath = 0.22 + (Math.sin(seconds * 2.1) + 1) * 0.1

      switch (input.expressionSlot) {
        case 'listening':
          angleZ += Math.sin(seconds * 3.4) * 0.9
          smile += 0.08; breath += 0.06; break
        case 'thinking':
          gazeX *= 0.35; angleZ += Math.sin(seconds * 1.8) * 2.4
          brow -= 0.18; break
        case 'speaking':
          angleZ += Math.sin(seconds * 5.8) * 0.9
          smile += 0.14 + mouth * 0.22; cheek += mouth * 0.06
          breath += 0.08; break
        case 'happy':
          angleZ += 1.8; smile += 0.18; cheek += 0.1; break
        case 'sleepy':
          gazeX *= 0.45; angleZ += Math.sin(seconds * 0.66) * 1.15
          breath -= 0.08; break
        case 'surprised':
          gazeY -= 0.08; brow += 0.15; break
        case 'confused':
          angleZ += Math.sin(seconds * 2.5) * 1.6; brow -= 0.1; break
        case 'embarrassed':
          gazeX *= 0.4; angleZ += 2.4; cheek += 0.22; smile += 0.06; break
        default: break
      }

      client.injectParameters([
        { id: 'NexusMouthOpen', value: mouth * 0.95 },
        { id: 'NexusMouthRound', value: mouth * 0.24 },
        { id: 'NexusMouthNarrow', value: mouth * 0.08 },
        { id: 'NexusSmile', value: smile },
        { id: 'NexusCheek', value: cheek },
        { id: 'NexusBrowForm', value: brow },
        { id: 'NexusBreath', value: breath },
        { id: 'NexusAngleX', value: gazeX * 18 },
        { id: 'NexusAngleY', value: gazeY * -12 },
        { id: 'NexusAngleZ', value: angleZ },
        { id: 'NexusBodyAngleX', value: bodyAngleX },
        { id: 'NexusEyeX', value: gazeX },
        { id: 'NexusEyeY', value: gazeY },
      ]).catch(() => {})

      if (input.expressionSlot !== lastExpressionRef.current) {
        lastExpressionRef.current = input.expressionSlot
        const hotkeyId = hotkeyMapRef.current.get(input.expressionSlot)
          ?? hotkeyMapRef.current.get(`nexus_${input.expressionSlot}`)
        if (hotkeyId) client.triggerHotkey(hotkeyId).catch(() => {})
      }
    }, INJECT_INTERVAL_MS)
  }

  return { state, modelName, updateInput }
}
