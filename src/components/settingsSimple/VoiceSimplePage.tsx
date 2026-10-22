/**
 * Voice page: this computer's recommendation, listen, speak, how to
 * start, and which voice. Languages change only when the button is used.
 */

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  applyVoiceSuggestion,
  configuredVoiceLanguages,
  migrateVoiceLanguageValue,
  voiceSuggestionChangesSettings,
} from '../../features/voiceProfile/index.ts'
import { useVoiceProfileProbe } from '../../hooks/useVoiceProfileProbe.ts'
import {
  isVoiceSpeechInputAvailable,
  isVoiceSpeechOutputAvailable,
} from '../../lib/platformProfile.ts'
import { keepTalkingPatch } from '../../features/settingsSimplify/index.ts'
import { markVoiceSwitchesChosen } from '../../features/voiceProfile/voiceReady.ts'
import { pickTranslatedUiTextOrFallback } from '../../lib/uiLanguage.ts'
import { getDirectSendFallbackWakeWord } from '../../features/hearing/companionWakeWordSync.ts'
import type { AppSettings, PlatformProfile, SpeechVoiceOption } from '../../types/index.ts'
import { SettingsV3Field, SettingsV3Switch } from '../../features/settingsV3/SettingsV3Primitives.tsx'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleChoices, SimpleRow } from './settingsSimpleShared.tsx'

type VoiceSimplePageProps = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  platformProfile: PlatformProfile
  speechVoiceOptions: SpeechVoiceOption[]
  onLoadSpeechVoices: () => void
}

