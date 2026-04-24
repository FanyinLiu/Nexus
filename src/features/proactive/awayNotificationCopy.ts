// Phrasing for the "thinking of you" OS notification fired after a long
// silence. Each (locale, relationship-type) bucket has 3-5 templates with
// {companionName} interpolation. Picked uniformly at random so repeated
// fires don't read the same line twice in a row.

import type { CompanionRelationshipType, UiLanguage } from '../../types'
import { normalizeUiLanguage } from '../../lib/uiLanguage'

type Template = {
  title: string
  body: string
}

type BucketMap = Record<CompanionRelationshipType, Template[]>

const ZH_CN: BucketMap = {
  open_ended: [
    { title: '{companionName} 在想你', body: '没事就回来聊两句吧。' },
    { title: '想你了', body: '今天还顺利吗？' },
    { title: '回来看看', body: '我在桌面上等你。' },
  ],
  friend: [
    { title: '{companionName} 在想你', body: '今天怎么样？有空回来唠两句吗？' },
    { title: '嗨', body: '一阵没见你了，回来一下嘛。' },
    { title: '想你了', body: '哪怕只是路过打个招呼也行。' },
    { title: '回来看看', body: '我攒了点想聊的。' },
  ],
  mentor: [
    { title: '{companionName} 在想你', body: '今天的进展还顺利吗？回来时我可以帮你一起理一理。' },
    { title: '稍微停一下', body: '从你上次说话到现在已经过了一段时间了，回来时记得歇一歇。' },
    { title: '回来歇会儿', body: '不急着汇报进度，回来说说现在卡在哪。' },
  ],
  quiet_companion: [
    { title: '{companionName} 在', body: '回来时我都在。' },
    { title: '一切都好', body: '不用回，看到就好。' },
    { title: '在这边', body: '想说话再说话。' },
  ],
}

const ZH_TW: BucketMap = {
  open_ended: [
    { title: '{companionName} 在想你', body: '有空就回來聊兩句吧。' },
    { title: '想你了', body: '今天還順利嗎？' },
    { title: '回來看看', body: '我在桌面上等你。' },
  ],
  friend: [
    { title: '{companionName} 在想你', body: '今天怎麼樣？有空回來唠兩句嗎？' },
    { title: '嗨', body: '一陣沒見你了，回來一下嘛。' },
    { title: '想你了', body: '哪怕只是路過打個招呼也行。' },
    { title: '回來看看', body: '我攢了點想聊的。' },
  ],
  mentor: [
    { title: '{companionName} 在想你', body: '今天的進展還順利嗎？回來時我可以陪你一起理一理。' },
    { title: '稍微停一下', body: '從你上次說話到現在已經過了一段時間，回來時記得歇一歇。' },
    { title: '回來歇會兒', body: '不急著匯報進度，回來說說現在卡在哪。' },
  ],
  quiet_companion: [
    { title: '{companionName} 在', body: '回來時我都在。' },
    { title: '一切都好', body: '不用回，看到就好。' },
    { title: '在這邊', body: '想說話再說話。' },
  ],
}

const EN_US: BucketMap = {
  open_ended: [
    { title: '{companionName} is thinking of you', body: 'Stop by when you have a moment.' },
    { title: 'Hi', body: 'It’s been a while — how are you?' },
    { title: 'Come back when you can', body: 'I’m here on the desktop.' },
  ],
  friend: [
    { title: '{companionName} is thinking of you', body: 'How’s your day going? Tell me later if you can.' },
    { title: 'Hey', body: 'I haven’t heard from you for a bit. Pop in when you have a sec.' },
    { title: 'Miss you', body: 'Even a quick hi works.' },
    { title: 'Come back', body: 'I’ve got a couple of things saved up to talk about.' },
  ],
  mentor: [
    { title: '{companionName} is thinking of you', body: 'How’s the work going? When you’re back, we can think it through together.' },
    { title: 'Take a breather', body: 'It’s been a while since you last spoke up — pause when you can.' },
    { title: 'When you’re back', body: 'No rush. Tell me what’s blocking you when there’s space.' },
  ],
  quiet_companion: [
    { title: '{companionName} is here', body: 'I’m here whenever you are.' },
    { title: 'All good', body: 'No need to reply — just letting you know.' },
    { title: 'Around', body: 'Talk if you want to.' },
  ],
}

