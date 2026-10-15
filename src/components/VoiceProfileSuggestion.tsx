/**
 * Onboarding and settings card for the voice-tier suggestion.
 *
 * The probe can be skipped and never gates the rest of the form.
 * Accepting a plan is the only write. That accept also asks the
 * existing model catalog to download SenseVoice (or MeloTTS) when
 * the file is not already present. Engines that are not wired
 * (Kokoro, Supertonic) stay in the selector and are not shown.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  applyVoiceSuggestion,
  configuredVoiceLanguages,
  migrateVoiceLanguageValue,
  selectVoiceProfile,
  shouldAlignStockVoiceLanguage,
  voiceSuggestionChangesSettings,
} from '../features/voiceProfile/index.ts'
import { SENSEVOICE_CATALOG_ID } from '../features/voice/senseVoiceInstall.ts'
import { useVoiceProfileProbe } from '../hooks/useVoiceProfileProbe.ts'
import { humanizeError } from '../lib/humanizeError.ts'
import { UI_LANGUAGE_OPTIONS, pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { AppSettings, TranslationKey } from '../types'

type VoiceProfileSuggestionProps = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  mode: 'onboarding' | 'settings'
}

function languageLabel(language: string) {
  return UI_LANGUAGE_OPTIONS.find((option) => option.value === language)?.nativeLabel ?? language
}

export function VoiceProfileSuggestion({ draft, setDraft, mode }: VoiceProfileSuggestionProps) {
  const ti = (
    key: TranslationKey,
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(draft.uiLanguage, key, params)
  const configured = useMemo(() => configuredVoiceLanguages({
    uiLanguage: draft.uiLanguage,
    speechRecognitionLang: draft.speechRecognitionLang,
    speechSynthesisLang: draft.speechSynthesisLang,
  }), [draft.speechRecognitionLang, draft.speechSynthesisLang, draft.uiLanguage])
  const probe = useVoiceProfileProbe({
    configuredLanguages: configured,
    autoStart: mode === 'onboarding',
  })
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const alignedRef = useRef(false)

  useEffect(() => {
    if (mode !== 'onboarding' || alignedRef.current) return
    if (!shouldAlignStockVoiceLanguage(draft)) {
      alignedRef.current = true
      return
    }
    const ui = migrateVoiceLanguageValue(draft.uiLanguage).canonical
    if (!ui) return
    const plan = selectVoiceProfile({
      tier: 'mid',
      threads: 2,
      reasons: ['stock-language'],
      configuredLanguages: [ui],
    }).languages.find((item) => item.language === ui)
    if (!plan) return
    alignedRef.current = true
    setDraft((current) => applyVoiceSuggestion(current, plan))
  }, [draft, mode, setDraft])

  const activeLanguage = migrateVoiceLanguageValue(draft.speechSynthesisLang).canonical
    ?? migrateVoiceLanguageValue(draft.speechRecognitionLang).canonical
    ?? migrateVoiceLanguageValue(draft.uiLanguage).canonical
    ?? 'zh-CN'
  const activePlan = probe.profile?.languages.find((item) => item.language === activeLanguage) ?? null
  const tierLabel = probe.profile
    ? ti(`onboarding.voice.profile.tier_${probe.profile.tier}` as TranslationKey)
    : ''

  const accept = (useOffline: boolean) => {
    if (!activePlan) return
    setDraft((current) => applyVoiceSuggestion(current, activePlan, { useOfflineAlternative: useOffline }))
    const catalogId = useOffline && activePlan.offlineAlternative
      ? activePlan.offlineAlternative.catalogId
      : SENSEVOICE_CATALOG_ID
    setDownloadError(null)
    void downloadCatalogModelIfMissing(catalogId).catch((error) => {
      setDownloadError(humanizeError(error, 'model'))
    })
  }

  const buttonClass = mode === 'onboarding' ? 'primary-button' : undefined
  const actionsClass = mode === 'settings' ? 'settings-v3-toolbar' : undefined

  return (
    <section className="onboarding-subsection" aria-live="polite">
      <strong>{ti('onboarding.voice.profile.title')}</strong>
      {mode === 'settings' ? <p className="onboarding-tip">{ti('onboarding.voice.profile.suggest_only')}</p> : null}
      {probe.phase === 'running' ? <p className="onboarding-tip">{ti('onboarding.voice.profile.detecting')}</p> : null}
      {probe.phase === 'unavailable' ? <p className="onboarding-tip">{ti('onboarding.voice.profile.unavailable')}</p> : null}
      {probe.phase === 'skipped' ? <p className="onboarding-tip">{ti('onboarding.voice.profile.skipped')}</p> : null}
      {probe.timedOut ? <p className="onboarding-tip">{ti('onboarding.voice.profile.timeout')}</p> : null}
      {probe.profile && probe.phase === 'ready' ? (
        <>
          <p className="onboarding-tip">{ti('onboarding.voice.profile.tier', { tier: tierLabel })}</p>
          <ul>
            {probe.profile.languages.map((plan) => (
              <li key={plan.language}>
                {ti('onboarding.voice.profile.row', {
                  language: languageLabel(plan.language),
                  mark: plan.configured ? ti('onboarding.voice.profile.in_use') : '',
                  stt: ti('onboarding.voice.profile.stt_sensevoice'),
                  tts: plan.applied.ttsProviderId === 'local-tts'
                    ? ti('onboarding.voice.profile.tts_melo')
                    : ti('onboarding.voice.profile.tts_edge'),
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {downloadError ? <p className="settings-test-result is-error" role="alert">{downloadError}</p> : null}
      <div className={actionsClass}>
        {probe.phase === 'running' ? (
          <button className={buttonClass} type="button" onClick={probe.skip}>{ti('onboarding.voice.profile.skip')}</button>
        ) : (
          <button className={buttonClass} type="button" onClick={() => void probe.run()}>
            {probe.phase === 'idle' ? ti('onboarding.voice.profile.check') : ti('onboarding.voice.profile.retry')}
          </button>
        )}
        {activePlan && voiceSuggestionChangesSettings(draft, activePlan) ? (
          <button className={buttonClass} type="button" onClick={() => accept(false)}>
            {ti('onboarding.voice.profile.apply', { language: languageLabel(activePlan.language) })}
          </button>
        ) : null}
        {activePlan?.offlineAlternative ? (
          <button className={buttonClass} type="button" onClick={() => accept(true)}>
            {ti('onboarding.voice.profile.use_offline')}
          </button>
        ) : null}
      </div>
    </section>
  )
}

async function downloadCatalogModelIfMissing(catalogId: string) {
  const download = window.desktopPet?.modelsDownload
  if (!download) return
  const inventory = await window.desktopPet?.modelsGetInventory?.()
  const entry = inventory?.models.find((model) => model.id === catalogId)
  if (entry?.present) return
  await download(catalogId)
}
