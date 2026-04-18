export interface AmbientPresenceState {
  text: string
  createdAt: string
  expiresAt: string
}

export type PresenceCategory = 'time' | 'memory' | 'recent' | 'mood' | 'neutral'

export interface PresenceHistoryItem {
  text: string
  category: PresenceCategory
  createdAt: string
}

export type PetMood =
  | 'idle'
  | 'thinking'
  | 'happy'
  | 'sleepy'
  | 'surprised'
  | 'confused'
  | 'embarrassed'
  // Expanded set — each has an expression slot of the same name.
  // Models that don't provide a dedicated expression fall back via the
  // MOOD_FALLBACK_CHAIN in features/pet/components/live2d/expressions.ts.
  | 'excited'
  | 'calm'
  | 'affectionate'
  | 'worried'
  | 'focused'
  | 'disappointed'
  | 'shy'

export type PetTouchZone = 'head' | 'face' | 'body'
