export type ChatSubmissionLock = { current: boolean }

export function tryAcquireChatSubmission(lock: ChatSubmissionLock): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function releaseChatSubmission(lock: ChatSubmissionLock): void {
  lock.current = false
}

export function shouldClearSubmittedInput(currentDraft: string, submittedContent: string): boolean {
  return currentDraft === submittedContent
}
