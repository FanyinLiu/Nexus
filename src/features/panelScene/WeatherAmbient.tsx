import { useEffect, useMemo, useState } from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { WeatherCondition, TimeOfDayBand } from './weatherCondition.ts'
import { getTimeOfDayBand } from './weatherCondition.ts'

type WeatherAmbientProps = {
  condition: WeatherCondition | null
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000

const RAIN_COUNT = {
  drizzle: 40,
  rain: 100,
  heavy_rain: 180,
  thunder: 120,
  storm: 200,
} as const

const SNOW_COUNT = {
  light_snow: 30,
  snow: 70,
  heavy_snow: 140,
} as const

const WIND_COUNT = {
  breeze: 14,
  gale: 45,
} as const

export function WeatherAmbient({ condition }: WeatherAmbientProps) {
  const [band, setBand] = useState<TimeOfDayBand>(() => getTimeOfDayBand())
  const prefersReducedMotion = usePrefersReducedMotion()

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
    () => makeIndexArray(condition === 'partly_cloudy' ? 4 : 0),
    [condition],
  )
  const dustMotes = useMemo(
    () => makeIndexArray(condition === 'clear' ? 18 : 0),
    [condition],
  )

  if (!condition) return null

  const rootClass = `weather-ambient weather-ambient--${condition} weather-ambient--${band}`
  const renderMotionLayers = !prefersReducedMotion
  const isRainy = condition === 'drizzle' || condition === 'rain'
    || condition === 'heavy_rain' || condition === 'thunder' || condition === 'storm'
  const isSnowy = condition === 'light_snow' || condition === 'snow' || condition === 'heavy_snow'
  const isWindy = condition === 'breeze' || condition === 'gale'
  const isStormy = condition === 'thunder' || condition === 'storm'

  return (
    <div className={rootClass} aria-hidden="true">
      <div className="weather-ambient__sky-tint" />
      <div className="weather-ambient__tint" />

      {condition === 'clear' && renderMotionLayers ? (
        <div className="weather-ambient__dust">
          {dustMotes.map((i) => (
            <span key={i} className="weather-ambient__dust-mote" style={makeDustStyle(i)} />
          ))}
        </div>
      ) : null}

      {condition === 'partly_cloudy' && renderMotionLayers ? (
        <div className="weather-ambient__clouds weather-ambient__clouds--upper">
          {cloudBlobs.map((i) => (
            <span key={i} className={`weather-ambient__cloud weather-ambient__cloud--${i + 1}`} />
          ))}
        </div>
      ) : null}

      {condition === 'fog' && renderMotionLayers ? (
        <div className="weather-ambient__fog">
          <div className="weather-ambient__fog-a" />
          <div className="weather-ambient__fog-b" />
          <div className="weather-ambient__fog-c" />
        </div>
      ) : null}

      {condition === 'drizzle' && renderMotionLayers ? (
        <div className="weather-ambient__drizzle-mist" />
      ) : null}

      {isRainy && renderMotionLayers ? (
        <>
          <div className="weather-ambient__rain">
            {rainDrops.map((i) => (
              <span key={i} className="weather-ambient__raindrop" style={makeRainStyle(i, condition)} />
            ))}
          </div>
          <div className="weather-ambient__puddle-wash" />
        </>
      ) : null}

      {isStormy && renderMotionLayers ? <div className="weather-ambient__flash" /> : null}

      {isSnowy && renderMotionLayers ? (
        <>
          <div className="weather-ambient__snow">
            {snowFlakes.map((i) => (
              <span key={i} className="weather-ambient__snowflake" style={makeSnowStyle(i, condition)} />
            ))}
          </div>
          <div className="weather-ambient__snow-drift" />
        </>
      ) : null}

      {isWindy && renderMotionLayers ? (
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
  const left = ((i * 83 + i * i * 7) % 100) + (i % 7) / 7
  const base = condition === 'drizzle' ? 1.0
    : condition === 'heavy_rain' || condition === 'storm' ? 0.45
      : 0.6
  const duration = base + ((i * 11) % 40) / 100
  // Negative delay → drops start mid-fall so the screen is already filled
  const delay = -(duration * (((i * 37) % 100) / 100))
  const heightBase = condition === 'drizzle' ? 8
    : condition === 'heavy_rain' || condition === 'storm' ? 20
      : 14
  const height = heightBase + (i % 6) * 2
  const opacity = condition === 'drizzle'
    ? 0.3 + ((i * 13) % 30) / 100
    : 0.45 + ((i * 13) % 40) / 100
  const driftX = -(12 + ((i * 19) % 30))
  const tilt = ((i * 23) % 10) - 5
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
  const left = ((i * 71 + i * i * 3) % 100) + (i % 7) / 7
  const duration = condition === 'light_snow' ? 8 + ((i * 7) % 60) / 10
    : condition === 'heavy_snow' ? 4 + ((i * 7) % 40) / 10
      : 6 + ((i * 7) % 50) / 10
  // Negative delay so flakes are already scattered on screen
  const delay = -(duration * (((i * 31) % 100) / 100))
  const sizeBase = condition === 'heavy_snow' ? 4 : 3
  const size = sizeBase + (i % 4)
  const opacity = 0.6 + ((i * 11) % 35) / 100
  const wobble = 8 + ((i * 41) % 32)
  const drift = ((i * 53) % 30) - 15
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
  const top = ((i * 41) % 88) + 4
  const duration = condition === 'gale' ? 0.6 + ((i * 23) % 30) / 100
    : 1.4 + ((i * 23) % 50) / 100
  const delay = -(duration * (((i * 19) % 100) / 100))
  const lengthBase = condition === 'gale' ? 60 : 35
  const length = lengthBase + ((i * 37) % 80)
  const thickness = condition === 'gale' ? 1.2 + (i % 3) * 0.6
    : 0.6 + (i % 3) * 0.3
  const opacity = 0.35 + ((i * 17) % 40) / 100
  const verticalDrift = ((i * 29) % 22) - 11
  const tilt = condition === 'gale'
    ? ((i * 17) % 12) - 6
    : ((i * 17) % 6) - 3
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
  const left = ((i * 53 + i * i * 11) % 100)
  const startY = 25 + ((i * 29) % 55)
  const duration = 9 + ((i * 19) % 80) / 10
  const delay = -(duration * (((i * 17) % 100) / 100))
  const size = 2 + (i % 3)
  const driftX = ((i * 41) % 50) - 25
  const driftY = -((i * 37) % 40) - 8
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
