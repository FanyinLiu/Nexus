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

  const rainDrops = useMemo(() => makeIndexArray(120), [])
  const snowFlakes = useMemo(() => makeIndexArray(80), [])
  const windStreaks = useMemo(() => makeIndexArray(36), [])
  const cloudBlobs = useMemo(() => makeIndexArray(6), [])
  const dustMotes = useMemo(() => makeIndexArray(40), [])

  if (!condition) return null

  const rootClass = `weather-ambient weather-ambient--${condition} weather-ambient--${band}`

  return (
    <div className={rootClass} aria-hidden="true">
      <div className="weather-ambient__sky-tint" />
      <div className="weather-ambient__tint" />
      {condition === 'clear' ? (
        <>
          <div className="weather-ambient__sun-disc" />
          <div className="weather-ambient__sun-glow" />
          <div className="weather-ambient__sun-rays" />
          <div className="weather-ambient__godray weather-ambient__godray--1" />
          <div className="weather-ambient__godray weather-ambient__godray--2" />
          <div className="weather-ambient__godray weather-ambient__godray--3" />
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
          <div className="weather-ambient__fog-c" />
        </>
      ) : null}
      {condition === 'rain' || condition === 'thunder' ? (
        <>
          <div className="weather-ambient__rain">
            {rainDrops.map((i) => (
              <span key={i} className="weather-ambient__raindrop" style={makeRainStyle(i)} />
            ))}
          </div>
          <div className="weather-ambient__puddle-wash" />
        </>
      ) : null}
      {condition === 'thunder' ? <div className="weather-ambient__flash" /> : null}
      {condition === 'snow' ? (
        <>
          <div className="weather-ambient__snow">
            {snowFlakes.map((i) => (
              <span key={i} className="weather-ambient__snowflake" style={makeSnowStyle(i)} />
            ))}
          </div>
          <div className="weather-ambient__snow-drift" />
        </>
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
  const left = ((i * 83) % 100) + (i % 5) / 5
  const delay = ((i * 17) % 100) / 100
  const duration = 0.55 + ((i * 11) % 40) / 100
  const height = 16 + (i % 5) * 3
  const opacity = 0.5 + ((i * 13) % 40) / 100
  return {
    left: `${left}%`,
    height: `${height}px`,
    opacity,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

function makeSnowStyle(i: number): React.CSSProperties {
  const left = ((i * 71) % 100) + (i % 5) / 5
  const delay = ((i * 13) % 100) / 10
  const duration = 5 + ((i * 7) % 60) / 10
  const size = 3 + (i % 5)
  const opacity = 0.7 + ((i * 11) % 30) / 100
  return {
    left: `${left}%`,
    width: `${size}px`,
    height: `${size}px`,
    opacity,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

function makeWindStyle(i: number): React.CSSProperties {
  const top = ((i * 41) % 92) + 2
  const delay = ((i * 19) % 100) / 20
  const duration = 0.9 + ((i * 23) % 40) / 100
  const length = 50 + ((i * 37) % 70)
  const thickness = 1 + (i % 3) * 0.6
  const opacity = 0.5 + ((i * 17) % 40) / 100
  return {
    top: `${top}%`,
    width: `${length}px`,
    height: `${thickness}px`,
    opacity,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}

function makeDustStyle(i: number): React.CSSProperties {
  const left = ((i * 53) % 100)
  const startY = 20 + ((i * 29) % 60)
  const delay = ((i * 11) % 100) / 10
  const duration = 7 + ((i * 19) % 80) / 10
  const size = 2 + (i % 4)
  return {
    left: `${left}%`,
    top: `${startY}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  }
}
