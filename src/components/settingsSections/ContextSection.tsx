import { memo, useState } from 'react'
import {
  formatReminderActionSummary,
  formatReminderCenterNextLabel,
  fromDatetimeLocalValue,
  getReminderScheduleOptions,
  getReminderTemplatePresets,
  parseNumberInput,
  toDatetimeLocalValue,
  type ConnectionResult,
  type ReminderTaskActionKind,
} from '../settingsDrawerSupport'
import { formatReminderScheduleSummaryForUi, type ReminderTaskDraftInput } from '../../features/reminders/schedule'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { SettingsToggle } from '../settingsFields'
import type {
  ReminderTask,
  ReminderTaskAction,
  ReminderTaskSchedule,
  ReminderScheduleKind,
  UiLanguage,
} from '../../types'

type ContextSectionProps = {
  active: boolean
  reminderTasks: ReminderTask[]
  uiLanguage: UiLanguage
  onAddReminderTask: (input: ReminderTaskDraftInput) => void
  onUpdateReminderTask: (
    id: string,
    updates: Partial<Omit<ReminderTask, 'id' | 'createdAt'>>,
  ) => void
  onRemoveReminderTask: (id: string) => void
}

function createDefaultReminderAt() {
  const nextAt = new Date(Date.now() + 30 * 60 * 1000)
  nextAt.setSeconds(0, 0)
  return toDatetimeLocalValue(nextAt.toISOString())
}

function buildReminderAction(
  kind: ReminderTaskActionKind,
  target: string,
): ReminderTaskAction {
  if (kind === 'weather') {
    return {
      kind: 'weather',
      location: target.trim(),
    }
  }

  if (kind === 'web_search') {
    return {
      kind: 'web_search',
      query: target.trim(),
      limit: 5,
    }
  }

  return {
    kind: 'notice',
  }
}

