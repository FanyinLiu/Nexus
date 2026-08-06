export declare const LOCAL_DATA_COMPANION_STORAGE_KEYS: readonly [
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
]

export type LocalDataCompanionStorageKey = (typeof LOCAL_DATA_COMPANION_STORAGE_KEYS)[number]
