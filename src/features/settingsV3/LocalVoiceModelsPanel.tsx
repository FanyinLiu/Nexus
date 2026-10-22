import { useCallback, useEffect, useState } from 'react'
import {
  buildLocalModelRows,
  localModelCopy,
  missingVoiceModelIds,
  voiceModelDownloadPayload,
  localModelCanResume,
  localModelDiskBlocksDownload,
  localModelDownloadAction,
  type LocalModelInventoryView,
} from '../setup/localModelRepair.ts'
import {
  mergeModelProgress,
  type PerModelProgress,
} from '../setup/modelSetupState.ts'
import { humanizeError } from '../../lib/humanizeError.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'
import {
  SettingsV3Notice,
  SettingsV3Section,
  SettingsV3Toolbar,
} from './SettingsV3Primitives.tsx'

type LocalVoiceModelsPanelProps = {
  uiLanguage: UiLanguage
  speechInputProviderId: string
  onMissingCount?: (count: number | null) => void
}

/**
 * Local model status and download on the Voice page. Dismissal of the
 * first-launch dialog does not hide this panel.
 */
export function LocalVoiceModelsPanel({
  uiLanguage,
  speechInputProviderId,
  onMissingCount,
}: LocalVoiceModelsPanelProps) {
  const ti = useCallback(
    (
      key: Parameters<typeof pickTranslatedUiText>[1],
      params?: Parameters<typeof pickTranslatedUiText>[2],
    ) => pickTranslatedUiText(uiLanguage, key, params),
    [uiLanguage],
  )
  const [inventory, setInventory] = useState<LocalModelInventoryView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<Record<string, PerModelProgress>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hadFailure, setHadFailure] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await window.desktopPet?.modelsGetInventory?.()
      setInventory(next ?? null)
    } catch (err) {
      console.warn('[voice] modelsGetInventory failed:', err)
      setInventory(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadInventory = window.desktopPet?.modelsGetInventory
    void Promise.resolve(loadInventory ? loadInventory() : null).then((next) => {
      if (cancelled) return
      setInventory(next ?? null)
      setLoaded(true)
    }).catch((err) => {
      console.warn('[voice] modelsGetInventory failed:', err)
      if (cancelled) return
      setInventory(null)
      setLoaded(true)
    })

    const unsubscribe = window.desktopPet?.subscribeModelsProgress?.((event) => {
      setProgress((current) => mergeModelProgress(current, event))
      if (event.phase === 'installed' || event.phase === 'done') {
        void refresh()
      } else if (event.phase === 'error') {
        setHadFailure(true)
        setError(event.message
          ? humanizeError(new Error(event.message), 'model')
          : ti('settings.voice.local_models_failed'))
      }
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [refresh, ti])

  useEffect(() => {
    if (!loaded) return
    onMissingCount?.(inventory ? missingVoiceModelIds(inventory.models, speechInputProviderId).length : null)
  }, [inventory, loaded, onMissingCount, speechInputProviderId])

  if (!loaded) return null

  if (!inventory) {
    return (
      <SettingsV3Section title={ti('settings.voice.local_models_title')}>
        <SettingsV3Notice tone="warning" title={ti('settings.voice.local_models_unavailable')} />
      </SettingsV3Section>
    )
  }

  const rows = buildLocalModelRows(inventory.models, progress).map((row) => ({
    ...row,
    label: localModelCopy(row, ti).label,
  }))
  const neededIds = missingVoiceModelIds(inventory.models, speechInputProviderId)
  const missingCount = neededIds.length
  const stillNeeded = missingCount
  const busyPercent = rows.find((row) => row.status === 'downloading')?.percent
  const diskBlocked = localModelDiskBlocksDownload(inventory.disk)
  const action = localModelDownloadAction({
    missingCount,
    resumable: localModelCanResume(inventory),
    hadFailure,
  })
  const actionLabel = action === 'resume'
    ? ti('settings.voice.local_models_resume')
    : action === 'retry'
      ? ti('settings.voice.local_models_retry')
      : ti('settings.voice.local_models_download')

  const startDownload = () => {
    setBusy(true)
    setError(null)
    const resumableIds = inventory.models
      .filter((model) => model.resumable && !model.present)
      .map((model) => model.id)
    const requiredIds = new Set(neededIds)
    const run = async () => {
      if (missingCount > 0) {
        const result = await window.desktopPet?.modelsDownloadMissing?.(
          voiceModelDownloadPayload(speechInputProviderId),
        )
        if (result?.inventory) setInventory(result.inventory)
        const failed = result?.results.filter((item) => !item.ok) ?? []
        if (failed.length) {
          setHadFailure(true)
          const explained = failed.map((item) => (
            item.message ? humanizeError(new Error(item.message), 'model') : item.id
          ))
          setError(explained.length === failed.length && failed.every((item) => item.message)
            ? explained.join(' ')
            : ti('settings.voice.local_models_partial', { ids: failed.map((item) => item.id).join(', ') }))
        } else {
          setHadFailure(false)
        }
      }
      // Required ids are already fetched above. An optional model can still
      // have a partial after that set is installed.
      for (const id of resumableIds) {
        if (requiredIds.has(id)) continue
        const next = await window.desktopPet?.modelsDownload?.(id)
        if (next) setInventory(next)
      }
    }
    void run()
      .catch((err) => {
        setHadFailure(true)
        setError(humanizeError(err, 'model'))
      })
      .finally(() => {
        setBusy(false)
        void refresh()
      })
  }

  return (
    <SettingsV3Section
      title={ti('settings.voice.local_models_title')}
      description={ti('settings.voice.local_models_hint')}
    >
      {diskBlocked ? (
        <SettingsV3Notice tone="warning" title={ti('settings.voice.local_models_disk')} />
      ) : null}
      {error ? <SettingsV3Notice tone="error" title={error} announce /> : null}
      {missingCount === 0 && !error ? (
        <SettingsV3Notice tone="success" title={ti('settings.voice.local_models_ready')} />
      ) : null}
      {stillNeeded > 0 ? (
        <p className="settings-v3-voice-models__summary">
          {ti(
            stillNeeded === 1
              ? 'settings.voice.local_models_missing_one'
              : 'settings.voice.local_models_missing',
            { count: stillNeeded },
          )}
        </p>
      ) : null}
      <ul className="settings-v3-voice-models">
        {rows.map((row) => (
          <li key={row.id} className="settings-v3-voice-models__row" data-state={row.status}>
            <div className="settings-v3-voice-models__head">
              <strong>{row.label}</strong>
              <span className="settings-v3-voice-models__size">{row.sizeLabel}</span>
            </div>
            <div className="settings-v3-voice-models__status">
              {row.status === 'installed'
                ? ti('settings.voice.local_models_installed')
                : row.status === 'downloading'
                  ? ti('settings.voice.local_models_downloading', { percent: row.percent ?? 0 })
                  : row.status === 'failed'
                    ? ti('settings.voice.local_models_failed')
                    : ti('settings.voice.local_models_pending')}
              {!row.required ? ` · ${ti('model_setup.optional_tag')}` : ''}
            </div>
            {row.status === 'downloading' && row.percent !== null ? (
              <progress
                value={row.percent}
                max={100}
                aria-label={`${row.label} ${ti('settings.voice.local_models_downloading', { percent: row.percent })}`}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <SettingsV3Toolbar>
        {action !== 'none' ? (
          <button
            type="button"
            className="primary-button settings-v3-voice-models__download"
            onClick={startDownload}
            aria-busy={busy ? 'true' : undefined}
            disabled={busy || diskBlocked || !window.desktopPet?.modelsDownloadMissing}
          >
            {busy ? ti('settings.voice.local_models_downloading', { percent: busyPercent ?? 0 }) : actionLabel}
          </button>
        ) : null}
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          {ti('settings.voice.local_models_refresh')}
        </button>
      </SettingsV3Toolbar>
    </SettingsV3Section>
  )
}
