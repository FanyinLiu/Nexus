/**
 * SOUL and 记忆 summary cards.
 *
 * The page shows two colored cards. Editing happens in a sheet, and recent
 * changes are sentences with one undo each. Op codes stay in the log.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import type { TranslationKey } from '../../types/i18n.ts'
import { loadCompanionSoul, saveCompanionSoul } from '../../lib/storage/companionSoul.ts'
import { loadMemoryOpLog, appendMemoryOpLog } from '../../lib/storage/memoryOpLog.ts'
import { undoMemoryOp } from '../memory/memoryUndo.ts'
import {
  displayMemoryText,
  memoryChangeDate,
  memoryChangeKey,
  memoryChangeSource,
  memoryTopicToken,
  plainMemoryName,
  type MemoryTopic,
} from '../memory/changeCopy.ts'
import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'
import './memory-portrait.css'

type MemoryPortraitCardsV3Props = {
  memories: MemoryItem[]
  diaryCount?: number
  onPatchMemory?: (id: string, patch: Partial<Pick<MemoryItem, 'content' | 'pinned' | 'userEdited' | 'importance'>>) => void
  onRemoveMemory: (id: string) => void
}

function replaceMemories(next: MemoryItem[]) {
  window.dispatchEvent(new CustomEvent('nexus:memories-replaced', { detail: next }))
}

function portraitStamp(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}.${String(date.getFullYear()).slice(-2)}`
}

function topicName(
  text: string,
  t: (key: TranslationKey) => string,
): string {
  const token: MemoryTopic | null = memoryTopicToken(text)
  if (token === 'passport') return t('memory.topic.passport')
  if (token === 'report') return t('memory.topic.report')
  if (token === 'interview') return t('memory.topic.interview')
  if (token === 'meeting') return t('memory.topic.meeting')
  return plainMemoryName(text) || t('memory.topic.note')
}

export function MemoryPortraitCardsV3({
  memories,
  diaryCount = 0,
  onPatchMemory,
  onRemoveMemory,
}: MemoryPortraitCardsV3Props) {
  const { t } = useTranslation()
  const [soul, setSoul] = useState(() => loadCompanionSoul())
  const [soulDraft, setSoulDraft] = useState(soul.text)
  const [sheet, setSheet] = useState<'soul' | 'memory' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [logTick, setLogTick] = useState(0)

  const savedSoul = soul.text.trim() ? soul.text : t('memory.soul.default')
  const active = useMemo(() => memories.filter((memory) => (
    memory.status !== 'archived'
    && memory.status !== 'superseded'
    && memory.enabled !== false
  )), [memories])
  const about = active.filter((memory) => memory.kind !== 'open_loop').slice(0, 12)
  const ongoing = active.filter((memory) => (
    memory.kind === 'open_loop' && (memory.loopStatus ?? 'open') !== 'dismissed'
  )).slice(0, 8)
  const preview = [...ongoing, ...about].slice(0, 3)
  const changes = useMemo(() => {
    void logTick
    return loadMemoryOpLog().filter((entry) => entry.op !== 'NOOP').slice(-8).reverse()
  }, [logTick])
  const latestChange = changes[0]?.at ?? active[0]?.updatedAt ?? active[0]?.createdAt ?? null
  const memorySummary = diaryCount === 0
    ? t('memory.portrait.summary_empty', { count: active.length })
    : t('memory.portrait.summary', { count: active.length })

  const saveSoul = () => {
    const note = saveCompanionSoul(soulDraft, new Date().toISOString())
    setSoul(note)
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
      evidenceQuote: entry.evidenceQuote || entry.before?.[0]?.content || t('memory.portrait.undo'),
      messageRef: entry.messageRef || entry.id,
    }])
    setLogTick((value) => value + 1)
  }
  const openSoul = () => {
    setSoulDraft(soul.text)
    setSheet('soul')
  }

  const renderMemory = (memory: MemoryItem) => {
    const editing = editingId === memory.id
    const text = displayMemoryText(memory.content)
    return (
      <li key={memory.id} className="memory-portrait__row">
        {editing ? (
          <textarea
            className="memory-portrait__editor"
            value={editingText}
            aria-label={t('memory.portrait.edit')}
            onChange={(event) => setEditingText(event.target.value)}
          />
        ) : (
          <p className="memory-portrait__line">
            {text}{memory.loopPlace ? ` · ${memory.loopPlace}` : ''}
            {memory.userEdited ? <span className="memory-portrait__tag">{t('memory.portrait.edited')}</span> : null}
          </p>
        )}
        <div className="memory-portrait__actions">
          {editing ? (
            <button
              type="button"
              className="memory-portrait__save"
              onClick={() => {
                const content = editingText.trim()
                if (content) onPatchMemory?.(memory.id, { content, userEdited: true })
                setEditingId(null)
              }}
            >
              {t('memory.portrait.save')}
            </button>
          ) : (
            <button type="button" onClick={() => { setEditingId(memory.id); setEditingText(text) }}>
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
    <div className="memory-portrait">
      <p className="memory-portrait__privacy">{t('memory.portrait.privacy')}</p>
      <div className="memory-portrait__pair">
        <button type="button" className="memory-portrait__card memory-portrait__card--soul" data-soul-card="true" onClick={openSoul}>
          <p className="memory-portrait__kicker">{t('memory.soul.title')}</p>
          <p className="memory-portrait__summary">{savedSoul}</p>
          <span className="memory-portrait__meta">
            <span>{portraitStamp(soul.updatedAt)}</span>
            <span>{t('memory.portrait.open')}</span>
          </span>
        </button>
        <button type="button" className="memory-portrait__card memory-portrait__card--memory" onClick={() => setSheet('memory')}>
          <p className="memory-portrait__kicker">{t('memory.portrait.title')}</p>
          <p className="memory-portrait__summary">{memorySummary}</p>
          <span className="memory-portrait__meta">
            <span>{portraitStamp(latestChange)}</span>
            <span>{t('memory.portrait.open')}</span>
          </span>
        </button>
      </div>
      {preview.length ? (
        <ul className="memory-portrait__notes">
          {preview.map((memory) => (
            <li key={memory.id}>
              {displayMemoryText(memory.content)}
              {memory.userEdited ? <span className="memory-portrait__tag">{t('memory.portrait.edited')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {sheet ? (
        <div className="memory-portrait__sheet" role="dialog" aria-modal="true" aria-label={sheet === 'soul' ? t('memory.soul.title') : t('memory.portrait.title')}>
          <div className="memory-portrait__sheet-card">
            <div className="memory-portrait__sheet-head">
              <h3>{sheet === 'soul' ? t('memory.soul.title') : t('memory.portrait.title')}</h3>
              <button type="button" onClick={() => setSheet(null)}>{t('memory.portrait.close')}</button>
            </div>
            {sheet === 'soul' ? (
              <>
                <p className="memory-portrait__label">{t('memory.soul.hint')}</p>
                <textarea
                  className="memory-portrait__editor"
                  value={soulDraft}
                  aria-label={t('memory.soul.title')}
                  placeholder={t('memory.soul.placeholder')}
                  onChange={(event) => setSoulDraft(event.target.value)}
                />
                <button type="button" className="memory-portrait__save" onClick={saveSoul}>{t('memory.soul.save')}</button>
              </>
            ) : (
              <>
                <p className="memory-portrait__label">{t('memory.portrait.about')}</p>
                {about.length ? <ul className="memory-portrait__notes">{about.map(renderMemory)}</ul> : <p>{t('memory.portrait.empty')}</p>}
                <p className="memory-portrait__label">{t('memory.portrait.ongoing')}</p>
                {ongoing.length ? <ul className="memory-portrait__notes">{ongoing.map(renderMemory)}</ul> : <p>{t('memory.portrait.empty')}</p>}
                <p className="memory-portrait__label">{t('memory.portrait.changes')}</p>
                {changes.length ? (
                  <ul className="memory-portrait__notes">
                    {changes.map((entry) => (
                      <li key={entry.id} className="memory-portrait__change">
                        <p>
                          {t(memoryChangeKey(entry), { name: topicName(memoryChangeSource(entry, memories), t) })}
                          {' · '}
                          {memoryChangeDate(entry.at)}
                        </p>
                        {entry.op !== 'UNDO' && entry.before?.length ? (
                          <button type="button" onClick={() => undo(entry)}>{t('memory.portrait.undo')}</button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : <p>{t('memory.portrait.empty')}</p>}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
