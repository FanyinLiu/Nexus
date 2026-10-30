import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StageDirectionStreamFilter } from '../src/features/pet/performance.ts'
import { filterSpeechText } from '../src/features/voice/speechTextFilter.ts'
import { prepareTextForTts } from '../src/features/voice/text.ts'
import { t } from '../src/i18n/runtime.ts'

const CASES: Array<[name: string, input: string, expected: string]> = [
  [
    'keeps an ordinary parenthetical and the sentence-final question mark',
    '嗯？你说的是 (比如 Python) 那个吗？',
    '嗯？你说的是 (比如 Python) 那个吗？',
  ],
  [
    'strips a single-asterisk action and an emoji',
    '*笑* 好呀～😊',
    '好呀～',
  ],
  [
    'strips a known ASCII gesture but keeps the exclamation mark',
    '(smiles) okay!',
    'okay!',
  ],
  [
    'keeps an unknown ASCII parenthetical',
    '看看这个 (TODO) 清单',
    '看看这个 (TODO) 清单',
  ],
  [
    'collapses repeated sentence-final punctuation',
    '好吧！！！',
    '好吧！',
  ],
  [
    'turns an ellipsis into a pause instead of a full stop',
    '等等……',
    '等等…',
  ],
  [
    'strips strikethrough and a kaomoji',
    '~~不要~~ ٩(◕‿◕)۶ 好呀',
    '好呀',
  ],
  [
    'strips a dot-face kaomoji',
    '好呀 (｡•ᴗ•｡) 再见',
    '好呀 再见',
  ],
  [
    'strips a caret kaomoji',
    '好呀 ^_^ 再见',
    '好呀 再见',
  ],
  [
    'strips markdown heading and list markers but keeps their words',
    '## 提醒\n- 喝水\n1. 休息',
    '提醒 喝水 休息',
  ],
]

for (const [name, input, expected] of CASES) {
  test(`prepareTextForTts ${name}`, () => {
    assert.equal(prepareTextForTts(input), expected)
  })
}

test('prepareTextForTts replaces a fenced code block with the localized phrase', () => {
  const spoken = prepareTextForTts('我写了这个：\n```ts\nconst x = 1\n```\n你看看？')

  assert.equal(spoken, `我写了这个： ${t('voice.tts.code_block_placeholder')} 你看看？`)
})

test('filterSpeechText uses the injected code-block placeholder', () => {
  assert.equal(
    filterSpeechText('before\n```js\nconsole.log(1)\n```\nafter', {
      codeBlockPlaceholder: 'the code is on screen',
    }),
    'before\n the code is on screen \nafter',
  )
})

test('filterSpeechText leaves multiplication alone', () => {
  assert.equal(filterSpeechText('2*3*4 等于 24'), '2*3*4 等于 24')
})

test('StageDirectionStreamFilter holds a partial ASCII action until its closing star', () => {
  const filter = new StageDirectionStreamFilter()

  assert.equal(filter.push('好呀*笑'), '好呀')
  assert.equal(filter.push('*'), '*笑*')
  assert.equal(filter.flush(), '')
})

test('StageDirectionStreamFilter holds a partial ASCII parenthetical until it closes', () => {
  const filter = new StageDirectionStreamFilter()

  assert.equal(filter.push('好呀(smi'), '好呀')
  assert.equal(filter.push('les)继续'), '继续')
  assert.equal(filter.flush(), '')
})

test('StageDirectionStreamFilter matches whole-string output when fed char by char', () => {
  const text = '好的（眼睛亮了）(*笑*)(smiles)继续呀'

  const whole = new StageDirectionStreamFilter()
  const expected = whole.push(text) + whole.flush()

  const streamed = new StageDirectionStreamFilter()
  let actual = ''
  for (const ch of text) {
    actual += streamed.push(ch)
  }
  actual += streamed.flush()

  assert.equal(actual, expected)
})

test('prepareTextForTts can keep an opening stage direction for the tone resolver', () => {
  const sentence = '（生气）你怎么又这样？'

  // Default speech text never contains the aside.
  assert.equal(prepareTextForTts(sentence), '你怎么又这样？')
  // The chunker input keeps it so the per-sentence resolver can read the cue;
  // code blocks are still normalised before chunking.
  assert.equal(prepareTextForTts(sentence, { keepStageDirections: true }), sentence)
  assert.match(
    prepareTextForTts('（小声）看这个。\n```js\nconst a = 1;\n```', { keepStageDirections: true }),
    /（小声）/u,
  )
})
