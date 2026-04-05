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

  sections.push(`当前已连接游戏：${ctx.game}（服务器 ${ctx.address}${ctx.username ? `，玩家 ${ctx.username}` : ''}）`)

  if (ctx.recentChat?.length) {
    const chatLines = ctx.recentChat.slice(-6).join('\n')
    sections.push(`最近聊天：\n${shorten(chatLines, MAX_GAME_CONTEXT_LENGTH)}`)
  }

  if (ctx.recentPlayerEvents?.length) {
    sections.push(`最近玩家事件：${ctx.recentPlayerEvents.slice(-4).join('、')}`)
  }

  if (ctx.recentCommands?.length) {
    const cmdLines = ctx.recentCommands
      .slice(-4)
      .map((c) => `> ${c.command} → ${c.response}`)
      .join('\n')
    sections.push(`最近指令：\n${shorten(cmdLines, MAX_GAME_CONTEXT_LENGTH)}`)
  }

  return [
    `以下是当前游戏上下文（${ctx.game}），用户可能在和你聊游戏相关话题：`,
    sections.join('\n\n'),
    '你可以根据游戏事件自然地回应，比如有人加入游戏或者有聊天消息。用户也可能让你执行游戏指令。',
  ].join('\n\n')
}

function shorten(text: string, maxLength: number) {
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}
