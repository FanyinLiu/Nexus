/**
 * Shared type guards. Zero-dependency — safe to import from any layer.
 */

/**
 * True for non-null, non-array objects; narrows to a string-keyed record.
 * Consolidated from private copies that all used the same
 * `Boolean(value) && typeof value === 'object' && !Array.isArray(value)` test.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