export function VoiceSimplePage({
  draft,
  setDraft,
  platformProfile,
  speechVoiceOptions,
  onLoadSpeechVoices,
}: VoiceSimplePageProps) {
  const ti = simpleTranslate(draft.uiLanguage)
  const inputAvailable = isVoiceSpeechInputAvailable(platformProfile)
  const outputAvailable = isVoiceSpeechOutputAvailable(platformProfile)
  const configured = useMemo(() => configuredVoiceLanguages({
    uiLanguage: draft.uiLanguage,
    speechRecognitionLang: draft.speechRecognitionLang,
    speechSynthesisLang: draft.speechSynthesisLang,
  }), [draft.speechRecognitionLang, draft.speechSynthesisLang, draft.uiLanguage])
  const probe = useVoiceProfileProbe({ configuredLanguages: configured, autoStart: true })
  const activeLanguage = migrateVoiceLanguageValue(draft.speechSynthesisLang).canonical
    ?? migrateVoiceLanguageValue(draft.uiLanguage).canonical
    ?? 'zh-CN'
  const activePlan = probe.profile?.languages.find((item) => item.language === activeLanguage)
    ?? probe.profile?.languages[0]
    ?? null

  const voicesRequested = useRef(false)
  useEffect(() => {
    if (voicesRequested.current || speechVoiceOptions.length > 0) return
    voicesRequested.current = true
    onLoadSpeechVoices()
  }, [onLoadSpeechVoices, speechVoiceOptions.length])

  function useThisComputer() {
    if (!activePlan) {
      void probe.run()
      return
    }
    setDraft((current) => applyVoiceSuggestion(current, activePlan))
  }

  const startMode = draft.voiceTriggerMode === 'wake_word'
    ? 'wake_word'
    : draft.voiceTriggerMode === 'direct_send'
      ? 'direct_send'
      : 'manual_confirm'

  return (
    <>
      <section className="settings-v3-section__body">
        <SimpleRow
          icon="laptop"
          title={ti('settings.simple.voice_computer')}
          hint={activePlan ? ti('settings.simple.voice_computer_ready') : ti('settings.simple.voice_computer_pending')}
        />
        {activePlan && !voiceSuggestionChangesSettings(draft, activePlan) ? null : (
          <div className="settings-v3-row">
            <button type="button" className="settings-v3-action" onClick={useThisComputer}>
              {ti('settings.simple.voice_use')}
            </button>
          </div>
        )}
      </section>

      <section className="settings-v3-section__body">
        <SimpleRow icon="voice" title={ti('settings.simple.voice_listen')} hint={ti('settings.simple.voice_listen_hint')}>
          <SettingsV3Switch
            checked={draft.speechInputEnabled}
            disabled={!inputAvailable}
            label={ti('settings.simple.voice_listen')}
            onChange={(speechInputEnabled) => {
              markVoiceSwitchesChosen()
              setDraft((current) => ({
                ...current,
                speechInputEnabled,
                ...(!speechInputEnabled ? { continuousVoiceModeEnabled: false } : {}),
              }))
            }}
          />
        </SimpleRow>
        <SimpleRow icon="speaker" tone="warning" title={ti('settings.simple.voice_speak')} hint={ti('settings.simple.voice_speak_hint')}>
          <SettingsV3Switch
            checked={draft.speechOutputEnabled}
            disabled={!outputAvailable}
            label={ti('settings.simple.voice_speak')}
            onChange={(speechOutputEnabled) => {
              markVoiceSwitchesChosen()
              setDraft((current) => ({ ...current, speechOutputEnabled }))
            }}
          />
        </SimpleRow>
      </section>

      <section className="settings-v3-section__body">
        <p>{ti('settings.simple.voice_start')}</p>
        <SimpleChoices
          label={ti('settings.simple.voice_start')}
          value={startMode}
          options={[
            { value: 'direct_send' as const, label: ti('settings.simple.voice_direct') },
            { value: 'wake_word' as const, label: ti('settings.simple.voice_name') },
          ]}
          onChange={(value) => {
            if (value !== 'direct_send' && value !== 'wake_word') return
            setDraft((current) => ({
              ...current,
              voiceTriggerMode: value,
              wakeWordEnabled: value === 'wake_word',
              ...(value === 'wake_word' && !current.wakeWord.trim()
                ? { wakeWord: getDirectSendFallbackWakeWord(current) }
                : {}),
            }))
          }}
        />
        {draft.voiceTriggerMode === 'wake_word' ? (
          <SettingsV3Field label={ti('settings.simple.wake_word')}>
            <input
              value={draft.wakeWord}
              onChange={(event) => setDraft((current) => ({ ...current, wakeWord: event.target.value }))}
            />
          </SettingsV3Field>
        ) : null}
        {startMode === 'manual_confirm' ? (
          <p>{ti('settings.simple.initiative_custom')}</p>
        ) : null}
      </section>

      <section className="settings-v3-section__body">
        <SettingsV3Field label={ti('settings.simple.voice_sound')}>
          <select
            aria-label={ti('settings.simple.voice_sound')}
            value={draft.speechOutputVoice}
            onChange={(event) => setDraft((current) => ({ ...current, speechOutputVoice: event.target.value }))}
          >
            {speechVoiceOptions.map((option) => {
              const label = pickTranslatedUiTextOrFallback(draft.uiLanguage, option.label) || option.label
              const shown = option.needsAuth
                ? `${label} ${ti('provider.tts.voice.volcengine.needs_auth_suffix')}`
                : label
              return <option key={option.id} value={option.id}>{shown}</option>
            })}
            {draft.speechOutputVoice && !speechVoiceOptions.some((option) => option.id === draft.speechOutputVoice) ? (
              <option value={draft.speechOutputVoice}>{draft.speechOutputVoice}</option>
            ) : null}
          </select>
        </SettingsV3Field>
      </section>

    </>
  )
}

export function VoiceKeepTalking({
  draft,
  setDraft,
}: {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
}) {
  const ti = simpleTranslate(draft.uiLanguage)
  return (
    <section className="settings-v3-section__body">
      <SimpleRow icon="waveform" title={ti('settings.simple.voice_keep')} hint={ti('settings.simple.voice_keep_hint')}>
        <SettingsV3Switch
          checked={draft.continuousVoiceModeEnabled}
          disabled={!draft.speechInputEnabled}
          label={ti('settings.simple.voice_keep')}
          onChange={(enabled) => setDraft((current) => ({ ...current, ...keepTalkingPatch(enabled) }))}
        />
      </SimpleRow>
    </section>
  )
}
