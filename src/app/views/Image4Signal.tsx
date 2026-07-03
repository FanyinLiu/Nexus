import type { CSSProperties } from 'react'

const IMAGE4_SIGNAL_BAR_COUNT = 64

function getImage4SignalBarHeight(index: number): number {
  const t = index / (IMAGE4_SIGNAL_BAR_COUNT - 1)
  const base = index % 3 === 0 ? 6.4 : 4.2
  const leftGlow = 11.5 * Math.exp(-(((t - 0.1) / 0.06) ** 2))
  const midBreath = 2.2 * Math.sin(t * 6.2)
  const rightPulse = 11.5 * Math.exp(-(((t - 0.78) / 0.18) ** 2))
  const microWave = 1.8 * Math.sin(index * 0.55 + t * 4.2) + 1.2 * Math.sin(index * 0.18 - t * 3.1)
  const spike = ((index % 17 === 0 ? 9 : 0) + (index % 29 === 0 ? 6 : 0)) * Math.exp(-(((t - 0.72) / 0.22) ** 2))
  return Math.max(3, Math.round(base + leftGlow + midBreath + rightPulse + microWave + spike))
}

function getImage4SignalBarColor(index: number): string {
  const p = index / (IMAGE4_SIGNAL_BAR_COUNT - 1)
  if (p > 0.44 && p < 0.58) return 'rgba(255, 200, 170, 0.34)'
  if (p > 0.72) return 'rgba(255, 178, 150, 0.3)'
  return 'rgba(255, 190, 150, 0.28)'
}

function getImage4SignalBarDelay(index: number): number {
  const phase = Math.floor(index / 22) * 120
  return -((index % 8) * 70 + phase)
}

type Image4SignalProps = {
  active: boolean
}

export function Image4Signal({ active }: Image4SignalProps) {
  return (
    <div className={`companion-presence__signal ${active ? 'is-speaking' : 'is-idle'}`} aria-hidden="true">
      <span className="companion-presence__signal-bars">
        {Array.from({ length: IMAGE4_SIGNAL_BAR_COUNT }, (_, index) => (
          <span
            key={index}
            className={`companion-presence__signal-bar ${index % 3 === 0 ? 'is-steady' : 'is-live'}`}
            style={{
              '--image4-signal-bar-color': getImage4SignalBarColor(index),
              '--image4-signal-bar-delay': `${getImage4SignalBarDelay(index)}ms`,
              '--image4-signal-bar-height': `${getImage4SignalBarHeight(index)}px`,
            } as CSSProperties}
          />
        ))}
      </span>
    </div>
  )
}
