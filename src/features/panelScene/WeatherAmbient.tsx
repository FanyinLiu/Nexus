import { useEffect, useMemo, useState } from 'react'
import type { WeatherCondition, TimeOfDayBand } from './weatherCondition.ts'
import { getTimeOfDayBand } from './weatherCondition.ts'

type WeatherAmbientProps = {
  condition: WeatherCondition | null
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000

export function WeatherAmbient({ condition }: WeatherAmbientProps) {
  const [band, setBand] = useState<TimeOfDayBand>(() => getTimeOfDayBand())

  useEffect(() => {
    const update = () => setBand(getTimeOfDayBand())
    const intervalId = window.setInterval(update, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [])

  const rainDrops = useMemo(() => makeIndexArray(28), [])
  const snowFlakes = useMemo(() => makeIndexArray(22), [])
  const windStreaks = useMemo(() => makeIndexArray(14), [])
  const cloudBlobs = useMemo(() => makeIndexArray(3), [])
  const dustMotes = useMemo(() => makeIndexArray(16), [])

  if (!condition) return null

  const rootClass = `weather-ambient weather-ambient--${condition} weather-ambient--${band}`

  return (
    <div className={rootClass} aria-hidden="true">
      <div className="weather-ambient__tint" />
      {condition === 'clear' ? (
        <>
          <div className="weather-ambient__sun-glow" />
          <div className="weather-ambient__sun-rays" />
          <div className="weather-ambient__dust">
            {dustMotes.map((i) => (
              <span key={i} className="weather-ambient__dust-mote" style={makeDustStyle(i)} />
            ))}
          </div>
        </>
      ) : null}
      {condition === 'cloudy' ? (
        <div className="weather-ambient__clouds">
          {cloudBlobs.map((i) => (
            <span key={i} className={`weather-ambient__cloud weather-ambient__cloud--${i + 1}`} />
          ))}
        </div>
      ) : null}
      {condition === 'fog' ? (
        <>
          <div className="weather-ambient__fog-a" />
          <div className="weather-ambient__fog-b" />
        </>
      ) : null}
      {condition === 'rain' || condition === 'thunder' ? (
        <div className="weather-ambient__rain">
          {rainDrops.map((i) => (
            <span key={i} className="weather-ambient__raindrop" style={makeRainStyle(i)} />
          ))}
        </div>
      ) : null}
      {condition === 'thunder' ? <div className="weather-ambient__flash" /> : null}
      {condition === 'snow' ? (
        <div className="weather-ambient__snow">
          {snowFlakes.map((i) => (
            <span key={i} className="weather-ambient__snowflake" style={makeSnowStyle(i)} />
          ))}
        </div>
      ) : null}
      {condition === 'wind' ? (
        <div className="weather-ambient__wind">
          {windStreaks.map((i) => (
            <span key={i} className="weather-ambient__wind-streak" style={makeWindStyle(i)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function makeIndexArray(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function makeRainStyle(i: number): React.CSSProperties {
  const left = ((i * 83) % 100) + (i % 3)
  const delay = ((i * 17) % 100) / 100
  const duration = 0.7 + ((i * 11) % 40) / 100
  return {
    left: `${left}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

function makeSnowStyle(i: number): React.CSSProperties {
  const left = ((i * 71) % 100) + (i % 5)
  const delay = ((i * 13) % 100) / 10
  const duration = 6 + ((i * 7) % 50) / 10
  const size = 3 + (i % 4)
  return {
    left: `${left}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

function makeWindStyle(i: number): React.CSSProperties {
  const top = ((i * 41) % 90) + 4
  const delay = ((i * 19) % 100) / 20
  const duration = 1.2 + ((i * 23) % 30) / 100
  const length = 40 + ((i * 37) % 45)
  return {
    top: `${top}%`,
    width: `${length}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

function makeDustStyle(i: number): React.CSSProperties {
  const left = ((i * 53) % 100)
  const startY = 20 + ((i * 29) % 60)
  const delay = ((i * 11) % 100) / 10
  const duration = 8 + ((i * 19) % 80) / 10
  const size = 2 + (i % 3)
  return {
    left: `${left}%`,
    top: `${startY}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}
