/**
 * One-version rollback switch for the M1.1 proactive-routing migration.
 *
 * Flip a key to true to restore that source's old surfacing while the router
 * beds in. It is a code constant on purpose: no AppSettings field, settings
 * migration, IPC channel or storage key exists for it. Delete this file one
 * release after M1.1.
 */
export const PROACTIVE_LEGACY_PATH: Readonly<{ capsule: boolean; open_arc: boolean }> = Object.freeze({
  capsule: false,
  open_arc: false,
})
