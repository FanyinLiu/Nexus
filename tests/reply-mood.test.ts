import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  emotionToPetMood,
  petMoodForAssistantReply,
} from '../src/features/autonomy/emotionModel.ts'

const SMILING = new Set(['happy', 'excited', 'playful', 'proud'])

test('sad replies do not choose a smiling mood', () => {
  for (const text of [
    "I'm sorry you're going through this. That sounds really hard.",
    '听到这些我很难过，你不用一个人扛着。',
    'I am sorry. This is heartbreaking.',
  ]) {
    const mood = petMoodForAssistantReply({ replyText: text })
    assert.ok(mood, text)
    assert.equal(SMILING.has(mood!), false, `${text} -> ${mood}`)
  }
})

test('a mood tag is mapped through emotionToPetMood and a plain reply does not invent one', () => {
  const happy = petMoodForAssistantReply({ replyText: 'All set.', moodWord: 'happy' })
  assert.equal(happy, emotionToPetMood({ energy: 0.72, warmth: 0.8, curiosity: 0.4, concern: 0.1 }))
  assert.equal(SMILING.has(happy!), true)

  const sadTag = petMoodForAssistantReply({ replyText: 'Okay.', moodWord: 'sad' })
  assert.equal(SMILING.has(sadTag!), false)

  assert.equal(petMoodForAssistantReply({ replyText: 'The file is saved.' }), null)

  const supplied = petMoodForAssistantReply({
    emotion: { energy: 0.32, warmth: 0.48, curiosity: 0.2, concern: 0.84 },
  })
  assert.equal(supplied, 'worried')
})
