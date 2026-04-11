import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildBuiltInToolAssistantSummary,
  buildBuiltInToolSpeechSummary,
  shouldUseBuiltInToolAssistantSummary,
} from '../src/features/tools/assistant.ts'
import { resolveAssistantPresentation } from '../src/features/tools/presentation.ts'

test('prefers structured search display summary when available', () => {
  const summary = buildBuiltInToolAssistantSummary({
    kind: 'web_search',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result: {
      query: 'nexus 搜索展示',
      message: '',
      display: {
        mode: 'answer',
        title: 'Nexus 搜索展示',
        summary: 'Nexus 会先整理最相关结果，再把适合展示的正文片段放进气泡里。',
        panels: [
          {
            title: 'Nexus Web Search',
            body: '搜索工具会生成结构化结果，便于前端直接展示。',
            host: 'github.com',
            url: 'https://github.com/FanyinLiu/Nexus',
          },
        ],
        sources: [
          {
            title: 'Nexus',
            url: 'https://github.com/FanyinLiu/Nexus',
            host: 'github.com',
          },
        ],
      },
      items: [
        {
          title: '无关结果',
          url: 'https://example.com/off-topic',
          snippet: '这是一个无关摘要。',
        },
      ],
    },
  })

  assert.equal(summary, 'Nexus 会先整理最相关结果，再把适合展示的正文片段放进气泡里。')
})

test('summarizes relevant web search hits directly without structured display', () => {
  const summary = buildBuiltInToolAssistantSummary({
    kind: 'web_search',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result: {
      query: '周传雄的黄昏 歌词',
      message: '',
      items: [
        {
          title: '周传雄《黄昏》歌词',
          url: 'https://example.com/lyrics',
          snippet: '周传雄《黄昏》歌词，歌曲表达了黄昏时刻的失落与怀念。',
        },
      ],
    },
  })

  assert.match(summary, /周传雄/u)
  assert.match(summary, /黄昏/u)
})

test('admits when web search results are off target', () => {
  const summary = buildBuiltInToolAssistantSummary({
    kind: 'web_search',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result: {
      query: '黄昏 歌词',
      message: '',
      items: [
        {
          title: '我的世界怎么打彩色字',
          url: 'https://example.com/mc',
          snippet: '这里介绍我的世界里怎么输入彩色字体。',
        },
      ],
    },
  })

  assert.match(summary, /没准确命中|不够贴合/u)
})

test('uses tool summary when the model only promises to act', () => {
  const shouldUseSummary = shouldUseBuiltInToolAssistantSummary(
    '好的，我这就给主人查找《黄昏》的歌词。',
    {
      kind: 'web_search',
      systemMessage: '',
      promptContext: '',
      assistantSummary: '我先总结一下：这次搜索已经基本命中“黄昏 歌词”。',
      result: {
        query: '黄昏 歌词',
        message: '',
        items: [],
      },
    },
  )

  assert.equal(shouldUseSummary, true)
})

test('lyrics search speech summary uses display title instead of generic result wording', () => {
  const speech = buildBuiltInToolSpeechSummary({
    kind: 'web_search',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result: {
      query: '周传雄 黄昏 歌词',
      message: '',
      display: {
        mode: 'lyrics',
        title: '周传雄《黄昏》',
        summary: '已找到周传雄《黄昏》的歌词片段。',
        bodyLines: ['过完整个夏天', '忧伤并没有好一些'],
        sources: [
          {
            title: '周传雄《黄昏》歌词',
            url: 'https://lrclib.net/api/get?track_name=%E9%BB%84%E6%98%8F&artist_name=%E5%91%A8%E4%BC%A0%E9%9B%84',
            host: 'lrclib.net',
          },
        ],
      },
      items: [
        {
          title: '周传雄《黄昏》歌词',
          url: 'https://lrclib.net/api/get?track_name=%E9%BB%84%E6%98%8F&artist_name=%E5%91%A8%E4%BC%A0%E9%9B%84',
          snippet: '过完整个夏天\n忧伤并没有好一些',
          contentPreview: '过完整个夏天\n忧伤并没有好一些',
        },
      ],
    },
  })

  assert.match(speech, /黄昏/u)
  assert.match(speech, /歌词/u)
  assert.doesNotMatch(speech, /结果/u)
})

