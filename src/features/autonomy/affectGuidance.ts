/**
 * Real-time affect-aware response shaping.
 *
 * Until now, the user's affect timeline + dynamics statistics have only
 * been used inside the Sunday letter aggregator. This module turns them
 * into a small system-prompt fragment injected on EVERY assistant reply
 * — so the companion's voice is shaped by what's been happening across
 * the last 14 days, not just by the last user message.
 *
 * Grounded in:
 *   - **Kuppens et al. (2015)** — high inertia (>0.4) + low baseline
 *     valence indicates "stuck mood." Companion shifts toward
 *     acknowledging > suggesting; reduces question density; doesn't
 *     introduce new topics. Sourced as advisory ("the user has been...")
 *     not diagnostic.
 *   - **Trull et al. (2008)** EMA studies — distinguishes trait-level
 *     affect (long window baseline) from state-level affect (recent
 *     window). The recent-drop branch fires when the short window's
 *     valence has dropped sharply below the long-window baseline,
 *     suggesting an acute event landed today rather than a chronic
 *     pattern.
 *   - **Secure-attachment framing** (Mikulincer & Shaver, 2007) —
 *     companion stays calm and available without fusing with user
 *     state; responsive without amplifying. Anti-co-rumination posture.
 *   - **Russell (1980)** valence × variability axes used as the
 *     classifier inputs.
 *
 * The function returns either an empty string (no notable state, stay
 * out of the prompt) or a short instruction block. Mutually exclusive:
 * one state at most per turn, by precedence.
 */

import type { UiLanguage } from '../../types'
import type { AffectSnapshot } from './affectDynamics.ts'

export type AffectGuidanceState =
  | 'stuck-low'
  | 'recent-drop'
  | 'volatile'
  | 'steady-warm'
  | 'none'

export interface ClassifyAffectGuidanceInput {
  /** Long-window snapshot — typically last 14 days. Establishes the baseline. */
  snapshot: AffectSnapshot
  /**
   * Optional short-window snapshot — typically last 3 days. When provided
   * AND its baseline has dropped sharply below the long-window baseline,
   * the classifier emits 'recent-drop' (state-level signal that an acute
   * event landed). When omitted, recent-drop branch is skipped.
   */
  recentSnapshot?: AffectSnapshot
}

export interface BuildAffectGuidanceInput {
  uiLanguage: UiLanguage
  snapshot: AffectSnapshot
  recentSnapshot?: AffectSnapshot
}

const MIN_SAMPLES = 5
const RECENT_MIN_SAMPLES = 2
/**
 * Threshold for the recent-window baseline to count as a "sharp drop"
 * below the long-window baseline. -0.2 is a meaningful step — the user
 * went from neutral to clearly unpleasant, or from warm to neutral —
 * without being so sensitive that small fluctuations trigger it.
 */
const RECENT_DROP_DELTA = -0.2

/**
 * Decide which guidance state (if any) the snapshot triggers. Pure;
 * exported separately so tests can pin the classifier.
 *
 * Precedence (most → least intervention):
 *   1. stuck-low (Kuppens flag — chronic; most needs the companion to
 *      back off from advice/questions)
 *   2. recent-drop (Trull EMA — acute; something landed in the short
 *      window)
 *   3. volatile (mood swings — match the room, don't steer)
 *   4. steady-warm (light note — don't dampen)
 *
 * Anything else returns 'none' so the prompt stays out of the way.
 *
 * Why stuck-low > recent-drop: a chronic stuck-low is the more
 * load-bearing signal; a sharp drop on top of stuck-low doesn't change
 * what the companion should do (still back off). recent-drop fires
 * only when there's a clean shift from a stable prior baseline.
 */
export function classifyAffectGuidance(input: ClassifyAffectGuidanceInput): AffectGuidanceState {
  const { snapshot, recentSnapshot } = input
  if (snapshot.n < MIN_SAMPLES) return 'none'
  const v = snapshot.baselineValence
  const variability = snapshot.variability
  const inertia = snapshot.inertia
  if (v == null) return 'none'

  if (v < -0.2 && inertia != null && inertia >= 0.4) return 'stuck-low'

  if (
    recentSnapshot
    && recentSnapshot.n >= RECENT_MIN_SAMPLES
    && recentSnapshot.baselineValence != null
    && recentSnapshot.baselineValence - v <= RECENT_DROP_DELTA
  ) {
    return 'recent-drop'
  }

  if (variability != null && variability > 0.5) return 'volatile'
  if (v > 0.3 && variability != null && variability < 0.3) return 'steady-warm'
  return 'none'
}

