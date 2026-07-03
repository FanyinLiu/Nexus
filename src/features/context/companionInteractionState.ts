import { toFiniteTimeMs } from '../../lib/time.ts'

export type NexusInteractionState = {
  readonly nexusOpenSince: string
  readonly getLastNexusInteractionAt: () => string
  readonly markNexusInteraction: () => string
}

function normalizeInteractionTime(value: string, fallback: string): string {
  const valueMs = toFiniteTimeMs(value)
  if (valueMs == null) return fallback
  return new Date(valueMs).toISOString()
}

function readInteractionTime(getNow: () => string, fallback: string): string {
  try {
    return normalizeInteractionTime(getNow(), fallback)
  } catch {
    return fallback
  }
}

export function createNexusInteractionState(
  initialOpenAt = new Date().toISOString(),
  getNow = () => new Date().toISOString(),
): NexusInteractionState {
  const fallbackOpenAt = new Date().toISOString()
  const nexusOpenSince = normalizeInteractionTime(initialOpenAt, fallbackOpenAt)
  let lastNexusInteractionAt = nexusOpenSince

  return {
    nexusOpenSince,
    getLastNexusInteractionAt: () => lastNexusInteractionAt,
    markNexusInteraction: () => {
      lastNexusInteractionAt = readInteractionTime(getNow, lastNexusInteractionAt)
      return lastNexusInteractionAt
    },
  }
}
