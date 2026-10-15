/**
 * Local hardware snapshot for voice-tier selection.
 *
 * Each signal is isolated. A disk, GPU, or battery read that throws or
 * hangs becomes null and cannot reject the probe. The whole call is
 * capped by the shared voice-probe budget.
 */

import os from 'node:os'
import fs from 'node:fs'
import { MAX_VOICE_PROBE_MS, runWithBudget } from '../../shared/voiceProfileBudget.js'

function emptyFacts() {
  return {
    platform: null,
    arch: null,
    release: null,
    logicalCores: null,
    cpuModel: null,
    totalMemBytes: null,
    freeMemBytes: null,
    freeDiskBytes: null,
    onBattery: null,
    gpuVendorId: null,
    gpuDeviceId: null,
  }
}

/**
 * Free bytes on the temp volume. Callers in Electron pass userData
 * instead. A missing statfs or a bad result is null, not an exception.
 * @param {string} [directory]
 */
export async function readFreeDiskBytes(directory = os.tmpdir()) {
  const statfs = fs.promises.statfs
  if (typeof statfs !== 'function') return null
  const stat = await statfs(directory)
  const bytes = Number(stat.bavail) * Number(stat.bsize)
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null
}

/**
 * @param {{
 *   os?: { release?: () => string, availableParallelism?: () => number, cpus?: () => Array<{ model?: string }>, totalmem?: () => number, freemem?: () => number },
 *   platform?: string,
 *   arch?: string,
 *   readDisk?: (signal: AbortSignal) => Promise<number | null>,
 *   readGpu?: (signal: AbortSignal) => Promise<{ vendorId?: unknown, deviceId?: unknown } | null>,
 *   readBattery?: (signal: AbortSignal) => Promise<boolean | null>,
 * }} [deps]
 * @param {{ budgetMs?: number }} [options]
 */
export async function collectHardwareFacts(deps = {}, options = {}) {
  const osApi = deps.os ?? os
  const readDisk = deps.readDisk ?? (() => readFreeDiskBytes())
  const readGpu = deps.readGpu ?? (async () => null)
  const readBattery = deps.readBattery ?? (async () => null)
  const budgetMs = options.budgetMs ?? MAX_VOICE_PROBE_MS

  return runWithBudget(async (signal) => {
    const facts = emptyFacts()
    try { facts.platform = deps.platform ?? process.platform } catch { facts.platform = null }
    try { facts.arch = deps.arch ?? process.arch } catch { facts.arch = null }
    try { facts.release = typeof osApi.release === 'function' ? osApi.release() : null } catch { facts.release = null }
    try {
      const cores = typeof osApi.availableParallelism === 'function'
        ? osApi.availableParallelism()
        : (typeof osApi.cpus === 'function' ? osApi.cpus().length : null)
      facts.logicalCores = Number.isFinite(cores) ? cores : null
      const model = typeof osApi.cpus === 'function' ? osApi.cpus()[0]?.model : null
      facts.cpuModel = typeof model === 'string' && model.trim() ? model.trim() : null
    } catch {
      facts.logicalCores = null
      facts.cpuModel = null
    }
    try {
      const total = typeof osApi.totalmem === 'function' ? osApi.totalmem() : null
      const free = typeof osApi.freemem === 'function' ? osApi.freemem() : null
      facts.totalMemBytes = Number.isFinite(total) ? total : null
      facts.freeMemBytes = Number.isFinite(free) ? free : null
    } catch {
      facts.totalMemBytes = null
      facts.freeMemBytes = null
    }
    if (!signal.aborted) {
      try { facts.freeDiskBytes = await readDisk(signal) } catch { facts.freeDiskBytes = null }
    }
    if (!signal.aborted) {
      try {
        const gpu = await readGpu(signal)
        facts.gpuVendorId = gpu && Number.isFinite(gpu.vendorId) ? gpu.vendorId : null
        facts.gpuDeviceId = gpu && Number.isFinite(gpu.deviceId) ? gpu.deviceId : null
      } catch {
        facts.gpuVendorId = null
        facts.gpuDeviceId = null
      }
    }
    if (!signal.aborted) {
      try {
        const battery = await readBattery(signal)
        facts.onBattery = typeof battery === 'boolean' ? battery : null
      } catch {
        facts.onBattery = null
      }
    }
    return facts
  }, budgetMs, MAX_VOICE_PROBE_MS)
}
