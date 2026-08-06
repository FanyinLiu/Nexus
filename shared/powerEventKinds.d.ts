export declare const POWER_EVENT_KINDS: readonly [
  'suspend',
  'resume',
  'lock-screen',
  'unlock-screen',
  'shutdown',
]

export type PowerEventKind = (typeof POWER_EVENT_KINDS)[number]
