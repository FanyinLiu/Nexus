import { t } from '../i18n/runtime.ts'

/**
 * Stable, non-cryptographic 32-bit text fingerprint. Used where an id or
 * tombstone must survive restarts without storing the source text itself.
 * Collisions are acceptable for those call sites; do not use it for secrets.
 */
export function stableTextHash(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash, 33) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

/** Bound `value` to [min, max]. Non-finite values snap to `min`. */
export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Exponential drift of a numeric record toward a baseline at the given rate.
 *
 *   next[k] = state[k] + (baseline[k] - state[k]) * rate
 *
 * Rate is the fraction of the gap closed per call (0 = frozen, 1 = snap to
 * baseline). Used by emotion + relationship sub-dimension decay.
 *
 * The constraint is `object` rather than `Record<string, number>` so that
 * TypeScript interfaces (which don't have open index signatures) can be
 * passed directly. Callers are responsible for ensuring every field is a
 * number — the runtime iterates whatever keys `state` has.
 */
export function driftToward<T extends object>(
  state: T,
  baseline: T,
  rate: number,
): T {
  const next = { ...state }
  const s = state as Record<string, number>
  const b = baseline as Record<string, number>
  const n = next as Record<string, number>
  for (const key of Object.keys(s)) {
    n[key] = s[key] + (b[key] - s[key]) * rate
  }
  return next
}

/**
 * Match a text against a list of labelled regex patterns and return the
 * labels of every pattern that fires. Used by the emotion + relationship
 * signal classifiers.
 */
export function classifyByPatterns<T extends string>(
  text: string,
  patterns: ReadonlyArray<{ signal: T; pattern: RegExp }>,
): T[] {
  if (!text) return []
  const signals: T[] = []
  for (const { signal, pattern } of patterns) {
    if (pattern.test(text)) signals.push(signal)
  }
  return signals
}

export function shorten(text: string, maxLength: number) {
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

export function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(t('file.error.record_read_failed')))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(t('file.error.record_read_failed')))
        return
      }

      const [, base64 = ''] = reader.result.split(',', 2)
      resolve(base64)
    }
    reader.readAsDataURL(blob)
  })
}
