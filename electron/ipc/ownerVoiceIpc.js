// @ts-check
import { ipcMain } from 'electron'

import { requireTrustedSender } from './validate.js'
import { validateSamplesPayload } from './ownerVoicePayload.js'
import {
  OWNER_VOICE_MAX_SECONDS,
  OWNER_VOICE_SAMPLE_RATE,
  getOwnerVoiceLock,
  rmsOf,
} from '../services/ownerVoiceLock.js'

/** One renderer frame is 2048 samples; allow a few seconds of slack. */
const LEVEL_MAX_SAMPLES = OWNER_VOICE_SAMPLE_RATE * 5
const ENROLL_MAX_SAMPLES = OWNER_VOICE_SAMPLE_RATE * (OWNER_VOICE_MAX_SECONDS + 1)

export function register() {
  const lock = getOwnerVoiceLock()

  ipcMain.handle('owner-voice:status', (event) => {
    requireTrustedSender(event)
    return lock.getStatus()
  })

  ipcMain.handle('owner-voice:enroll', (event, payload) => {
    requireTrustedSender(event)
    const samples = validateSamplesPayload(payload, ENROLL_MAX_SAMPLES)
    if (!samples) {
      return { ok: false, reason: /** @type {const} */ ('too_short'), voicedSeconds: 0 }
    }
    return lock.enroll(samples)
  })

  ipcMain.handle('owner-voice:clear', (event) => {
    requireTrustedSender(event)
    return lock.clear()
  })

  // Barge-in monitor: how loud is the owner in this frame? `reset` opens a
  // new monitor so the previous one's stream state does not carry over.
  ipcMain.handle('owner-voice:level', (event, payload) => {
    requireTrustedSender(event)
    const samples = validateSamplesPayload(payload, LEVEL_MAX_SAMPLES)
    if (!samples) return { rms: 0, isolated: false }
    if (/** @type {{ reset?: unknown }} */ (payload).reset === true) lock.resetChannel('interrupt')
    const result = lock.process('interrupt', samples)
    return { rms: rmsOf(result.samples), isolated: result.isolated }
  })
}