test('weather speech summary includes actual weather details', () => {
  const speech = buildBuiltInToolSpeechSummary({
    kind: 'weather',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result: {
      location: 'Shanghai',
      resolvedName: '上海',
      currentSummary: '多云，22 度',
      todaySummary: '白天 25 度，夜间 18 度',
      tomorrowSummary: '小雨，20 到 24 度',
      message: '',
    },
  })

  assert.match(speech, /上海/u)
  assert.match(speech, /多云/u)
  assert.match(speech, /今天|明天/u)
})

test('weather speech summary does not repeat day labels', () => {
  const speech = buildBuiltInToolSpeechSummary({
    kind: 'weather',
    systemMessage: '',
    promptContext: '',
    assistantSummary: '',
    result: {
      location: 'Shenzhen',
      resolvedName: '深圳',
      currentSummary: '当前28度，局部多云',
      todaySummary: '今天，小阵雨，24度到28度',
      tomorrowSummary: '明天，阴天，24度到28度',
      message: '',
    },
  })

  assert.doesNotMatch(speech, /今天今天/u)
  assert.doesNotMatch(speech, /明天明天/u)
  assert.match(speech, /今天，小阵雨/u)
  assert.match(speech, /明天，阴天/u)
})

test('assistant spoken reply wins over tool speech when the model gives a real weather answer', () => {
  const presentation = resolveAssistantPresentation({
    builtInToolResult: {
      kind: 'weather',
      systemMessage: '',
      promptContext: '',
      assistantSummary: '我先总结一下：深圳当前有雷阵雨。',
      result: {
        location: 'Shenzhen',
        resolvedName: '深圳',
        currentSummary: '雷阵雨，24到28度',
        todaySummary: '今天有雷阵雨，24到28度',
        tomorrowSummary: '明天小阵雨，24到27度',
        message: '',
      },
    },
    hasToolResultCard: true,
    assistantDisplayContent: '是的呢，今天深圳有雷阵雨，气温24到28度，出门记得带伞哦。',
    assistantSpokenContent: '是的呢，今天深圳有雷阵雨，气温24到28度，出门记得带伞哦。',
    toolSpeechOutput: '好的，主人。深圳当前雷阵雨，今天有雷阵雨，明天小阵雨。',
  })

  assert.equal(
    presentation.speechContent,
    '是的呢，今天深圳有雷阵雨，气温24到28度，出门记得带伞哦。',
  )
})

test('tool speech stays as fallback when the model only promises to check weather', () => {
  const presentation = resolveAssistantPresentation({
    builtInToolResult: {
      kind: 'weather',
      systemMessage: '',
      promptContext: '',
      assistantSummary: '我先总结一下：深圳当前有雷阵雨。',
      result: {
        location: 'Shenzhen',
        resolvedName: '深圳',
        currentSummary: '雷阵雨，24到28度',
        todaySummary: '今天有雷阵雨，24到28度',
        tomorrowSummary: '明天小阵雨，24到27度',
        message: '',
      },
    },
    hasToolResultCard: true,
    assistantDisplayContent: '好的，我这就帮你查天气。',
    assistantSpokenContent: '好的，我这就帮你查天气。',
    toolSpeechOutput: '好的，主人。深圳当前雷阵雨，今天有雷阵雨，明天小阵雨。',
  })

  assert.equal(
    presentation.speechContent,
    '好的，主人。深圳当前雷阵雨，今天有雷阵雨，明天小阵雨。',
  )
})
