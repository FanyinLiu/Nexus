type ChatSheetScrollRole = 'user' | 'assistant'

export interface ChatSheetScrollMessage {
  id: string
  role: ChatSheetScrollRole
  content: string
}

export type ChatSheetScrollDecision = 'none' | 'follow' | 'announce'

export type ChatSheetScrollTarget = 'message-start' | 'bottom'

/** Minimal positioned element used to translate an article offset into scrollTop. */
export interface ChatScrollPositionedElement {
  offsetTop: number
  offsetParent: unknown
}

/** Minimal history offset needed by the article-to-scrollTop conversion. */
export interface ChatScrollHistoryOffset {
  offsetTop: number
}

/** Minimal rendered message article the history search can read an id from. */
export interface ChatScrollArticleElement extends ChatScrollPositionedElement {
  getAttribute(name: string): string | null
}

/** Minimal scrolling history container; avoids depending on real DOM classes. */
export interface ChatScrollHistoryElement extends ChatScrollPositionedElement {
  scrollHeight: number
  querySelectorAll(selector: string): ArrayLike<ChatScrollArticleElement>
}

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

/**
 * Picks where the history should land after the latest message changes.
 * A capsule letter must start at its opener line so the card is not scrolled
 * past; every other message keeps the existing bottom-follow behaviour.
 */
export function getChatSheetScrollTarget(
  latest: { id: string; capsuleLetter?: unknown } | undefined,
): ChatSheetScrollTarget {
  return latest && latest.capsuleLetter ? 'message-start' : 'bottom'
}

/**
 * Converts an article's layout offset into the history's scrollTop.
 * The history is not a positioned ancestor, so article and history share an
 * offsetParent; subtracting the history offset gives a client-relative top.
 */
export function getChatMessageStartScrollTop(
  article: ChatScrollPositionedElement,
  history: ChatScrollHistoryOffset,
): number {
  const top = article.offsetParent === history
    ? article.offsetTop
    : article.offsetTop - history.offsetTop
  return Math.max(0, top)
}

/**
 * Resolves the history scrollTop for the latest message. Capsule letters anchor
 * the article top; everything else (including a missing article) falls back to
 * the bottom so no path can strand the user mid-conversation.
 */
export function getChatHistoryScrollTop(
  history: ChatScrollHistoryElement,
  messages: readonly { id: string; capsuleLetter?: unknown }[],
): number {
  const latest = messages[messages.length - 1]
  if (!latest || getChatSheetScrollTarget(latest) !== 'message-start') {
    return history.scrollHeight
  }
  const articles = history.querySelectorAll('[data-message-id]')
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index]
    if (article && article.getAttribute('data-message-id') === latest.id) {
      return getChatMessageStartScrollTop(article, history)
    }
  }
  return history.scrollHeight
}
