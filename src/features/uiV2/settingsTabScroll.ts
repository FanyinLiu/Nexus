export type SettingsTabScrollMetrics = {
  navScrollLeft: number
  navClientWidth: number
  tabOffsetLeft: number
  tabWidth: number
}

export function getSettingsTabScrollLeft({
  navScrollLeft,
  navClientWidth,
  tabOffsetLeft,
  tabWidth,
}: SettingsTabScrollMetrics): number {
  if (navClientWidth <= 0 || tabWidth <= 0) return navScrollLeft

  const tabEnd = tabOffsetLeft + tabWidth
  const visibleEnd = navScrollLeft + navClientWidth
  if (tabOffsetLeft < navScrollLeft) return Math.max(0, tabOffsetLeft)
  if (tabEnd > visibleEnd) return Math.max(0, tabEnd - navClientWidth)
  return navScrollLeft
}
