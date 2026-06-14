// Phrasing for the daily morning/evening bracket — paired prompts that
// bookend the day. Single-tone per locale; relationship-type splits
// can layer on later if the simple version feels uniform.

import type { UiLanguage } from '../../types'
import { normalizeUiLanguage } from '../../lib/uiLanguage.ts'

export type BracketTemplates = {
  /** Open questions used when there's no previous evening to anchor on. */
  morningOpenQuestions: string[]
  /** Callback template; replace {topic} with the prior evening's gist. */
  morningCallback: string
  eveningHighlight: string
  eveningStressful: string
  /** Button / inline prompt offering to extend the evening callback. */
  eveningGoDeeperPrompt: string
  /** Pool of follow-ups picked when the user opts into "go deeper". */
  eveningGoDeeperPool: string[]
  /** OS-notification title for the morning ping. {companionName} interpolated. */
  morningNotificationTitle: string
  eveningNotificationTitle: string
  /** Glue between the two evening questions in the notification body. */
  eveningJoiner: string
}

const ZH_CN: BracketTemplates = {
  morningOpenQuestions: [
    '今天起床第一感觉是什么？',
    '今天最想做的一件小事是什么？',
    '昨晚睡得怎么样？',
    '今天打算先动哪一块？',
    '今天有什么是想自己留着、不打算告诉别人的？',
    '今天想被打扰吗，还是一个人待着？',
    '如果只能做一件事就收工，你会选哪件？',
    '现在脑子里转的是什么？',
    '今天有没有什么在期待？',
    '昨天没做完的事，今天还想碰吗？',
    '今天的天气，适合做什么？',
    '有没有什么话是昨天想说但没说出口的？',
  ],
  morningCallback: '昨晚你说{topic}——今天再看，感觉变了吗？',
  eveningHighlight: '今天最让你开心的一个瞬间是什么？',
  eveningStressful: '今天什么事最让你心累？',
  eveningGoDeeperPrompt: '想多坐一会儿这件事吗？',
  eveningGoDeeperPool: [
    '当时你心里第一反应是什么？',
    '如果重来一次，你会怎么处理？',
    '这件事让你想到了之前的什么时候？',
    '你最希望明天它变成什么样？',
    '这件事到现在，哪个部分还卡在你心里？',
    '当时有别人在旁边吗？他们什么反应？',
    '你当时其实希望事情怎么走？',
    '如果跟人说这件事，你最想让对方知道什么？',
  ],
  morningNotificationTitle: '{companionName} 早安',
  eveningNotificationTitle: '{companionName} 等你回个话',
  eveningJoiner: '\n',
}

const ZH_TW: BracketTemplates = {
  morningOpenQuestions: [
    '今天起床第一感覺是什麼？',
    '今天最想做的一件小事是什麼？',
    '昨晚睡得怎麼樣？',
    '今天打算先動哪一塊？',
    '今天有什麼是想自己留著、不打算告訴別人的？',
    '今天想被打擾嗎，還是一個人待著？',
    '如果只能做一件事就收工，你會選哪件？',
    '現在腦子裡轉的是什麼？',
    '今天有沒有什麼在期待？',
    '昨天沒做完的事，今天還想碰嗎？',
    '今天的天氣，適合做什麼？',
    '有沒有什麼話是昨天想說但沒說出口的？',
  ],
  morningCallback: '昨晚你說{topic}——今天再看，感覺變了嗎？',
  eveningHighlight: '今天最讓你開心的一個瞬間是什麼？',
  eveningStressful: '今天什麼事最讓你心累？',
  eveningGoDeeperPrompt: '想多坐一會兒這件事嗎？',
  eveningGoDeeperPool: [
    '當時你心裡第一反應是什麼？',
    '如果重來一次，你會怎麼處理？',
    '這件事讓你想到了之前的什麼時候？',
    '你最希望明天它變成什麼樣？',
    '這件事到現在，哪個部分還卡在你心裡？',
    '當時有別人在旁邊嗎？他們什麼反應？',
    '你當時其實希望事情怎麼走？',
    '如果跟人說這件事，你最想讓對方知道什麼？',
  ],
  morningNotificationTitle: '{companionName} 早安',
  eveningNotificationTitle: '{companionName} 等你回個話',
  eveningJoiner: '\n',
}

