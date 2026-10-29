/**
 * Date-grouped "What she remembers" view.
 *
 * Long-term memories and diary entries share one newest-first list. The same
 * component renders inline inside Advanced and as a sheet opened from the
 * simple Memory page, so the card and the full view always agree.
 */

import { useMemo, useState } from 'react'
import type { ConfirmFn } from '../../components/useConfirm.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import { formatPortraitDate } from '../memory/changeCopy.ts'
import {
  buildMemoryTimeline,
  type MemoryTimelineGroup,
  type MemoryTimelineItem,
} from '../memory/memoryTimeline.ts'
import type {
  DailyMemoryEntry,
  MemoryItem,
  TranslationKey,
  UiLanguage,
} from '../../types'
import './memory-portrait.css'

type MemoryTimelineV3Props = {
  memories: readonly MemoryItem[]
  dailyEntries: readonly DailyMemoryEntry[]
  uiLanguage: UiLanguage
  memoryPaused: boolean
  confirm?: ConfirmFn
  onUpdateMemory: (id: string, content: string) => void
  onRemoveMemory: (id: string) => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
  /** When set, the timeline opens as a sheet over the settings page. */
  onClose?: () => void
}

const GROUP_KEYS: Record<Exclude<MemoryTimelineGroup['kind'], 'month'>, TranslationKey> = {
  today: 'memory.timeline.today',
  yesterday: 'memory.timeline.yesterday',
  this_week: 'memory.timeline.this_week',
}

function groupLabel(
  group: MemoryTimelineGroup,
  uiLanguage: UiLanguage,
): string {
  if (group.kind === 'month' && group.month) {
    const date = new Date(`${group.month}-01T12:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(uiLanguage, { year: 'numeric', month: 'long' }).format(date)
    }
  }
  return pickTranslatedUiText(uiLanguage, GROUP_KEYS[group.kind === 'month' ? 'today' : group.kind])
}

function itemKey(item: MemoryTimelineItem): string {
  return `${item.kind}:${item.id}`
}

export function MemoryTimelineV3({
  memories,
  dailyEntries,
  uiLanguage,
  memoryPaused,
  confirm,
  onUpdateMemory,
  onRemoveMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
  onClose,
}: MemoryTimelineV3Props) {
  const ti = (key: TranslationKey, params?: Parameters<typeof pickTranslatedUiText>[2]) =>
    pickTranslatedUiText(uiLanguage, key, params)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const groups = useMemo(
    () => buildMemoryTimeline({ memories, dailyEntries }),
    [memories, dailyEntries],
  )
  const stampTemplate = ti('memory.portrait.stamp')

  const startEdit = (item: MemoryTimelineItem) => {
    setEditingKey(itemKey(item))
    setEditingText(item.text)
  }
  const cancelEdit = () => {
    setEditingKey(null)
    setEditingText('')
  }
  const saveEdit = (item: MemoryTimelineItem) => {
    const content = editingText.trim()
    if (!content) return
    if (item.kind === 'memory') onUpdateMemory(item.id, content)
    else if (item.day) onUpdateDailyEntry?.(item.id, item.day, content)
    cancelEdit()
  }
  const removeItem = async (item: MemoryTimelineItem) => {
    const accepted = confirm
      ? await confirm({
          message: ti(item.kind === 'memory' ? 'memory_panel.confirm_delete_memory' : 'memory_panel.confirm_delete_diary'),
          tone: 'danger',
        })
      : true
    if (!accepted) return
    if (item.kind === 'memory') onRemoveMemory(item.id)
    else if (item.day) onRemoveDailyEntry?.(item.id, item.day)
  }

  const body = memoryPaused ? (
    <p className="memory-timeline__notice">{ti('memory.timeline.paused')}</p>
  ) : groups.length ? (
    <div className="memory-timeline__groups">
      {groups.map((group) => (
        <section key={group.id} className="memory-timeline__group" aria-label={groupLabel(group, uiLanguage)}>
          <h4 className="memory-timeline__group-title">{groupLabel(group, uiLanguage)}</h4>
          <ul className="memory-timeline__list">
            {group.items.map((item) => {
              const key = itemKey(item)
              const editing = editingKey === key
              return (
                <li key={key} className="memory-timeline__item" data-kind={item.kind}>
                  <div className="memory-timeline__meta">
                    <span className="memory-timeline__badge">
                      {ti(item.kind === 'memory' ? 'memory.timeline.memory_badge' : 'memory.timeline.diary_badge')}
                    </span>
                    <span>{formatPortraitDate(item.at, stampTemplate)}</span>
                  </div>
                  {editing ? (
                    <textarea
                      className="memory-portrait__editor"
                      value={editingText}
                      aria-label={ti('memory.portrait.edit')}
                      onChange={(event) => setEditingText(event.target.value)}
                    />
                  ) : (
                    <p className="memory-timeline__text">{item.text}</p>
                  )}
                  <div className="memory-portrait__actions">
                    {editing ? (
                      <>
                        <button type="button" onClick={() => saveEdit(item)}>{ti('memory.portrait.save')}</button>
                        <button type="button" onClick={cancelEdit}>{ti('memory_panel.cancel')}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => startEdit(item)}>{ti('memory.portrait.edit')}</button>
                    )}
                    <button type="button" onClick={() => void removeItem(item)}>{ti('memory.portrait.delete')}</button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  ) : (
    <p className="memory-timeline__notice">{ti('memory.timeline.empty')}</p>
  )

  if (!onClose) {
    return <div className="memory-timeline">{body}</div>
  }

  return (
    <div
      className="memory-portrait__sheet"
      role="dialog"
      aria-modal="true"
      aria-label={ti('memory.timeline.title')}
    >
      <div className="memory-portrait__sheet-card">
        <div className="memory-portrait__sheet-head">
          <h3>{ti('memory.timeline.title')}</h3>
          <button type="button" onClick={onClose}>{ti('memory.timeline.close')}</button>
        </div>
        <p className="memory-portrait__label">{ti('memory.timeline.description')}</p>
        {body}
      </div>
    </div>
  )
}
