/** How often the shared agenda may speak. The hard ceiling stays 3 a day. */
export type ProactiveFrequencyPreset = 'low' | 'normal'

export type AgendaKind = 'open_loop' | 'message_follow_up'

export type AgendaDeliverOn = 'return' | 'next_turn' | 'either'

export type AgendaItemState = 'pending' | 'snoozed' | 'done' | 'dismissed'

export interface AgendaItem {
  id: string
  kind: AgendaKind
  sourceId: string
  summary: string
  priority: number
  notBefore: number
  notAfter?: number
  deliverOn: AgendaDeliverOn
  state: AgendaItemState
  snoozeUntil?: number
  firedAt?: number
  attempts: number
}

/** Persisted agenda, delivery timestamps, and the daily consolidation watermark. */
export interface ProactiveAgendaState {
  items: AgendaItem[]
  firedAt: number[]
  lastConsolidationAt: string | null
}
