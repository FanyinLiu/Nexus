import { useState } from 'react'
import { usePortraitDraftFlow } from '../hooks/usePortraitDraftFlow.ts'
import { portraitModelSummary, portraitProgressKey } from '../features/pet/portraitDraftFlow.ts'
import { SettingsV3Notice, SettingsV3Toolbar } from '../features/settingsV3/SettingsV3Primitives.tsx'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage, TranslationKey, TranslationParams } from '../types/i18n.ts'
import { PetControlIcon } from './PetControlIcon.tsx'
import { PortraitDraftPreview } from './PortraitDraftPreview.tsx'
import { PortraitDraftExport } from './PortraitDraftExport.tsx'

export function PortraitDraftSetup({ active, language }: { active: boolean; language: UiLanguage }) {
  const [expanded, setExpanded] = useState(false)
  const { state, refresh, setConsent, download, generate, setExportName, setExportAttribution, exportDraft } = usePortraitDraftFlow(active && expanded)
  const t = (key: TranslationKey, params?: TranslationParams) => pickTranslatedUiText(language, key, params)
  const summary = portraitModelSummary(state.status)
  const busy = state.downloading || state.generating || state.exporting || state.checking
  const progress = state.progress

  return (
    <details className="settings-v3-disclosure settings-v3-portrait" data-testid="portrait-flow-disclosure" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><span><strong>{t('settings.chat.portrait_flow.title')}</strong><small>{t('settings.chat.portrait_flow.hint')}</small></span><PetControlIcon name="chevron-down" aria-hidden="true" /></summary>
      <div className="settings-v3-disclosure__body">
        <SettingsV3Notice title={t('settings.chat.portrait_flow.local_only')}>
          {t('settings.chat.portrait_flow.draft_limit')}
        </SettingsV3Notice>
        {summary.models.map((model) => (
          <div className="settings-v3-field" key={model.id} data-model-id={model.id}>
            <span><a href={model.sourceUrl} target="_blank" rel="noreferrer">{model.sourceName}</a></span>
            <small><a href={model.licenseUrl} target="_blank" rel="noreferrer">{model.licenseSpdx}</a>{' · '}
              {t(model.trainingDataDocumented ? 'settings.chat.portrait_flow.training_documented' : 'settings.chat.portrait_flow.training_undisclosed')}
            </small>
          </div>
        ))}
        {state.checking ? <p role="status">{t('settings.chat.portrait_flow.checking')}</p> : null}
        {state.modelNotice ? <SettingsV3Notice tone="error" title={t(state.modelNotice.key, state.modelNotice.params)} /> : null}
        {summary.ready ? <SettingsV3Notice tone="success" title={t('settings.chat.portrait_flow.ready')} /> : (
          <>
            <p>{t('settings.chat.portrait_flow.download_size', { megabytes: summary.downloadMegabytes })}</p>
            <label className="settings-v3-portrait-consent">
              <input type="checkbox" data-testid="portrait-model-consent" checked={state.consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
              <span>{t('settings.chat.portrait_flow.consent')}</span>
            </label>
            {state.status && !state.status.releasePublished ? <SettingsV3Notice tone="warning" title={t('settings.chat.portrait_flow.release_unavailable')} /> : null}
            <SettingsV3Toolbar>
              <button type="button" data-testid="portrait-model-download" disabled={busy || !state.consent || !state.status?.releasePublished} onClick={() => void download()}>{t('settings.chat.portrait_flow.download')}</button>
            </SettingsV3Toolbar>
          </>
        )}
        {progress ? (
          <div role="status" aria-live="polite">
            <span>{t(portraitProgressKey(progress.phase))}</span>
            <progress data-testid="portrait-model-progress" aria-label={t('settings.chat.portrait_flow.downloading')} max={progress.totalBytes || undefined} value={progress.phase === 'downloading' ? progress.receivedBytes : undefined} />
          </div>
        ) : null}
        <SettingsV3Toolbar>
          <button type="button" data-testid="portrait-model-refresh" disabled={busy} onClick={() => void refresh()}>{t('settings.chat.portrait_flow.refresh')}</button>
          <button type="button" data-testid="portrait-draft-generate" disabled={busy || !summary.ready} onClick={() => void generate()}>{t(state.generating ? 'settings.chat.portrait_flow.generating' : 'settings.chat.portrait_flow.generate')}</button>
        </SettingsV3Toolbar>
        {state.draftNotice ? <div data-testid="portrait-draft-result"><SettingsV3Notice announce tone={state.draftNotice.error ? 'error' : 'info'} title={t(state.draftNotice.key, state.draftNotice.params)} /></div> : null}
        {active && expanded && state.preview ? <PortraitDraftPreview key={state.previewRevision} preview={state.preview} active={active && expanded} language={language} /> : null}
        {active && expanded && state.preview && state.draftId ? <PortraitDraftExport state={state} language={language} busy={busy} onNameChange={setExportName} onAttributionChange={setExportAttribution} onExport={exportDraft} /> : null}
      </div>
    </details>
  )
}
