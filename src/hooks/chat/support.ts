import { parseAssistantPerformanceContent } from '../../features/pet/performance.ts'
import { humanizeIfSpeechIpcError, humanizeVoiceError } from '../../lib/humanizeError.ts'
import type { ChatMessage } from '../../types/index.ts'

export function formatReminderNextRunLabel(timestamp: string | undefined, locale: string) {
  const parsed = Date.parse(timestamp ?? '')
  if (Number.isNaN(parsed)) {
    return ''
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(parsed))
}

export function getSpeechOutputErrorMessage(error: unknown, fallback?: string) {
  const coded = humanizeIfSpeechIpcError(error, 'tts')
  if (coded) return coded
  // No code means the renderer cannot classify the failure any further;
  // playback is the honest category. The raw text is logged inside
  // humanizeVoiceError and never returned to the caller.
  if (error === null || error === undefined) {
    return fallback?.trim() || humanizeVoiceError(error, { category: 'playback' })
  }
  return humanizeVoiceError(error, { category: 'playback' })
}

export function sanitizeLoadedMessages(messages: ChatMessage[]) {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') {
      return [message]
    }

    const cleanedContent = parseAssistantPerformanceContent(message.content).displayContent
    if (!cleanedContent) {
      return []
    }

    return [{
      ...message,
      content: cleanedContent,
    }]
  })
}
