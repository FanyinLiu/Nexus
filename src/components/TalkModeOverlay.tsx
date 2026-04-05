import { useEffect, useRef, useState } from 'react'
import type { VoiceState } from '../types/voice'

type TalkModeOverlayProps = {
  voiceState: VoiceState
  liveTranscript: string
  speechLevel: number
  continuousVoiceActive: boolean
}

type OverlayDisplayState = 'hidden' | 'listening' | 'thinking' | 'speaking' | 'interrupted'

const INTERRUPTED_DURATION_MS = 900

const WAVE_SHAPE = [0.6, 0.9, 1.0, 0.9, 0.6]

const labelMap: Record<OverlayDisplayState, string> = {
  hidden: '',
  listening: '听',
  thinking: '想',
  speaking: '说',
  interrupted: '打断',
}

function resolveDisplayState(voiceState: VoiceState, interrupted: boolean): OverlayDisplayState {
  if (voiceState === 'idle') return 'hidden'
  if (voiceState === 'listening' && interrupted) return 'interrupted'
  if (voiceState === 'listening') return 'listening'
  if (voiceState === 'processing') return 'thinking'
  return 'speaking'
}

function MicPulseRing() {
  return <div className="talk-overlay__mic-ring" />
}

function ThinkingDots() {
  return (
    <div className="talk-overlay__dots">
      <span className="talk-overlay__dot" />
      <span className="talk-overlay__dot" />
      <span className="talk-overlay__dot" />
    </div>
  )
}

function SpeechBars({ speechLevel }: { speechLevel: number }) {
  return (
    <div className="talk-overlay__bars">
      {WAVE_SHAPE.map((weight, i) => (
        <span
          key={i}
          className="talk-overlay__bar"
          style={{ '--bar-scale': 0.3 + speechLevel * 0.7 * weight } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

function InterruptedFlash() {
  return <span className="talk-overlay__interrupted-icon">✋</span>
}

export function TalkModeOverlay({
  voiceState,
  liveTranscript,
  speechLevel,
}: TalkModeOverlayProps) {
  const [interrupted, setInterrupted] = useState(false)
  const prevVoiceState = useRef<VoiceState>(voiceState)
  const interruptedTimer = useRef<number | null>(null)

  useEffect(() => {
    if (prevVoiceState.current === 'speaking' && voiceState === 'listening') {
      setInterrupted(true)
      if (interruptedTimer.current) window.clearTimeout(interruptedTimer.current)
      interruptedTimer.current = window.setTimeout(() => setInterrupted(false), INTERRUPTED_DURATION_MS)
    }
    prevVoiceState.current = voiceState
    return () => {
      if (interruptedTimer.current) window.clearTimeout(interruptedTimer.current)
    }
  }, [voiceState])

  const displayState = resolveDisplayState(voiceState, interrupted)

  return (
    <div className="pet-window__talk-layer" aria-live="polite" aria-atomic="true">
      <div className={`talk-overlay talk-overlay--${displayState}`} role="status">
        <div className="talk-overlay__visual">
          {displayState === 'listening' && <MicPulseRing />}
          {displayState === 'thinking' && <ThinkingDots />}
          {displayState === 'speaking' && <SpeechBars speechLevel={speechLevel} />}
          {displayState === 'interrupted' && <InterruptedFlash />}
        </div>
        {displayState === 'listening' && liveTranscript && (
          <p className="talk-overlay__transcript">{liveTranscript}</p>
        )}
        {displayState !== 'hidden' && (
          <span className="talk-overlay__label">{labelMap[displayState]}</span>
        )}
      </div>
    </div>
  )
}
