import { useCallback } from 'react'
import {
  openTextFileWithFallback,
  saveTextFileWithFallback,
} from '../../lib/index.ts'
import { parseChatHistoryArchive, serializeChatHistoryArchive } from '../../features/chat/index.ts'
import { clearCompactionCache } from '../../features/chat/contextCompaction.ts'
import type { Translator } from '../../types/i18n.ts'
import type { ChatMessage } from '../../types/index.ts'
import { sanitizeLoadedMessages } from './support.ts'
import type { UseChatContext } from './types.ts'

type ChatHistoryArchiveDependencies = {
  ctx: Pick<UseChatContext, 'settingsRef'>
  t: Translator
  messagesRef: { current: ChatMessage[] }
  setMessages: (next: ChatMessage[]) => void
  setError: (value: string | null) => void
  setInputValue: (value: string) => void
}

/**
 * Chat history archive actions: wholesale replacement plus the JSON
 * export / import / clear flows (with compaction-cache invalidation on
 * clear so a stale older-message summary cannot leak into a fresh history).
 */
export function useChatHistoryArchive({
  ctx,
  t,
  messagesRef,
  setMessages,
  setError,
  setInputValue,
}: ChatHistoryArchiveDependencies) {
  const replaceChatHistory = useCallback((nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    setError(null)
    setInputValue('')
  }, [messagesRef, setError, setInputValue, setMessages])

  const exportChatHistory = useCallback(async () => {
    const fileNameDate = new Date().toISOString().slice(0, 10)
    const exportContent = serializeChatHistoryArchive(messagesRef.current, {
      companionName: ctx.settingsRef.current.companionName,
      userName: ctx.settingsRef.current.userName,
    })

    return saveTextFileWithFallback({
      title: t('chat.export.title'),
      defaultFileName: `nexus-chat-history-${fileNameDate}.json`,
      content: exportContent,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
  }, [ctx.settingsRef, messagesRef, t])

  const importChatHistory = useCallback(async () => {
    const result = await openTextFileWithFallback({
      title: t('chat.import.title'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.content) {
      return result
    }

    const importedMessages = sanitizeLoadedMessages(parseChatHistoryArchive(result.content))
    replaceChatHistory(importedMessages)

    return {
      canceled: false,
      filePath: result.filePath,
      message: t('chat.import.success', { count: importedMessages.length }),
    }
  }, [replaceChatHistory, t])

  const clearChatHistory = useCallback(async () => {
    replaceChatHistory([])
    // Invalidate the older-message LLM-summary cache — its key is
    // hashOlderText(...) of the prior conversation tail, but on a hard
    // clear the next compaction is logically a fresh start, and we
    // don't want a stale summary leaking in if the user's first new
    // message happens to produce the same hash window.
    clearCompactionCache()

    return {
      canceled: false,
      message: t('chat.clear.success'),
    }
  }, [replaceChatHistory, t])

  return {
    replaceChatHistory,
    exportChatHistory,
    importChatHistory,
    clearChatHistory,
  }
}
