import { useEffect, useMemo, useState } from 'react'
import type {
  PetActionMapDraft,
  PetActionMapDraftPatch,
  PetExpressionSlot,
  PetLifecycleMotionSlot,
  PetPresenceStateMotionTarget,
  PetModelDefinition,
  PublicGestureName,
} from '../../../features/pet'
import {
  buildPetActionMapDraft,
  buildPetActionMapDraftPatch,
  buildPetActionMapReport,
  PET_EXPRESSION_SLOTS,
  PET_LIFECYCLE_MOTION_SLOTS,
  PUBLIC_GESTURE_NAMES,
} from '../../../features/pet'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'

type Live2DActionMapPanelProps = {
  petModel: PetModelDefinition | undefined
  ti: (key: TranslationKey, params?: TranslationParams) => string
  translatePetText: (value: string | undefined) => string
  hasSavedActionMapOverride: boolean
  onApplyActionMapDraft: (patch: PetActionMapDraftPatch) => void
  onClearActionMapOverride: () => void
}

function statusKey(status: string): TranslationKey {
  if (status === 'missing') return 'settings.chat.live2d_action_map.status.missing'
  if (status === 'sprite') return 'settings.chat.live2d_action_map.status.sprite'
  return 'settings.chat.live2d_action_map.status.mapped'
}

function motionTargetLabel(target: PetPresenceStateMotionTarget) {
  if (target.kind === 'gesture') return `gesture:${target.gesture}`
  return `lifecycle:${target.slot}`
}

function copyTextWithCopyEvent(value: string) {
  let copied = false
  const handleCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', value)
    event.preventDefault()
    copied = true
  }

  document.addEventListener('copy', handleCopy)
  try {
    return document.execCommand('copy') && copied
  } finally {
    document.removeEventListener('copy', handleCopy)
  }
}