const EN_US: BracketTemplates = {
  morningOpenQuestions: [
    'What’s the first thing you noticed this morning?',
    'What’s one small thing you actually want to do today?',
    'How did you sleep?',
    'What are you starting with today?',
    'Anything today you’d like to keep just for yourself?',
    'Do you want to be interrupted today, or left to yourself?',
    'If you could only get one thing done today, what would it be?',
    'What’s rattling around in your head right now?',
    'Anything you’re looking forward to today?',
    'That thing from yesterday — still want to pick it back up?',
    'Weather aside, what kind of day do you want this to be?',
    'Is there something you wanted to say yesterday but didn’t?',
  ],
  morningCallback: 'Last night you said {topic} — does it look different this morning?',
  eveningHighlight: 'What was the highlight of your day?',
  eveningStressful: 'What was stressful about your day?',
  eveningGoDeeperPrompt: 'Want to sit with this a little longer?',
  eveningGoDeeperPool: [
    'What was your first reaction in the moment?',
    'If you could replay it, what would you do differently?',
    'What does this remind you of from before?',
    'How would you most like tomorrow to look?',
    'What part of it is still sticking with you?',
    'Was anyone else there? What did they do?',
    'What were you hoping would happen instead?',
    'If you told someone about this, what would you want them to know?',
  ],
  morningNotificationTitle: 'Good morning from {companionName}',
  eveningNotificationTitle: '{companionName} is wrapping up the day',
  eveningJoiner: '\n',
}

const JA: BracketTemplates = {
  morningOpenQuestions: [
    '起きて最初に気づいたことは？',
    '今日「これだけはやりたい」って小さなことは？',
    '昨晩はよく眠れた？',
    '今日は何から手をつける？',
    '今日のことで、自分の中にだけ置いておきたいことはある？',
    '今日は話しかけられたい気分？それとも一人がいい？',
    '一つだけ片付けるなら、何にする？',
    '今、頭の中でぐるぐるしてることは？',
    '今日、楽しみにしてることある？',
    '昨日やりかけたこと、今日もやる？',
    '今日の天気、何するのに合いそう？',
    '昨日言いたくて言えなかったことはある？',
  ],
  morningCallback: '昨晩、{topic}って言ってたよね — 今朝になって感じ方は変わった？',
  eveningHighlight: '今日いちばん嬉しかった瞬間は？',
  eveningStressful: '今日いちばん疲れたことは？',
  eveningGoDeeperPrompt: 'もう少しこのことに付き合おうか？',
  eveningGoDeeperPool: [
    'その瞬間、最初に浮かんだ気持ちは？',
    'やり直せるなら、どうしてた？',
    '前にも似たことあった気がする？',
    '明日がどうなってたら、いちばん救われそう？',
    'いまだに引っかかってる部分はある？',
    'そのとき、他の人はどうしてた？',
    '本当はどうなってほしかった？',
    '誰かに話すとしたら、何をいちばん伝えたい？',
  ],
  morningNotificationTitle: '{companionName} からおはよう',
  eveningNotificationTitle: '{companionName}、一日のしめに少しだけ',
  eveningJoiner: '\n',
}

