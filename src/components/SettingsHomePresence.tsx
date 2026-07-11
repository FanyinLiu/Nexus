import { PetControlIcon } from './PetControlIcon.tsx'

type SettingsHomePresenceProps = {
  badge: string
  title: string
  body: string
}

export function SettingsHomePresence({
  badge,
  title,
  body,
}: SettingsHomePresenceProps) {
  return (
    <section
      className="settings-home-presence"
      aria-labelledby="settings-home-presence-title"
    >
      <span className="settings-home-presence__icon" aria-hidden="true">
        <PetControlIcon name="settings" />
      </span>
      <div className="settings-home-presence__copy">
        <span className="settings-home-presence__badge">
          {badge}
        </span>
        <strong id="settings-home-presence-title">
          {title}
        </strong>
        <span className="settings-home-presence__body">
          {body}
        </span>
      </div>
    </section>
  )
}
