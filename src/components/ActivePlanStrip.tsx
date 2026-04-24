import { memo, useEffect, useState } from 'react'
import { useTranslation } from '../i18n/useTranslation.ts'
import { planStore, type Plan } from '../features/plan/planStore'

function pickActivePlan(plans: Plan[]): Plan | undefined {
  return plans.find((p) => p.status === 'active')
}

const STEP_ICON: Record<Plan['steps'][number]['status'], string> = {
  completed: '●',
  in_progress: '◐',
  failed: '✕',
  skipped: '◌',
  pending: '○',
}

const STEP_ICON_TONE: Record<Plan['steps'][number]['status'], string> = {
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

  return (
    <div className="active-plan-strip">
      <button
        type="button"
        className="active-plan-strip__header"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="active-plan-strip__title-row">
          <span className="active-plan-strip__eyebrow">{t('plan_strip.executing')}</span>
          <span className="active-plan-strip__goal">{activePlan.goal}</span>
          <span className={`active-plan-strip__counter${failed ? ' is-failed' : ''}`}>
            {completed}/{total}
            {failed ? t('plan_strip.failed_suffix', { count: failed }) : ''}
          </span>
        </div>
        <div className="active-plan-strip__progress">
          <div
            className={`active-plan-strip__progress-fill${failed ? ' is-failed' : ''}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {currentStep && !expanded ? (
          <div className="active-plan-strip__current">
            <span className="active-plan-strip__current-icon">◐</span>
            {currentStep.text}
          </div>
        ) : null}
      </button>

      {expanded ? (
        <ul className="active-plan-strip__steps">
          {activePlan.steps.map((step) => (
            <li key={step.id} className="active-plan-strip__step">
              <span className={`active-plan-strip__step-icon ${STEP_ICON_TONE[step.status]}`}>
                {STEP_ICON[step.status]}
              </span>
              <span className={`active-plan-strip__step-text${step.status === 'skipped' ? ' is-skipped' : ''}`}>
                {step.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
})