const KO: BracketTemplates = {
  morningOpenQuestions: [
    '오늘 아침 처음 든 생각은?',
    '오늘 진짜 해보고 싶은 작은 일 하나는?',
    '어젯밤은 잘 잤어?',
    '오늘 뭐부터 시작할 거야?',
    '오늘 일 중에 혼자 간직하고 싶은 거 있어?',
    '오늘 방해받아도 괜찮아, 아니면 혼자 있고 싶어?',
    '딱 하나만 끝낼 수 있다면 뭘 할 거야?',
    '지금 머릿속에 맴도는 건 뭐야?',
    '오늘 기대하는 거 있어?',
    '어제 못 끝낸 거, 오늘도 이어 할 거야?',
    '오늘 날씨는 뭐 하기에 좋을까?',
    '어제 하고 싶었는데 못 한 말 있어?',
  ],
  morningCallback: '어젯밤에 {topic}라고 했잖아 — 아침이 되니까 좀 달라 보여?',
  eveningHighlight: '오늘 가장 기뻤던 순간은?',
  eveningStressful: '오늘 가장 마음 무거웠던 일은?',
  eveningGoDeeperPrompt: '이 얘기 조금만 더 같이 있을까?',
  eveningGoDeeperPool: [
    '그 순간 처음 든 기분은 뭐였어?',
    '다시 해본다면 어떻게 할 것 같아?',
    '예전에 비슷한 일 있었어?',
    '내일은 어떻게 됐으면 좋겠어?',
    '아직까지 마음에 걸리는 부분은 뭐야?',
    '그때 다른 사람은 뭐라고 했어?',
    '사실 어떻게 되길 바랐어?',
    '누군가에게 이 얘기를 한다면, 제일 알아줬으면 하는 건 뭐야?',
  ],
  morningNotificationTitle: '{companionName} 의 아침 인사',
  eveningNotificationTitle: '{companionName}, 하루 마무리 잠깐만',
  eveningJoiner: '\n',
}

const TEMPLATES: Record<UiLanguage, BracketTemplates> = {
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'en-US': EN_US,
  ja: JA,
  ko: KO,
}

export function getBracketTemplates(uiLanguage: UiLanguage): BracketTemplates {
  return TEMPLATES[normalizeUiLanguage(uiLanguage)]
}

export type PickMorningPromptInput = {
  uiLanguage: UiLanguage
  /** Gist of the prior evening's exchange; null when bracket has never run. */
  previousEveningTopic: string | null
  /** 0..1 RNG; supply a fixed value in tests. */
  randomFn?: () => number
}

export function pickMorningPrompt(input: PickMorningPromptInput): string {
  const t = getBracketTemplates(input.uiLanguage)
  if (input.previousEveningTopic && input.previousEveningTopic.trim().length > 0) {
    return t.morningCallback.replace('{topic}', input.previousEveningTopic.trim())
  }
  const rand = input.randomFn ?? Math.random
  return t.morningOpenQuestions[Math.floor(rand() * t.morningOpenQuestions.length)]
}

export function pickGoDeeperFollowup(
  uiLanguage: UiLanguage,
  randomFn: () => number = Math.random,
): string {
  const t = getBracketTemplates(uiLanguage)
  return t.eveningGoDeeperPool[Math.floor(randomFn() * t.eveningGoDeeperPool.length)]
}

export type BuildBracketNotificationInput = {
  uiLanguage: UiLanguage
  companionName: string
  bracket: 'morning' | 'evening'
  /** Used by the morning callback when present; ignored for evening. */
  previousEveningTopic?: string | null
  randomFn?: () => number
}

export function buildBracketNotification(
  input: BuildBracketNotificationInput,
): { title: string; body: string } {
  const t = getBracketTemplates(input.uiLanguage)
  const companionName = input.companionName?.trim() || 'Nexus'

  if (input.bracket === 'morning') {
    return {
      title: t.morningNotificationTitle.replace('{companionName}', companionName),
      body: pickMorningPrompt({
        uiLanguage: input.uiLanguage,
        previousEveningTopic: input.previousEveningTopic ?? null,
        randomFn: input.randomFn,
      }),
    }
  }

  return {
    title: t.eveningNotificationTitle.replace('{companionName}', companionName),
    body: `${t.eveningHighlight}${t.eveningJoiner}${t.eveningStressful}`,
  }
}
