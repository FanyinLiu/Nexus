/**
 * Appearance page: theme, names, look, relationship, and how often she
 * comes by. The older sections stay behind one advanced disclosure.
 */

import type { Dispatch, SetStateAction } from 'react'
import { CompanionThemePicker } from '../CompanionThemePicker.tsx'
import { RELATIONSHIP_OPTIONS } from '../../lib/relationshipTypes.ts'
import { pickTranslatedUiTextOrFallback } from '../../lib/uiLanguage.ts'
import { setCompanionNameWithWakeWordSync } from '../../features/hearing/companionWakeWordSync.ts'
import {
  companionInitiativePatch,
  inferCompanionInitiative,
  quietHoursPatch,
  unifiedQuietHours,
} from '../../features/settingsSimplify/index.ts'
import type { AppSettings, CompanionInitiative, CompanionRelationshipType } from '../../types/index.ts'
import type { PetModelDefinition } from '../../features/pet/index.ts'
import { SettingsV3Field, SettingsV3Switch } from '../../features/settingsV3/SettingsV3Primitives.tsx'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleChoices, SimpleRow } from './settingsSimpleShared.tsx'

type AppearanceSimplePageProps = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  petModelPresets: PetModelDefinition[]
}

function clampHour(value: string) {
  const hour = Number(value)
  if (!Number.isFinite(hour)) return 0
  return Math.max(0, Math.min(23, Math.round(hour)))
}

export function AppearanceSimplePage({ draft, setDraft, petModelPresets }: AppearanceSimplePageProps) {
  const ti = simpleTranslate(draft.uiLanguage)
  const pace = inferCompanionInitiative(draft)
  const quiet = unifiedQuietHours(
    { start: draft.autonomyQuietHoursStart, end: draft.autonomyQuietHoursEnd },
    { start: draft.proactiveQuietHoursStart, end: draft.proactiveQuietHoursEnd },
  )
  const showPaceExtras = pace === 'sometimes' || pace === 'often'

  function choosePace(next: CompanionInitiative) {
    if (next === 'custom') return
    setDraft((current) => ({
      ...current,
      ...companionInitiativePatch(next),
      companionInitiative: next,
    }))
  }

  function patchDraft(patch: Partial<AppSettings>) {
    setDraft((current) => {
      const next = { ...current, ...patch }
      return { ...next, companionInitiative: inferCompanionInitiative(next) }
    })
  }

  return (
    <>
      <section className="settings-v3-section__body">
        <SimpleRow icon="palette" title={ti('settings.appearance.label')} />
        <CompanionThemePicker
          themeId={draft.themeId}
          colorScheme={draft.themeColorScheme}
          language={draft.uiLanguage}
          onChange={(next) => setDraft((current) => ({
            ...current,
            themeId: next.themeId,
            themeColorScheme: next.colorScheme,
          }))}
        />
      </section>

      <section className="settings-v3-section__body">
        <SimpleRow
          icon="bell"
          title={ti('settings.simple.bracket')}
          hint={ti('settings.simple.bracket_hint')}
        >
          <SettingsV3Switch
            checked={draft.proactiveBracketEnabled}
            label={ti('settings.simple.bracket')}
            onChange={(proactiveBracketEnabled) => patchDraft({ proactiveBracketEnabled })}
          />
        </SimpleRow>
      </section>

      <section className="settings-v3-section__body">
        <SettingsV3Field label={ti('settings.simple.her_name')}>
          <input
            value={draft.companionName}
            onChange={(event) => setDraft((current) => setCompanionNameWithWakeWordSync(current, event.target.value))}
          />
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.simple.your_name')}>
          <input
            value={draft.userName}
            onChange={(event) => setDraft((current) => ({ ...current, userName: event.target.value }))}
          />
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.simple.look')}>
          <select
            aria-label={ti('settings.simple.look')}
            value={draft.petModelId}
            onChange={(event) => setDraft((current) => ({ ...current, petModelId: event.target.value }))}
          >
            {petModelPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {pickTranslatedUiTextOrFallback(draft.uiLanguage, preset.label) || preset.label}
              </option>
            ))}
          </select>
        </SettingsV3Field>
      </section>

      <section className="settings-v3-section__body">
        <p>{ti('settings.simple.relationship')}</p>
        <SimpleChoices
          label={ti('settings.simple.relationship')}
          value={draft.companionRelationshipType}
          options={RELATIONSHIP_OPTIONS.map((option) => ({
            value: option.value,
            label: ti(option.labelKey),
          }))}
          onChange={(value: CompanionRelationshipType) => setDraft((current) => ({
            ...current,
            companionRelationshipType: value,
          }))}
        />
      </section>

      <section className="settings-v3-section__body">
        <p>{ti('settings.simple.initiative')}</p>
        <SimpleChoices
          label={ti('settings.simple.initiative')}
          value={pace}
          options={[
            { value: 'quiet' as const, label: ti('settings.simple.initiative_quiet') },
            { value: 'sometimes' as const, label: ti('settings.simple.initiative_sometimes') },
            { value: 'often' as const, label: ti('settings.simple.initiative_often') },
            ...(pace === 'custom'
              ? [{ value: 'custom' as const, label: ti('settings.simple.initiative_custom') }]
              : []),
          ]}
          onChange={choosePace}
        />
        {pace === 'sometimes' ? <p>{ti('settings.simple.initiative_sometimes_hint')}</p> : null}
        {pace === 'often' ? <p>{ti('settings.simple.initiative_often_hint')}</p> : null}
        {showPaceExtras && quiet ? (
          <div className="settings-v3-row">
            <div className="settings-v3-row__copy">
              <strong>{ti('settings.simple.quiet_hours')}</strong>
            </div>
            <input
              aria-label={ti('settings.memory.proactive.quiet_start')}
              type="number"
              min={0}
              max={23}
              value={quiet.start}
              onChange={(event) => patchDraft(quietHoursPatch({
                start: clampHour(event.target.value),
                end: quiet.end,
              }))}
            />
            <input
              aria-label={ti('settings.memory.proactive.quiet_end')}
              type="number"
              min={0}
              max={23}
              value={quiet.end}
              onChange={(event) => patchDraft(quietHoursPatch({
                start: quiet.start,
                end: clampHour(event.target.value),
              }))}
            />
          </div>
        ) : null}
        {showPaceExtras && !quiet ? <p>{ti('settings.simple.quiet_split')}</p> : null}
        {showPaceExtras ? (
          <SimpleRow icon="bell" tone="warning" title={ti('settings.simple.away')}>
            <SettingsV3Switch
              checked={draft.proactiveAwayNotificationsEnabled}
              label={ti('settings.simple.away')}
              onChange={(proactiveAwayNotificationsEnabled) => patchDraft({ proactiveAwayNotificationsEnabled })}
            />
          </SimpleRow>
        ) : null}
      </section>
    </>
  )
}
