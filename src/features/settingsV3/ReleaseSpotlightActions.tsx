import type { ReleaseSpotlightAction } from '../../features/releaseNotes'
import type { TranslationKey } from '../../types/i18n'
import { PetControlIcon } from '../PetControlIcon'

type ReleaseSpotlightActionsProps = {
  actions: readonly ReleaseSpotlightAction[]
  className: string
  iconClassName: string
  translate: (key: TranslationKey) => string
  onOpenSettingsSection?: (sectionId: ReleaseSpotlightAction['targetSectionId']) => void
}

export function ReleaseSpotlightActions({
  actions,
  className,
  iconClassName,
  translate,
  onOpenSettingsSection,
}: ReleaseSpotlightActionsProps) {
  if (!onOpenSettingsSection) return null

  return (
    <div className={className}>
      {actions.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={index === 0 ? 'primary-button' : 'ghost-button'}
          onClick={() => onOpenSettingsSection(item.targetSectionId)}
        >
          <PetControlIcon
            name={item.id === 'open_voice' ? 'mic' : 'sparkles'}
            className={iconClassName}
          />
          <span>{translate(item.labelKey)}</span>
        </button>
      ))}
    </div>
  )
}
