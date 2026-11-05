/**
 * Behaviour tests for the proactive OS notifications.
 *
 * The agenda, bracket and weekly-letter cases render the real hooks so the
 * notification payload, the chat/bubble payload and every log call come from
 * the production pipeline. The away-copy snapshot and the missing-uiLanguage
 * open-arc case are function-level: the away hook only re-randomises the same
 * static table, and the open-arc dependency object is the documented contract
 * surface the hook forwards to.
 *
 * The renderer, environment mocks and fixture builders live in
 * tests/helpers/directNotificationHookHarness.ts. No assertion or helper
 * prints user content; console is captured for the duration of each hook run.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { deliverDueOpenArc } from '../src/features/arc/openArcProactiveMessage.ts'
import type {
  DeliverDueOpenArcDeps,
  OpenArcDeliveryText,
} from '../src/features/arc/openArcProactiveMessage.ts'
import type { OpenArcRecord } from '../src/features/arc/openArcStore.ts'
import { pickAwayNotificationCopy } from '../src/features/proactive/awayNotificationCopy.ts'
import { truncateAgendaWhat } from '../src/features/proactive/directNotificationCopy.ts'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { DeliveryContext } from '../shared/proactiveDelivery.js'
import {
  AGENDA_MEMORY_TEXT,
  DAY,
  ERRAND_PROMPT,
  ERRAND_RESULT,
  EVENING_TOPIC,
  HOUR,
  LETTER_BODY,
  LETTER_GREETING,
  LETTER_NOW,
  assertNotLeaked,
  assertSame,
  makeLoop,
  runAgenda,
  runBracket,
  runLetter,
} from './helpers/directNotificationHookHarness.ts'

// Hooks use bundler-style imports; registration must precede every dynamic
// import below.
register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

// ── Agenda hook ────────────────────────────────────────────────────────────

test('agenda logs never echo the memory text, its clipped what, or distinctive words', async (t) => {
  const now = new Date(2026, 4, 1, 12, 0, 0).getTime()
  const run = await runAgenda(t, {
    now,
    memories: [makeLoop({
      id: 'agenda-private',
      content: AGENDA_MEMORY_TEXT,
      createdAt: new Date(now - 2 * DAY).toISOString(),
      loopDueAt: new Date(now - HOUR).toISOString(),
    })],
  })

  assert.equal(run.notifications.length, 1, 'agenda should fire one OS notification')
  assert.equal(run.notices.length, 1, 'agenda should still reach chat/bubble')

  const secrets = [AGENDA_MEMORY_TEXT, truncateAgendaWhat(AGENDA_MEMORY_TEXT), '国贸', '小林']
  for (const secret of secrets) {
    for (const log of run.logs) {
      assertNotLeaked(log.title, secret, 'onLog title leaked agenda memory content')
      assertNotLeaked(log.detail, secret, 'onLog detail leaked agenda memory content')
    }
    for (const line of run.consoleOutput) {
      assertNotLeaked(line, secret, 'console output leaked agenda memory content')
    }
  }
})

test('agenda first line: the OS title drops later lines and logs never carry them', async (t) => {
  const now = new Date(2026, 4, 1, 12, 0, 0).getTime()
  const content = '买牛奶\n顺便取快递\n密码 1234'
  const run = await runAgenda(t, {
    now,
    memories: [makeLoop({
      id: 'agenda-first-line',
      content,
      createdAt: new Date(now - 2 * DAY).toISOString(),
      loopDueAt: new Date(now - HOUR).toISOString(),
    })],
  })

  assert.equal(run.notifications.length, 1)
  const notification = run.notifications[0]
  assertSame(notification.title, '买牛奶…', 'OS title is the clipped first line')
  assert.equal(notification.body, undefined, 'OS toast has no body')
  assert.equal(run.notices.length, 1)
  assert.equal(run.notices[0].chatContent.includes(content), true, 'chat keeps the full memory text')

  for (const secret of ['顺便取快递', '1234', content]) {
    assertNotLeaked(notification.title, secret, 'notification title leaked a later agenda line')
    assertNotLeaked(notification.body ?? '', secret, 'notification body leaked a later agenda line')
    for (const log of run.logs) {
      assertNotLeaked(log.title, secret, 'onLog title leaked a later agenda line')
      assertNotLeaked(log.detail, secret, 'onLog detail leaked a later agenda line')
    }
    for (const line of run.consoleOutput) {
      assertNotLeaked(line, secret, 'console output leaked a later agenda line')
    }
  }
})

test('agenda chat/bubble keep the full outreach while the OS toast is the key point', async (t) => {
  const now = new Date(2026, 4, 1, 9, 0, 0).getTime()
  // The place lives only in loopPlace, not in `what`, so the two surfaces are
  // clearly distinguishable: chat has it, the OS toast does not.
  const what = '对一下季度方案的细节顺便把上周的发票带过去'
  const run = await runAgenda(t, {
    now,
    memories: [makeLoop({
      id: 'agenda-full-copy',
      content: what,
      loopKeyPoint: '对季度方案',
      loopPlace: '国贸',
      loopDueText: '下午三点',
      loopDueAt: new Date(now + 3 * HOUR).toISOString(),
      createdAt: new Date(now - DAY).toISOString(),
    })],
  })

  assert.equal(run.notices.length, 1)
  const notice = run.notices[0]
  assert.ok(notice.chatContent.length > 20)
  assert.equal(notice.chatContent.includes('国贸'), true, 'chat keeps the place')
  assertSame(notice.bubbleContent, notice.chatContent, 'bubble keeps the full copy')

  assert.equal(run.notifications.length, 1)
  const notification = run.notifications[0]
  assertSame(notification.title, '对季度方案', 'OS title is the stored key point')
  assert.equal(notification.body, undefined, 'OS toast has no body')
  assert.equal(notification.title.includes('国贸'), false, 'OS toast omits the place')
})

// ── Bracket hook ───────────────────────────────────────────────────────────

test('bracket errand keeps the result in chat/bubble while the OS toast is the fixed line', async (t) => {
  const now = new Date(2026, 4, 25, 9, 0, 0).getTime()
  const run = await runBracket(t, {
    now,
    errands: [{
      id: 'errand-1',
      prompt: ERRAND_PROMPT,
      status: 'completed',
      createdAt: new Date(now - 12 * HOUR).toISOString(),
      completedAt: new Date(now - 2 * HOUR).toISOString(),
      result: ERRAND_RESULT,
    }],
  })

  assert.equal(run.notices.length, 1)
  const notice = run.notices[0]
  assert.equal(notice.chatContent.includes(ERRAND_RESULT), true, 'chat keeps the errand result')
  assertSame(notice.bubbleContent, notice.chatContent, 'bubble keeps the full errand copy')

  assert.equal(run.notifications.length, 1)
  assertSame(run.notifications[0].body, '昨晚帮你查的东西整理好了。', 'OS toast is the fixed errand line')
  assertNotLeaked(run.notifications[0].body ?? '', ERRAND_RESULT, 'OS toast leaked the errand result')
})

test('bracket last-night callback keeps the topic in chat/bubble while the OS toast is the fixed line', async (t) => {
  const now = new Date(2026, 4, 25, 9, 0, 0).getTime()
  const run = await runBracket(t, {
    now,
    bracketState: {
      lastMorningFiredMs: null,
      lastEveningFiredMs: null,
      eveningTopic: EVENING_TOPIC,
      eveningTopicAtMs: now - 10 * HOUR,
    },
  })

  assert.equal(run.notices.length, 1)
  const notice = run.notices[0]
  assert.equal(notice.chatContent.includes(EVENING_TOPIC), true, 'chat keeps the topic')
  assertSame(notice.bubbleContent, notice.chatContent, 'bubble keeps the full topic copy')

  assert.equal(run.notifications.length, 1)
  assertSame(run.notifications[0].body, '昨晚聊的事，我还记着。', 'OS toast is the fixed callback line')
  assertNotLeaked(run.notifications[0].body ?? '', EVENING_TOPIC, 'OS toast leaked the topic')
})

// ── Weekly letter hook ─────────────────────────────────────────────────────

test('the weekly letter OS title is the companion name, never the greeting', async (t) => {
  const run = await runLetter(t, { now: LETTER_NOW, companionName: '星绘' })

  assert.equal(run.notifications.length, 1)
  const notification = run.notifications[0]
  assertSame(notification.title, '星绘', 'letter title is the companion name')
  assertNotLeaked(notification.title, LETTER_GREETING, 'letter title leaked the greeting')
  assertNotLeaked(notification.body ?? '', LETTER_GREETING, 'letter body leaked the greeting')
  assertNotLeaked(notification.body ?? '', LETTER_BODY, 'letter body leaked the letter text')
})

test('the weekly letter OS title falls back to Nexus for a blank companion name', async (t) => {
  const run = await runLetter(t, { now: LETTER_NOW, companionName: '   ' })

  assert.equal(run.notifications.length, 1)
  assertSame(run.notifications[0].title, 'Nexus', 'blank name falls back to Nexus')
})

// ── Away copy snapshot ─────────────────────────────────────────────────────

const RELATIONSHIP_TYPES = ['open_ended', 'friend', 'mentor', 'quiet_companion'] as const

type AwayTemplate = { title: string; body: string }
type AwayCopy = Record<string, Record<string, AwayTemplate[]>>

// Copied verbatim from src/features/proactive/awayNotificationCopy.ts. Passing
// "{companionName}" as the name makes the selector return the raw template, so
// this is a literal snapshot of every title/body in the source table.
const AWAY_COPY: AwayCopy = {
  'zh-CN': {
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
  },
  'zh-TW': {
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
  },
  'en-US': {
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
  },
  ja: {
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
  },
  ko: {
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
  },
}

test('away notification copy is unchanged for every locale, type and template', () => {
  // The hook only calls pickAwayNotificationCopy with Math.random; snapshotting
  // the selector per index is the narrowest real entry point for this static
  // table, so the test is function-level by design.
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'] as const) {
    for (const relationshipType of RELATIONSHIP_TYPES) {
      const expected = AWAY_COPY[locale][relationshipType]
      assert.ok(expected.length > 0, `${locale}/${relationshipType} snapshot is empty`)
      for (let index = 0; index < expected.length; index += 1) {
        const actual = pickAwayNotificationCopy({
          uiLanguage: locale,
          relationshipType,
          // Keeps the raw {companionName} placeholder so the snapshot matches
          // the source table literally.
          companionName: '{companionName}',
          randomFn: () => (index + 0.5) / expected.length,
        })
        assert.deepEqual(actual, expected[index], `${locale}/${relationshipType}/${index}`)
      }
    }
  }
})

// ── Open arc without uiLanguage ────────────────────────────────────────────

const NOW = new Date(2026, 4, 1, 12, 0, 0).getTime()
const ARC_THEME = '要不要换工作'
const ARC: OpenArcRecord = {
  id: 'arc-1',
  theme: ARC_THEME,
  startedAt: '2026-01-01T08:00:00.000Z',
  checkInDays: [3, 5],
  status: 'open',
  checkInsFired: [],
}
const ARC_DELIVERY = {
  title: 'A thread you opened',
  body: `Nexus held this for you: "${ARC_THEME}". Three days in — is it still sitting with you?`,
}

function makeContext(): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
  }
}

test('open-arc delivery without uiLanguage falls back to the zh-CN fixed line', async () => {
  // DeliverDueOpenArcDeps requires uiLanguage, but tests are not part of the
  // tsc -b project graph. This runtime test is the enforced contract that a
  // missing reader language must not silently switch to another locale.
  await ensureLocaleLoaded('zh-CN')
  await ensureLocaleLoaded('en-US')

  const notifications: OpenArcDeliveryText[] = []
  const deps = {
    arc: ARC,
    delivery: ARC_DELIVERY,
    milestoneDay: 3,
    now: NOW,
    useLegacyPath: false,
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload: OpenArcDeliveryText) => { notifications.push(payload) },
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async () => undefined,
    recordCheckInFired: () => undefined,
    isStopped: () => false,
  } as unknown as DeliverDueOpenArcDeps

  const result = await deliverDueOpenArc(deps)

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [{
    title: ARC_DELIVERY.title,
    body: '上次你说的那件事，后来怎么样了？',
  }])
  assertNotLeaked(JSON.stringify(notifications), ARC_THEME, 'open-arc toast leaked the theme')
})
