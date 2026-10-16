/**
 * Muse-style SOUL and 记忆 cards.
 *
 * SOUL is the companion portrait the user can edit. 记忆 groups what she
 * remembers, plus the op log with one-tap undo for a single change or
 * the latest daily run.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { loadCompanionSoul, saveCompanionSoul } from '../../lib/storage/companionSoul.ts'
import { loadMemoryOpLog, appendMemoryOpLog } from '../../lib/storage/memoryOpLog.ts'
import { loadMemoryRunSnapshots } from '../../lib/storage/memoryRunSnapshot.ts'
import { undoMemoryOp, undoMemoryRun } from '../memory/memoryUndo.ts'
import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'
import { SettingsV3Section } from './SettingsV3Primitives.tsx'

type MemoryPortraitCardsV3Props = {
  memories: MemoryItem[]
  onPatchMemory?: (id: string, patch: Partial<Pick<MemoryItem, 'content' | 'pinned' | 'userEdited' | 'importance'>>) => void
  onRemoveMemory: (id: string) => void
}

function replaceMemories(next: MemoryItem[]) {
  window.dispatchEvent(new CustomEvent('nexus:memories-replaced', { detail: next }))
}

export function MemoryPortraitCardsV3({ memories, onPatchMemory, onRemoveMemory }: MemoryPortraitCardsV3Props) {
  const { t } = useTranslation()
  const [soul, setSoul] = useState(() => loadCompanionSoul().text)
  const [soulDraft, setSoulDraft] = useState(soul)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [logTick, setLogTick] = useState(0)

  const savedSoul = soul.trim() ? soul : t('memory.soul.default')
  const about = useMemo(() => memories.filter((memory) => (
    memory.kind !== 'open_loop'
    && memory.status !== 'archived'
    && memory.status !== 'superseded'
    && memory.enabled !== false
  )).slice(0, 12), [memories])
  const ongoing = useMemo(() => memories.filter((memory) => (
    memory.kind === 'open_loop'
    && memory.status !== 'archived'
    && memory.status !== 'superseded'
    && (memory.loopStatus ?? 'open') !== 'dismissed'
  )).slice(0, 8), [memories])
  const changes = useMemo(() => {
    void logTick
    return loadMemoryOpLog().filter((entry) => entry.op !== 'NOOP').slice(-8).reverse()
  }, [logTick])
  const latestRun = useMemo(() => {
    void logTick
    const runs = loadMemoryRunSnapshots()
    return runs[runs.length - 1] ?? null
  }, [logTick])

  const saveSoul = () => {
    const note = saveCompanionSoul(soulDraft, new Date().toISOString())
    setSoul(note.text)
  }
  const undo = (entry: MemoryOpRecord) => {
    replaceMemories(undoMemoryOp(memories, entry))
    appendMemoryOpLog([{
      id: `memory-op-undo-${entry.id}`,
      at: new Date().toISOString(),
      actor: 'user',
      op: 'UNDO',
      targetIds: entry.targetIds,
      reason: 'undo',
      evidenceQuote: entry.evidenceQuote || entry.reason || 'undo',
      messageRef: entry.messageRef || entry.id,
    }])
    setLogTick((value) => value + 1)
  }
  const undoRun = () => {
    if (!latestRun) return
    replaceMemories(undoMemoryRun(latestRun.memories))
    appendMemoryOpLog([{
      id: `memory-op-undo-run-${latestRun.id}`,
      at: new Date().toISOString(),
      actor: 'user',
      op: 'UNDO',
      targetIds: [latestRun.id],
      reason: 'undo-run',
      evidenceQuote: 'undo run',
      messageRef: latestRun.id,
      runId: latestRun.id,
    }])
    setLogTick((value) => value + 1)
  }

  const renderRow = (memory: MemoryItem) => {
    const editing = editingId === memory.id
    return (
      <li key={memory.id} className="memory-portrait__row settings-v3-collection-row">
        {editing ? (
          <input
            value={editingText}
            aria-label={t('memory.portrait.edit')}
            onChange={(event) => setEditingText(event.target.value)}
          />
        ) : (
          <p>{memory.content}{memory.loopPlace ? ` · ${memory.loopPlace}` : ''}</p>
        )}
        <div className="memory-portrait__actions settings-v3-chip-line">
          {editing ? (
            <button
              type="button"
              onClick={() => {
                const content = editingText.trim()
                if (content) onPatchMemory?.(memory.id, { content, userEdited: true })
                setEditingId(null)
              }}
            >
              {t('memory.portrait.save')}
            </button>
          ) : (
            <button type="button" onClick={() => { setEditingId(memory.id); setEditingText(memory.content) }}>
              {t('memory.portrait.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onPatchMemory?.(memory.id, {
              pinned: memory.pinned !== true && memory.importance !== 'pinned',
              importance: memory.pinned || memory.importance === 'pinned' ? 'normal' : 'pinned',
              userEdited: true,
            })}
          >
            {memory.pinned || memory.importance === 'pinned' ? t('memory.portrait.unpin') : t('memory.portrait.pin')}
          </button>
          <button type="button" onClick={() => onRemoveMemory(memory.id)}>{t('memory.portrait.delete')}</button>
        </div>
      </li>
    )
  }

  return (
    <>
      <SettingsV3Section title={t('memory.soul.title')}>
        <p className="memory-portrait__hint">{t('memory.soul.hint')}</p>
        <p className="memory-portrait__soul" data-soul-card="true">{savedSoul}</p>
        <textarea
          className="memory-portrait__editor"
          value={soulDraft}
          aria-label={t('memory.soul.title')}
          placeholder={t('memory.soul.placeholder')}
          onChange={(event) => setSoulDraft(event.target.value)}
        />
        <button type="button" onClick={saveSoul}>{t('memory.soul.save')}</button>
      </SettingsV3Section>
      <SettingsV3Section title={t('memory.portrait.title')}>
        <p className="memory-portrait__hint">{t('memory.portrait.hint')}</p>
        <h3>{t('memory.portrait.about')}</h3>
        {about.length ? <ul className="memory-portrait__list settings-v3-collection">{about.map(renderRow)}</ul> : <p>{t('memory.portrait.empty')}</p>}
        <h3>{t('memory.portrait.ongoing')}</h3>
        {ongoing.length ? <ul className="memory-portrait__list settings-v3-collection">{ongoing.map(renderRow)}</ul> : <p>{t('memory.portrait.empty')}</p>}
        <h3>{t('memory.portrait.changes')}</h3>
        {latestRun ? (
          <button type="button" data-undo-run="true" onClick={undoRun}>{t('memory.portrait.undo_run')}</button>
        ) : null}
        {changes.length ? (
          <ul className="memory-portrait__list settings-v3-collection">
            {changes.map((entry) => (
              <li key={entry.id} className="memory-portrait__row">
                <p>{entry.op} · {entry.reason ?? ''}{entry.evidenceQuote ? ` · ${entry.evidenceQuote}` : ''}</p>
                {entry.op !== 'UNDO' && entry.before?.length ? (
                  <button type="button" onClick={() => undo(entry)}>{t('memory.portrait.undo')}</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p>{t('memory.portrait.empty')}</p>}
      </SettingsV3Section>
    </>
  )
}
