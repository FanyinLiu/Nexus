import { memo, useEffect, useState } from 'react'
import { useTranslation } from '../i18n/useTranslation.ts'
import { planStore, type Plan } from '../features/plan/planStore'

function pickActivePlan(plans: Plan[]): Plan | undefined {
  return plans.find((p) => p.status === 'active')
}

const STEP_MARKER_TONE: Record<Plan['steps'][number]['status'], string> = {
  completed: 'is-completed',
  in_progress: 'is-progress',
  failed: 'is-failed',
  skipped: 'is-skipped',
  pending: 'is-pending',
}

export const ActivePlanStrip = memo(function ActivePlanStrip() {
  const { t } = useTranslation()
  const [activePlan, setActivePlan] = useState<Plan | undefined>(() =>
    pickActivePlan(planStore.list()),
  )
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    return planStore.subscribe((plans) => setActivePlan(pickActivePlan(plans)))
  }, [])

  if (!activePlan) return null

  const total = activePlan.steps.length
  const completed = activePlan.steps.filter((s) => s.status === 'completed').length
  const failed = activePlan.steps.filter((s) => s.status === 'failed').length
  const currentStep =
    activePlan.steps.find((s) => s.status === 'in_progress')
    ?? activePlan.steps.find((s) => s.status === 'pending')
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0
  const failedLabel = failed ? t('plan_strip.failed_suffix', { count: failed }) : ''
  const headerLabel = `${t('plan_strip.executing')}: ${activePlan.goal} (${completed}/${total}${failedLabel})`
  const stepsId = `active-plan-strip-steps-${encodeURIComponent(activePlan.id)}`

  return (
    <div className="active-plan-strip">
      <button
        type="button"
        className="active-plan-strip__header"
        aria-expanded={expanded}
        aria-controls={stepsId}
        aria-label={headerLabel}
        title={headerLabel}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="active-plan-strip__title-row">
          <span className="active-plan-strip__eyebrow">{t('plan_strip.executing')}</span>
          <span className="active-plan-strip__goal">{activePlan.goal}</span>
          <span className={`active-plan-strip__counter${failed ? ' is-failed' : ''}`}>
            {completed}/{total}
            {failedLabel}
          </span>
        </div>
        <progress
          className={`active-plan-strip__progress${failed ? ' is-failed' : ''}`}
          value={progressPct}
          max={100}
          aria-hidden="true"
        />
        {currentStep && !expanded ? (
          <div className="active-plan-strip__current">
            <span className="active-plan-strip__current-icon is-progress" aria-hidden="true" />
            {currentStep.text}
          </div>
        ) : null}
      </button>

      <ul id={stepsId} className="active-plan-strip__steps" hidden={!expanded}>
        {activePlan.steps.map((step) => (
          <li key={step.id} className="active-plan-strip__step">
            <span className={`active-plan-strip__step-icon ${STEP_MARKER_TONE[step.status]}`} aria-hidden="true" />
            <span className={`active-plan-strip__step-text${step.status === 'skipped' ? ' is-skipped' : ''}`}>
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
})
