import { createId } from '../../lib'
import { getCoreRuntime } from '../../lib/coreRuntime'
import { t } from '../../i18n/runtime.ts'
import type { ChatMessage } from '../../types'

const CONVERSATION_ID = 'local-chat'

export type SlashCommandResult = {
  handled: boolean
  messages?: ChatMessage[]
}

function buildTurn(content: string, resultText: string): ChatMessage[] {
  const createdAt = new Date().toISOString()
  return [
    { id: createId('msg'), role: 'user', content, createdAt },
    { id: createId('msg'), role: 'assistant', content: resultText, createdAt },
  ]
}

function runTodo(rest: string): string {
  const runtime = getCoreRuntime()
  const [sub, ...restTokens] = rest.split(/\s+/)
  const subArg = restTokens.join(' ').trim()

  if (!sub || sub === 'list') {
    const items = runtime.todoStore.list(CONVERSATION_ID)
    return items.length
      ? items.map((i) => `• [${i.status}] ${i.id}: ${i.text}`).join('\n')
      : t('chat.slash.todo.empty')
  }

  if (sub === 'add') {
    if (!subArg) return t('chat.slash.todo.usage_add')
    const item = runtime.todoStore.add(CONVERSATION_ID, subArg)
    return t('chat.slash.todo.added', { id: item.id, text: item.text })
  }

  if (sub === 'done') {
    if (!subArg) return t('chat.slash.todo.usage_done')
    const updated = runtime.todoStore.update(subArg, { status: 'completed' })
    return updated
      ? t('chat.slash.todo.marked_done', { text: updated.text })
      : t('chat.slash.todo.not_found', { id: subArg })
  }

  if (sub === 'clear') {
    const removed = runtime.todoStore.clear(CONVERSATION_ID)
    return t('chat.slash.todo.cleared', { count: removed })
  }

  return t('chat.slash.todo.usage')
}

async function runNote(content: string): Promise<string> {
  const runtime = getCoreRuntime()

  if (content === '/notes') {
    const entries = await runtime.memoryBackend.list('conversation', CONVERSATION_ID)
    return entries.length
      ? entries.map((e) => `• ${e.key}: ${e.value}`).join('\n')
      : '本会话暂无笔记。'
  }

  const text = content.slice('/note'.length).trim()
  if (!text) {
    return '用法：/note <内容> 保存一条笔记；/notes 查看全部。'
  }

  const key = `note-${Date.now()}`
  const entry = await runtime.memoryBackend.write({
    scope: 'conversation',
    ownerId: CONVERSATION_ID,
    key,
    value: text,
  })
  return `已记下笔记 ${entry.key}`
}

function runSearch(content: string): string {
  const query = content.slice('/search'.length).trim()
  if (!query) {
    return '用法：/search 关键词 — 在本地聊天历史中做全文检索。'
  }

  const hits = getCoreRuntime().sessionStore.search(query, { limit: 5 })
  if (hits.length === 0) {
    return `没有在本地聊天历史中找到与「${query}」相关的片段。`
  }

  return hits
    .map((hit, idx) => {
      const when = new Date(hit.timestamp).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      return `${idx + 1}. [${hit.role} · ${when}] ${hit.snippet}`
    })
    .join('\n')
}

export async function handleSlashCommand(content: string): Promise<SlashCommandResult> {
  if (content === '/todo' || content.startsWith('/todo ')) {
    const rest = content.slice('/todo'.length).trim()
    return { handled: true, messages: buildTurn(content, runTodo(rest)) }
  }

  if (content === '/notes' || content === '/note' || content.startsWith('/note ')) {
    const resultText = await runNote(content)
    return { handled: true, messages: buildTurn(content, resultText) }
  }

  if (content === '/search' || content.startsWith('/search ')) {
    return { handled: true, messages: buildTurn(content, runSearch(content)) }
  }

  return { handled: false }
}
