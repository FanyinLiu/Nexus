import { memo, useEffect, useState } from 'react'
import { planStore, type Plan } from '../features/plan/planStore'
import { useTranslation } from '../i18n/useTranslation.ts'
import type { TranslationKey } from '../types/i18n'

const STATUS_LABEL_KEY: Record<Plan['status'], TranslationKey> = {
  draft: 'plan.status.draft',
  active: 'plan.status.active',
  completed: 'plan.status.completed',
  aborted: 'plan.status.aborted',
}

function formatTime(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

const PlanRow = memo(function PlanRow({ plan, onRemove }: { plan: Plan; onRemove: () => void }) {
  const { t, locale } = useTranslation()
  const completedCount = plan.steps.filter((s) => s.status === 'completed').length
  const total = plan.steps.length

  return (
    <article className="settings-plan-card" data-status={plan.status}>
      <div className="settings-plan-card__header">
        <strong className="settings-plan-card__goal">
          {plan.goal}
        </strong>
        <span className="settings-plan-card__time">{formatTime(plan.updatedAt, locale)}</span>
      </div>
      <div className="settings-plan-card__meta">
        {t(STATUS_LABEL_KEY[plan.status])} · {completedCount}/{total}
      </div>
      <ul className="settings-plan-card__steps">
        {plan.steps.map((step) => (
          <li
            key={step.id}
            className="settings-plan-card__step"
            data-status={step.status}
          >
            <span className="settings-plan-card__step-icon" aria-hidden="true" />
            <span className="settings-plan-card__step-text">
              {step.text}
              {step.result && step.status === 'failed' && (
                <span className="settings-plan-card__step-error" role="alert" aria-live="assertive" aria-atomic="true">
                  {step.result}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {(plan.status === 'completed' || plan.status === 'aborted') && (
        <button
          type="button"
          className="settings-plan-card__remove"
          onClick={onRemove}
        >
          {t('plan.remove')}
        </button>
      )}
    </article>
  )
})

export const PlanPanel = memo(function PlanPanel() {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<Plan[]>(() => planStore.list())

  useEffect(() => {
    return planStore.subscribe(setPlans)
  }, [])

  if (plans.length === 0) {
    return (
      <p className="settings-plan-panel__empty">
        {t('plan.empty_state')}
      </p>
    )
  }

  return (
    <div className="settings-plan-panel">
      {plans.map((plan) => (
        <PlanRow key={plan.id} plan={plan} onRemove={() => planStore.remove(plan.id)} />
      ))}
    </div>
  )
})
