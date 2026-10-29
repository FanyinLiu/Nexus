/**
 * Memory page. The pause switch keeps the immediate-save behavior and
 * the labels from the memory pause change. Other rows stay in the draft.
 */

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ConfirmFn } from '../useConfirm.ts'
import { desktopAwarenessPatch } from '../../features/settingsSimplify/index.ts'
import { formatPortraitDate } from '../../features/memory/changeCopy.ts'
import { buildRememberedCardView } from '../../features/memory/memoryTimeline.ts'
import type { SavedLetter } from '../../features/letter/letterStore.ts'
import { formatLetterDate, isLetterUnread } from '../../features/letter/letterView.ts'
import { useLetters } from '../../hooks/useLetters.ts'
import { useDreams } from '../../hooks/useDreams.ts'
import { useProactiveEtiquette } from '../../hooks/useProactiveEtiquette.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  MemoryItem,
  ProactiveFrequencyPreset,
} from '../../types/index.ts'
import { SettingsV3Switch } from '../../features/settingsV3/SettingsV3Primitives.tsx'
import { MemoryTimelineV3 } from '../../features/settingsV3/MemoryTimelineV3.tsx'
import { SundayLetterReader } from '../SundayLetterReader.tsx'
import { SundayLetterShelf } from '../SundayLetterShelf.tsx'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleChoices, SimpleRow } from './settingsSimpleShared.tsx'

type MemorySimplePageProps = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  memories: readonly MemoryItem[]
  dailyMemoryEntries: readonly DailyMemoryEntry[]
  confirm: ConfirmFn
  onCommitMemoryPaused: (paused: boolean) => void
  onOpenAdvanced: () => void
  onUpdateMemory: (id: string, content: string) => void
  onRemoveMemory: (id: string) => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
}

