export type SkillId = string

type SkillTrigger = {
  keywords?: string[]
  intents?: string[]
  channels?: string[]
  minHistoryLength?: number
  hasToolCalls?: boolean
}

type SkillStatus = 'draft' | 'active' | 'deprecated'

export type Skill = {
  id: SkillId
  name: string
  description: string
  trigger: SkillTrigger
  body: string
  status: SkillStatus
  version: number
  successCount: number
  failureCount: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export type SkillMatchContext = {
  text: string
  intent?: string
  channelId?: string
  historyLength: number
  hasToolCalls: boolean
}

export type SkillMatchResult = {
  skill: Skill
  score: number
  reasons: string[]
}
