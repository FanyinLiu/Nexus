import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  estimateModelContextWindowTokens,
  modelSupportsSpeech,
  modelSupportsVision,
} from '../src/lib/modelCapabilities.ts'

test('modelSupportsVision: known multimodal families', () => {
  for (const id of [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4-turbo',
    'gpt-4-vision-preview',
    'gpt-5',
    'gpt-5-mini',
    'o3-mini',
    'o4',
    'claude-3-5-sonnet-20241022',
    'claude-4-opus',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'gemini-1.5-pro',
    'gemini-2.0-flash',
    'qwen-vl-max-latest',
    'qwen2-vl-72b',
    'qwen2.5-vl-7b',
    'pixtral-12b',
    'llava-1.5',
    'llama-3.2-vision',
    'minicpm-v',
    'moondream2',
    'internvl2',
    'glm-4v',
    'yi-vl-34b',
    'step-1v-32k',
  ]) {
    assert.equal(modelSupportsVision(id), true, `expected ${id} to be vision-capable`)
  }
})

test('modelSupportsVision: text-only models', () => {
  for (const id of [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'deepseek-coder',
    'llama-3.1-70b',
    'llama-3-8b',
    'mistral-7b',
    'codestral-22b',
    'qwen2.5-7b',
    'qwen2.5-coder-32b',
    'gpt-3.5-turbo',
    'gpt-4o-mini-tts',
    'gpt-4o-mini-transcribe',
    'gpt-4o-transcribe',
    'whisper-1',
  ]) {
    assert.equal(modelSupportsVision(id), false, `expected ${id} to be text-only`)
  }
})

test('modelSupportsVision: empty / nullish', () => {
  assert.equal(modelSupportsVision(''), false)
  assert.equal(modelSupportsVision(null), false)
  assert.equal(modelSupportsVision(undefined), false)
  assert.equal(modelSupportsVision('   '), false)
})

test('modelSupportsSpeech: detects voice and realtime model ids', () => {
  assert.equal(modelSupportsSpeech('gpt-4o-mini-tts'), true)
  assert.equal(modelSupportsSpeech('gpt-realtime'), true)
  assert.equal(modelSupportsSpeech('deepseek-v4-flash'), false)
})

test('estimateModelContextWindowTokens: returns useful coarse buckets', () => {
  assert.equal(estimateModelContextWindowTokens('deepseek-v4-flash'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('gpt-5.4-mini'), 400_000)
  assert.equal(estimateModelContextWindowTokens('grok-4.3'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('grok-build-0.1'), 256_000)
  assert.equal(estimateModelContextWindowTokens('grok-4.20-0309-reasoning'), 2_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-opus-4-8'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-sonnet-4-6'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('deepseek-v4-pro'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.7-max'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.6-plus'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('mistral-medium-3-5'), 256_000)
  assert.equal(estimateModelContextWindowTokens('moonshotai/Kimi-K2.6'), 256_000)
  assert.equal(estimateModelContextWindowTokens('MiniMaxAI/MiniMax-M2.7'), 200_000)
  assert.equal(estimateModelContextWindowTokens('unknown-model'), null)
})
