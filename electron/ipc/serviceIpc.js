import { BrowserWindow, ipcMain } from 'electron'
import * as tencentAsr from '../services/tencentAsr.js'
import * as minecraftGateway from '../services/minecraftGateway.js'
import * as factorioRcon from '../services/factorioRcon.js'
import { requireTrustedSender } from './validate.js'

const realtimeVoiceEnabled = process.env.NEXUS_ENABLE_REALTIME_VOICE === '1'
let realtimeVoicePromise = null

function loadRealtimeVoice() {
  if (!realtimeVoiceEnabled) return Promise.resolve(null)
  if (!realtimeVoicePromise) {
    realtimeVoicePromise = import('../services/realtimeVoice.js').catch((err) => {
      realtimeVoicePromise = null
      throw err
    })
  }
  return realtimeVoicePromise
}

export function register() {
  // ── Tencent Cloud Real-Time ASR ──

  ipcMain.handle('tencent-asr:connect', async (event, payload) => {
    requireTrustedSender(event)
    await tencentAsr.connect({
      appId: String(payload?.appId ?? '').trim(),
      secretId: String(payload?.secretId ?? '').trim(),
      secretKey: String(payload?.secretKey ?? '').trim(),
      engineModelType: String(payload?.engineModelType ?? '16k_zh').trim(),
      hotwordList: String(payload?.hotwordList ?? '').trim(),
    })
    return tencentAsr.getStatus()
  })

  ipcMain.handle('tencent-asr:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { ok: true }
    if (samples.length > 320000) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    tencentAsr.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('tencent-asr:finish', async (event) => {
    requireTrustedSender(event)
    const text = await tencentAsr.finishStream()
    return { text }
  })

  ipcMain.handle('tencent-asr:abort', (event) => {
    requireTrustedSender(event)
    tencentAsr.abortStream()
    return { ok: true }
  })

  ipcMain.handle('tencent-asr:disconnect', async (event) => {
    requireTrustedSender(event)
    await tencentAsr.disconnect()
    return { ok: true }
  })

  ipcMain.handle('tencent-asr:status', (event) => {
    requireTrustedSender(event)
    return tencentAsr.getStatus()
  })

  // ── Minecraft Gateway ──

  ipcMain.handle('minecraft:connect', async (event, payload) => {
    requireTrustedSender(event)
    const address = String(payload?.address ?? '').trim()
    const port = Number(payload?.port ?? 19131)
    const username = String(payload?.username ?? '').trim()
    await minecraftGateway.connect(address, port, username)
    return minecraftGateway.getStatus()
  })

  ipcMain.handle('minecraft:disconnect', async (event) => {
    requireTrustedSender(event)
    await minecraftGateway.disconnect()
    return { ok: true }
  })

  ipcMain.handle('minecraft:send-command', (event, payload) => {
    requireTrustedSender(event)
    minecraftGateway.sendCommand(String(payload?.command ?? ''))
    return { ok: true }
  })

  ipcMain.handle('minecraft:status', (event) => {
    requireTrustedSender(event)
    return minecraftGateway.getStatus()
  })

  ipcMain.handle('minecraft:game-context', (event) => {
    requireTrustedSender(event)
    return minecraftGateway.getGameContext()
  })

  // ── Factorio RCON ──

  ipcMain.handle('factorio:connect', async (event, payload) => {
    requireTrustedSender(event)
    const address = String(payload?.address ?? '').trim()
    const port = Number(payload?.port ?? 34197)
    const password = String(payload?.password ?? '').trim()
    await factorioRcon.connect(address, port, password)
    return factorioRcon.getStatus()
  })

  ipcMain.handle('factorio:disconnect', async (event) => {
    requireTrustedSender(event)
    await factorioRcon.disconnect()
    return { ok: true }
  })

  ipcMain.handle('factorio:execute', async (event, payload) => {
    requireTrustedSender(event)
    const command = String(payload?.command ?? '')
    const response = await factorioRcon.execute(command)
    return { response }
  })

  ipcMain.handle('factorio:status', (event) => {
    requireTrustedSender(event)
    return factorioRcon.getStatus()
  })

  ipcMain.handle('factorio:game-context', (event) => {
    requireTrustedSender(event)
    return factorioRcon.getGameContext()
  })

  if (realtimeVoiceEnabled) {
    // ── Realtime Voice (OpenAI Realtime API) ──

    loadRealtimeVoice().then((realtimeVoice) => {
      realtimeVoice?.onRealtimeEvent((event) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('realtime:event', event)
        }
      })
    }).catch((err) => {
      console.warn('[realtime] failed to initialize:', err?.message ?? err)
    })

    ipcMain.handle('realtime:start', async (event, payload) => {
      requireTrustedSender(event)
      const realtimeVoice = await loadRealtimeVoice()
      return realtimeVoice.startSession(payload)
    })
    ipcMain.handle('realtime:stop', async (event) => {
      requireTrustedSender(event)
      const realtimeVoice = await loadRealtimeVoice()
      return realtimeVoice.stopSession()
    })
    ipcMain.handle('realtime:feed', async (event, payload) => {
      requireTrustedSender(event)
      const samples = payload.samples
      if (samples && !(Array.isArray(samples) || samples instanceof Float32Array)) return { ok: true }
      if (samples && samples.length > 320000) return { ok: true }
      const realtimeVoice = await loadRealtimeVoice()
      realtimeVoice.feedAudio(samples)
      return { ok: true }
    })
    ipcMain.handle('realtime:interrupt', async (event) => {
      requireTrustedSender(event)
      const realtimeVoice = await loadRealtimeVoice()
      realtimeVoice.interrupt()
      return { ok: true }
    })
    ipcMain.handle('realtime:send-text', async (event, payload) => {
      requireTrustedSender(event)
      const realtimeVoice = await loadRealtimeVoice()
      realtimeVoice.sendTextMessage(payload.text)
      return { ok: true }
    })
    ipcMain.handle('realtime:state', async (event) => {
      requireTrustedSender(event)
      const realtimeVoice = await loadRealtimeVoice()
      return realtimeVoice.getState()
    })
  }
}
