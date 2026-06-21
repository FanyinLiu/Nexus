export type ActivityClass =
  | 'coding'
  | 'browsing'
  | 'media'
  | 'gaming'
  | 'communication'
  | 'documents'
  | 'unknown'

const ACTIVITY_PATTERNS: Array<{ class: ActivityClass; pattern: RegExp }> = [
  {
    class: 'coding',
    pattern: /Visual Studio|VS ?Code|IntelliJ|WebStorm|PyCharm|Sublime Text|Cursor|Android Studio|Xcode|CLion|GoLand|RustRover|Terminal|iTerm|Warp|Alacritty|Neovim|Vim|Emacs/i,
  },
  {
    class: 'media',
    pattern: /Spotify|YouTube|Netflix|Bilibili|VLC|PotPlayer|网易云|QQ音乐|Apple Music/i,
  },
  {
    class: 'gaming',
    pattern: /Steam|Epic Games|Minecraft|Genshin|原神|崩坏|League of Legends|Valorant|CS2|Overwatch/i,
  },
  {
    class: 'communication',
    pattern: /WeChat|微信|QQ|Telegram|Discord|Slack|Teams|Zoom|钉钉|飞书|Lark/i,
  },
  {
    class: 'documents',
    pattern: /Word|Excel|PowerPoint|Notion|Obsidian|Typora|WPS|OneNote|Google Docs|Figma/i,
  },
  {
    class: 'browsing',
    pattern: /Chrome|Firefox|Edge|Safari|Opera|Brave|Arc|Vivaldi/i,
  },
]

const WEB_IDE_PATTERNS = /VS ?Code|Visual Studio|Cursor|WebStorm|IntelliJ|GitHub Codespace|Gitpod|CodeSandbox|StackBlitz|Replit/i

export function classifyActivity(windowTitle: string | null): ActivityClass {
  if (!windowTitle) return 'unknown'
  for (const group of ACTIVITY_PATTERNS) {
    if (group.pattern.test(windowTitle)) return group.class
  }
  return 'unknown'
}

export function isUserDeepFocused(
  activity: ActivityClass,
  consecutiveIdleTicks: number,
  windowTitle: string | null,
): boolean {
  if (consecutiveIdleTicks > 2) return false
  if (activity === 'coding' || activity === 'documents') return true
  if (activity === 'browsing' && windowTitle && WEB_IDE_PATTERNS.test(windowTitle)) {
    return true
  }
  return false
}
