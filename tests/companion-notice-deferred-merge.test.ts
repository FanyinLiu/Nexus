import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dedupeDeferredReminders,
  mergeDeferredReminders,
  type DeferredReminderCopy,
  type DeferredReminderItem,
} from '../src/features/reminders/deferredNotice.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'

function copyFor(messages: Record<string, string>): DeferredReminderCopy {
  const separator = messages['companion.notice.deferred_separator']
  return {
    separator,
    sentenceEnd: messages['companion.notice.deferred_end'],
    prefix: (items) => messages['companion.notice.deferred_prefix'].replace('{items}', items),
    prefixLabel: messages['companion.notice.deferred_prefix'].split('{items}', 1)[0].trimEnd(),
    more: (count) => messages['companion.notice.deferred_more'].replace('{count}', String(count)),
    moreOne: () => messages['companion.notice.deferred_more_one'],
    moreJoiner: separator.endsWith(' ') ? ' ' : '',
  }
}

function item(
  reminderId: string,
  dueAt: number,
  enqueuedAt: number,
  speechContent: string,
): DeferredReminderItem {
  return {
    reminderId,
    dueAt,
    enqueuedAt,
    chatContent: `chat-${speechContent}`,
    bubbleContent: speechContent,
    speechContent,
  }
}

function rawItem(
  reminderId: string,
  dueAt: number,
  text: string,
): DeferredReminderItem {
  return {
    reminderId,
    dueAt,
    enqueuedAt: 0,
    chatContent: text,
    bubbleContent: text,
    speechContent: text,
  }
}

test('merged reminders are ordered by due time and deduplicated by id', () => {
  const merged = mergeDeferredReminders([
    item('late', 300, 0, 'late'),
    item('early', 100, 0, 'early'),
    item('early', 50, 0, 'earlier duplicate'),
    item('middle', 200, 0, 'middle'),
  ], copyFor(enMessages), { now: 0 })

  assert.ok(merged)
  assert.deepEqual(merged.selected.map((entry) => entry.reminderId), ['early', 'middle', 'late'])
  assert.deepEqual(merged.selected.map((entry) => entry.speechContent), [
    'earlier duplicate',
    'middle',
    'late',
  ])
  assert.equal(merged.extraCount, 0)
})

test('prefix appears only when any reminder waited at least 60 seconds', () => {
  const en = copyFor(enMessages)
  const at = (waitedMs: number) => mergeDeferredReminders([
    item('water', 100, 1_000, 'drink water'),
  ], en, { now: 1_000 + waitedMs })

  assert.equal(at(59_000)?.usedPrefix, false)
  assert.equal(at(59_000)?.speechContent, 'drink water.')
  assert.equal(at(60_000)?.usedPrefix, true)
  assert.equal(
    at(60_000)?.speechContent,
    'While we were chatting, a reminder came up: drink water.',
  )
  assert.equal(at(61_000)?.usedPrefix, true)
})

test('the merged utterance caps at three items and appends the singular/plural more line', () => {
  const en = copyFor(enMessages)
  const three = mergeDeferredReminders([
    item('a', 1, 0, 'a'),
    item('b', 2, 0, 'b'),
    item('c', 3, 0, 'c'),
  ], en, { now: 0 })
  assert.equal(three?.extraCount, 0)
  assert.equal(three?.speechContent, 'a; b; c.')

  const four = mergeDeferredReminders([
    item('a', 1, 0, 'a'),
    item('b', 2, 0, 'b'),
    item('c', 3, 0, 'c'),
    item('d', 4, 0, 'd'),
  ], en, { now: 0 })
  assert.equal(four?.extraCount, 1)
  assert.equal(four?.selected.length, 3)
  assert.equal(four?.speechContent, 'a; b; c. 1 more reminder.')

  const five = mergeDeferredReminders([
    item('a', 1, 0, 'a'),
    item('b', 2, 0, 'b'),
    item('c', 3, 0, 'c'),
    item('d', 4, 0, 'd'),
    item('e', 5, 0, 'e'),
  ], en, { now: 0 })
  assert.equal(five?.extraCount, 2)
  assert.equal(five?.speechContent, 'a; b; c. 2 more reminders.')
})

