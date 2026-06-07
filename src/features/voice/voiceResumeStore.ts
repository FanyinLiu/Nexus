// Tracks an in-progress TTS utterance so that, when the user interrupts mid-
// sentence, we can offer to resume the unplayed portion later (instead of
// either dropping it or replaying from the very beginning).
//
// Lifecycle:
//   setActiveText(text)        — TTS started; remember the full original text.
//   recordChunkPlayed(chunk)   — a chunk was definitely heard by the user.
//   markCompleted()            — TTS finished cleanly; clear all state.
//   markInterrupted()          — TTS was cut off; freeze remaining text.
//   popPendingResume()         — read the remaining text once and clear.
//
// This module deliberately has no React/UI deps so it can be called from
// hooks, the bus reducer, or background services. Storage is in-memory only
// — a resume offer that survives a full app restart is not the goal.

export type VoiceResumeSnapshot = {
  originalText: string
  remainingText: string
  interruptedAt: number
}

type Listener = (snapshot: VoiceResumeSnapshot | null) => void

function cloneSnapshot(snapshot: VoiceResumeSnapshot): VoiceResumeSnapshot {
  return { ...snapshot }
}

class VoiceResumeStoreImpl {
  private originalText = ''
  private playedChars = 0
  private pending: VoiceResumeSnapshot | null = null
  private listeners = new Set<Listener>()

  setActiveText(text: string): void {
    this.originalText = text ?? ''
    this.playedChars = 0
    if (this.pending) this.setPending(null)
  }

  recordChunkPlayed(chunkText: string): void {
    if (!chunkText) return
    if (!this.originalText) return
    // Advance the played offset by chunk length, capped at the original length.
    // We don't try to align chunks to original character positions because the
    // chunker may have stripped whitespace or normalized punctuation; approximate
    // length is good enough for "where to resume from".
    this.playedChars = Math.min(this.originalText.length, this.playedChars + chunkText.length)
  }

  markCompleted(): void {
    this.originalText = ''
    this.playedChars = 0
    this.setPending(null)
  }

  markInterrupted(): void {
    if (!this.originalText) {
      this.setPending(null)
      return
    }
    const remainingText = this.originalText.slice(this.playedChars).trim()
    if (!remainingText) {
      this.setPending(null)
      return
    }
    this.setPending({
      originalText: this.originalText,
      remainingText,
      interruptedAt: Date.now(),
    })
    this.originalText = ''
    this.playedChars = 0
  }

  popPendingResume(): VoiceResumeSnapshot | null {
    const snapshot = this.pending
    if (snapshot) this.setPending(null)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  peekPendingResume(): VoiceResumeSnapshot | null {
    return this.pending ? cloneSnapshot(this.pending) : null
  }

  clear(): void {
    this.originalText = ''
    this.playedChars = 0
    this.setPending(null)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.pending ? cloneSnapshot(this.pending) : null)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setPending(next: VoiceResumeSnapshot | null): void {
    this.pending = next ? cloneSnapshot(next) : null
    for (const listener of this.listeners) {
      try {
        listener(this.pending ? cloneSnapshot(this.pending) : null)
      } catch {
        // listener errors must not break the store
      }
    }
  }
}

export const voiceResumeStore = new VoiceResumeStoreImpl()
