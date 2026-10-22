export type ActivityClass =
  | 'coding'
  | 'browsing'
  | 'media'
  | 'gaming'
  | 'communication'
  | 'documents'
  | 'unknown'

// ASCII names use word boundaries so "password" is not Word, "Wordle" is not
// Word, and "Archive" is not the Arc browser. Chinese names are not \w, so a
// trailing \b would fail to match them.
const ACTIVITY_PATTERNS: Array<{ class: ActivityClass; pattern: RegExp }> = [
  {
    class: 'coding',
    pattern: /\b(?:Visual Studio|VS ?Code|IntelliJ|WebStorm|PyCharm|Sublime Text|Cursor|Android Studio|Xcode|CLion|GoLand|RustRover|Terminal|iTerm2?|Warp|Alacritty|Neovim|Vim|Emacs)\b/i,
  },
  {
    class: 'media',
    pattern: /\b(?:Spotify|YouTube|Netflix|Bilibili|VLC|PotPlayer|Apple Music)\b|网易云|QQ音乐/i,
  },
  {
    class: 'gaming',
    pattern: /\b(?:Steam|Epic Games|Minecraft|Genshin|League of Legends|Valorant|CS2|Overwatch)\b|原神|崩坏/i,
  },
  {
    class: 'communication',
    pattern: /\b(?:WeChat|QQ|Telegram|Discord|Slack|Teams|Zoom|Lark)\b|微信|钉钉|飞书/i,
  },
  {
    class: 'documents',
    pattern: /\b(?:Word|Excel|PowerPoint|Notion|Obsidian|Typora|WPS|OneNote|Google Docs|Figma)\b/i,
  },
  {
    class: 'browsing',
    pattern: /\b(?:Chrome|Firefox|Edge|Safari|Opera|Brave|Arc|Vivaldi)\b/i,
  },
]

const WEB_IDE_PATTERNS = /\b(?:VS ?Code|Visual Studio|Cursor|WebStorm|IntelliJ|GitHub Codespace|Gitpod|CodeSandbox|StackBlitz|Replit)\b/i

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
