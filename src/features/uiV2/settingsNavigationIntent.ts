export type SettingsV2NavigationIntent = {
  moveFocus: boolean
}

export function getSettingsV2NavigationIntent(eventDetail: number): SettingsV2NavigationIntent {
  return { moveFocus: eventDetail === 0 }
}
