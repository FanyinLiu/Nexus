/**
 * Voice auto-detect probe. Returns hardware facts and, when asked, a
 * short SenseVoice timing. Failures become a payload the renderer can
 * turn into the low tier. This handler does not download models.
 */

import { app, ipcMain, powerMonitor } from 'electron'
import fs from 'node:fs'
import { requireTrustedSender } from './validate.js'
import { validateVoiceProfileProbePayload } from './voicePayloadSchemas.js'
import { collectHardwareFacts } from '../services/hardwareProbe.js'
import { runVoiceBenchmark } from '../services/voiceBenchmark.js'
import { normalizeBenchmarkStatus } from '../../shared/voiceProfileBudget.js'

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function publicHardware(facts) {
  if (!facts) return null
  return {
    platform: typeof facts.platform === 'string' ? facts.platform : null,
    arch: typeof facts.arch === 'string' ? facts.arch : null,
    release: typeof facts.release === 'string' ? facts.release : null,
    logicalCores: finiteOrNull(facts.logicalCores),
    cpuModel: typeof facts.cpuModel === 'string' ? facts.cpuModel : null,
    totalMemBytes: finiteOrNull(facts.totalMemBytes),
    freeMemBytes: finiteOrNull(facts.freeMemBytes),
    freeDiskBytes: finiteOrNull(facts.freeDiskBytes),
    onBattery: typeof facts.onBattery === 'boolean' ? facts.onBattery : null,
    gpuVendorId: finiteOrNull(facts.gpuVendorId),
    gpuDeviceId: finiteOrNull(facts.gpuDeviceId),
  }
}

async function readUserDataDisk() {
  const target = app.getPath('userData')
  const stat = await fs.promises.statfs(target)
  const bytes = Number(stat.bavail) * Number(stat.bsize)
  return Number.isFinite(bytes) ? bytes : null
}

async function readGpu() {
  const info = await Promise.race([
    app.getGPUInfo('complete').catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 800)),
  ])
  const device = info?.gpuDevice?.[0]
  if (!device) return null
  return { vendorId: device.vendorId ?? null, deviceId: device.deviceId ?? null }
}

export function register() {
  ipcMain.handle('voice-profile:probe', async (event, payload) => {
    requireTrustedSender(event)
    const parsed = validateVoiceProfileProbePayload(payload)
    const wantBenchmark = parsed?.benchmark === true
    try {
      const hardwareBudget = await collectHardwareFacts({
        readDisk: () => readUserDataDisk().catch(() => null),
        readGpu: () => readGpu().catch(() => null),
        readBattery: async () => {
          try {
            return powerMonitor.isOnBatteryPower()
          } catch {
            return null
          }
        },
      })
      if (!hardwareBudget.ok || !hardwareBudget.value) {
        return {
          ok: true,
          probeTimedOut: true,
          hardware: null,
          benchmark: { status: 'not-run', sttRtf: null },
        }
      }
      const benchmark = wantBenchmark
        ? normalizeBenchmarkStatus(await runVoiceBenchmark())
        : { status: 'not-run', sttRtf: null }
      return {
        ok: true,
        probeTimedOut: false,
        hardware: publicHardware(hardwareBudget.value),
        benchmark,
      }
    } catch {
      return {
        ok: false,
        probeTimedOut: false,
        hardware: null,
        benchmark: { status: 'error', sttRtf: null },
      }
    }
  })
}
