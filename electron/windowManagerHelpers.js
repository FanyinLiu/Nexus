// Pure geometry helpers extracted from windowManager.js so they can be
// unit-tested without loading Electron.

export const PANEL_WINDOW_GAP_PX = 28

export function clampWindowPosition(width, height, preferredX, preferredY, workArea) {
  const maxX = workArea.x + Math.max(workArea.width - width, 0)
  const maxY = workArea.y + Math.max(workArea.height - height, 0)

  return {
    x: Math.min(Math.max(Math.round(preferredX), workArea.x), maxX),
    y: Math.min(Math.max(Math.round(preferredY), workArea.y), maxY),
  }
}

export function getPanelWindowPosition(width, height, ownerBounds, workArea) {
  if (!ownerBounds) {
    return clampWindowPosition(
      width,
      height,
      workArea.x + workArea.width - width - 72,
      workArea.y + 72,
      workArea,
    )
  }

  const spaceLeft = ownerBounds.x - workArea.x
  const spaceRight = workArea.x + workArea.width - (ownerBounds.x + ownerBounds.width)
  const preferRight = spaceRight >= spaceLeft
  const rightX = ownerBounds.x + ownerBounds.width + PANEL_WINDOW_GAP_PX
  const leftX = ownerBounds.x - width - PANEL_WINDOW_GAP_PX
  const preferredX = preferRight ? rightX : leftX
  const preferredY = ownerBounds.y + ownerBounds.height - height

  return clampWindowPosition(width, height, preferredX, preferredY, workArea)
}