test('zh-CN and en use their own separator and prefix copy', () => {
  const zh = copyFor(zhCNMessages)
  const en = copyFor(enMessages)
  const items = [
    item('water', 1, 0, '喝水'),
    item('parcel', 2, 0, '拿快递'),
  ]

  assert.equal(mergeDeferredReminders(items, zh, { now: 0 })?.speechContent, '喝水；拿快递。')
  assert.equal(mergeDeferredReminders(items, en, { now: 0 })?.speechContent, '喝水; 拿快递.')
  assert.equal(
    mergeDeferredReminders(items, zh, { now: 60_000 })?.speechContent,
    '刚才聊天的时候到点了：喝水；拿快递。',
  )
})

test('every locale has exact five-item and single-item output', () => {
  const cases = [
    {
      name: 'zh-CN',
      messages: zhCNMessages,
      five: '刚才聊天的时候到点了：喝水；拿快递；给妈打电话。还有 2 条提醒。',
      single: '该去开会了。',
      singleItem: '该去开会了',
    },
    {
      name: 'zh-TW',
      messages: zhTWMessages,
      five: '剛才聊天的時候到點了：喝水；拿快遞；給媽打電話。還有 2 則提醒。',
      single: '該去開會了。',
      singleItem: '該去開會了',
    },
    {
      name: 'en',
      messages: enMessages,
      five: 'While we were chatting, a reminder came up: a; b; c. 2 more reminders.',
      single: 'take out the trash.',
      singleItem: 'take out the trash',
    },
    {
      name: 'ja',
      messages: jaMessages,
      five: 'さっき話している間に時間になりました：水を飲む、荷物を受け取る、母に電話する。ほかにもリマインダーが 2 件あります。',
      single: '会議に行く。',
      singleItem: '会議に行く',
    },
    {
      name: 'ko',
      messages: koMessages,
      five: '아까 대화하는 동안 시간이 됐어요: 물 마시기, 택배 찾기, 엄마에게 전화하기. 리마인더가 2개 더 있어요.',
      single: '회의에 가기.',
      singleItem: '회의에 가기',
    },
  ]

  for (const localeCase of cases) {
    const copy = copyFor(localeCase.messages)
    const fiveItems = localeCase.name === 'zh-CN' || localeCase.name === 'zh-TW'
      ? ['喝水', '拿快递', '给妈打电话', '第四', '第五']
      : localeCase.name === 'ja'
        ? ['水を飲む', '荷物を受け取る', '母に電話する', '第四', '第五']
        : localeCase.name === 'ko'
          ? ['물 마시기', '택배 찾기', '엄마에게 전화하기', '네 번째', '다섯 번째']
          : ['a', 'b', 'c', 'd', 'e']
    const zhTWItems = ['喝水', '拿快遞', '給媽打電話', '第四', '第五']
    const items = localeCase.name === 'zh-TW' ? zhTWItems : fiveItems
    const merged = mergeDeferredReminders(
      items.map((speech, index) => item(`r${index}`, index, 0, speech)),
      copy,
      { now: 60_000 },
    )
    assert.equal(merged?.speechContent, localeCase.five, localeCase.name)

    const single = mergeDeferredReminders([
      item('single', 1, 0, localeCase.singleItem),
    ], copy, { now: 0 })
    assert.equal(single?.speechContent, localeCase.single, `${localeCase.name} single`)
  }
})

test('source punctuation is stripped before the one sentence end', () => {
  const zh = copyFor(zhCNMessages)
  const en = copyFor(enMessages)
  const zhMerged = mergeDeferredReminders([
    item('meeting', 1, 0, '该去开会了。'),
    item('parcel', 2, 0, '拿快递'),
  ], zh, { now: 60_000 })
  assert.equal(zhMerged?.speechContent, '刚才聊天的时候到点了：该去开会了；拿快递。')

  const enMerged = mergeDeferredReminders([
    item('a', 1, 0, 'a.'),
    item('b', 2, 0, 'b!'),
    item('c', 3, 0, 'c！'),
  ], en, { now: 0 })
  assert.equal(enMerged?.speechContent, 'a; b; c.')

  const single = mergeDeferredReminders([
    item('single', 1, 0, '该去开会了。'),
  ], zh, { now: 0 })
  assert.equal(single?.speechContent, '该去开会了。')
})

