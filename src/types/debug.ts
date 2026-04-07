export type DebugConsoleEventSource = 'voice' | 'reminder' | 'scheduler' | 'tool' | 'system' | 'autonomy'

export type DebugConsoleEventTone = 'info' | 'success' | 'warning' | 'error'

export interface DebugConsoleEvent {
  id: string
  source: DebugConsoleEventSource
  title: string
  detail: string
  tone: DebugConsoleEventTone
  createdAt: string
  relatedTaskId?: string
}

export interface DebugConsoleEventDraft {
  source: DebugConsoleEventSource
  title: string
  detail: string
  tone?: DebugConsoleEventTone
  createdAt?: string
  relatedTaskId?: string
}
