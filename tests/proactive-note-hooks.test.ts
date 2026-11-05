import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { useProactiveNotebookNarration } from '../src/hooks/useProactiveNotebookNarration.ts'

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

test('the notebook narration hook exposes its interrupt boundary', () => {
  const html = renderToStaticMarkup(React.createElement(NarrationProbe))
  assert.match(html, /data-interrupt="function"/)
})
