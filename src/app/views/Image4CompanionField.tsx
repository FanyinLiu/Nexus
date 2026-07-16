import { Image4Signal } from './Image4Signal'

type Image4PresenceHeaderProps = {
  body: string
  signalActive: boolean
  statusLabel: string
  title: string
}

export function Image4PresenceHeader({
  body,
  signalActive,
  statusLabel,
  title,
}: Image4PresenceHeaderProps) {
  const presenceLabel = statusLabel ? `${title} · ${statusLabel}` : title

  return (
    <section className="companion-presence image4-presence" aria-label={presenceLabel}>
      <div className="companion-presence__topline">
        <div className="companion-presence__identity">
          <div className="companion-presence__copy">
            <strong>{title}</strong>
            <span>{body}</span>
          </div>
        </div>
      </div>
      <Image4Signal active={signalActive} />
    </section>
  )
}
