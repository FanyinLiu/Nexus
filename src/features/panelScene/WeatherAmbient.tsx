import { useEffect, useMemo, useState } from 'react'
import type { WeatherCondition, TimeOfDayBand } from './weatherCondition.ts'
import { getTimeOfDayBand } from './weatherCondition.ts'

type WeatherAmbientProps = {
  condition: WeatherCondition | null
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000

// Particle counts per condition — tuned so "heavy" reads as heavier, not
// just more. Keeping numbers as named constants so the WeatherAmbient JSX
// below stays readable and the diff when we tune densities is obvious.
const RAIN_COUNT = {
  drizzle: 50,
  rain: 120,
  heavy_rain: 220,
  thunder: 140,
  storm: 240,
} as const

const SNOW_COUNT = {
  light_snow: 38,
  snow: 80,
  heavy_snow: 160,
} as const

const WIND_COUNT = {
  breeze: 18,
  gale: 56,
} as const

export function WeatherAmbient({ condition }: WeatherAmbientProps) {
  const [band, setBand] = useState<TimeOfDayBand>(() => getTimeOfDayBand())

  useEffect(() => {
    const update = () => setBand(getTimeOfDayBand())
    const intervalId = window.setInterval(update, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [])

  const rainDrops = useMemo(
    () => makeIndexArray(
      condition === 'drizzle' ? RAIN_COUNT.drizzle
        : condition === 'heavy_rain' ? RAIN_COUNT.heavy_rain
          : condition === 'thunder' ? RAIN_COUNT.thunder
            : condition === 'storm' ? RAIN_COUNT.storm
              : condition === 'rain' ? RAIN_COUNT.rain
                : 0,
    ),
    [condition],
  )
  const snowFlakes = useMemo(
    () => makeIndexArray(
      condition === 'light_snow' ? SNOW_COUNT.light_snow
        : condition === 'heavy_snow' ? SNOW_COUNT.heavy_snow
          : condition === 'snow' ? SNOW_COUNT.snow
            : 0,
    ),
    [condition],
  )
  const windStreaks = useMemo(
    () => makeIndexArray(
      condition === 'breeze' ? WIND_COUNT.breeze
        : condition === 'gale' ? WIND_COUNT.gale
          : 0,
    ),
    [condition],
  )
  const cloudBlobs = useMemo(
    () => makeIndexArray(
      condition === 'overcast' ? 8
        : condition === 'partly_cloudy' ? 3
          : 0,
    ),
    [condition],
  )
  const dustMotes = useMemo(
    () => makeIndexArray(condition === 'clear' ? 40 : 0),
    [condition],
  )

  if (!condition) return null

  const rootClass = `weather-ambient weather-ambient--${condition} weather-ambient--${band}`
  const isRainy = condition === 'drizzle' || condition === 'rain'
    || condition === 'heavy_rain' || condition === 'thunder' || condition === 'storm'
  const isSnowy = condition === 'light_snow' || condition === 'snow' || condition === 'heavy_snow'
  const isWindy = condition === 'breeze' || condition === 'gale'
  const isStormy = condition === 'thunder' || condition === 'storm'

  return (
    <div className={rootClass} aria-hidden="true">
      <div className="weather-ambient__sky-tint" />
      <div className="weather-ambient__tint" />

      {condition === 'clear' ? (
        <div className="weather-ambient__dust">
          {dustMotes.map((i) => (
            <span key={i} className="weather-ambient__dust-mote" style={makeDustStyle(i)} />
          ))}
        </div>
      ) : null}

      {condition === 'partly_cloudy' ? (
        <div className="weather-ambient__clouds">
          {cloudBlobs.map((i) => (
            <span key={i} className={`weather-ambient__cloud weather-ambient__cloud--${i + 1}`} />
          ))}
        </div>
      ) : null}

      {condition === 'overcast' ? (
        <div className="weather-ambient__clouds weather-ambient__clouds--dense">
          {cloudBlobs.map((i) => (
            <span key={i} className={`weather-ambient__cloud weather-ambient__cloud--${i + 1}`} />
          ))}
        </div>
      ) : null}

      {condition === 'fog' ? (
        <>
          <div className="weather-ambient__fog-a" />
          <div className="weather-ambient__fog-b" />
          <div className="weather-ambient__fog-c" />
        </>
      ) : null}

      {isRainy ? (
        <>
          <div className="weather-ambient__rain">
            {rainDrops.map((i) => (
              <span key={i} className="weather-ambient__raindrop" style={makeRainStyle(i, condition)} />
            ))}
          </div>
          <div className="weather-ambient__puddle-wash" />
        </>
      ) : null}

      {isStormy ? <div className="weather-ambient__flash" /> : null}

      {isSnowy ? (
        <>
          <div className="weather-ambient__snow">
            {snowFlakes.map((i) => (
              <span key={i} className="weather-ambient__snowflake" style={makeSnowStyle(i, condition)} />
            ))}
          </div>
          <div className="weather-ambient__snow-drift" />
        </>
      ) : null}

      {isWindy ? (
        <div className="weather-ambient__wind">
          {windStreaks.map((i) => (
            <span key={i} className="weather-ambient__wind-streak" style={makeWindStyle(i, condition)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function makeIndexArray(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function makeRainStyle(i: number, condition: WeatherCondition): React.CSSProperties {
  const left = ((i * 83) % 100) + (i % 5) / 5
  const delay = ((i * 17) % 100) / 100
  // Drizzle is slower + thinner; heavy_rain / storm fall faster and longer.
  const base = condition === 'drizzle' ? 0.8
    : condition === 'heavy_rain' || condition === 'storm' ? 0.4
      : 0.55
  const duration = base + ((i * 11) % 40) / 100
  const heightBase = condition === 'drizzle' ? 10
    : condition === 'heavy_rain' || condition === 'storm' ? 22
      : 16
  const height = heightBase + (i % 5) * 3
  const opacity = 0.5 + ((i * 13) % 40) / 100
  // Horizontal drift varied per-drop so sheets of rain look gusty,
  // not like a uniform slanted curtain. Range ~15-42px.
  const driftX = -(15 + ((i * 19) % 28))
  // Tilt the drop slightly so long drops look angled, not vertical.
  const tilt = ((i * 23) % 14) - 7
  return {
    left: `${left}%`,
    height: `${height}px`,
    opacity,
    transform: `rotate(${tilt}deg)`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    ['--rain-drift-x' as string]: `${driftX}px`,
  }
}

function makeSnowStyle(i: number, condition: WeatherCondition): React.CSSProperties {
  const left = ((i * 71) % 100) + (i % 5) / 5
  const delay = ((i * 13) % 100) / 10
  const duration = condition === 'light_snow' ? 7 + ((i * 7) % 60) / 10
    : condition === 'heavy_snow' ? 3.5 + ((i * 7) % 40) / 10
      : 5 + ((i * 7) % 60) / 10
  const sizeBase = condition === 'heavy_snow' ? 4 : 3
  const size = sizeBase + (i % 5)
  const opacity = 0.7 + ((i * 11) % 30) / 100
  // Zig-zag amplitude and bias varied per-flake so snow tumbles rather
  // than all flakes tracing the same S-curve. Range ±8..40px.
  const wobble = 8 + ((i * 41) % 32)
  const drift = ((i * 53) % 30) - 15
  // Three-phase path assigned by i%3 — each flake takes one of three
  // shuffled animation patterns so they don't visually sync.
  const variant = i % 3
  return {
    left: `${left}%`,
    width: `${size}px`,
    height: `${size}px`,
    opacity,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    animationName: `weather-snow-fall-${variant}`,
    ['--snow-wobble' as string]: `${wobble}px`,
    ['--snow-drift' as string]: `${drift}px`,
  }
}

function makeWindStyle(i: number, condition: WeatherCondition): React.CSSProperties {
  const top = ((i * 41) % 92) + 2
  const delay = ((i * 19) % 100) / 20
  const duration = condition === 'gale' ? 0.5 + ((i * 23) % 30) / 100
    : 1.2 + ((i * 23) % 40) / 100
  const lengthBase = condition === 'gale' ? 80 : 45
  const length = lengthBase + ((i * 37) % 70)
  const thickness = condition === 'gale' ? 1.4 + (i % 3) * 0.8
    : 0.8 + (i % 3) * 0.4
  const opacity = 0.5 + ((i * 17) % 40) / 100
  // Slight vertical rise/fall per streak so the whole line field looks
  // gusty rather than perfectly horizontal stripes. ±6-14px range.
  const verticalDrift = ((i * 29) % 26) - 13
  // Streak tilt so some lines slant upward, some downward.
  const tilt = ((i * 17) % 8) - 4
  return {
    top: `${top}%`,
    width: `${length}px`,
    height: `${thickness}px`,
    opacity,
    transform: `rotate(${tilt}deg)`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    ['--wind-rise' as string]: `${verticalDrift}px`,
  }
}

function makeDustStyle(i: number): React.CSSProperties {
  const left = ((i * 53) % 100)
  const startY = 20 + ((i * 29) % 60)
  const delay = ((i * 11) % 100) / 10
  const duration = 7 + ((i * 19) % 80) / 10
  const size = 2 + (i % 4)
  // Randomize drift direction per mote so they swirl in different
  // directions instead of all drifting the same up-right path.
  const driftX = ((i * 41) % 60) - 30
  const driftY = -((i * 37) % 50) - 10
  return {
    left: `${left}%`,
    top: `${startY}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    ['--dust-drift-x' as string]: `${driftX}px`,
    ['--dust-drift-y' as string]: `${driftY}px`,
  }
}