test('English prefix preserves item casing and acronyms', () => {
  const en = copyFor(enMessages)
  const sentence = mergeDeferredReminders([
    item('water', 1, 0, 'Time to drink water'),
  ], en, { now: 60_000 })
  assert.equal(
    sentence?.speechContent,
    'While we were chatting, a reminder came up: Time to drink water.',
  )

  const acronym = mergeDeferredReminders([
    item('tv', 1, 0, 'TV time'),
    item('me', 2, 0, 'I will call'),
  ], en, { now: 60_000 })
  assert.equal(
    acronym?.speechContent,
    'While we were chatting, a reminder came up: TV time; I will call.',
  )
})

test('multi-line chat keeps full text while speech and bubble use the title line', () => {
  const en = copyFor(enMessages)
  const multiLine: DeferredReminderItem = {
    reminderId: 'auto',
    dueAt: 1,
    enqueuedAt: 0,
    chatContent: '【自动任务】标题\n内容正文',
    bubbleContent: '【自动任务】标题\n内容正文',
    speechContent: '【自动任务】标题\n内容正文',
  }
  const merged = mergeDeferredReminders([multiLine], en, { now: 0 })
  assert.equal(merged?.chatContent, '【自动任务】标题\n内容正文')
  assert.equal(merged?.speechContent, '【自动任务】标题.')
  assert.equal(merged?.bubbleContent, '【自动任务】标题.')
})

test('chat content uses prefix, item and more lines without separators or punctuation', () => {
  const zh = copyFor(zhCNMessages)
  const en = copyFor(enMessages)
  const makeItems = (first: string, second: string, third: string, fourth?: string) => [
    {
      reminderId: 'first',
      dueAt: 1,
      enqueuedAt: 0,
      chatContent: `${first}\nfull details`,
      bubbleContent: `${first}\nfull details`,
      speechContent: `${first}\nfull details`,
    },
    {
      reminderId: 'second',
      dueAt: 2,
      enqueuedAt: 0,
      chatContent: second,
      bubbleContent: second,
      speechContent: second,
    },
    {
      reminderId: 'third',
      dueAt: 3,
      enqueuedAt: 0,
      chatContent: third,
      bubbleContent: third,
      speechContent: third,
    },
    ...(fourth ? [{
      reminderId: 'fourth',
      dueAt: 4,
      enqueuedAt: 0,
      chatContent: fourth,
      bubbleContent: fourth,
      speechContent: fourth,
    }] : []),
  ]

  const zhThree = mergeDeferredReminders(makeItems('喝水', '拿快递', '给妈打电话。'), zh, { now: 60_000 })
  assert.equal(
    zhThree?.chatContent,
    '刚才聊天的时候到点了：\n喝水\nfull details\n拿快递\n给妈打电话。',
  )
  assert.equal(
    zhThree?.speechContent,
    '刚才聊天的时候到点了：喝水；拿快递；给妈打电话。',
  )

  const zhFour = mergeDeferredReminders(makeItems('喝水', '拿快递', '给妈打电话。', '买牛奶'), zh, { now: 60_000 })
  assert.equal(
    zhFour?.chatContent,
    '刚才聊天的时候到点了：\n喝水\nfull details\n拿快递\n给妈打电话。\n还有 1 条提醒。',
  )
  assert.equal(
    zhFour?.speechContent,
    '刚才聊天的时候到点了：喝水；拿快递；给妈打电话。还有 1 条提醒。',
  )

  const enThree = mergeDeferredReminders(makeItems('Drink water', 'Pick up parcel', 'Call Mom!'), en, { now: 60_000 })
  assert.equal(
    enThree?.chatContent,
    'While we were chatting, a reminder came up:\nDrink water\nfull details\nPick up parcel\nCall Mom!',
  )
  assert.equal(
    enThree?.speechContent,
    'While we were chatting, a reminder came up: Drink water; Pick up parcel; Call Mom.',
  )
  assert.equal(
    enThree?.bubbleContent,
    'While we were chatting, a reminder came up: Drink water; Pick up parcel; Call Mom.',
  )

  const enFour = mergeDeferredReminders(makeItems('Drink water', 'Pick up parcel', 'Call Mom!', 'Buy milk'), en, { now: 60_000 })
  assert.equal(
    enFour?.chatContent,
    'While we were chatting, a reminder came up:\nDrink water\nfull details\nPick up parcel\nCall Mom!\n1 more reminder.',
  )
  assert.equal(
    enFour?.speechContent,
    'While we were chatting, a reminder came up: Drink water; Pick up parcel; Call Mom. 1 more reminder.',
  )

  const noPrefix = mergeDeferredReminders(makeItems('喝水', '拿快递', '给妈打电话。'), zh, { now: 0 })
  assert.equal(noPrefix?.chatContent, '喝水\nfull details\n拿快递\n给妈打电话。')
  assert.equal(noPrefix?.speechContent, '喝水；拿快递；给妈打电话。')
})