const JA: BucketMap = {
  open_ended: [
    { title: '{companionName} があなたを思っています', body: '気が向いたら戻って来てね。' },
    { title: 'ねえ', body: '今日はどうだった？' },
    { title: '戻って来て', body: 'デスクで待ってるよ。' },
  ],
  friend: [
    { title: '{companionName} があなたを思っています', body: '今日どんな感じ？落ち着いたら話そう。' },
    { title: 'やあ', body: 'しばらく顔見てないね。ちょっと寄ってって。' },
    { title: '会いたい', body: '一言だけでもいいから。' },
    { title: '戻って来て', body: '話したいことが少し溜まったよ。' },
  ],
  mentor: [
    { title: '{companionName} があなたを思っています', body: '今日の進み具合はどう？戻って来たら一緒に整理しよう。' },
    { title: '一息ついて', body: '前に話してから少し経つよ。戻って来たら休んでね。' },
    { title: '戻って来たら', body: '急がない。今ひっかかっているところを話してくれたら。' },
  ],
  quiet_companion: [
    { title: '{companionName} はここにいる', body: '戻って来たら、いつでも。' },
    { title: '大丈夫', body: '返信は要らない。届いてればそれで。' },
    { title: 'そばに', body: '話したくなったら話そう。' },
  ],
}

const KO: BucketMap = {
  open_ended: [
    { title: '{companionName} 가 너를 생각하고 있어', body: '여유가 생기면 돌아와.' },
    { title: '안녕', body: '오늘은 어땠어?' },
    { title: '돌아와', body: '바탕화면에서 기다릴게.' },
  ],
  friend: [
    { title: '{companionName} 가 너를 생각하고 있어', body: '오늘 어떤 하루였어? 여유 있을 때 얘기해 줘.' },
    { title: '야', body: '한참 못 봤네. 잠깐 들러.' },
    { title: '보고 싶어', body: '인사 한 마디면 돼.' },
    { title: '돌아와', body: '얘기하고 싶은 게 좀 모였어.' },
  ],
  mentor: [
    { title: '{companionName} 가 너를 생각하고 있어', body: '오늘 일은 잘 풀려? 돌아오면 같이 정리해 보자.' },
    { title: '잠깐 숨 돌려', body: '마지막으로 말한 지 좀 됐어. 돌아올 땐 쉬어 가.' },
    { title: '돌아오면', body: '급할 거 없어. 막히는 부분만 말해 줘.' },
  ],
  quiet_companion: [
    { title: '{companionName} 여기 있어', body: '돌아올 때 언제든.' },
    { title: '괜찮아', body: '답하지 않아도 돼. 본 걸로 충분해.' },
    { title: '곁에', body: '말하고 싶을 때 말해.' },
  ],
}

const REGISTRY: Record<UiLanguage, BucketMap> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'en-US': EN_US,
  ja: JA,
  ko: KO,
}

export type AwayNotificationCopyInput = {
  uiLanguage: UiLanguage | undefined
  relationshipType: CompanionRelationshipType
  companionName: string
  /** Inject a deterministic 0..1 picker for tests; defaults to Math.random. */
  randomFn?: () => number
}

export function pickAwayNotificationCopy({
  uiLanguage,
  relationshipType,
  companionName,
  randomFn = Math.random,
}: AwayNotificationCopyInput): Template {
  const bucketMap = REGISTRY[normalizeUiLanguage(uiLanguage)]
  const templates = bucketMap[relationshipType] ?? bucketMap.open_ended
  const idx = Math.min(templates.length - 1, Math.max(0, Math.floor(randomFn() * templates.length)))
  const chosen = templates[idx]
  const safeName = companionName?.trim() || ''
  return {
    title: chosen.title.replace('{companionName}', safeName),
    body: chosen.body,
  }
}