function copyTextWithTextarea(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto 0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

async function copyText(value: string) {
  if (copyTextWithCopyEvent(value)) return
  if (copyTextWithTextarea(value)) return

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  throw new Error('copy command rejected')
}

export function Live2DActionMapPanel({
  petModel,
  ti,
  translatePetText,
  hasSavedActionMapOverride,
  onApplyActionMapDraft,
  onClearActionMapOverride,
}: Live2DActionMapPanelProps) {
  const [copyState, setCopyState] = useState<'idle' | 'report-copied' | 'draft-copied' | 'failed'>('idle')
  const [applyState, setApplyState] = useState<'idle' | 'applied' | 'cleared'>('idle')
  const [draft, setDraft] = useState<PetActionMapDraft | null>(null)
  const report = useMemo(() => (petModel ? buildPetActionMapReport(petModel) : null), [petModel])
  const defaultDraft = useMemo(() => (petModel ? buildPetActionMapDraft(petModel) : null), [petModel])

  useEffect(() => {
    setDraft(defaultDraft)
  }, [defaultDraft])

  if (!petModel || !report || !defaultDraft) return null

  const activeDraft = draft ?? defaultDraft
  const draftJson = JSON.stringify(activeDraft, null, 2)

  const copyValue = async (value: string, copiedState: typeof copyState) => {
    try {
      await copyText(value)
      setCopyState(copiedState)
    } catch {
      setCopyState('failed')
    }

    window.setTimeout(() => setCopyState('idle'), 1800)
  }

  const markApplied = (state: typeof applyState) => {
    setApplyState(state)
    window.setTimeout(() => setApplyState('idle'), 1800)
  }

  const updateExpressionTarget = (slot: PetExpressionSlot, value: string) => {
    setDraft((current) => ({
      ...(current ?? defaultDraft),
      expressions: {
        ...(current ?? defaultDraft).expressions,
        [slot]: value,
      },
    }))
  }

  const updateGestureTarget = (gesture: PublicGestureName, value: string) => {
    setDraft((current) => ({
      ...(current ?? defaultDraft),
      gestures: {
        ...(current ?? defaultDraft).gestures,
        [gesture]: value,
      },
    }))
  }

  const updateLifecycleTarget = (slot: PetLifecycleMotionSlot, value: string) => {
    setDraft((current) => ({
      ...(current ?? defaultDraft),
      lifecycleMotions: {
        ...(current ?? defaultDraft).lifecycleMotions,
        [slot]: value,
      },
    }))
  }

  const copyLabel = copyState === 'report-copied'
    ? ti('settings.chat.live2d_action_map.copy_copied')
    : copyState === 'failed'
      ? ti('settings.chat.live2d_action_map.copy_failed')
      : ti('settings.chat.live2d_action_map.copy')
  const draftCopyLabel = copyState === 'draft-copied'
    ? ti('settings.chat.live2d_action_map.copy_draft_copied')
    : copyState === 'failed'
      ? ti('settings.chat.live2d_action_map.copy_failed')
      : ti('settings.chat.live2d_action_map.copy_draft')
  const applyLabel = applyState === 'applied'
    ? ti('settings.chat.live2d_action_map.apply_draft_applied')
    : applyState === 'cleared'
      ? ti('settings.chat.live2d_action_map.clear_override_cleared')
      : ti('settings.chat.live2d_action_map.apply_draft')

  return (
    <details className="settings-mini-group settings-pet-preview-card settings-live2d-action-map">
      <summary className="settings-mini-group__head">
        <div>
          <h5>{ti('settings.chat.live2d_action_map.title')}</h5>
          <span>{ti('settings.chat.live2d_action_map.hint')}</span>
        </div>
      </summary>

      <div className="settings-context-diagnostics__traces">
        <div className="settings-context-diagnostics__trace">
          <dt>{ti('settings.chat.live2d_action_map.model')}</dt>
          <dd>{translatePetText(petModel.label) || petModel.id}</dd>
        </div>
        <div className="settings-context-diagnostics__trace">
          <dt>{ti('settings.chat.live2d_action_map.expressions')}</dt>
          <dd>{report.summary.mappedExpressions}/{report.summary.expressionSlots}</dd>
        </div>
        <div className="settings-context-diagnostics__trace">
          <dt>{ti('settings.chat.live2d_action_map.gestures')}</dt>
          <dd>{report.summary.mappedGestures}/{report.summary.publicGestures}</dd>
        </div>
        <div className="settings-context-diagnostics__trace">
          <dt>{ti('settings.chat.live2d_action_map.lifecycle')}</dt>
          <dd>{report.summary.mappedLifecycleMotions}/{report.summary.lifecycleMotions}</dd>
        </div>
        <div className="settings-context-diagnostics__trace">
          <dt>{ti('settings.chat.live2d_action_map.presence_states')}</dt>
          <dd>{report.summary.mappedPresenceStates}/{report.summary.presenceStates}</dd>
        </div>
        <div className="settings-context-diagnostics__trace">
          <dt>{ti('settings.chat.live2d_action_map.fidgets')}</dt>
          <dd>{report.summary.idleFidgets}</dd>
        </div>
      </div>

      <div className="settings-pet-kit-rows">
        {report.presenceStates.map((state) => (
          <span
            key={state.state}
            className={state.status === 'missing' ? 'is-missing' : 'is-ready'}
          >
            {state.state}: {state.expressionSlot} + {motionTargetLabel(state.motionTarget)}
          </span>
        ))}
        {report.gestures.map((gesture) => (
          <span
            key={gesture.gesture}
            className={gesture.status === 'missing' ? 'is-missing' : 'is-ready'}
          >
            {gesture.gesture}: {gesture.motionGroup ?? ti(statusKey(gesture.status))}
          </span>
        ))}
      </div>

      {report.summary.missing ? (
        <p className="settings-mini-group__note">
          {ti('settings.chat.live2d_action_map.missing_count', {
            count: String(report.summary.missing),
          })}
        </p>
      ) : (
        <p className="settings-mini-group__note">
          {ti('settings.chat.live2d_action_map.ready')}
        </p>
      )}

      <div className="settings-inline-row">
        <button
          type="button"
          className="ghost-button"
          onClick={() => void copyValue(JSON.stringify(report, null, 2), 'report-copied')}
        >
          {copyLabel}
        </button>
      </div>

      <div className="settings-live2d-action-map__draft">
        <div className="settings-mini-group__head">
          <div>
            <h5>{ti('settings.chat.live2d_action_map.draft_title')}</h5>
            <span>{ti('settings.chat.live2d_action_map.draft_hint')}</span>
          </div>
        </div>

        <div className="settings-live2d-action-map__editor">
          <section>
            <h6>{ti('settings.chat.live2d_action_map.draft_expressions')}</h6>
            <div className="settings-live2d-action-map__grid">
              {PET_EXPRESSION_SLOTS.map((slot) => (
                <label key={slot}>
                  <span>{slot}</span>
                  <input
                    type="text"
                    value={activeDraft.expressions[slot]}
                    placeholder={ti('settings.chat.live2d_action_map.target_placeholder')}
                    onChange={(event) => updateExpressionTarget(slot, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h6>{ti('settings.chat.live2d_action_map.draft_gestures')}</h6>
            <div className="settings-live2d-action-map__grid">
              {PUBLIC_GESTURE_NAMES.map((gesture) => (
                <label key={gesture}>
                  <span>{gesture}</span>
                  <input
                    type="text"
                    value={activeDraft.gestures[gesture]}
                    placeholder={ti('settings.chat.live2d_action_map.target_placeholder')}
                    onChange={(event) => updateGestureTarget(gesture, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h6>{ti('settings.chat.live2d_action_map.draft_lifecycle')}</h6>
            <div className="settings-live2d-action-map__grid">
              {PET_LIFECYCLE_MOTION_SLOTS.map((slot) => (
                <label key={slot}>
                  <span>{slot}</span>
                  <input
                    type="text"
                    value={activeDraft.lifecycleMotions[slot]}
                    placeholder={ti('settings.chat.live2d_action_map.target_placeholder')}
                    onChange={(event) => updateLifecycleTarget(slot, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>

        <textarea
          className="settings-live2d-action-map__draft-json"
          readOnly
          rows={6}
          aria-label={ti('settings.chat.live2d_action_map.draft_title')}
          value={draftJson}
        />

        <div className="settings-inline-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setDraft(defaultDraft)}
          >
            {ti('settings.chat.live2d_action_map.reset_draft')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void copyValue(draftJson, 'draft-copied')}
          >
            {draftCopyLabel}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onApplyActionMapDraft(buildPetActionMapDraftPatch(activeDraft))
              markApplied('applied')
            }}
          >
            {applyLabel}
          </button>
          {hasSavedActionMapOverride ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                onClearActionMapOverride()
                setDraft(defaultDraft)
                markApplied('cleared')
              }}
            >
              {ti('settings.chat.live2d_action_map.clear_override')}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}
