import { PetControlIcon, type PetControlIconName } from '../../components/PetControlIcon'

type PanelToolbarButtonProps = {
  icon: PetControlIconName
  label: string
  onClick: () => void
  tone?: 'default' | 'settings' | 'collapse' | 'danger'
  settingsOpener?: boolean
}

export function PanelToolbarButton({
  icon,
  label,
  onClick,
  tone = 'default',
  settingsOpener = false,
}: PanelToolbarButtonProps) {
  const toneClass = tone === 'default' ? '' : ` panel-window__icon-button--${tone}`

  return (
    <button
      className={`panel-window__icon-button${toneClass}`}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-settings-opener={settingsOpener ? 'true' : undefined}
    >
      <PetControlIcon name={icon} />
    </button>
  )
}
