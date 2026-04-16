import type { AssistantReplyRunnerOptions } from './assistantReply'
import type { UseChatContext } from './types'

const TURN_HARD_TIMEOUT_MS = 90_000

export type ExecuteAssistantTurnDeps = {
  ctx: Pick<
    UseChatContext,
    | 'appendVoiceTrace'
    | 'busEmit'
    | 'clearPetPerformanceCue'
    | 'setLiveTranscript'
    | 'setMood'
    | 'setVoiceState'
    | 'updatePetStatus'
    | 'updateVoicePipeline'
    | 'voiceStateRef'
  >
  setBusy: (value: boolean) => void
  setError: (value: string | null) => void
  busyRef: { current: boolean }
  activeTurnIdRef: { current: number }
  activeStreamAbortRef: { current: (() => Promise<void>) | null }
  runAssistantReplyTurn: (options: AssistantReplyRunnerOptions) => Promise<boolean>
  flushDeferredCompanionNotices: () => Promise<void>
}

export type ExecuteAssistantTurnInput = Omit<
  AssistantReplyRunnerOptions,
  'turnId' | 'isLatestTurn'
>

export async function executeAssistantTurn(
  deps: ExecuteAssistantTurnDeps,
  input: ExecuteAssistantTurnInput,
): Promise<boolean> {
  const {
    ctx,
    setBusy,
    setError,
    busyRef,
    activeTurnIdRef,
    activeStreamAbortRef,
    runAssistantReplyTurn,
    flushDeferredCompanionNotices,
  } = deps
  const { fromVoice, content, traceLabel } = input

  busyRef.current = true
  setBusy(true)
  ctx.clearPetPerformanceCue()
  ctx.setMood('thinking')
  ctx.setVoiceState('processing')
  ctx.busEmit({ type: 'chat:busy_changed', busy: true })
  setError(null)
  ctx.setLiveTranscript('')
  const turnId = ++activeTurnIdRef.current
  await activeStreamAbortRef.current?.().catch(() => undefined)
  activeStreamAbortRef.current = null

  if (fromVoice) {
    ctx.updateVoicePipeline('sending', '识别文本已进入聊天，正在请求大模型。', content)
    ctx.appendVoiceTrace('请求大模型', `#${traceLabel} 已调用聊天接口，等待模型返回`)
  }

  ctx.updatePetStatus(
    fromVoice ? '我收到了，正在整理这句话的重点。' : '我在整理这条消息，马上回你。',
  )

  let sendSucceeded = false
  let hardTimeoutTimer: number | null = null
  try {
    sendSucceeded = await Promise.race([
      runAssistantReplyTurn({
        ...input,
        turnId,
        isLatestTurn: () => activeTurnIdRef.current === turnId,
      }),
      new Promise<boolean>((resolve) => {
        hardTimeoutTimer = window.setTimeout(() => {
          hardTimeoutTimer = null
          console.warn('[Chat] Turn hard timeout — forcing busy=false')
          void activeStreamAbortRef.current?.().catch(() => undefined)
          activeStreamAbortRef.current = null
          resolve(false)
        }, TURN_HARD_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (hardTimeoutTimer != null) {
      window.clearTimeout(hardTimeoutTimer)
      hardTimeoutTimer = null
    }
    busyRef.current = false
    setBusy(false)
    activeStreamAbortRef.current = null
    // Safety reset: executeAssistantTurn sets voiceState='processing' on entry,
    // expecting the TTS lifecycle to transition it onward. When TTS is disabled,
    // text is empty, or the reply finishes without a tts:started event, the bus
    // goes idle→idle which is a no-op for the busEmit phase sync — leaving
    // voiceState stuck at 'processing' and the pet chip permanently showing
    // 理解中. If voice speaking took over, the state transitions before reaching
    // here, so this only fires on the stuck path.
    if (ctx.voiceStateRef.current === 'processing') {
      ctx.setVoiceState('idle')
      ctx.busEmit({ type: 'session:completed' })
    }
    void flushDeferredCompanionNotices()
  }

  return sendSucceeded
}
