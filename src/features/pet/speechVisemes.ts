/**
 * Speech mouth-channel mix for Live2D.
 * Open stays the jaw; round and narrow phase-offset so the mouth is not a
 * frozen A-shape while speaking.
 */

export function resolveSpeechVisemes(
  mouthOpen: number,
  nowMs: number,
  reduced = false,
) {
  const open = mouthOpen < 0.015 ? 0 : mouthOpen
  if (open <= 0) return { open: 0, round: 0, narrow: 0 }
  if (reduced) {
    return {
      open,
      round: open * 0.25,
      narrow: open * 0.08,
    }
  }
  const seconds = nowMs / 1000
  const roundWave = 0.5 + 0.5 * Math.sin(seconds * 11.7 + 0.4)
  const narrowWave = 0.5 + 0.5 * Math.sin(seconds * 18.2 + 1.7)
  return {
    open,
    round: open * (0.12 + roundWave * 0.22),
    narrow: open * (0.04 + narrowWave * 0.14),
  }
}
