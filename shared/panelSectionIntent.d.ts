export type PanelSectionName = 'chat' | 'settings'
export type PanelChatIntent = 'text' | 'recent' | null

export type PanelSectionState = {
  section: PanelSectionName
  intent: PanelChatIntent
  intentToken: number
}

export type PanelSectionSnapshot = {
  section: PanelSectionName
  intent: PanelChatIntent
  intentToken: number
}

export function initialPanelSectionState(): PanelSectionState

export function requestPanelSection(state: PanelSectionState, section: string): PanelSectionState

export function panelSectionSnapshot(state: PanelSectionState): PanelSectionSnapshot

export function consumePanelSectionIntent(state: PanelSectionState): PanelSectionState

export function panelChatIntentDecision(
  appliedToken: number,
  snapshot: Partial<PanelSectionSnapshot> | null | undefined,
): { open: boolean; appliedToken: number }
