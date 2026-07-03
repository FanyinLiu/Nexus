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

type Image4DialProps = {
  clockLabel: string
  dateLabel: string
  greeting: string
  speaking: boolean
  weatherLabel: string
}

export function Image4Dial({
  clockLabel,
  dateLabel,
  greeting,
  speaking,
  weatherLabel,
}: Image4DialProps) {
  const metaLabel = `${dateLabel} · ${weatherLabel}`

  return (
    <div className="image4-dial-stage">
      <div
        className="companion-presence__dial"
        aria-label={`${greeting} ${clockLabel} ${metaLabel}`}
        data-dial-speaking={speaking ? 'true' : 'false'}
      >
        <span className="companion-presence__dial-layer companion-presence__dial-layer--glow" aria-hidden="true" />
        <span className="companion-presence__dial-layer companion-presence__dial-layer--base" aria-hidden="true" />
        <span className="companion-presence__dial-layer companion-presence__dial-layer--arc" aria-hidden="true" />
        <span className="companion-presence__dial-layer companion-presence__dial-layer--moon" aria-hidden="true" />
        <span className="companion-presence__dial-layer companion-presence__dial-layer--ring" aria-hidden="true" />
        <span className="companion-presence__dial-voice" aria-hidden="true">
          <span className="companion-presence__dial-voice-ring companion-presence__dial-voice-ring--outer" />
          <span className="companion-presence__dial-voice-ring companion-presence__dial-voice-ring--middle" />
          <span className="companion-presence__dial-voice-ring companion-presence__dial-voice-ring--inner" />
          <span className="companion-presence__dial-voice-core" />
        </span>
        <span className="companion-presence__dial-band">{greeting}</span>
        <strong>{clockLabel}</strong>
        <span className="companion-presence__dial-meta" aria-label={metaLabel}>
          <span className="companion-presence__dial-meta__date">{dateLabel}</span>
          <span className="companion-presence__dial-meta__weather">{weatherLabel}</span>
        </span>
      </div>
    </div>
  )
}
