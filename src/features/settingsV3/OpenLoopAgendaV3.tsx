/**
 * Open loops and the upcoming proactive agenda inside the memory view.
 * Edits go through the memory patch callback so the renderer store stays
 * the source of truth. Agenda rows are the same queue delivery uses.
 */

import { useState } from 'react'
import { dueFromText, listLoopMemories } from '../memory/openLoops.ts'
import {
  applyAgendaUserAction,
  followUpKeyToSettle,
  projectAgenda,
  type AgendaUserAction,
} from '../autonomy/proactiveAgenda.ts'
import { loadProactiveAgenda, saveProactiveAgenda } from '../../lib/storage/proactiveAgenda.ts'
import { loadMessageFollowUps, settleMessageFollowUp } from '../../lib/storage/messageFollowUps.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { AppSettings, MemoryItem, TranslationKey, UiLanguage } from '../../types'
import type { AgendaItem, ProactiveAgendaState, ProactiveFrequencyPreset } from '../../types/proactive.ts'
import {
  SettingsV3Disclosure,
  SettingsV3Empty,
  SettingsV3Field,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives.tsx'

type Patch = Partial<Pick<MemoryItem, 'content' | 'loopStatus' | 'loopDueAt' | 'loopDueText' | 'loopSnoozeUntil'>>

function visibleAgenda(memories: readonly MemoryItem[], nowMs: number): ProactiveAgendaState {
  return projectAgenda({
    memories,
    followUps: loadMessageFollowUps(),
    previous: loadProactiveAgenda(),
    nowMs,
  })
}

function currentTime(): number {
  return Date.now()
}

function commitAgendaAction(
  memories: MemoryItem[],
  item: AgendaItem,
  action: AgendaUserAction,
): { state: ProactiveAgendaState; memories: MemoryItem[] } {
  const nowMs = currentTime()
  const projected = visibleAgenda(memories, nowMs)
  const result = applyAgendaUserAction(projected, memories, item.id, action, nowMs)
  saveProactiveAgenda(result.state)
  const followUpKey = followUpKeyToSettle(item, action)
  if (followUpKey) settleMessageFollowUp(followUpKey, nowMs)
  return result
}

function editedLoopPatch(content: string, dueText: string): Patch {
  const due = dueFromText(`${content} ${dueText}`, new Date(currentTime()).toISOString())
  return {
    content,
    loopDueText: dueText.trim() || due.loopDueText,
    ...(due.loopDueAt ? { loopDueAt: due.loopDueAt } : {}),
  }
}

export function OpenLoopAgendaV3({
  draft,
  memories,
  onPatchMemory,
  setDraft,
  uiLanguage,
}: {
  draft: AppSettings
  memories: MemoryItem[]
  onPatchMemory?: (id: string, patch: Patch) => void
  setDraft: (updater: (previous: AppSettings) => AppSettings) => void
  uiLanguage: UiLanguage
}) {
  const ti = (key: TranslationKey, params?: Record<string, string | number>) =>
    pickTranslatedUiText(uiLanguage, key, params)
  const [clock, setClock] = useState(currentTime)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [editingDue, setEditingDue] = useState('')
  const agenda = visibleAgenda(memories, clock)

  const loops = listLoopMemories(memories)
  const upcoming = agenda.items.filter((item) => item.state === 'pending' || item.state === 'snoozed')

  const act = (item: AgendaItem, action: AgendaUserAction) => {
    const result = commitAgendaAction(memories, item, action)
    setClock(currentTime)
    if (item.kind !== 'open_loop' || !onPatchMemory) return
    const memory = result.memories.find((candidate) => candidate.id === item.sourceId)
    if (!memory) return
    onPatchMemory(memory.id, {
      loopStatus: memory.loopStatus,
      loopSnoozeUntil: memory.loopSnoozeUntil,
    })
  }

  const saveEdit = (memory: MemoryItem) => {
    const content = editingContent.trim()
    if (!content || !onPatchMemory) return
    onPatchMemory(memory.id, editedLoopPatch(content, editingDue))
    setEditingId(null)
  }

  return (
    <SettingsV3Section title={ti('settings.memory.loops.title')} description={ti('settings.memory.loops.note')}>
      <SettingsV3Row label={ti('settings.memory.proactive.enable')} hint={ti('settings.memory.proactive.enable_hint')}>
        <SettingsV3Switch
          checked={draft.proactiveAgendaEnabled}
          label={ti('settings.memory.proactive.enable')}
          onChange={(enabled) => setDraft((previous) => ({ ...previous, proactiveAgendaEnabled: enabled }))}
        />
      </SettingsV3Row>
      <SettingsV3Field label={ti('settings.memory.proactive.frequency')}>
        <select
          value={draft.proactiveFrequency}
          onChange={(event) => setDraft((previous) => ({
            ...previous,
            proactiveFrequency: event.target.value as ProactiveFrequencyPreset,
          }))}
        >
          <option value="low">{ti('settings.memory.proactive.frequency_low')}</option>
          <option value="normal">{ti('settings.memory.proactive.frequency_normal')}</option>
        </select>
      </SettingsV3Field>
      <SettingsV3Field label={ti('settings.memory.proactive.quiet_start')}>
        <input
          type="number"
          min={0}
          max={23}
          value={draft.proactiveQuietHoursStart}
          onChange={(event) => setDraft((previous) => ({
            ...previous,
            proactiveQuietHoursStart: Number(event.target.value),
          }))}
        />
      </SettingsV3Field>
      <SettingsV3Field label={ti('settings.memory.proactive.quiet_end')}>
        <input
          type="number"
          min={0}
          max={23}
          value={draft.proactiveQuietHoursEnd}
          onChange={(event) => setDraft((previous) => ({
            ...previous,
            proactiveQuietHoursEnd: Number(event.target.value),
          }))}
        />
      </SettingsV3Field>

      {loops.length ? (
        <ul className="settings-v3-collection">
          {loops.map((memory) => {
            const status = memory.loopStatus ?? 'open'
            const statusKey = status === 'done'
              ? 'settings.memory.loops.status_done'
              : status === 'dismissed'
                ? 'settings.memory.loops.status_dismissed'
                : 'settings.memory.loops.status_open'
            const agendaItem = agenda.items.find((item) => item.kind === 'open_loop' && item.sourceId === memory.id)
            return (
              <li key={memory.id} className="settings-v3-collection-row">
                {editingId === memory.id ? (
                  <div className="settings-v3-editor" style={{ gridColumn: '1 / -1' }}>
                    <SettingsV3Field label={ti('settings.memory.loops.edit')}>
                      <textarea rows={2} value={editingContent} onChange={(event) => setEditingContent(event.target.value)} />
                    </SettingsV3Field>
                    <SettingsV3Field label={ti('settings.memory.loops.due')}>
                      <input value={editingDue} onChange={(event) => setEditingDue(event.target.value)} />
                    </SettingsV3Field>
                    <SettingsV3Toolbar>
                      <button type="button" onClick={() => saveEdit(memory)}>{ti('settings.memory.loops.save')}</button>
                      <button type="button" onClick={() => setEditingId(null)}>{ti('memory_panel.cancel')}</button>
                    </SettingsV3Toolbar>
                  </div>
                ) : (
                  <>
                    <div className="settings-v3-collection-row__main">
                      <span className="settings-v3-chip-line">
                        <span>{ti(statusKey)}</span>
                        {memory.loopDueText ? <span>{memory.loopDueText}</span> : null}
                      </span>
                      <span className="settings-v3-collection-row__title">{memory.content}</span>
                    </div>
                    <SettingsV3Toolbar>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(memory.id)
                          setEditingContent(memory.content)
                          setEditingDue(memory.loopDueText ?? '')
                        }}
                      >{ti('settings.memory.loops.edit')}</button>
                      {agendaItem && status === 'open' ? (
                        <>
                          <button type="button" onClick={() => act(agendaItem, 'done')}>{ti('settings.memory.loops.done')}</button>
                          <button type="button" onClick={() => act(agendaItem, 'snooze')}>{ti('settings.memory.loops.snooze')}</button>
                          <button type="button" onClick={() => act(agendaItem, 'dismiss')}>{ti('settings.memory.loops.dismiss')}</button>
                        </>
                      ) : null}
                    </SettingsV3Toolbar>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : <SettingsV3Empty title={ti('settings.memory.loops.empty')} />}

      <SettingsV3Disclosure title={ti('settings.memory.agenda.title')} description={ti('settings.memory.agenda.note')}>
        {upcoming.length ? (
          <ul className="settings-v3-collection">
            {upcoming.map((item) => (
              <li key={item.id} className="settings-v3-collection-row">
                <div className="settings-v3-collection-row__main">
                  <span className="settings-v3-chip-line">
                    <span>{ti(item.kind === 'message_follow_up' ? 'settings.memory.agenda.follow_up' : 'settings.memory.agenda.loop')}</span>
                  </span>
                  <span className="settings-v3-collection-row__title">{item.summary}</span>
                </div>
                <SettingsV3Toolbar>
                  <button type="button" onClick={() => act(item, 'done')}>{ti('settings.memory.loops.done')}</button>
                  <button type="button" onClick={() => act(item, 'snooze')}>{ti('settings.memory.loops.snooze')}</button>
                  <button type="button" onClick={() => act(item, 'dismiss')}>{ti('settings.memory.loops.dismiss')}</button>
                </SettingsV3Toolbar>
              </li>
            ))}
          </ul>
        ) : <SettingsV3Empty title={ti('settings.memory.agenda.empty')} />}
      </SettingsV3Disclosure>
    </SettingsV3Section>
  )
}
