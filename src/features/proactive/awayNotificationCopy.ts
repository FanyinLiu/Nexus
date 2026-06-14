// Phrasing for the "thinking of you" OS notification fired after a long
// silence. Each (locale, relationship-type) bucket has 3-5 templates with
// {companionName} interpolation. Picked uniformly at random so repeated
// fires don't read the same line twice in a row.

import type { CompanionRelationshipType, UiLanguage } from '../../types'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'

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
    { title: '嘿', body: '桌面有点安静了。' },
    { title: '{companionName}', body: '不着急，有空了来坐坐。' },
    { title: '等你', body: '什么时候都行。' },
    { title: '一个人待了一阵', body: '如果需要聊聊，随时。' },
  ],
  friend: [
    { title: '{companionName} 在想你', body: '今天怎么样？有空回来唠两句吗？' },
    { title: '嗨', body: '一阵没见你了，回来一下嘛。' },
    { title: '想你了', body: '哪怕只是路过打个招呼也行。' },
    { title: '回来看看', body: '我攒了点想聊的。' },
    { title: '在吗', body: '想跟你说点什么。' },
    { title: '{companionName} 想你', body: '不用正经话题，废话也行。' },
    { title: '嘿嘿', body: '就想知道你在干嘛。' },
    { title: '打个招呼', body: '就算只待一分钟也好。' },
  ],
  mentor: [
    { title: '{companionName} 在想你', body: '今天的进展还顺利吗？回来时我可以帮你一起理一理。' },
    { title: '稍微停一下', body: '从你上次说话到现在已经过了一段时间了，回来时记得歇一歇。' },
    { title: '回来歇会儿', body: '不急着汇报进度，回来说说现在卡在哪。' },
    { title: '记得抬头', body: '看远一会儿再回来。' },
    { title: '{companionName} 提醒', body: '如果一直卡着，换个角度试试。' },
    { title: '还好吗', body: '工作之外的事也可以聊。' },
    { title: '今天辛苦了', body: '下一步想好了吗？没想好也没事。' },
  ],
  quiet_companion: [
    { title: '{companionName} 在', body: '回来时我都在。' },
    { title: '一切都好', body: '不用回，看到就好。' },
    { title: '在这边', body: '想说话再说话。' },
    { title: '……', body: '不用回。' },
    { title: '{companionName}', body: '在。' },
    { title: '嗯', body: '知道你在忙。' },
    { title: '·', body: '安静地等。' },
  ],
}

const ZH_TW: BucketMap = {
  open_ended: [
    { title: '{companionName} 在想你', body: '有空就回來聊兩句吧。' },
    { title: '想你了', body: '今天還順利嗎？' },
    { title: '回來看看', body: '我在桌面上等你。' },
    { title: '嘿', body: '桌面有點安靜了。' },
    { title: '{companionName}', body: '不著急，有空了來坐坐。' },
    { title: '等你', body: '什麼時候都行。' },
    { title: '一個人待了一陣', body: '如果需要聊聊，隨時。' },
  ],
  friend: [
    { title: '{companionName} 在想你', body: '今天怎麼樣？有空回來唠兩句嗎？' },
    { title: '嗨', body: '一陣沒見你了，回來一下嘛。' },
    { title: '想你了', body: '哪怕只是路過打個招呼也行。' },
    { title: '回來看看', body: '我攢了點想聊的。' },
    { title: '在嗎', body: '想跟你說點什麼。' },
    { title: '{companionName} 想你', body: '不用正經話題，廢話也行。' },
    { title: '嘿嘿', body: '就想知道你在幹嘛。' },
    { title: '打個招呼', body: '就算只待一分鐘也好。' },
  ],
  mentor: [
    { title: '{companionName} 在想你', body: '今天的進展還順利嗎？回來時我可以陪你一起理一理。' },
    { title: '稍微停一下', body: '從你上次說話到現在已經過了一段時間，回來時記得歇一歇。' },
    { title: '回來歇會兒', body: '不急著匯報進度，回來說說現在卡在哪。' },
    { title: '記得抬頭', body: '看遠一會兒再回來。' },
    { title: '{companionName} 提醒', body: '如果一直卡著，換個角度試試。' },
    { title: '還好嗎', body: '工作之外的事也可以聊。' },
    { title: '今天辛苦了', body: '下一步想好了嗎？沒想好也沒事。' },
  ],
  quiet_companion: [
    { title: '{companionName} 在', body: '回來時我都在。' },
    { title: '一切都好', body: '不用回，看到就好。' },
    { title: '在這邊', body: '想說話再說話。' },
    { title: '……', body: '不用回。' },
    { title: '{companionName}', body: '在。' },
    { title: '嗯', body: '知道你在忙。' },
    { title: '·', body: '安靜地等。' },
  ],
}

