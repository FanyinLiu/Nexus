import { shorten } from '../../lib/common.ts'

type GameContextSnapshot = {
  game: string
  connected: true
  address: string
  username?: string
  recentChat?: string[]
  recentPlayerEvents?: string[]
  recentCommands?: Array<{ command: string; response: string; timestamp: string }>
}

const MAX_GAME_CONTEXT_LENGTH = 1_200

export async function loadGameContext(): Promise<GameContextSnapshot | null> {
  const dp = window.desktopPet

  const [mcCtx, fCtx] = await Promise.all([
    dp?.minecraftGameContext?.().catch(() => null) ?? Promise.resolve(null),
    dp?.factorioGameContext?.().catch(() => null) ?? Promise.resolve(null),
  ])

  return mcCtx ?? fCtx ?? null
}

export function formatGameContext(ctx: GameContextSnapshot | null | undefined): string {
  if (!ctx) return ''

  const sections: string[] = []

  sections.push(`Currently connected game: ${ctx.game} (server ${ctx.address}${ctx.username ? `, player ${ctx.username}` : ''})`)

  if (ctx.recentChat?.length) {
    const chatLines = ctx.recentChat.slice(-6).join('\n')
    sections.push(`Recent chat:\n${shorten(chatLines, MAX_GAME_CONTEXT_LENGTH)}`)
  }

  if (ctx.recentPlayerEvents?.length) {
    sections.push(`Recent player events: ${ctx.recentPlayerEvents.slice(-4).join(', ')}`)
  }

  if (ctx.recentCommands?.length) {
    const cmdLines = ctx.recentCommands
      .slice(-4)
      .map((c) => `> ${c.command} → ${c.response}`)
      .join('\n')
    sections.push(`Recent commands:\n${shorten(cmdLines, MAX_GAME_CONTEXT_LENGTH)}`)
  }

  return [
    `Below is the current game context (${ctx.game}). The user may be chatting about game-related topics:`,
    sections.join('\n\n'),
    'You can respond naturally to game events, like someone joining the game or a chat message. The user may also ask you to run game commands. Reply in the user\'s language.',
  ].join('\n\n')
}
