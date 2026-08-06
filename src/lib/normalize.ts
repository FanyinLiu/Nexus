/**
 * String / misc normalization helpers shared across features and storage
 * parsers. Zero-dependency — safe to import from any layer.
 *
 * These were consolidated from private copies scattered across the tree.
 * Variants whose semantics genuinely differ (undefined- vs null-returning,
 * rounding instead of flooring, unpadded output, ...) were intentionally
 * left private in their original files.
 */

/**
 * Trim a string-ish value, returning null for non-strings and empty results.
 * When maxLength is given, over-long results are hard-truncated.
 */
export function normalizeText(value: unknown, maxLength?: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return maxLength !== undefined && trimmed.length > maxLength
    ? trimmed.slice(0, maxLength)
    : trimmed
}

/** Trim a string-ish value; non-strings become ''. */
export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Trim (optionally collapsing whitespace runs first) a string-ish value,
 * returning null for non-strings and empty results.
 */
export function normalizeNullableString(
  value: unknown,
  collapseWhitespace = true,
): string | null {
  if (typeof value !== 'string') return null
  const normalized = collapseWhitespace
    ? value.replace(/\s+/g, ' ').trim()
    : value.trim()
  return normalized.length > 0 ? normalized : null
}

/** Collapse all whitespace runs to single spaces and trim. */
export function normalizeWhitespace(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Collapse + trim a string-ish value and cap it at limit characters;
 * non-strings become ''. With trimAfterSlice the capped result is trimmed
 * again (the slice can leave a trailing space behind).
 */
export function normalizeBoundedText(
  value: unknown,
  limit: number,
  trimAfterSlice = false,
): string {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/\s+/g, ' ').trim().slice(0, limit)
  return trimAfterSlice ? collapsed.trim() : collapsed
}

/** Pick the entry for the given locale, falling back to 'en-US'. */
export function pickLocale<Locale extends string, Value>(
  table: Record<Locale, Value>,
  locale: Locale,
): Value {
  return table[locale] ?? table['en-US' as Locale]
}

/**
 * Structural-equality check used by persisted-state writers to skip
 * no-change writes.
 */
export function hasChanged(normalized: unknown, raw: unknown): boolean {
  return JSON.stringify(normalized) !== JSON.stringify(raw)
}

/** Floor a finite non-negative number; anything else becomes 0. */
export function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}
