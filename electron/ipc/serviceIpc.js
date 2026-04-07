import { BrowserWindow, ipcMain } from 'electron'
import * as funasrStream from '../services/funasrStream.js'
import * as tencentAsr from '../services/tencentAsr.js'
import * as minecraftGateway from '../services/minecraftGateway.js'
import * as factorioRcon from '../services/factorioRcon.js'
import * as realtimeVoice from '../services/realtimeVoice.js'

export function register() {
  // ── FunASR Streaming STT ──

  ipcMain.handle('funasr:connect', async (_event, payload) => {
    const baseUrl = String(payload?.baseUrl ?? '').trim()
    await funasrStream.connect(baseUrl)
    return funasrStream.getStatus()
  })

  ipcMain.handle('funasr:disconnect', async () => {
    await funasrStream.disconnect()
    return { ok: true }
  })

  ipcMain.handle('funasr:start-stream', (_event, payload) => {
    funasrStream.startStream(payload)
    return { ok: true }
  })

  ipcMain.handle('funasr:feed', (_event, payload) => {
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    funasrStream.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('funasr:finish', async () => {
    const text = await funasrStream.finishStream()
    return { text }
  })

  ipcMain.handle('funasr:abort', () => {
    funasrStream.abortStream()
    return { ok: true }
  })

  ipcMain.handle('funasr:status', () => funasrStream.getStatus())

  // ── Tencent Cloud Real-Time ASR ──

  ipcMain.handle('tencent-asr:connect', async (_event, payload) => {
    await tencentAsr.connect({
      appId: String(payload?.appId ?? '').trim(),
      secretId: String(payload?.secretId ?? '').trim(),
      secretKey: String(payload?.secretKey ?? '').trim(),
      engineModelType: String(payload?.engineModelType ?? '16k_zh').trim(),
      hotwordList: String(payload?.hotwordList ?? '').trim(),
    })
    return tencentAsr.getStatus()
  })

  ipcMain.handle('tencent-asr:feed', (_event, payload) => {
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    tencentAsr.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('tencent-asr:finish', async () => {
    const text = await tencentAsr.finishStream()
    return { text }
  })

  ipcMain.handle('tencent-asr:abort', () => {
    tencentAsr.abortStream()
    return { ok: true }
  })

  ipcMain.handle('tencent-asr:disconnect', async () => {
    await tencentAsr.disconnect()
    return { ok: true }
  })

  ipcMain.handle('tencent-asr:status', () => tencentAsr.getStatus())

  // ── Minecraft Gateway ──

  ipcMain.handle('minecraft:connect', async (_event, payload) => {
    const address = String(payload?.address ?? '').trim()
    const port = Number(payload?.port ?? 19131)
    const username = String(payload?.username ?? '').trim()
    await minecraftGateway.connect(address, port, username)
    return minecraftGateway.getStatus()
  })

  ipcMain.handle('minecraft:disconnect', async () => {
    await minecraftGateway.disconnect()
    return { ok: true }
  })

  ipcMain.handle('minecraft:send-command', (_event, payload) => {
    minecraftGateway.sendCommand(String(payload?.command ?? ''))
    return { ok: true }
  })

  ipcMain.handle('minecraft:status', () => minecraftGateway.getStatus())

  ipcMain.handle('minecraft:game-context', () => minecraftGateway.getGameContext())

  // ── Factorio RCON ──

  ipcMain.handle('factorio:connect', async (_event, payload) => {
    const address = String(payload?.address ?? '').trim()
    const port = Number(payload?.port ?? 34197)
    const password = String(payload?.password ?? '').trim()
    await factorioRcon.connect(address, port, password)
    return factorioRcon.getStatus()
  })

  ipcMain.handle('factorio:disconnect', async () => {
    await factorioRcon.disconnect()
    return { ok: true }
  })

  ipcMain.handle('factorio:execute', async (_event, payload) => {
    const command = String(payload?.command ?? '')
    const response = await factorioRcon.execute(command)
    return { response }
  })

  ipcMain.handle('factorio:status', () => factorioRcon.getStatus())

  ipcMain.handle('factorio:game-context', () => factorioRcon.getGameContext())

  // ── Realtime Voice (OpenAI Realtime API) ──

  realtimeVoice.onRealtimeEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('realtime:event', event)
    }
  })

  ipcMain.handle('realtime:start', (_event, payload) => realtimeVoice.startSession(payload))
  ipcMain.handle('realtime:stop', () => realtimeVoice.stopSession())
  ipcMain.handle('realtime:feed', (_event, payload) => {
    realtimeVoice.feedAudio(payload.samples)
    return { ok: true }
  })
  ipcMain.handle('realtime:interrupt', () => {
    realtimeVoice.interrupt()
    return { ok: true }
  })
  ipcMain.handle('realtime:send-text', (_event, payload) => {
    realtimeVoice.sendTextMessage(payload.text)
    return { ok: true }
  })
  ipcMain.handle('realtime:state', () => realtimeVoice.getState())
}
