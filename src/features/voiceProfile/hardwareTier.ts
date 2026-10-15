/**
 * Maps a local hardware snapshot and an optional SenseVoice timing
 * into low / mid / high. Thresholds are the onboarding research rules.
 * A failed or timed-out benchmark forces low. A skipped benchmark
 * (model not installed, or the user skipped) does not: high still
 * requires a measured RTF, so the result caps at mid.
 */

export type VoiceTier = 'low' | 'mid' | 'high'

export type VoiceBenchmarkStatus = 'ok' | 'timeout' | 'skipped' | 'error' | 'not-run'

export type HardwareTierInput = {
  logicalCores: number | null
  totalMemBytes: number | null
  freeDiskBytes: number | null
}

export type BenchmarkTierInput = {
  status: VoiceBenchmarkStatus
  sttRtf: number | null
}

export type VoiceTierDecision = {
  tier: VoiceTier
  threads: number
  reasons: string[]
}

const GIBIBYTE = 1024 ** 3

function gigabytes(bytes: number | null): number | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  return bytes / GIBIBYTE
}

/**
 * Unknown free disk (statfs failed) does not fail a tier. A known short
 * disk does. Treating "couldn't read" as zero would mark every machine
 * low whenever the probe cannot see the volume.
 */
function diskAllows(freeDiskBytes: number | null, minimumGb: number): boolean {
  const free = gigabytes(freeDiskBytes)
  if (free == null) return true
  return free >= minimumGb
}

export function mapVoiceTier(
  hardware: HardwareTierInput,
  benchmark: BenchmarkTierInput,
): VoiceTierDecision {
  if (benchmark.status === 'timeout' || benchmark.status === 'error') {
    return { tier: 'low', threads: 2, reasons: ['benchmark-failed'] }
  }

  const ramGb = gigabytes(hardware.totalMemBytes) ?? 0
  const cores = Number.isFinite(hardware.logicalCores) ? hardware.logicalCores ?? 0 : 0
  const rtf = benchmark.status === 'ok' ? benchmark.sttRtf : null
  const measured = typeof rtf === 'number' && Number.isFinite(rtf)

  const high = ramGb >= 16
    && cores >= 8
    && diskAllows(hardware.freeDiskBytes, 4)
    && measured
    && (rtf as number) <= 0.08
  if (high) {
    return { tier: 'high', threads: 4, reasons: ['ram', 'cores', 'disk', 'rtf'] }
  }

  const midRtf = !measured || (rtf as number) <= 0.25
  const mid = ramGb >= 8
    && cores >= 4
    && diskAllows(hardware.freeDiskBytes, 1.5)
    && midRtf
  if (mid) {
    return {
      tier: 'mid',
      threads: cores >= 8 ? 4 : 2,
      reasons: measured ? ['ram', 'cores', 'disk', 'rtf'] : ['hardware-only'],
    }
  }

  return { tier: 'low', threads: 2, reasons: ['below-mid'] }
}
