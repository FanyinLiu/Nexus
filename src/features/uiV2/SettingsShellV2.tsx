import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { PetControlIcon } from '../../components/PetControlIcon.tsx'
import {
  renderSettingsCardIcon,
  type SettingsCardIconKey,
} from '../../components/settingsDrawerIcons.tsx'
import {
  getSettingsV2NavigationIntent,
  type SettingsV2NavigationIntent,
} from './settingsNavigationIntent.ts'
import './settings-v2.css'

export type { SettingsV2NavigationIntent } from './settingsNavigationIntent.ts'

export type SettingsV2GroupId = 'companion' | 'voice' | 'privacy' | 'advanced'
export type SettingsV2Destination = 'home' | SettingsV2GroupId

export type SettingsV2Group = {
  id: SettingsV2GroupId
  label: string
  description: string
  icon: SettingsCardIconKey
  summary?: string
}

export type SettingsShellV2Labels = {
  settings: string
  home: string
  backToSettings: string
  returnToCompanion: string
  closeSettings: string
  unsavedChanges: string
  cancel: string
  save: string
  saving: string
  navigationLabel: string
}

export type SettingsShellV2Props = {
  activeDestination: SettingsV2Destination
  groups: readonly SettingsV2Group[]
  labels: SettingsShellV2Labels
  children?: ReactNode
  className?: string
  activeHeadingRef?: RefObject<HTMLHeadingElement | null>
  dirty?: boolean
  saving?: boolean
  saveDisabled?: boolean
  headerActions?: ReactNode
  onNavigate: (destination: SettingsV2Destination, intent: SettingsV2NavigationIntent) => void
  onClose: () => void
  onDiscardDraft?: () => void
  onSaveDraft?: () => void | Promise<void>
}

function joinClassNames(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ')
}

export function SettingsShellV2({
  activeDestination,
  groups,
  labels,
  children,
  className,
  activeHeadingRef,
  dirty = false,
  saving = false,
  saveDisabled = false,
  headerActions,
  onNavigate,
  onClose,
  onDiscardDraft,
  onSaveDraft,
}: SettingsShellV2Props) {
  const activeGroup = groups.find((group) => group.id === activeDestination)
  const isHome = activeDestination === 'home'
  const homeCardRefs = useRef<Partial<Record<SettingsV2GroupId, HTMLButtonElement | null>>>({})
  const pendingHomeFocusGroupRef = useRef<SettingsV2GroupId | null>(null)
  const canDiscard = dirty && !saving && Boolean(onDiscardDraft)
  const canSave = dirty && !saving && !saveDisabled && Boolean(onSaveDraft)

  useLayoutEffect(() => {
    if (!isHome) return
    const returnGroupId = pendingHomeFocusGroupRef.current
    if (!returnGroupId) return
    pendingHomeFocusGroupRef.current = null
    homeCardRefs.current[returnGroupId]?.focus()
  }, [isHome])

  const handleReturnToHome = (eventDetail: number) => {
    const intent = getSettingsV2NavigationIntent(eventDetail)
    pendingHomeFocusGroupRef.current = !isHome && intent.moveFocus ? activeDestination : null
    onNavigate('home', intent)
  }

  const handleSave = () => {
    if (!canSave || !onSaveDraft) return
    void onSaveDraft()
  }

  return (
    <section
      className={joinClassNames('settings-v2', className)}
      data-settings-v2-destination={activeDestination}
      aria-label={labels.settings}
    >
      <aside className="settings-v2__sidebar">
        <div className="settings-v2__sidebar-title">{labels.settings}</div>
        <nav className="settings-v2__nav" aria-label={labels.navigationLabel}>
          <button
            type="button"
            className={joinClassNames('settings-v2__nav-item', isHome && 'is-active')}
            aria-current={isHome ? 'page' : undefined}
            onClick={(event) => handleReturnToHome(event.detail)}
          >
            <span className="settings-v2__nav-icon" aria-hidden="true">
              <PetControlIcon name="settings" />
            </span>
            <span>{labels.home}</span>
          </button>
          {groups.map((group) => {
            const isActive = activeDestination === group.id
            return (
              <button
                key={group.id}
                type="button"
                className={joinClassNames('settings-v2__nav-item', isActive && 'is-active')}
                aria-current={isActive ? 'page' : undefined}
                onClick={(event) => onNavigate(group.id, getSettingsV2NavigationIntent(event.detail))}
              >
                <span className="settings-v2__nav-icon" aria-hidden="true">
                  {renderSettingsCardIcon(group.icon)}
                </span>
                <span>{group.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="settings-v2__main">
        <header className="settings-v2__header">
          <button
            type="button"
            className="settings-v2__mobile-back"
            aria-label={isHome ? labels.returnToCompanion : labels.backToSettings}
            onClick={(event) => isHome ? onClose() : handleReturnToHome(event.detail)}
          >
            <PetControlIcon name="back" aria-hidden="true" />
            <span>{isHome ? labels.returnToCompanion : labels.backToSettings}</span>
          </button>

          <div className="settings-v2__heading">
            <h1
              ref={!isHome ? activeHeadingRef : undefined}
              tabIndex={!isHome && activeHeadingRef ? -1 : undefined}
            >
              {isHome ? labels.settings : activeGroup?.label}
            </h1>
            {isHome || !activeGroup?.description ? null : <p>{activeGroup.description}</p>}
          </div>

          <div className="settings-v2__header-actions">
            {dirty ? (
              <span className="settings-v2__dirty-status" role="status">
                <span aria-hidden="true" />
                {labels.unsavedChanges}
              </span>
            ) : null}
            {headerActions}
            <button
              type="button"
              className="settings-v2__close"
              aria-label={labels.closeSettings}
              title={labels.closeSettings}
              onClick={onClose}
            >
              <PetControlIcon name="close" />
            </button>
          </div>
        </header>

        <div className="settings-v2__content">
          {isHome ? (
            <div className="settings-v2__home" aria-label={labels.settings}>
              {groups.map((group) => (
                <button
                  key={group.id}
                  ref={(node) => {
                    homeCardRefs.current[group.id] = node
                  }}
                  type="button"
                  className="settings-v2__home-card"
                  data-focus-return-group={group.id}
                  onClick={(event) => onNavigate(group.id, getSettingsV2NavigationIntent(event.detail))}
                >
                  <span className="settings-v2__home-icon" aria-hidden="true">
                    {renderSettingsCardIcon(group.icon)}
                  </span>
                  <span className="settings-v2__home-copy">
                    <strong>{group.label}</strong>
                    <span>{group.description}</span>
                    {group.summary ? <small>{group.summary}</small> : null}
                  </span>
                  <PetControlIcon
                    name="chevron-down"
                    className="settings-v2__home-chevron"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="settings-v2__section">{children}</div>
          )}
        </div>

        {!isHome && dirty ? (
          <footer className="settings-v2__draft-bar">
            <button
              type="button"
              className="settings-v2__draft-button settings-v2__draft-button--secondary"
              disabled={!canDiscard}
              onClick={onDiscardDraft}
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              className="settings-v2__draft-button settings-v2__draft-button--primary"
              disabled={!canSave}
              onClick={handleSave}
            >
              {saving ? labels.saving : labels.save}
            </button>
          </footer>
        ) : null}
      </div>
    </section>
  )
}
