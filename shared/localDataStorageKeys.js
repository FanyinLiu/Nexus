/**
 * Canonical localData companion storage keys — single source of truth for the
 * 12 renderer localStorage keys that the main process mirrors into its SQLite
 * companion authority. Consumed by the renderer registry
 * (src/lib/storage/core.ts), the IPC payload whitelist
 * (electron/ipc/localDataPayloadSchemas.js), and the storage contract
 * (scripts/storage-contract.mjs).
 *
 * Order is contractual: the first 6 keys form the relationship group, the
 * last 6 the task group — the renderer slices the tuple at that boundary, so
 * append-only edits must keep the two groups contiguous.
 */

/** The 12 companion localData keys, relationship group first, then tasks. */
export const LOCAL_DATA_COMPANION_STORAGE_KEYS = Object.freeze([
  'nexus:autonomy:relationship',
  'nexus:autonomy:relationship-history',
  'nexus:autonomy:emotion',
  'nexus:autonomy:emotion-history',
  'nexus:autonomy:rhythm',
  'nexus:autonomy:user-affect-history',
  'nexus:plans',
  'nexus:open-goals',
  'nexus:agent-traces',
  'nexus:background-tasks',
  'nexus:agent:errands',
  'nexus:reminder-tasks',
])
