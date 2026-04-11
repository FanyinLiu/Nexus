export type ReminderScheduleKind = 'at' | 'every' | 'cron'

export type ReminderTaskAction =
  | {
      kind: 'notice'
    }
  | {
      kind: 'weather'
      location: string
    }
  | {
      kind: 'web_search'
      query: string
      limit?: number
    }
  | {
      kind: 'chat_action'
      instruction: string
    }

export type ReminderTaskSchedule =
  | {
      kind: 'at'
      at: string
    }
  | {
      kind: 'every'
      everyMinutes: number
      anchorAt?: string
    }
  | {
      kind: 'cron'
      expression: string
    }

export interface ReminderTask {
  id: string
  title: string
  prompt: string
  speechText?: string
  action: ReminderTaskAction
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastTriggeredAt?: string
  nextRunAt?: string
  schedule: ReminderTaskSchedule
}
