import { useEffect, useRef, useState } from 'react'
import { PetDialogBubble } from '../../components/PetDialogBubble.tsx'
import { proactiveBubbleIdentity } from '../../features/proactive/proactivePresentation.ts'
import { useProactiveCollapseTimer } from '../../hooks/useProactiveCollapseTimer.ts'
import type { PetDialogBubbleState } from '../../types/index.ts'

/**
 * Dialog bubble host for the legacy pet window.
 *
 * Router-driven (proactive) bubbles inherit the hover-aware collapse window
 * from `useProactiveCollapseTimer` — the same scheduler the v2 caption uses.
 * Hover is keyed by bubble identity, so a replacement message never inherits
 * the previous bubble's hover state and its old countdown can never hide it.
 */
export type LegacyPetDialogLayerProps = {
  bubble: PetDialogBubbleState
  assistantName: string
  /** Drops the bubble from chat state when the proactive countdown ends. */
  onCollapse: () => void
}

export function LegacyPetDialogLayer({
  bubble,
  assistantName,
  onCollapse,
}: LegacyPetDialogLayerProps) {
  const proactiveKey = proactiveBubbleIdentity(bubble)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const bubbleRef = useRef(bubble)
  useEffect(() => {
    bubbleRef.current = bubble
  }, [bubble])
  useProactiveCollapseTimer({
    active: Boolean(proactiveKey),
    paused: Boolean(proactiveKey) && hoveredKey === proactiveKey,
    identity: proactiveKey,
    onCollapse: () => {
      if (proactiveBubbleIdentity(bubbleRef.current) !== proactiveKey) return
      onCollapse()
    },
  })

  // The v2 caption shows the proactive title; the legacy bubble matches it so
  // both surfaces present one line for the same router message.
  const title = bubble.proactiveTitle?.trim()
  const displayedBubble = title ? { ...bubble, content: title } : bubble

  return (
    <div
      className="pet-window__dialog-layer"
      onPointerEnter={() => setHoveredKey(proactiveKey || null)}
      onPointerLeave={() => setHoveredKey(null)}
    >
      <PetDialogBubble bubble={displayedBubble} assistantName={assistantName} />
    </div>
  )
}