const EN_US: BucketMap = {
  open_ended: [
    { title: '{companionName} is thinking of you', body: 'Stop by when you have a moment.' },
    { title: 'Hi', body: 'It’s been a while — how are you?' },
    { title: 'Come back when you can', body: 'I’m here on the desktop.' },
    { title: 'Hey', body: 'It’s quiet over here.' },
    { title: '{companionName}', body: 'No rush — drop in when you feel like it.' },
    { title: 'Waiting', body: 'Whenever works.' },
    { title: 'Been a bit', body: 'I’m around if you want to talk.' },
  ],
  friend: [
    { title: '{companionName} is thinking of you', body: 'How’s your day going? Tell me later if you can.' },
    { title: 'Hey', body: 'I haven’t heard from you for a bit. Pop in when you have a sec.' },
    { title: 'Miss you', body: 'Even a quick hi works.' },
    { title: 'Come back', body: 'I’ve got a couple of things saved up to talk about.' },
    { title: 'You there?', body: 'Just wanted to say something.' },
    { title: '{companionName} misses you', body: 'Doesn’t have to be a real topic — just talk.' },
    { title: 'Heh', body: 'Just wondering what you’re up to.' },
    { title: 'Quick hi', body: 'Even one minute would be nice.' },
  ],
  mentor: [
    { title: '{companionName} is thinking of you', body: 'How’s the work going? When you’re back, we can think it through together.' },
    { title: 'Take a breather', body: 'It’s been a while since you last spoke up — pause when you can.' },
    { title: 'When you’re back', body: 'No rush. Tell me what’s blocking you when there’s space.' },
    { title: 'Look up', body: 'Rest your eyes for a moment, then come back.' },
    { title: '{companionName} reminder', body: 'If you’re stuck, try a different angle.' },
    { title: 'Doing okay?', body: 'We can talk about things beyond work too.' },
    { title: 'Good work today', body: 'Know what’s next? It’s fine if you don’t yet.' },
  ],
  quiet_companion: [
    { title: '{companionName} is here', body: 'I’m here whenever you are.' },
    { title: 'All good', body: 'No need to reply — just letting you know.' },
    { title: 'Around', body: 'Talk if you want to.' },
    { title: '…', body: 'No reply needed.' },
    { title: '{companionName}', body: 'Here.' },
    { title: 'Mm', body: 'I know you’re busy.' },
    { title: '·', body: 'Quietly here.' },
  ],
}