export function MemorySimplePage({
  draft,
  setDraft,
  memories,
  dailyMemoryEntries,
  confirm,
  onCommitMemoryPaused,
  onOpenAdvanced,
  onUpdateMemory,
  onRemoveMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
}: MemorySimplePageProps) {
  const ti = simpleTranslate(draft.uiLanguage)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [letterShelfOpen, setLetterShelfOpen] = useState(false)
  const [openLetter, setOpenLetter] = useState<SavedLetter | null>(null)
  const { letters, unreadCount, markRead } = useLetters()
  const { dreams } = useDreams()
  const { quietUntil, resumeMessages } = useProactiveEtiquette()
  const remembered = useMemo(
    () => buildRememberedCardView({
      memories,
      dailyEntries: dailyMemoryEntries,
      paused: draft.memoryPaused,
    }),
    [dailyMemoryEntries, draft.memoryPaused, memories],
  )
  const dateTemplate = ti('memory.portrait.stamp')

  function patch(next: Partial<AppSettings>) {
    setDraft((current) => ({ ...current, ...next }))
  }

  const rememberedHint = remembered.state === 'paused'
    ? ti('settings.simple.memory_remembered_paused')
    : remembered.state === 'empty'
      ? ti('settings.simple.memory_remembered_empty')
      : ti('settings.simple.memory_remembered_count', { count: remembered.count })

  const letterShelfHint = letters.length === 0
    ? ti('settings.simple.letter_none')
    : unreadCount > 0
      ? ti('settings.simple.letter_unread_count', { count: letters.length, unread: unreadCount })
      : ti('settings.simple.letter_count', { count: letters.length })

  const dreamHint = draft.memoryPaused
    ? ti('settings.simple.dream_diary_paused')
    : dreams.length > 0
      ? ti('settings.simple.dream_diary_count', { count: dreams.length })
      : ti('settings.simple.dream_diary_hint')

  function openSavedLetter(letter: SavedLetter) {
    markRead(letter.id)
    setOpenLetter(letter)
  }

  return (
    <>
      <section className="settings-v3-section__body">
        <SimpleRow
          icon="bookmark"
          tone="success"
          title={ti('settings.memory.transparency.pause')}
          hint={ti('settings.memory.transparency.paused_effect')}
        >
          <SettingsV3Switch
            checked={draft.memoryPaused}
            label={ti('settings.memory.transparency.pause')}
            onChange={onCommitMemoryPaused}
          />
        </SimpleRow>
        <SimpleRow
          icon="bookmark"
          tone="success"
          title={ti('settings.simple.memory_remembered')}
          hint={rememberedHint}
        >
          {remembered.state === 'ready' ? (
            <button
              type="button"
              className="settings-v3-action"
              onClick={() => setTimelineOpen(true)}
            >
              {ti('settings.simple.memory_remembered_open')}
            </button>
          ) : null}
        </SimpleRow>
        {remembered.state === 'ready' ? (
          <ul className="memory-remembered__list">
            {remembered.latest.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="memory-remembered__item">
                <span className="memory-remembered__text">{item.text}</span>
                <span className="memory-remembered__date">{formatPortraitDate(item.at, dateTemplate)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <SimpleRow
          icon="book"
          title={ti('settings.simple.dream_diary')}
          hint={dreamHint}
        >
          <SettingsV3Switch
            checked={draft.dreamDiaryEnabled !== false}
            label={ti('settings.simple.dream_diary')}
            onChange={(dreamDiaryEnabled) => patch({ dreamDiaryEnabled })}
          />
        </SimpleRow>
        {dreams.length > 0 ? (
          <SimpleRow
            icon="book"
            title={ti('settings.simple.dream_diary_read')}
            hint={ti('settings.simple.dream_diary_read_hint')}
          >
            <button
              type="button"
              className="settings-v3-action"
              onClick={() => setTimelineOpen(true)}
            >
              {ti('settings.simple.memory_remembered_open')}
            </button>
          </SimpleRow>
        ) : null}
        <SimpleRow
          icon="window"
          title={ti('settings.simple.memory_seeing')}
          hint={draft.contextAwarenessEnabled
            ? ti('settings.simple.memory_seeing_on')
            : ti('settings.simple.memory_seeing_off')}
        >
          <SettingsV3Switch
            checked={draft.contextAwarenessEnabled}
            label={ti('settings.simple.memory_seeing')}
            onChange={(enabled) => patch(desktopAwarenessPatch(enabled, draft))}
          />
        </SimpleRow>
        {draft.contextAwarenessEnabled ? (
          <>
            <SimpleRow icon="window" title={ti('settings.simple.memory_window')}>
              <SettingsV3Switch
                checked={draft.activeWindowContextEnabled}
                label={ti('settings.simple.memory_window')}
                onChange={(activeWindowContextEnabled) => patch({ activeWindowContextEnabled })}
              />
            </SimpleRow>
            <SimpleRow icon="bookmark" title={ti('settings.simple.memory_clipboard')}>
              <SettingsV3Switch
                checked={draft.clipboardContextEnabled}
                label={ti('settings.simple.memory_clipboard')}
                onChange={(clipboardContextEnabled) => patch({ clipboardContextEnabled })}
              />
            </SimpleRow>
            <SimpleRow icon="book" title={ti('settings.simple.memory_screen')}>
              <SettingsV3Switch
                checked={draft.screenContextEnabled}
                label={ti('settings.simple.memory_screen')}
                onChange={(screenContextEnabled) => patch({ screenContextEnabled })}
              />
            </SimpleRow>
          </>
        ) : null}
      </section>

      <section className="settings-v3-section__body">
        <SimpleRow
          icon="letters"
          title={ti('settings.simple.letter')}
          hint={ti('settings.simple.letter_hint')}
        >
          <SettingsV3Switch
            checked={draft.proactiveLetterEnabled}
            label={ti('settings.simple.letter')}
            onChange={(enabled) => patch({
              proactiveLetterEnabled: enabled,
              proactiveLetterChoice: enabled ? 'on' : 'off',
            })}
          />
        </SimpleRow>
        <SimpleRow
          icon="letters"
          title={ti('settings.simple.letter_shelf')}
          hint={letterShelfHint}
        >
          {letters.length > 0 ? (
            <button
              type="button"
              className="settings-v3-action"
              onClick={() => setLetterShelfOpen(true)}
            >
              {ti('settings.simple.letter_open')}
            </button>
          ) : null}
        </SimpleRow>
        {letters.length > 0 ? (
          <ul className="sunday-letter-shelf__list">
            {letters.slice(0, 3).map((letter) => {
              const unread = isLetterUnread(letter)
              return (
                <li key={letter.id} className="sunday-letter-shelf__item">
                  <button
                    type="button"
                    className="sunday-letter-shelf__open"
                    onClick={() => openSavedLetter(letter)}
                  >
                    <span className="sunday-letter-shelf__meta">
                      <span className="sunday-letter-shelf__date">
                        {formatLetterDate(letter.letterDate, draft.uiLanguage)}
                      </span>
                      <span className="sunday-letter-shelf__badge" data-unread={unread ? 'true' : 'false'}>
                        {unread ? ti('settings.letters.unread_badge') : ti('settings.letters.read_badge')}
                      </span>
                    </span>
                    <span className="sunday-letter-shelf__preview">{letter.content.greeting}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="settings-v3-section__body">
        <SimpleRow icon="book" tone="warning" title={ti('settings.simple.memory_lore')} hint={ti('settings.simple.memory_lore_hint')}>
          <button type="button" className="settings-v3-action" onClick={onOpenAdvanced}>
            {ti('settings.simple.memory_lore_open')}
          </button>
        </SimpleRow>
        <SimpleRow
          icon="checks"
          tone="warning"
          title={ti('settings.simple.memory_unfinished')}
          hint={ti('settings.simple.memory_unfinished_hint')}
        >
          <SettingsV3Switch
            checked={draft.proactiveAgendaEnabled}
            label={ti('settings.simple.memory_unfinished')}
            onChange={(proactiveAgendaEnabled) => patch({ proactiveAgendaEnabled })}
          />
        </SimpleRow>
        {draft.proactiveAgendaEnabled ? (
          <SimpleChoices
            label={ti('settings.memory.proactive.frequency')}
            value={draft.proactiveFrequency}
            options={[
              { value: 'low' as ProactiveFrequencyPreset, label: ti('settings.memory.proactive.frequency_low') },
              { value: 'normal' as ProactiveFrequencyPreset, label: ti('settings.memory.proactive.frequency_normal') },
            ]}
            onChange={(proactiveFrequency) => patch({ proactiveFrequency })}
          />
        ) : null}
        {quietUntil ? (
          <SimpleRow
            icon="bell"
            tone="warning"
            title={ti('proactive.etiquette.settings_active', {
              when: new Intl.DateTimeFormat(draft.uiLanguage, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(quietUntil)),
            })}
          >
            <button type="button" className="settings-v3-action" onClick={resumeMessages}>
              {ti('proactive.etiquette.undo')}
            </button>
          </SimpleRow>
        ) : null}
      </section>

      <section className="settings-v3-section__body">
        <SimpleRow icon="bell" tone="warning" title={ti('settings.simple.memory_reminders')} hint={ti('settings.simple.memory_reminders_hint')} />
      </section>

      {timelineOpen ? (
        <MemoryTimelineV3
          memories={memories}
          dailyEntries={dailyMemoryEntries}
          uiLanguage={draft.uiLanguage}
          memoryPaused={draft.memoryPaused}
          confirm={confirm}
          onUpdateMemory={onUpdateMemory}
          onRemoveMemory={onRemoveMemory}
          onUpdateDailyEntry={onUpdateDailyEntry}
          onRemoveDailyEntry={onRemoveDailyEntry}
          onClose={() => setTimelineOpen(false)}
        />
      ) : null}

      {letterShelfOpen ? (
        <SundayLetterShelf
          letters={letters}
          uiLanguage={draft.uiLanguage}
          onClose={() => setLetterShelfOpen(false)}
        />
      ) : null}

      {openLetter ? (
        <SundayLetterReader
          letter={openLetter}
          uiLanguage={draft.uiLanguage}
          onClose={() => setOpenLetter(null)}
        />
      ) : null}
    </>
  )
}
