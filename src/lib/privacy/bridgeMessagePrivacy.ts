export type BridgeIncomingDebugInput = {
  source: string
  container: string
  sender: string
  isOwner: boolean
  ownerSuffix?: string
  text?: string
  media?: string | null
}

export function shouldForwardBridgeIncomingToChat(options: {
  isOwner: boolean
  text?: string | null
}): boolean {
  return options.isOwner && Boolean(options.text?.trim())
}

export function buildBridgeOwnerChatForwardText(source: 'Telegram' | 'Discord', text: string): string {
  return `【${source}】${text}`
}

export function buildBridgeIncomingDebugDetail(input: BridgeIncomingDebugInput): string {
  const textLength = input.text?.length ?? 0
  const media = input.media?.trim() || 'none'
  return `${input.source}; [${input.container}] ${input.sender}${input.isOwner ? input.ownerSuffix ?? '' : ''}; textLength=${textLength}; media=${media}`
}

export function buildBridgeAnnouncementDebugDetail(input: {
  source: string
  sender: string
  text?: string | null
  media?: string | null
}): string {
  const textLength = input.text?.length ?? 0
  const media = input.media?.trim() || 'none'
  return `${input.source}; sender=${input.sender}; textLength=${textLength}; media=${media}`
}
