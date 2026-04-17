import type { ToolDefinition, ToolExecutor } from '../../tools/types'

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

export type MemoryAction = 'write' | 'read' | 'search' | 'delete' | 'list'

export type MemoryArgs = {
  action: MemoryAction
  scope?: MemoryScope
  key?: string
  value?: string
  query?: string
  tags?: string[]
  limit?: number
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

export const memoryTool: ToolDefinition = {
  id: 'agent.memory',
  displayName: 'Memory',
  description:
    'Persist or retrieve long-term memory across conversations. Actions: write, read, search, delete, list. Scopes: global, conversation, user.',
  parameterSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['write', 'read', 'search', 'delete', 'list'] },
      scope: { type: 'string', enum: ['global', 'conversation', 'user'] },
      key: { type: 'string' },
      value: { type: 'string' },
      query: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
    },
  },
  requiresApproval: false,
  source: 'builtin',
}

export function createMemoryExecutor(backend: MemoryBackend): ToolExecutor {
  return async (args, context) => {
    const parsed = args as MemoryArgs
    const scope: MemoryScope = parsed.scope ?? 'conversation'
    const ownerId = resolveOwnerId(scope, context.conversationId, context.userId)

    switch (parsed.action) {
      case 'write': {
        if (!parsed.key || parsed.value === undefined) {
          throw new Error('memory write: `key` and `value` required')
        }
        return backend.write({
          scope,
          ownerId,
          key: parsed.key,
          value: parsed.value,
          tags: parsed.tags,
        })
      }
      case 'read': {
        if (!parsed.key) throw new Error('memory read: `key` required')
        const entry = await backend.read(scope, ownerId, parsed.key)
        if (!entry) throw new Error(`memory: key "${parsed.key}" not found in ${scope}`)
        return entry
      }
      case 'search': {
        if (!parsed.query) throw new Error('memory search: `query` required')
        return backend.search(parsed.query, {
          scope,
          ownerId: scope === 'global' ? undefined : ownerId,
          limit: parsed.limit,
        })
      }
      case 'delete': {
        if (!parsed.key) throw new Error('memory delete: `key` required')
        return { deleted: await backend.delete(scope, ownerId, parsed.key) }
      }
      case 'list':
        return backend.list(scope, ownerId)
      default:
        throw new Error(`memory: unknown action ${String(parsed.action)}`)
    }
  }
}

function resolveOwnerId(scope: MemoryScope, conversationId: string, userId: string): string {
  if (scope === 'global') return 'global'
  if (scope === 'user') return userId
  return conversationId
}
