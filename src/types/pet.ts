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

export type PetMood = 'idle' | 'thinking' | 'happy' | 'sleepy' | 'surprised' | 'confused' | 'embarrassed'

export type PetTouchZone = 'head' | 'face' | 'body'
