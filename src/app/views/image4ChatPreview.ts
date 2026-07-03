import type { ChatMessage } from '../../types'

export type Image4ChatPreviewVariant = 'default' | 'density'

export function getImage4ChatPreviewModeSync(): boolean {
  const value = new URLSearchParams(window.location.search).get('image4ChatPreview')
  return value === '1' || value === 'density'
}

export function getImage4ChatPreviewVariantSync(): Image4ChatPreviewVariant {
  return new URLSearchParams(window.location.search).get('image4ChatPreview') === 'density'
    ? 'density'
    : 'default'
}

function minutesBefore(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString()
}

function buildImage4DensityPreviewMessages(now: Date): ChatMessage[] {
  return [
    {
      id: 'image4-chat-preview-density-user-short',
      role: 'user',
      content: '嗯',
      createdAt: minutesBefore(now, 6),
    },
    {
      id: 'image4-chat-preview-density-assistant-short',
      role: 'assistant',
      content: '在。',
      createdAt: minutesBefore(now, 5),
      runStatus: 'final',
    },
    {
      id: 'image4-chat-preview-density-assistant-streaming',
      role: 'assistant',
      content: '我会用短句、普通句和长句一起检查气泡宽度。短消息不应该被撑成卡片，长消息也不能顶到面板边界。',
      createdAt: minutesBefore(now, 1),
      runStatus: 'streaming_text',
    },
  ]
}

export function buildImage4ChatPreviewMessages(
  now = new Date(),
  variant: Image4ChatPreviewVariant = 'default',
): ChatMessage[] {
  if (variant === 'density') {
    return buildImage4DensityPreviewMessages(now)
  }

  return [
    {
      id: 'image4-chat-preview-user',
      role: 'user',
      content: '我刚刚卡在主对话框了，帮我看看哪里还别扭。',
      createdAt: minutesBefore(now, 5),
    },
    {
      id: 'image4-chat-preview-assistant-final',
      role: 'assistant',
      content: '我看到问题了：快捷项和输入框之间的距离会让主对话框像独立漂出去。先收紧节奏，再看真实聊天状态。',
      createdAt: minutesBefore(now, 4),
      runStatus: 'final',
    },
    {
      id: 'image4-chat-preview-assistant-streaming',
      role: 'assistant',
      content: '现在我在检查 active chat 的消息密度、流式边界和输入框连续性。',
      createdAt: minutesBefore(now, 1),
      runStatus: 'streaming_text',
    },
  ]
}
