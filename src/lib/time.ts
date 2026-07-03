export const MAX_VALID_JS_DATE_MS = 8_640_000_000_000_000

export function isSafeTimeMs(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_VALID_JS_DATE_MS
}

export function toFiniteTimeMs(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
    : Date.parse(value)
  return isSafeTimeMs(ms) ? ms : null
}