export const ContextSection = memo(function ContextSection({
  active,
  reminderTasks,
  uiLanguage,
  onAddReminderTask,
  onUpdateReminderTask,
  onRemoveReminderTask,
}: ContextSectionProps) {
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const [reminderStatus, setReminderStatus] = useState<ConnectionResult | null>(null)
  const [newReminderTitle, setNewReminderTitle] = useState('')
  const [newReminderPrompt, setNewReminderPrompt] = useState('')
  const [newReminderSpeechText, setNewReminderSpeechText] = useState('')
  const [newReminderActionKind, setNewReminderActionKind] = useState<ReminderTaskActionKind>('notice')
  const [newReminderActionTarget, setNewReminderActionTarget] = useState('')
  const [newReminderScheduleKind, setNewReminderScheduleKind] = useState<ReminderScheduleKind>('at')
  const [newReminderAt, setNewReminderAt] = useState(createDefaultReminderAt)
  const [newReminderEveryMinutes, setNewReminderEveryMinutes] = useState('60')
  const [newReminderCronExpression, setNewReminderCronExpression] = useState('0 9 * * *')

  const reminderScheduleOptions = getReminderScheduleOptions(uiLanguage)
  const reminderTemplatePresets = getReminderTemplatePresets(uiLanguage)
  const enabledReminderCount = reminderTasks.filter((task) => task.enabled).length
  const nextReminderTask = reminderTasks.find((task) => task.enabled && task.nextRunAt)

  function buildReminderSchedule(
    kind: ReminderScheduleKind,
    fallback?: ReminderTask['schedule'],
  ): ReminderTaskSchedule {
    if (kind === 'every') {
      return {
        kind: 'every',
        everyMinutes: Math.max(1, parseNumberInput(newReminderEveryMinutes, 60)),
        anchorAt: fallback?.kind === 'every' ? fallback.anchorAt : undefined,
      }
    }

    if (kind === 'cron') {
      return {
        kind: 'cron',
        expression: newReminderCronExpression.trim() || '0 9 * * *',
      }
    }

    return {
      kind: 'at',
      at: fromDatetimeLocalValue(newReminderAt),
    }
  }

  function resetNewReminderDraft() {
    setNewReminderTitle('')
    setNewReminderPrompt('')
    setNewReminderSpeechText('')
    setNewReminderActionKind('notice')
    setNewReminderActionTarget('')
    setNewReminderScheduleKind('at')
    setNewReminderAt(createDefaultReminderAt())
    setNewReminderEveryMinutes('60')
    setNewReminderCronExpression('0 9 * * *')
  }

  function handleAddReminderTask() {
    const title = newReminderTitle.trim()
    const prompt = newReminderPrompt.trim()
    const actionTarget = newReminderActionTarget.trim()

    if (!title || !prompt) {
      setReminderStatus({
        ok: false,
        message: ti('settings.context.error.title_and_prompt_required'),
      })
      return
    }

    if (newReminderActionKind === 'web_search' && !actionTarget) {
      setReminderStatus({
        ok: false,
        message: ti('settings.context.error.search_query_required'),
      })
      return
    }

    try {
      onAddReminderTask({
        title,
        prompt,
        speechText: newReminderSpeechText.trim() || undefined,
        action: buildReminderAction(newReminderActionKind, actionTarget),
        enabled: true,
        schedule: buildReminderSchedule(newReminderScheduleKind),
      })
      resetNewReminderDraft()
      setReminderStatus({
        ok: true,
        message: ti('settings.context.success.saved'),
      })
    } catch (error) {
      setReminderStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || ti('settings.context.error.save_failed'),
      })
    }
  }

  function handleAddReminderTemplate(templateId: string) {
    const template = reminderTemplatePresets.find((item) => item.id === templateId)
    if (!template) {
      return
    }

    try {
      onAddReminderTask(template.buildDraft(new Date()))
      setReminderStatus({
        ok: true,
        message: ti('settings.context.success.template_added', { name: template.label }),
      })
    } catch (error) {
      setReminderStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || ti('settings.context.error.template_failed'),
      })
    }
  }

  function handleUpdateReminderTaskSchedule(task: ReminderTask, nextKind: ReminderScheduleKind) {
    const fallbackAt = task.schedule.kind === 'at'
      ? task.schedule.at
      : fromDatetimeLocalValue(newReminderAt)

    const schedule: ReminderTaskSchedule = nextKind === 'at'
      ? { kind: 'at', at: fallbackAt }
      : nextKind === 'every'
        ? {
            kind: 'every',
            everyMinutes: task.schedule.kind === 'every' ? task.schedule.everyMinutes : 60,
            anchorAt: task.schedule.kind === 'every' ? task.schedule.anchorAt : undefined,
          }
        : {
            kind: 'cron',
            expression: task.schedule.kind === 'cron' ? task.schedule.expression : '0 9 * * *',
          }

    onUpdateReminderTask(task.id, { schedule })
  }

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.context.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.context.note')}
          </p>
        </div>
      </div>

      <div className="settings-drawer__stack">
        <div className="settings-drawer__inline-actions">
          <span className="settings-summary-chip">{ti('settings.context.total_summary', { count: reminderTasks.length })}</span>
          <span className="settings-summary-chip">{ti('settings.context.enabled_summary', { count: enabledReminderCount })}</span>
          <span className="settings-summary-chip">
            {ti('settings.context.next_task_summary', { name: nextReminderTask ? nextReminderTask.title : ti('settings.context.none') })}
          </span>
        </div>

        <p className="settings-drawer__hint">
          {nextReminderTask
            ? ti('settings.context.next_task_line', {
              title: nextReminderTask.title,
              when: formatReminderCenterNextLabel(nextReminderTask.nextRunAt, uiLanguage),
            })
            : ti('settings.context.no_upcoming_task')}
        </p>

        <div className="settings-drawer__inline-actions">
          {reminderTemplatePresets.map((template) => (
            <button
              key={template.id}
              type="button"
              className="ghost-button"
              onClick={() => handleAddReminderTemplate(template.id)}
              title={template.hint}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      {reminderTasks.length ? (
        <div className="settings-drawer__stack">
          {reminderTasks.map((task) => (
            <article key={task.id} className="settings-drawer__card">
              <label>
                <span>{ti('settings.context.field.title')}</span>
                <input
                  value={task.title}
                  onChange={(event) => onUpdateReminderTask(task.id, { title: event.target.value })}
                />
              </label>

              <label>
                <span>{ti('settings.context.field.prompt')}</span>
                <textarea
                  rows={3}
                  value={task.prompt}
                  onChange={(event) => onUpdateReminderTask(task.id, { prompt: event.target.value })}
                />
              </label>

              <label>
                <span>{ti('settings.context.field.speech_text')}</span>
                <input
                  value={task.speechText ?? ''}
                  onChange={(event) => onUpdateReminderTask(task.id, { speechText: event.target.value || undefined })}
                  placeholder={ti('settings.context.field.speech_placeholder')}
                />
              </label>

              <label>
                <span>{ti('settings.context.field.action')}</span>
                <select
                  value={task.action.kind}
                  onChange={(event) => onUpdateReminderTask(task.id, {
                    action: buildReminderAction(
                      event.target.value as ReminderTaskActionKind,
                      task.action.kind === 'weather'
                        ? task.action.location
                        : task.action.kind === 'web_search'
                          ? task.action.query
                          : '',
                    ),
                  })}
                >
                  <option value="notice">{ti('settings.context.action.notice')}</option>
                  <option value="weather">{ti('settings.context.action.weather')}</option>
                  <option value="web_search">{ti('settings.context.action.web_search')}</option>
                </select>
              </label>

              {task.action.kind === 'weather' ? (
                <label>
                  <span>{ti('settings.context.field.weather_location')}</span>
                  <input
                    value={task.action.location}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      action: {
                        kind: 'weather',
                        location: event.target.value,
                      },
                    })}
                    placeholder={ti('settings.context.field.weather_location_placeholder')}
                  />
                </label>
              ) : null}

              {task.action.kind === 'web_search' ? (
                <label>
                  <span>{ti('settings.context.field.search_query')}</span>
                  <input
                    value={task.action.query}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      action: buildReminderAction('web_search', event.target.value),
                    })}
                    placeholder={ti('settings.context.field.search_query_placeholder')}
                  />
                </label>
              ) : null}

              <label>
                <span>{ti('settings.context.field.schedule')}</span>
                <select
                  value={task.schedule.kind}
                  onChange={(event) => handleUpdateReminderTaskSchedule(task, event.target.value as ReminderScheduleKind)}
                >
                  {reminderScheduleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {task.schedule.kind === 'at' ? (
                <label>
                  <span>{ti('settings.context.field.run_at')}</span>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocalValue(task.schedule.at)}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      schedule: {
                        kind: 'at',
                        at: fromDatetimeLocalValue(event.target.value),
                      },
                    })}
                  />
                </label>
              ) : null}

              {task.schedule.kind === 'every' ? (
                <label>
                  <span>{ti('settings.context.field.every_minutes')}</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={(task.schedule as Extract<ReminderTaskSchedule, { kind: 'every' }>).everyMinutes}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      schedule: {
                        kind: 'every',
                        anchorAt: (task.schedule as Extract<ReminderTaskSchedule, { kind: 'every' }>).anchorAt,
                        everyMinutes: Math.max(
                          1,
                          parseNumberInput(
                            event.target.value,
                            (task.schedule as Extract<ReminderTaskSchedule, { kind: 'every' }>).everyMinutes,
                          ),
                        ),
                      },
                    })}
                  />
                </label>
              ) : null}

              {task.schedule.kind === 'cron' ? (
                <label>
                  <span>{ti('settings.context.field.cron')}</span>
                  <input
                    value={task.schedule.expression}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      schedule: {
                        kind: 'cron',
                        expression: event.target.value,
                      },
                    })}
                    placeholder="0 9 * * *"
                  />
                </label>
              ) : null}

              <SettingsToggle
                label={ti('settings.context.field.enable_task')}
                checked={task.enabled}
                onChange={(enabled) => onUpdateReminderTask(task.id, { enabled })}
              />

              <div className="settings-drawer__hint">
                {formatReminderActionSummary(task, uiLanguage)} · {formatReminderScheduleSummaryForUi(task, uiLanguage)}
                {task.nextRunAt
                  ? ` · ${ti('settings.context.next_run_prefix', { time: toDatetimeLocalValue(task.nextRunAt).replace('T', ' ') })}`
                  : ` · ${ti('settings.context.no_next_run')}`}
              </div>

              <div className="settings-drawer__inline-actions">
                <button type="button" className="ghost-button" onClick={() => onRemoveReminderTask(task.id)}>
                  {ti('settings.context.delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="settings-drawer__hint">{ti('settings.context.empty_state')}</p>
      )}

      <div className="settings-drawer__card">
        <label>
          <span>{ti('settings.context.new_title_label')}</span>
          <input
            value={newReminderTitle}
            onChange={(event) => setNewReminderTitle(event.target.value)}
            placeholder={ti('settings.context.new_title_placeholder')}
          />
        </label>

        <label>
          <span>{ti('settings.context.field.prompt')}</span>
          <textarea
            rows={3}
            value={newReminderPrompt}
            onChange={(event) => setNewReminderPrompt(event.target.value)}
            placeholder={ti('settings.context.new_prompt_placeholder')}
          />
        </label>

        <label>
          <span>{ti('settings.context.field.speech_text')}</span>
          <input
            value={newReminderSpeechText}
            onChange={(event) => setNewReminderSpeechText(event.target.value)}
            placeholder={ti('settings.context.new_speech_placeholder')}
          />
        </label>

        <label>
          <span>{ti('settings.context.field.action')}</span>
          <select
            value={newReminderActionKind}
            onChange={(event) => setNewReminderActionKind(event.target.value as ReminderTaskActionKind)}
          >
            <option value="notice">{ti('settings.context.action.notice')}</option>
            <option value="weather">{ti('settings.context.action.weather')}</option>
            <option value="web_search">{ti('settings.context.action.web_search')}</option>
          </select>
        </label>

        {newReminderActionKind === 'weather' ? (
          <label>
            <span>{ti('settings.context.field.weather_location')}</span>
            <input
              value={newReminderActionTarget}
              onChange={(event) => setNewReminderActionTarget(event.target.value)}
              placeholder={ti('settings.context.field.weather_location_placeholder')}
            />
          </label>
        ) : null}

        {newReminderActionKind === 'web_search' ? (
          <label>
            <span>{ti('settings.context.field.search_query')}</span>
            <input
              value={newReminderActionTarget}
              onChange={(event) => setNewReminderActionTarget(event.target.value)}
              placeholder={ti('settings.context.new_search_placeholder')}
            />
          </label>
        ) : null}

        <label>
          <span>{ti('settings.context.field.schedule')}</span>
          <select
            value={newReminderScheduleKind}
            onChange={(event) => setNewReminderScheduleKind(event.target.value as ReminderScheduleKind)}
          >
            {reminderScheduleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {newReminderScheduleKind === 'at' ? (
          <label>
            <span>{ti('settings.context.field.run_at')}</span>
            <input
              type="datetime-local"
              value={newReminderAt}
              onChange={(event) => setNewReminderAt(event.target.value)}
            />
          </label>
        ) : null}

        {newReminderScheduleKind === 'every' ? (
          <label>
            <span>{ti('settings.context.field.every_minutes')}</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={newReminderEveryMinutes}
              onChange={(event) => setNewReminderEveryMinutes(event.target.value)}
            />
          </label>
        ) : null}

        {newReminderScheduleKind === 'cron' ? (
          <label>
            <span>{ti('settings.context.field.cron')}</span>
            <input
              value={newReminderCronExpression}
              onChange={(event) => setNewReminderCronExpression(event.target.value)}
              placeholder="0 9 * * *"
            />
          </label>
        ) : null}

        <div className="settings-drawer__inline-actions">
          <button type="button" className="primary-button" onClick={handleAddReminderTask}>
            {ti('settings.context.add_button')}
          </button>
        </div>
      </div>

      {reminderStatus ? (
        <div
          className={`settings-status ${reminderStatus.ok ? 'is-success' : 'is-error'}`}
          role={reminderStatus.ok ? 'status' : 'alert'}
          aria-live={reminderStatus.ok ? 'polite' : 'assertive'}
          aria-atomic="true"
        >
          {reminderStatus.message}
        </div>
      ) : null}

    </section>
  )
})
