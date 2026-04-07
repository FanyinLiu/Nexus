import { memo, useState, type Dispatch, type SetStateAction } from 'react'
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
import {
  getWebSearchProviderPreset,
  resolveWebSearchApiBaseUrl,
  WEB_SEARCH_PROVIDER_PRESETS,
} from '../../lib/webSearchProviders'
import type {
  AppSettings,
  ReminderTask,
  ReminderTaskAction,
  ReminderTaskSchedule,
  ReminderScheduleKind,
  UiLanguage,
} from '../../types'

type ContextSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
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
  draft,
  setDraft,
  reminderTasks,
  uiLanguage,
  onAddReminderTask,
  onUpdateReminderTask,
  onRemoveReminderTask,
}: ContextSectionProps) {
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

  const webSearchProvider = getWebSearchProviderPreset(draft.toolWebSearchProviderId)
  const reminderScheduleOptions = getReminderScheduleOptions(uiLanguage)
  const reminderTemplatePresets = getReminderTemplatePresets(uiLanguage)
  const enabledReminderCount = reminderTasks.filter((task) => task.enabled).length
  const nextReminderTask = reminderTasks.find((task) => task.enabled && task.nextRunAt)

  function applyWebSearchProviderPreset(providerId: string) {
    const preset = getWebSearchProviderPreset(providerId)

    setDraft((prev) => ({
      ...prev,
      toolWebSearchProviderId: preset.id,
      toolWebSearchApiBaseUrl: resolveWebSearchApiBaseUrl(preset.id, prev.toolWebSearchApiBaseUrl),
      toolWebSearchApiKey: preset.id === prev.toolWebSearchProviderId
        ? prev.toolWebSearchApiKey
        : '',
    }))
  }

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
        message: '请先填写提醒标题和提醒内容。',
      })
      return
    }

    if (newReminderActionKind === 'web_search' && !actionTarget) {
      setReminderStatus({
        ok: false,
        message: '搜索任务需要填写搜索关键词。',
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
        message: '本地提醒已保存。',
      })
    } catch (error) {
      setReminderStatus({
        ok: false,
        message: error instanceof Error ? error.message : '提醒保存失败。',
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
        message: `已添加模板任务：${template.label}`,
      })
    } catch (error) {
      setReminderStatus({
        ok: false,
        message: error instanceof Error ? error.message : '模板任务添加失败。',
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
          <h4>工具权限</h4>
          <p className="settings-drawer__hint">
            内置工具已经走"注册表 / 策略 / 确认"流程。这里决定助手能否自动调用搜索、天气和外链工具；对外部链接建议保留确认。
          </p>
        </div>
      </div>

      <label className="settings-toggle">
        <span>允许网页搜索工具</span>
        <input
          type="checkbox"
          checked={draft.toolWebSearchEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolWebSearchEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>允许天气查询工具</span>
        <input
          type="checkbox"
          checked={draft.toolWeatherEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolWeatherEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>允许打开外部链接</span>
        <input
          type="checkbox"
          checked={draft.toolOpenExternalEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolOpenExternalEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>打开外链前需要确认</span>
        <input
          type="checkbox"
          checked={draft.toolOpenExternalRequiresConfirmation}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolOpenExternalRequiresConfirmation: event.target.checked,
            }))
          }
          disabled={!draft.toolOpenExternalEnabled}
        />
      </label>

      <div className="settings-section__title-row">
        <div>
          <h4>网页搜索 Provider</h4>
          <p className="settings-drawer__hint">
            可以切换搜索后端；当当前 provider 失败时，主进程会自动回退到内置 Bing RSS。
          </p>
        </div>
      </div>

      <label>
        <span>搜索提供商</span>
        <select
          value={draft.toolWebSearchProviderId}
          onChange={(event) => applyWebSearchProviderPreset(event.target.value)}
          disabled={!draft.toolWebSearchEnabled}
        >
          {WEB_SEARCH_PROVIDER_PRESETS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {webSearchProvider.description}
        {webSearchProvider.baseUrl ? ` 默认地址：${webSearchProvider.baseUrl}` : ''}
      </p>

      <label>
        <span>搜索 API Base URL</span>
        <input
          value={draft.toolWebSearchApiBaseUrl}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolWebSearchApiBaseUrl: event.target.value,
            }))
          }
          placeholder={webSearchProvider.baseUrl || '当前 provider 不需要填写'}
          disabled={!draft.toolWebSearchEnabled || !webSearchProvider.supportsBaseUrlOverride}
        />
      </label>

      <label>
        <span>搜索 API Key</span>
        <input
          type="password"
          value={draft.toolWebSearchApiKey}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolWebSearchApiKey: event.target.value,
            }))
          }
          placeholder={webSearchProvider.apiKeyPlaceholder || '当前 provider 不需要填写'}
          disabled={!draft.toolWebSearchEnabled || !webSearchProvider.requiresApiKey}
        />
      </label>

      <label className="settings-toggle">
        <span>Provider 失败时自动回退到 Bing</span>
        <input
          type="checkbox"
          checked={draft.toolWebSearchFallbackToBing}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolWebSearchFallbackToBing: event.target.checked,
            }))
          }
          disabled={!draft.toolWebSearchEnabled}
        />
      </label>

      <label>
        <span>天气默认地点</span>
        <input
          value={draft.toolWeatherDefaultLocation}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              toolWeatherDefaultLocation: event.target.value,
            }))
          }
          placeholder="例如：深圳"
          disabled={!draft.toolWeatherEnabled}
        />
      </label>

      <div className="settings-section__title-row">
        <div>
          <h4>本地自动任务中心</h4>
          <p className="settings-drawer__hint">
            支持 `at / every / cron` 三种调度；触发时会直接弹人物气泡，展示文本和 TTS 播报文本可以分开写，也可以先用下面的模板快速建一个常用任务。
          </p>
        </div>
      </div>

      <div className="settings-drawer__stack">
        <div className="settings-drawer__inline-actions">
          <span className="settings-summary-chip">总数 {reminderTasks.length}</span>
          <span className="settings-summary-chip">启用 {enabledReminderCount}</span>
          <span className="settings-summary-chip">
            下个任务 {nextReminderTask ? nextReminderTask.title : '暂无'}
          </span>
        </div>

        <p className="settings-drawer__hint">
          {nextReminderTask
            ? `最近一次触发将是「${nextReminderTask.title}」：${formatReminderCenterNextLabel(nextReminderTask.nextRunAt, uiLanguage)}`
            : '当前还没有即将执行的本地任务。'}
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
                <span>标题</span>
                <input
                  value={task.title}
                  onChange={(event) => onUpdateReminderTask(task.id, { title: event.target.value })}
                />
              </label>

              <label>
                <span>展示内容</span>
                <textarea
                  rows={3}
                  value={task.prompt}
                  onChange={(event) => onUpdateReminderTask(task.id, { prompt: event.target.value })}
                />
              </label>

              <label>
                <span>TTS 播报文本</span>
                <input
                  value={task.speechText ?? ''}
                  onChange={(event) => onUpdateReminderTask(task.id, { speechText: event.target.value || undefined })}
                  placeholder="留空时默认读取展示内容"
                />
              </label>

              <label>
                <span>执行动作</span>
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
                  <option value="notice">普通提醒</option>
                  <option value="weather">天气播报</option>
                  <option value="web_search">网页搜索</option>
                </select>
              </label>

              {task.action.kind === 'weather' ? (
                <label>
                  <span>天气地点</span>
                  <input
                    value={task.action.location}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      action: {
                        kind: 'weather',
                        location: event.target.value,
                      },
                    })}
                    placeholder="留空时走默认地点"
                  />
                </label>
              ) : null}

              {task.action.kind === 'web_search' ? (
                <label>
                  <span>搜索关键词</span>
                  <input
                    value={task.action.query}
                    onChange={(event) => onUpdateReminderTask(task.id, {
                      action: buildReminderAction('web_search', event.target.value),
                    })}
                    placeholder="例如：AI 新闻 / 周传雄 黄昏 歌词"
                  />
                </label>
              ) : null}

              <label>
                <span>调度方式</span>
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
                  <span>执行时间</span>
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
                  <span>每隔多少分钟</span>
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
                  <span>Cron 表达式</span>
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

              <label className="settings-toggle">
                <span>启用这个任务</span>
                <input
                  type="checkbox"
                  checked={task.enabled}
                  onChange={(event) => onUpdateReminderTask(task.id, { enabled: event.target.checked })}
                />
              </label>

              <div className="settings-drawer__hint">
                {formatReminderActionSummary(task, uiLanguage)} · {formatReminderScheduleSummaryForUi(task, uiLanguage)}
                {task.nextRunAt ? ` · 下次：${toDatetimeLocalValue(task.nextRunAt).replace('T', ' ')}` : ' · 当前不会再触发'}
              </div>

              <div className="settings-drawer__inline-actions">
                <button type="button" className="ghost-button" onClick={() => onRemoveReminderTask(task.id)}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="settings-drawer__hint">还没有本地提醒，下面可以直接新建一个。</p>
      )}

      <div className="settings-drawer__card">
        <label>
          <span>新提醒标题</span>
          <input
            value={newReminderTitle}
            onChange={(event) => setNewReminderTitle(event.target.value)}
            placeholder="例如：喝水提醒"
          />
        </label>

        <label>
          <span>展示内容</span>
          <textarea
            rows={3}
            value={newReminderPrompt}
            onChange={(event) => setNewReminderPrompt(event.target.value)}
            placeholder="例如：先休息一下，喝口水再继续。"
          />
        </label>

        <label>
          <span>TTS 播报文本</span>
          <input
            value={newReminderSpeechText}
            onChange={(event) => setNewReminderSpeechText(event.target.value)}
            placeholder="例如：主人，记得喝水休息一下。"
          />
        </label>

        <label>
          <span>执行动作</span>
          <select
            value={newReminderActionKind}
            onChange={(event) => setNewReminderActionKind(event.target.value as ReminderTaskActionKind)}
          >
            <option value="notice">普通提醒</option>
            <option value="weather">天气播报</option>
            <option value="web_search">网页搜索</option>
          </select>
        </label>

        {newReminderActionKind === 'weather' ? (
          <label>
            <span>天气地点</span>
            <input
              value={newReminderActionTarget}
              onChange={(event) => setNewReminderActionTarget(event.target.value)}
              placeholder="留空时走默认地点"
            />
          </label>
        ) : null}

        {newReminderActionKind === 'web_search' ? (
          <label>
            <span>搜索关键词</span>
            <input
              value={newReminderActionTarget}
              onChange={(event) => setNewReminderActionTarget(event.target.value)}
              placeholder="例如：AI 新闻 / 深圳天气 / 周传雄 黄昏 歌词"
            />
          </label>
        ) : null}

        <label>
          <span>调度方式</span>
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
            <span>执行时间</span>
            <input
              type="datetime-local"
              value={newReminderAt}
              onChange={(event) => setNewReminderAt(event.target.value)}
            />
          </label>
        ) : null}

        {newReminderScheduleKind === 'every' ? (
          <label>
            <span>每隔多少分钟</span>
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
            <span>Cron 表达式</span>
            <input
              value={newReminderCronExpression}
              onChange={(event) => setNewReminderCronExpression(event.target.value)}
              placeholder="0 9 * * *"
            />
          </label>
        ) : null}

        <div className="settings-drawer__inline-actions">
          <button type="button" className="primary-button" onClick={handleAddReminderTask}>
            添加提醒
          </button>
        </div>
      </div>

      {reminderStatus ? (
        <div className={`settings-status ${reminderStatus.ok ? 'is-success' : 'is-error'}`}>
          {reminderStatus.message}
        </div>
      ) : null}

    </section>
  )
})
