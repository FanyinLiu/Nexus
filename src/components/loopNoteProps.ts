/**
 * The reminder card fields of one chat line.
 *
 * Every surface that shows a proactive line hands the same four fields to
 * the card. A surface that forgets one of them loses a control without
 * saying so, so the mapping lives here and every surface uses it.
 */

import type { ChatMessage } from '../types/chat.ts'

export type LoopNoteSource = {
  id?: string
  loopOffer?: ChatMessage['loopOffer']
  loopCheck?: ChatMessage['loopCheck']
  proactiveWhy?: ChatMessage['proactiveWhy']
}

export type LoopNoteProps = {
  messageId?: string
  loopOffer?: ChatMessage['loopOffer']
  loopCheck?: ChatMessage['loopCheck']
  proactiveWhy?: ChatMessage['proactiveWhy']
}

/** The card fields a chat line carries. A field that is not there stays out. */
export function loopNoteProps(message: LoopNoteSource): LoopNoteProps {
  return {
    ...(message.id ? { messageId: message.id } : {}),
    ...(message.loopOffer ? { loopOffer: message.loopOffer } : {}),
    ...(message.loopCheck ? { loopCheck: message.loopCheck } : {}),
    ...(message.proactiveWhy ? { proactiveWhy: message.proactiveWhy } : {}),
  }
}
