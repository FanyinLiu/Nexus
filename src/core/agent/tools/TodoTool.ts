import type { ToolDefinition, ToolExecutor } from '../../tools/types'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TodoItem = {
  id: string
  conversationId: string
  text: string
  status: TodoStatus
  createdAt: number
  updatedAt: number
}

export type TodoAction = 'add' | 'update' | 'list' | 'remove' | 'clear'

export type TodoArgs = {
  action: TodoAction
  id?: string
  text?: string
  status?: TodoStatus
}

export class TodoStore {
  private readonly items = new Map<string, TodoItem>()

  add(conversationId: string, text: string): TodoItem {
    const id = `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const now = Date.now()
    const item: TodoItem = {
      id,
      conversationId,
      text,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    this.items.set(id, item)
    return item
  }

  update(id: string, patch: { text?: string; status?: TodoStatus }): TodoItem | undefined {
    const item = this.items.get(id)
    if (!item) return undefined
    if (patch.text !== undefined) item.text = patch.text
    if (patch.status !== undefined) item.status = patch.status
    item.updatedAt = Date.now()
    return item
  }

  list(conversationId: string): TodoItem[] {
    return Array.from(this.items.values())
      .filter((item) => item.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  remove(id: string): boolean {
    return this.items.delete(id)
  }

  clear(conversationId: string): number {
    let removed = 0
    for (const [id, item] of this.items.entries()) {
      if (item.conversationId === conversationId) {
        this.items.delete(id)
        removed += 1
      }
    }
    return removed
  }
}

export const todoTool: ToolDefinition = {
  id: 'agent.todo',
  displayName: 'Todo',
  description:
    'Track multi-step plans across turns. Actions: add, update, list, remove, clear. Use this when a task has 3+ discrete steps.',
  parameterSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['add', 'update', 'list', 'remove', 'clear'] },
      id: { type: 'string' },
      text: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    },
  },
  requiresApproval: false,
  source: 'builtin',
}

export function createTodoExecutor(store: TodoStore): ToolExecutor {
  return async (args, context) => {
    const parsed = args as TodoArgs
    if (!parsed?.action) throw new Error('todo: `action` is required')
    switch (parsed.action) {
      case 'add': {
        if (!parsed.text) throw new Error('todo add: `text` is required')
        return store.add(context.conversationId, parsed.text)
      }
      case 'update': {
        if (!parsed.id) throw new Error('todo update: `id` is required')
        const updated = store.update(parsed.id, { text: parsed.text, status: parsed.status })
        if (!updated) throw new Error(`todo ${parsed.id} not found`)
        return updated
      }
      case 'list':
        return store.list(context.conversationId)
      case 'remove': {
        if (!parsed.id) throw new Error('todo remove: `id` is required')
        return { removed: store.remove(parsed.id) }
      }
      case 'clear':
        return { removed: store.clear(context.conversationId) }
      default:
        throw new Error(`todo: unknown action ${String(parsed.action)}`)
    }
  }
}
