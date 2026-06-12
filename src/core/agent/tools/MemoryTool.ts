
export type MemoryScope = 'global' | 'conversation' | 'user'

export type MemoryEntry = {
  id: string
  scope: MemoryScope
  ownerId: string
  key: string
  value: string
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export type MemoryBackend = {
  write(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>
  read(scope: MemoryScope, ownerId: string, key: string): Promise<MemoryEntry | undefined>
  search(query: string, options?: {
    scope?: MemoryScope
    ownerId?: string
    limit?: number
  }): Promise<MemoryEntry[]>
  delete(scope: MemoryScope, ownerId: string, key: string): Promise<boolean>
  list(scope: MemoryScope, ownerId: string): Promise<MemoryEntry[]>
}

export class InMemoryMemoryBackend implements MemoryBackend {
  private readonly entries = new Map<string, MemoryEntry>()

  async write(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MemoryEntry> {
    const now = Date.now()
    const id = composeKey(entry.scope, entry.ownerId, entry.key)
    const existing = this.entries.get(id)
    const stored: MemoryEntry = existing
      ? { ...existing, value: entry.value, tags: entry.tags, updatedAt: now }
      : {
          id,
          scope: entry.scope,
          ownerId: entry.ownerId,
          key: entry.key,
          value: entry.value,
          tags: entry.tags,
          createdAt: now,
          updatedAt: now,
        }
    this.entries.set(id, stored)
    return stored
  }

  async read(
    scope: MemoryScope,
    ownerId: string,
    key: string,
  ): Promise<MemoryEntry | undefined> {
    return this.entries.get(composeKey(scope, ownerId, key))
  }

  async search(
    query: string,
    options?: { scope?: MemoryScope; ownerId?: string; limit?: number },
  ): Promise<MemoryEntry[]> {
    const q = query.toLowerCase()
    const all = Array.from(this.entries.values()).filter((entry) => {
      if (options?.scope && entry.scope !== options.scope) return false
      if (options?.ownerId && entry.ownerId !== options.ownerId) return false
      return (
        entry.key.toLowerCase().includes(q) ||
        entry.value.toLowerCase().includes(q) ||
        (entry.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
      )
    })
    all.sort((a, b) => b.updatedAt - a.updatedAt)
    return options?.limit ? all.slice(0, options.limit) : all
  }

  async delete(scope: MemoryScope, ownerId: string, key: string): Promise<boolean> {
    return this.entries.delete(composeKey(scope, ownerId, key))
  }

  async list(scope: MemoryScope, ownerId: string): Promise<MemoryEntry[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.scope === scope && e.ownerId === ownerId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
}

function composeKey(scope: MemoryScope, ownerId: string, key: string): string {
  return `${scope}::${ownerId}::${key}`
}
