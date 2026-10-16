/**
 * Memory page. The pause switch keeps the immediate-save behavior and
 * the labels from the memory pause change. Other rows stay in the draft.
 */

import type { Dispatch, SetStateAction } from 'react'
import { desktopAwarenessPatch } from '../../features/settingsSimplify/index.ts'
import type { AppSettings, ProactiveFrequencyPreset } from '../../types/index.ts'
import { SettingsV3Switch } from '../../features/settingsV3/SettingsV3Primitives.tsx'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleChoices, SimpleRow } from './settingsSimpleShared.tsx'

type MemorySimplePageProps = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  onCommitMemoryPaused: (paused: boolean) => void
  onOpenAdvanced: () => void
}

export function MemorySimplePage({
  draft,
  setDraft,
  onCommitMemoryPaused,
  onOpenAdvanced,
}: MemorySimplePageProps) {
  const ti = simpleTranslate(draft.uiLanguage)

  function patch(next: Partial<AppSettings>) {
    setDraft((current) => ({ ...current, ...next }))
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
      </section>

      <section className="settings-v3-section__body">
        <SimpleRow icon="bell" tone="warning" title={ti('settings.simple.memory_reminders')} hint={ti('settings.simple.memory_reminders_hint')} />
      </section>
    </>
  )
}
