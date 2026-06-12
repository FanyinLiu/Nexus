
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TodoItem = {
  id: string
  conversationId: string
  text: string
  status: TodoStatus
  createdAt: number
  updatedAt: number
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
