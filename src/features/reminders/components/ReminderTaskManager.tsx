import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n/useTranslation.ts'
import type { ReminderTask } from '../../../types'
import {
  formatReminderScheduleSummaryForUi,
  type ReminderTaskDraftInput,
} from '../schedule'

type ReminderTaskManagerProps = {
  tasks: ReminderTask[]
  onSaveTask: (input: ReminderTaskDraftInput & { id?: string }) => void
  onRemoveTask: (id: string) => void
  onToggleTask: (id: string, enabled: boolean) => void
}

type ScheduleKind = ReminderTask['schedule']['kind']

function toDateTimeLocalValue(value?: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function formatDateTimeLabel(value: string | undefined, unsetLabel: string) {
  if (!value) {
    return unsetLabel
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function buildTaskTitle(title: string, prompt: string, fallback: string) {
  const normalizedTitle = title.trim()
  if (normalizedTitle) {
    return normalizedTitle
  }

  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) {
    return fallback
  }

  return normalizedPrompt.slice(0, 18)
}

export function ReminderTaskManager({
  tasks,
  onSaveTask,
  onRemoveTask,
  onToggleTask,
}: ReminderTaskManagerProps) {
  const { t, locale } = useTranslation()
  const [editingId, setEditingId] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [speechText, setSpeechText] = useState('')
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('at')
  const [atValue, setAtValue] = useState('')
  const [everyMinutes, setEveryMinutes] = useState('30')
  const [cronExpression, setCronExpression] = useState('0 9 * * *')
  const [enabled, setEnabled] = useState(true)
  const [formError, setFormError] = useState('')

  const saveLabel = editingId ? t('reminder_mgr.update') : t('reminder_mgr.add')
  const unsetLabel = t('reminder_mgr.unset')
  const emptyState = useMemo(() => !tasks.length, [tasks.length])

  function resetForm() {
    setEditingId('')
    setTitle('')
    setPrompt('')
    setSpeechText('')
    setScheduleKind('at')
    setAtValue('')
    setEveryMinutes('30')
    setCronExpression('0 9 * * *')
    setEnabled(true)
    setFormError('')
  }

  function loadTaskIntoForm(task: ReminderTask) {
    setEditingId(task.id)
    setTitle(task.title)
    setPrompt(task.prompt)
    setSpeechText(task.speechText ?? '')
    setEnabled(task.enabled)
    setFormError('')

    if (task.schedule.kind === 'at') {
      setScheduleKind('at')
      setAtValue(toDateTimeLocalValue(task.schedule.at))
      return
    }

    if (task.schedule.kind === 'every') {
      setScheduleKind('every')
      setEveryMinutes(String(task.schedule.everyMinutes))
      return
    }

    setScheduleKind('cron')
    setCronExpression(task.schedule.expression)
  }

  function handleSave() {
    const nextTitle = buildTaskTitle(title, prompt, t('reminder_mgr.title_new'))
    const nextPrompt = prompt.trim() || nextTitle
    if (!nextPrompt) {
      setFormError(t('reminder_mgr.error.prompt_required'))
      return
    }

    const nextSpeechText = speechText.trim()
    let schedule: ReminderTaskDraftInput['schedule']

    if (scheduleKind === 'at') {
      if (!atValue) {
        setFormError(t('reminder_mgr.error.time_required'))
        return
      }

      const date = new Date(atValue)
      if (Number.isNaN(date.getTime())) {
        setFormError(t('reminder_mgr.error.time_invalid'))
        return
      }

      schedule = {
        kind: 'at',
        at: date.toISOString(),
      }
    } else if (scheduleKind === 'every') {
      const minutes = Math.max(1, Math.round(Number(everyMinutes) || 0))
      if (!minutes) {
        setFormError(t('reminder_mgr.error.every_minimum'))
        return
      }

      schedule = {
        kind: 'every',
        everyMinutes: minutes,
      }
    } else {
      if (!cronExpression.trim()) {
        setFormError(t('reminder_mgr.error.cron_required'))
        return
      }

      schedule = {
        kind: 'cron',
        expression: cronExpression.trim(),
      }
    }

    onSaveTask({
      ...(editingId ? { id: editingId } : {}),
      title: nextTitle,
      prompt: nextPrompt,
      ...(nextSpeechText ? { speechText: nextSpeechText } : {}),
      enabled,
      schedule,
    })
    resetForm()
  }

  return (
    <div className="reminder-task-manager">
      <div className="settings-grid settings-grid--two">
        <label>
          <span>{t('reminder_mgr.title_label')}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('reminder_mgr.title_placeholder')}
          />
        </label>

        <label>
          <span>{t('reminder_mgr.trigger_method')}</span>
          <select
            value={scheduleKind}
            onChange={(event) => setScheduleKind(event.target.value as ScheduleKind)}
          >
            <option value="at">{t('reminder_mgr.trigger.once')}</option>
            <option value="every">{t('reminder_mgr.trigger.every')}</option>
            <option value="cron">{t('reminder_mgr.cron_label')}</option>
          </select>
        </label>
      </div>

      <label>
        <span>{t('reminder_mgr.prompt_label')}</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={t('reminder_mgr.prompt_placeholder')}
        />
      </label>

      <label>
        <span>{t('reminder_mgr.speech_label')}</span>
        <textarea
          value={speechText}
          onChange={(event) => setSpeechText(event.target.value)}
          rows={2}
          placeholder={t('reminder_mgr.speech_hint')}
        />
      </label>

      {scheduleKind === 'at' ? (
        <label>
          <span>{t('reminder_mgr.time_label')}</span>
          <input
            type="datetime-local"
            value={atValue}
            onChange={(event) => setAtValue(event.target.value)}
          />
        </label>
      ) : null}

      {scheduleKind === 'every' ? (
        <label>
          <span>{t('reminder_mgr.every_minutes_label')}</span>
          <input
            type="number"
            min={1}
            step={1}
            value={everyMinutes}
            onChange={(event) => setEveryMinutes(event.target.value)}
          />
        </label>
      ) : null}

      {scheduleKind === 'cron' ? (
        <label>
          <span>{t('reminder_mgr.trigger.cron')}</span>
          <input
            value={cronExpression}
            onChange={(event) => setCronExpression(event.target.value)}
            placeholder="0 9 * * *"
          />
        </label>
      ) : null}

      <label className="settings-toggle">
        <span>{t('reminder_mgr.enable_this')}</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </label>

      <div className="settings-drawer__actions">
        <button
          type="button"
          className="ghost-button"
          onClick={resetForm}
        >
          {t('reminder_mgr.clear_form')}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleSave}
        >
          {saveLabel}
        </button>
      </div>

      <p className="settings-section__note">
        {t('reminder_mgr.note')}
      </p>

      {formError ? (
        <div className="settings-inline-note reminder-task-manager__status">{formError}</div>
      ) : null}

      {emptyState ? (
        <div className="settings-inline-note">
          {t('reminder_mgr.empty_state')}
        </div>
      ) : null}

      {!emptyState ? (
        <div className="reminder-task-list">
          {tasks.map((task) => (
            <article key={task.id} className="reminder-task-card">
              <div className="reminder-task-card__head">
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.prompt}</p>
                </div>
                <span className={`settings-summary-chip ${task.enabled ? '' : 'is-muted'}`}>
                  {task.enabled ? t('reminder_mgr.enabled') : t('reminder_mgr.paused')}
                </span>
              </div>

              <div className="reminder-task-card__meta">
                <span>{t('reminder_mgr.schedule_prefix', { summary: formatReminderScheduleSummaryForUi(task, locale) })}</span>
                <span>{t('reminder_mgr.next_trigger', { time: formatDateTimeLabel(task.nextRunAt, unsetLabel) })}</span>
                <span>{t('reminder_mgr.last_trigger', { time: formatDateTimeLabel(task.lastTriggeredAt, unsetLabel) })}</span>
              </div>

              <div className="reminder-task-card__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => loadTaskIntoForm(task)}
                >
                  {t('reminder_mgr.edit')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onToggleTask(task.id, !task.enabled)}
                >
                  {task.enabled ? t('reminder_mgr.pause') : t('reminder_mgr.enable')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onRemoveTask(task.id)}
                >
                  {t('reminder_mgr.delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