test('punctuation-only items are skipped from speech and do not count toward the cap', () => {
  const en = copyFor(enMessages)
  const merged = mergeDeferredReminders([
    rawItem('a', 1, 'a'),
    rawItem('empty', 2, '。'),
    rawItem('b', 3, 'b'),
    rawItem('c', 4, 'c'),
    rawItem('d', 5, 'd'),
  ], en, { now: 0 })

  assert.equal(merged?.speechContent, 'a; b; c. 1 more reminder.')
  assert.equal(merged?.bubbleContent, 'a; b; c. 1 more reminder.')
  assert.equal(merged?.chatContent, 'a\n。\nb\nc\n1 more reminder.')
  assert.equal(merged?.extraCount, 1, 'the empty item is not counted in the more line')
})

test('punctuation-only items are skipped when fewer than three real items remain', () => {
  const en = copyFor(enMessages)
  const merged = mergeDeferredReminders([
    rawItem('a', 1, 'a'),
    rawItem('empty', 2, '。'),
    rawItem('b', 3, 'b'),
  ], en, { now: 0 })

  assert.equal(merged?.speechContent, 'a; b.')
  assert.equal(merged?.bubbleContent, 'a; b.')
  assert.equal(merged?.chatContent, 'a\n。\nb')
  assert.equal(merged?.extraCount, 0)
})

test('all punctuation-only items produce chat text but no speech or bubble', () => {
  const en = copyFor(enMessages)
  const merged = mergeDeferredReminders([
    rawItem('dots', 1, '。'),
    rawItem('bangs', 2, '!!'),
  ], en, { now: 0 })

  assert.equal(merged?.speechContent, '')
  assert.equal(merged?.bubbleContent, '')
  assert.equal(merged?.chatContent, '。\n!!')
  assert.equal(merged?.selected.length, 0)
  assert.equal(merged?.extraCount, 0)
})

test('English keeps casing in chat, speech and bubble', () => {
  const en = copyFor(enMessages)
  const merged = mergeDeferredReminders([
    rawItem('one', 1, 'Drink water'),
    rawItem('two', 2, 'Pick up parcel'),
    rawItem('three', 3, 'Call Mom'),
  ], en, { now: 60_000 })

  assert.equal(
    merged?.chatContent,
    'While we were chatting, a reminder came up:\nDrink water\nPick up parcel\nCall Mom',
  )
  assert.equal(
    merged?.speechContent,
    'While we were chatting, a reminder came up: Drink water; Pick up parcel; Call Mom.',
  )
  assert.equal(
    merged?.bubbleContent,
    'While we were chatting, a reminder came up: Drink water; Pick up parcel; Call Mom.',
  )
})

test('dedupe keeps the earliest due occurrence for the same reminder id', () => {
  const deduped = dedupeDeferredReminders([
    item('same', 500, 10, 'later'),
    item('same', 100, 20, 'earlier'),
    item('same', 100, 5, 'earliest enqueue'),
  ])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].speechContent, 'earliest enqueue')
})
