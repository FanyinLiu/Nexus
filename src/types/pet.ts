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

// PetMood drives Live2D expression selection, system-prompt tone hints, and
// presence-message variety. The union intentionally covers more shades than
// the model's expression file count — multiple moods can map to the same
// `PetExpressionSlot` (see `resolveExpressionSlot`), so e.g. `excited` and
// `playful` visually reuse the `happy` slot while differing in tone words and
// presence-line selection. Added post-v0.2.7 to feed the roadmap item "扩展
// 情绪状态到 10-20 种" without bloating the expression-slot surface. Older
// app versions that read an unknown mood string via `loadPetRuntimeState`
// will fall through to `'idle'` in the slot resolver — forward-compatible.
export type PetMood =
  // Original 7
  | 'idle'
  | 'thinking'
  | 'happy'
  | 'sleepy'
  | 'surprised'
  | 'confused'
  | 'embarrassed'
  // Fine-grained shades added by emotionToPetMood when the 4-dim state
  // lands in a more specific region than the originals capture.
  | 'excited'      // high energy + high curiosity — burst of engagement
  | 'affectionate' // sustained high warmth at moderate energy — tender
  | 'proud'        // post task_completed streak — energy + warmth, low concern
  | 'curious'      // sustained high curiosity — distinct from 'surprised' burst
  | 'worried'      // high concern + low-mid energy — distinct from 'confused'
  | 'playful'      // high energy + high warmth + low concern — bouncy/teasing

export type PetTouchZone = 'head' | 'face' | 'body'