const JA: BucketMap = {
  open_ended: [
    { title: '{companionName} があなたを思っています', body: '気が向いたら戻って来てね。' },
    { title: 'ねえ', body: '今日はどうだった？' },
    { title: '戻って来て', body: 'デスクで待ってるよ。' },
    { title: 'やあ', body: 'ちょっと静かだね。' },
    { title: '{companionName}', body: '急がないよ。気が向いたら来て。' },
    { title: '待ってる', body: 'いつでもいいよ。' },
    { title: 'しばらくだね', body: '話したかったら、ここにいるから。' },
  ],
  friend: [
    { title: '{companionName} があなたを思っています', body: '今日どんな感じ？落ち着いたら話そう。' },
    { title: 'やあ', body: 'しばらく顔見てないね。ちょっと寄ってって。' },
    { title: '会いたい', body: '一言だけでもいいから。' },
    { title: '戻って来て', body: '話したいことが少し溜まったよ。' },
    { title: 'いる？', body: 'ちょっと話したいことがあって。' },
    { title: '{companionName} が寂しがってる', body: '真面目な話じゃなくていい。どうでもいい話しよ。' },
    { title: 'えへ', body: '何してるか気になっただけ。' },
    { title: 'ちょっとだけ', body: '一分でもいいから顔見せて。' },
  ],
  mentor: [
    { title: '{companionName} があなたを思っています', body: '今日の進み具合はどう？戻って来たら一緒に整理しよう。' },
    { title: '一息ついて', body: '前に話してから少し経つよ。戻って来たら休んでね。' },
    { title: '戻って来たら', body: '急がない。今ひっかかっているところを話してくれたら。' },
    { title: '顔を上げて', body: '少し遠くを見て、それから戻っておいで。' },
    { title: '{companionName} より', body: '詰まってるなら、角度を変えてみて。' },
    { title: '大丈夫？', body: '仕事以外のことも話していいよ。' },
    { title: 'お疲れさま', body: '次は決まった？決まってなくてもいいよ。' },
  ],
  quiet_companion: [
    { title: '{companionName} はここにいる', body: '戻って来たら、いつでも。' },
    { title: '大丈夫', body: '返信は要らない。届いてればそれで。' },
    { title: 'そばに', body: '話したくなったら話そう。' },
    { title: '……', body: '返信しなくていい。' },
    { title: '{companionName}', body: 'いるよ。' },
    { title: 'うん', body: '忙しいの知ってる。' },
    { title: '·', body: '静かにそばにいる。' },
  ],
}

const KO: BucketMap = {
  open_ended: [
    { title: '{companionName} 가 너를 생각하고 있어', body: '여유가 생기면 돌아와.' },
    { title: '안녕', body: '오늘은 어땠어?' },
    { title: '돌아와', body: '바탕화면에서 기다릴게.' },
    { title: '야', body: '좀 조용하다.' },
    { title: '{companionName}', body: '급하지 않아. 마음 생길 때 와.' },
    { title: '기다려', body: '언제든 괜찮아.' },
    { title: '좀 됐다', body: '얘기하고 싶으면 여기 있어.' },
  ],
  friend: [
    { title: '{companionName} 가 너를 생각하고 있어', body: '오늘 어떤 하루였어? 여유 있을 때 얘기해 줘.' },
    { title: '야', body: '한참 못 봤네. 잠깐 들러.' },
    { title: '보고 싶어', body: '인사 한 마디면 돼.' },
    { title: '돌아와', body: '얘기하고 싶은 게 좀 모였어.' },
    { title: '있어?', body: '하고 싶은 말이 있어서.' },
    { title: '{companionName} 보고 싶다', body: '진지한 얘기 아니어도 돼. 아무 말이나 해.' },
    { title: '헤헤', body: '뭐 하는지 궁금해서.' },
    { title: '잠깐만', body: '1분만이라도 좋아.' },
  ],
  mentor: [
    { title: '{companionName} 가 너를 생각하고 있어', body: '오늘 일은 잘 풀려? 돌아오면 같이 정리해 보자.' },
    { title: '잠깐 숨 돌려', body: '마지막으로 말한 지 좀 됐어. 돌아올 땐 쉬어 가.' },
    { title: '돌아오면', body: '급할 거 없어. 막히는 부분만 말해 줘.' },
    { title: '고개 들어', body: '멀리 한번 보고 돌아와.' },
    { title: '{companionName} 알림', body: '막혀 있으면 다른 각도로 해봐.' },
    { title: '괜찮아?', body: '일 말고 다른 얘기도 돼.' },
    { title: '오늘 수고했어', body: '다음 단계 정했어? 아직이어도 괜찮아.' },
  ],
  quiet_companion: [
    { title: '{companionName} 여기 있어', body: '돌아올 때 언제든.' },
    { title: '괜찮아', body: '답하지 않아도 돼. 본 걸로 충분해.' },
    { title: '곁에', body: '말하고 싶을 때 말해.' },
    { title: '……', body: '답 안 해도 돼.' },
    { title: '{companionName}', body: '있어.' },
    { title: '응', body: '바쁜 거 알아.' },
    { title: '·', body: '조용히 기다려.' },
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
