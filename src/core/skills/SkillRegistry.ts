import type { Skill, SkillId, SkillMatchContext, SkillMatchResult } from './types.ts'

export type SkillBackend = {
  load(): Promise<Skill[]>
  save(skills: Skill[]): Promise<void>
}

export class InMemorySkillBackend implements SkillBackend {
  private stored: Skill[] = []
  async load(): Promise<Skill[]> {
    return this.stored.map((s) => ({ ...s }))
  }
  async save(skills: Skill[]): Promise<void> {
    this.stored = skills.map((s) => ({ ...s }))
  }
}

export type RegisterSkillInput = Omit<
  Skill,
  'id' | 'status' | 'version' | 'successCount' | 'failureCount' | 'createdAt' | 'updatedAt'
> & {
  id?: SkillId
  status?: Skill['status']
}

export class SkillRegistry {
  private readonly skills = new Map<SkillId, Skill>()
  private readonly backend: SkillBackend

  constructor(backend: SkillBackend = new InMemorySkillBackend()) {
    this.backend = backend
  }

  async load(): Promise<void> {
    const loaded = await this.backend.load()
    this.skills.clear()
    for (const skill of loaded) {
      this.skills.set(skill.id, skill)
    }
  }

  async persist(): Promise<void> {
    await this.backend.save(Array.from(this.skills.values()))
  }

  register(input: RegisterSkillInput): Skill {
    const now = Date.now()
    const id = input.id ?? `skill-${now}-${Math.random().toString(36).slice(2, 6)}`
    const existing = this.skills.get(id)
    if (existing) {
      const updated: Skill = {
        ...existing,
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        body: input.body,
        status: input.status ?? existing.status,
        version: existing.version + 1,
        updatedAt: now,
        metadata: input.metadata,
      }
      this.skills.set(id, updated)
      return updated
    }
    const skill: Skill = {
      id,
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      body: input.body,
      status: input.status ?? 'draft',
      version: 1,
      successCount: 0,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    }
    this.skills.set(id, skill)
    return skill
  }

  get(id: SkillId): Skill | undefined {
    return this.skills.get(id)
  }

  list(status?: Skill['status']): Skill[] {
    const all = Array.from(this.skills.values())
    return status ? all.filter((s) => s.status === status) : all
  }

  remove(id: SkillId): boolean {
    return this.skills.delete(id)
  }

  match(context: SkillMatchContext): SkillMatchResult[] {
    const results: SkillMatchResult[] = []
    const text = context.text.toLowerCase()
    for (const skill of this.skills.values()) {
      if (skill.status !== 'active') continue
      const reasons: string[] = []
      let score = 0
      const { trigger } = skill

      if (trigger.keywords?.length) {
        const hits = trigger.keywords.filter((kw) => text.includes(kw.toLowerCase()))
        if (hits.length === 0) continue
        score += hits.length * 2
        reasons.push(`keywords:${hits.join(',')}`)
      }

      if (trigger.intents?.length) {
        if (!context.intent || !trigger.intents.includes(context.intent)) continue
        score += 3
        reasons.push(`intent:${context.intent}`)
      }

      if (trigger.channels?.length) {
        if (!context.channelId || !trigger.channels.includes(context.channelId)) continue
        score += 1
        reasons.push(`channel:${context.channelId}`)
      }

      if (trigger.minHistoryLength !== undefined) {
        if (context.historyLength < trigger.minHistoryLength) continue
        score += 1
      }

      if (trigger.hasToolCalls !== undefined) {
        if (trigger.hasToolCalls !== context.hasToolCalls) continue
        score += 1
      }

      const successRatio =
        skill.successCount + skill.failureCount === 0
          ? 0.5
          : skill.successCount / (skill.successCount + skill.failureCount)
      score += successRatio * 2

      results.push({ skill, score, reasons })
    }
    results.sort((a, b) => b.score - a.score)
    return results
  }

  recordSuccess(id: SkillId): void {
    const skill = this.skills.get(id)
    if (!skill) return
    skill.successCount += 1
    skill.updatedAt = Date.now()
  }

  recordFailure(id: SkillId): void {
    const skill = this.skills.get(id)
    if (!skill) return
    skill.failureCount += 1
    skill.updatedAt = Date.now()
  }
}
