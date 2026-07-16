export type ChatAssistantMessageLike = {
  id: string
  content: string
}

export function getChatAssistantMessageKey(message: ChatAssistantMessageLike | null | undefined): string | null {
  return message ? `${message.id}:${message.content}` : null
}

export function shouldAnnounceChatAssistantReply(
  busyStartKey: string | null,
  latestAssistantKey: string | null,
  lastAnnouncedKey: string,
): boolean {
  return Boolean(
    latestAssistantKey
    && latestAssistantKey !== busyStartKey
    && latestAssistantKey !== lastAnnouncedKey,
  )
}