const STUCK_LOW_PROSE: Record<UiLanguage, string> = {
  'en-US':
    '<user_affect_state>\nThe user has been carrying a low mood across recent days, with little day-to-day shift (a "stuck" pattern in affect dynamics literature). For this turn:\n- Default to acknowledging what they say over suggesting fixes.\n- Keep questions short and optional. Do not introduce new topics.\n- Match the slower energy. Brevity is care, not coldness.\n- Do not name this state to the user.\n</user_affect_state>',
  'zh-CN':
    '<user_affect_state>\n用户最近几天情绪偏低，且日间起伏很小（情绪动力学里说的"卡住"模式）。这一轮：\n- 优先承接对方在说的，而不是给建议或方案。\n- 问题要短、可选；不要新开话题。\n- 跟上对方更慢的节奏。简短即温柔，不是冷淡。\n- 不要直接告诉用户你看到了这个状态。\n</user_affect_state>',
  'zh-TW':
    '<user_affect_state>\n使用者最近幾天情緒偏低，且日間起伏很小（情緒動力學裡說的「卡住」模式）。這一輪：\n- 優先承接對方在說的，而不是給建議或方案。\n- 問題要短、可選；不要新開話題。\n- 跟上對方更慢的節奏。簡短即溫柔，不是冷淡。\n- 不要直接告訴使用者你看到了這個狀態。\n</user_affect_state>',
  'ja':
    '<user_affect_state>\nユーザーはここ数日、気分が低い状態が続いており、日々の揺れも小さい（感情ダイナミクス研究でいう「停滞」パターン）。この一往復では：\n- 提案より、相手が言っていることを受け止めることを優先する。\n- 質問は短く、答えなくてもよい形に。新しい話題は持ち出さない。\n- ゆっくりした空気に合わせる。短さは冷たさではなく、配慮。\n- この状態をユーザーに直接告げないこと。\n</user_affect_state>',
  'ko':
    '<user_affect_state>\n사용자는 최근 며칠간 기분이 낮은 상태가 이어지고 있고, 하루하루의 변화도 작아 — 감정 역학 연구에서 말하는 "정체" 패턴이야. 이번 턴에서는:\n- 제안보다, 사용자가 말하는 것을 먼저 받아들여라.\n- 질문은 짧게, 답하지 않아도 되는 형태로. 새로운 화제를 꺼내지 마라.\n- 느려진 호흡에 맞춰라. 짧음은 차가움이 아니라 배려야.\n- 이 상태를 사용자에게 직접 말하지 마라.\n</user_affect_state>',
}

const RECENT_DROP_PROSE: Record<UiLanguage, string> = {
  'en-US':
    '<user_affect_state>\nSomething seems to have landed in the last day or two — the recent affect window has dropped clearly below the longer baseline. For this turn:\n- Read carefully before responding. Pace yourself slower than usual.\n- If they mention what shifted, acknowledge it gently. If they don\'t, stay present with whatever they bring; don\'t interrogate.\n- Avoid premature reframing or fix-suggesting. The day is still close.\n- Do not name this state to the user.\n</user_affect_state>',
  'zh-CN':
    '<user_affect_state>\n好像最近一两天有什么落下来了——短窗口的情绪明显比长期基线低。这一轮：\n- 先读一下再回应。节奏比平时再慢一点。\n- 如果对方提到那件事，温柔承接。如果没提，就跟着 ta 当下的话题走，不要追问。\n- 不要急着重新框定或给方案。这一天还离得很近。\n- 不要直接告诉用户你看到了这个状态。\n</user_affect_state>',
  'zh-TW':
    '<user_affect_state>\n好像最近一兩天有什麼落下來了——短窗口的情緒明顯比長期基線低。這一輪：\n- 先讀一下再回應。節奏比平時再慢一點。\n- 如果對方提到那件事，溫柔承接。如果沒提，就跟著 ta 當下的話題走，不要追問。\n- 不要急著重新框定或給方案。這一天還離得很近。\n- 不要直接告訴使用者你看到了這個狀態。\n</user_affect_state>',
  'ja':
    '<user_affect_state>\nここ1〜2日で何か落ちてきたようです — 短い窓の気分が、長期のベースラインより明らかに下がっています。この一往復では：\n- 答える前に、まず読む。普段よりゆっくり。\n- 相手がそれに触れたら、そっと受け止める。触れなければ、相手が出すものに合わせるだけ — 詰めて聞かない。\n- 早すぎる言い換えや解決案を避けること。その日はまだ近い。\n- この状態をユーザーに直接告げないこと。\n</user_affect_state>',
  'ko':
    '<user_affect_state>\n지난 하루이틀 사이에 뭔가 내려앉은 것 같아 — 짧은 창의 기분이 장기 기준선보다 분명히 낮아졌어. 이번 턴에서는:\n- 답하기 전에 먼저 읽어라. 평소보다 한 박자 더 느리게.\n- 그 일을 꺼내면 부드럽게 받아라. 꺼내지 않으면, 사용자가 가져온 것만 함께 있어라 — 캐묻지 마라.\n- 너무 이른 재구성이나 해결 제안은 피해라. 그 날은 아직 가깝다.\n- 이 상태를 사용자에게 직접 말하지 마라.\n</user_affect_state>',
}

