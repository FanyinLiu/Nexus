import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { useProactiveNotebookNarration } from '../src/hooks/useProactiveNotebookNarration.ts'
import { useProactiveNoteMotion } from '../src/hooks/useProactiveNoteMotion.ts'
import type { ProactiveNoteView } from '../src/features/proactive/proactiveNote.ts'

const ONE_SHEET: ProactiveNoteView = { state: 'one', sheets: 1, animated: true }

function MotionProbe() {
  const { motion, onApproach } = useProactiveNoteMotion({ view: ONE_SHEET, context: null })
  return React.createElement('span', {
    'data-motion': motion ?? 'none',
    'data-approach': typeof onApproach,
  })
}

function NarrationProbe() {
  const { interrupt } = useProactiveNotebookNarration({
    open: false,
    rows: [],
    openingUnseenIds: [],
    openingText: '我记了几件事。',
    letterText: '有一封信',
    restText: '剩下的你翻翻看',
    settings: { speechOutputEnabled: false },
    context: null,
    speak: async () => {},
    stop: () => {},
    setSpeakingId: () => {},
  })
  return React.createElement('span', { 'data-interrupt': typeof interrupt })
}

test('the note motion hook starts still and exposes one approach trigger', () => {
  const html = renderToStaticMarkup(React.createElement(MotionProbe))
  assert.match(html, /data-motion="none"/)
  assert.match(html, /data-approach="function"/)
})

test('the notebook narration hook exposes its interrupt boundary', () => {
  const html = renderToStaticMarkup(React.createElement(NarrationProbe))
  assert.match(html, /data-interrupt="function"/)
})
