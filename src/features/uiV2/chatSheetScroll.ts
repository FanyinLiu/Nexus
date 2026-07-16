export type ChatSheetScrollRole = 'user' | 'assistant'

export interface ChatSheetScrollMessage {
  id: string
  role: ChatSheetScrollRole
  content: string
}

export type ChatSheetScrollDecision = 'none' | 'follow' | 'announce'

export function isChatSheetNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 72,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function getChatSheetScrollDecision(
  previousMessages: readonly ChatSheetScrollMessage[],
  nextMessages: readonly ChatSheetScrollMessage[],
  shouldFollowLatest: boolean,
): ChatSheetScrollDecision {
  const nextLatest = nextMessages[nextMessages.length - 1]
  if (!nextLatest) return 'none'
  if (previousMessages.length === 0) return 'follow'

  const previousLatest = previousMessages[previousMessages.length - 1]
  if (
    previousLatest
    && previousLatest.id === nextLatest.id
    && previousLatest.content === nextLatest.content
  ) {
    return 'none'
  }

  if (nextLatest.role === 'user' || shouldFollowLatest) return 'follow'
  return nextLatest.role === 'assistant' ? 'announce' : 'none'
}