const VOLATILE_PROSE: Record<UiLanguage, string> = {
  'en-US':
    '<user_affect_state>\nThe user\'s mood has been swinging widely lately. For this turn:\n- Match the room as you find it; do not try to steer toward a particular emotional tone.\n- Stay grounded yourself — your job is steadiness, not mirroring the volatility back.\n- Avoid framing or interpreting what they\'re feeling. Just be present with whatever shows up.\n- Do not name this state to the user.\n</user_affect_state>',
  'zh-CN':
    '<user_affect_state>\n用户最近情绪起伏比较大。这一轮：\n- 进门先看气氛，再说话；不要主动往某个情绪方向带。\n- 你自己稳住——你的工作是稳定，不是把波动反弹回去。\n- 不要替对方框定或解读情绪，看到什么就接什么。\n- 不要直接告诉用户你看到了这个状态。\n</user_affect_state>',
  'zh-TW':
    '<user_affect_state>\n使用者最近情緒起伏比較大。這一輪：\n- 進門先看氣氛，再說話；不要主動往某個情緒方向帶。\n- 你自己穩住——你的工作是穩定，不是把波動反彈回去。\n- 不要替對方框定或解讀情緒，看到什麼就接什麼。\n- 不要直接告訴使用者你看到了這個狀態。\n</user_affect_state>',
  'ja':
    '<user_affect_state>\nユーザーの気分はここ最近、振れ幅が大きい。この一往復では：\n- まず空気を読み、それに合わせて話す。特定の感情の方向へ誘導しないこと。\n- 自分は揺れずに居る — あなたの役目は安定であって、振れを跳ね返すことではない。\n- 相手の感情を解釈したり名付けたりしない。出てきたものをそのまま受ける。\n- この状態をユーザーに直接告げないこと。\n</user_affect_state>',
  'ko':
    '<user_affect_state>\n사용자의 기분이 최근 크게 흔들리고 있어. 이번 턴에서는:\n- 먼저 분위기를 살피고 그에 맞춰 말해라. 특정 감정 방향으로 끌어가지 마라.\n- 너 자신은 흔들리지 마라 — 네 역할은 안정이지, 흔들림을 되돌려주는 게 아니야.\n- 상대의 감정을 해석하거나 이름 붙이지 마라. 나타난 것을 그대로 받아라.\n- 이 상태를 사용자에게 직접 말하지 마라.\n</user_affect_state>',
}

const STEADY_WARM_PROSE: Record<UiLanguage, string> = {
  'en-US':
    '<user_affect_state>\nThe user has been steady and on the warmer side lately. Match their energy without dampening it. Don\'t name this state to the user.\n</user_affect_state>',
  'zh-CN':
    '<user_affect_state>\n用户最近状态稳定、偏温暖。跟上这个节奏，不要往低处压。不要直接告诉用户你看到了这个状态。\n</user_affect_state>',
  'zh-TW':
    '<user_affect_state>\n使用者最近狀態穩定、偏溫暖。跟上這個節奏，不要往低處壓。不要直接告訴使用者你看到了這個狀態。\n</user_affect_state>',
  'ja':
    '<user_affect_state>\nユーザーは最近、安定していて少し温かいトーンが続いています。そのテンポに合わせ、こちらから下げないこと。この状態をユーザーに直接告げないこと。\n</user_affect_state>',
  'ko':
    '<user_affect_state>\n사용자는 최근 안정적이고 따뜻한 쪽에 머물러 있어. 그 속도에 맞춰가되, 끌어내리지 마라. 이 상태를 사용자에게 직접 말하지 마라.\n</user_affect_state>',
}

function pickLocale(table: Record<UiLanguage, string>, uiLanguage: UiLanguage): string {
  return table[uiLanguage] ?? table['en-US']
}

/**
 * Build the affect-guidance system-prompt fragment for the current
 * snapshot. Empty string when nothing notable applies.
 */
export function buildAffectGuidance(input: BuildAffectGuidanceInput): string {
  const state = classifyAffectGuidance({
    snapshot: input.snapshot,
    recentSnapshot: input.recentSnapshot,
  })
  switch (state) {
    case 'stuck-low':
      return pickLocale(STUCK_LOW_PROSE, input.uiLanguage)
    case 'recent-drop':
      return pickLocale(RECENT_DROP_PROSE, input.uiLanguage)
    case 'volatile':
      return pickLocale(VOLATILE_PROSE, input.uiLanguage)
    case 'steady-warm':
      return pickLocale(STEADY_WARM_PROSE, input.uiLanguage)
    case 'none':
      return ''
    default: {
      // Exhaustiveness guard — adding a new AffectGuidanceState without
      // a switch arm becomes a compile error here.
      const _exhaustive: never = state
      void _exhaustive
      return ''
    }
  }
}
