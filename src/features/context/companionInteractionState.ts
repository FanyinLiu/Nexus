export type NexusInteractionState = {
  readonly nexusOpenSince: string
  readonly getLastNexusInteractionAt: () => string
  readonly markNexusInteraction: () => string
}

export function createNexusInteractionState(
  initialOpenAt = new Date().toISOString(),
  getNow = () => new Date().toISOString(),
): NexusInteractionState {
  let lastNexusInteractionAt = initialOpenAt

  return {
    nexusOpenSince: initialOpenAt,
    getLastNexusInteractionAt: () => lastNexusInteractionAt,
    markNexusInteraction: () => {
      lastNexusInteractionAt = getNow()
      return lastNexusInteractionAt
    },
  }
}
