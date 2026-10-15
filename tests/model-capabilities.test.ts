import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  estimateModelContextWindowTokens,
  modelRejectsChatCompletionsTools,
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
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-haiku-4-5',
    'kimi-k3',
    'gpt-5.6-sol',
    'qwen3.8-max',
    'qwen3.8-flash',
    'glm-5.3-flash',
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
    'glm-5.3',
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
  assert.equal(estimateModelContextWindowTokens('gpt-5.6-sol'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('grok-4.6'), 500_000)
  assert.equal(estimateModelContextWindowTokens('grok-4.3'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('grok-build-0.1'), 256_000)
  assert.equal(estimateModelContextWindowTokens('grok-4.20-0309-reasoning'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-opus-5'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-sonnet-5'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-opus-4-8'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-sonnet-4-6'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('deepseek-v4-pro'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.8-max'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.8-flash'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.8-27b'), 256_000)
  assert.equal(estimateModelContextWindowTokens('glm-5.3'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('glm-5.3-flash'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.7-max'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen-3-7-max'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.7-plus'), 256_000)
  assert.equal(estimateModelContextWindowTokens('kimi-k3'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('glm-5.2'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3.6-plus'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('qwen3-6-27b'), 256_000)
  assert.equal(estimateModelContextWindowTokens('qwen3-coder-next'), 256_000)
  assert.equal(estimateModelContextWindowTokens('qwen3-coder-480b-a35b-instruct-turbo'), 256_000)
  assert.equal(estimateModelContextWindowTokens('mistral-medium-3-5'), 256_000)
  assert.equal(estimateModelContextWindowTokens('moonshotai/Kimi-K2.6'), 256_000)
  assert.equal(estimateModelContextWindowTokens('kimi-k2-6'), 256_000)
  assert.equal(estimateModelContextWindowTokens('MiniMax-M3'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('gpt-6.1-sol'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('grok-4.7'), 500_000)
  assert.equal(estimateModelContextWindowTokens('deepseek-flash'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('claude-haiku-5-5'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('gemini-4-argon'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('mistral-large-4'), 1_000_000)
  assert.equal(estimateModelContextWindowTokens('doubao-seed-2-1-pro-260915'), 1_000_000)
  assert.equal(modelSupportsVision('deepseek-v4-flash'), false)
  assert.equal(modelSupportsVision('deepseek-flash'), true)
  assert.equal(modelSupportsVision('deepseek-ai/DeepSeek-V4.1-Flash'), true)
  assert.equal(modelSupportsVision('deepseek-ai/deepseek-v4.1-flash'), true)
  assert.equal(modelSupportsVision('deepseek-v4-1-flash'), true)
  assert.equal(modelSupportsVision('gpt-6-luna'), true)
  assert.equal(estimateModelContextWindowTokens('MiniMaxAI/MiniMax-M2.7'), 200_000)
  assert.equal(estimateModelContextWindowTokens('zai-org-glm-5-1'), 200_000)
  assert.equal(estimateModelContextWindowTokens('ernie-x1.1'), 64_000)
  assert.equal(estimateModelContextWindowTokens('unknown-model'), null)
  assert.equal(modelRejectsChatCompletionsTools('gpt-6-astra'), true)
  assert.equal(modelRejectsChatCompletionsTools('GPT-6.1-Sol'), true)
  assert.equal(modelRejectsChatCompletionsTools('gpt-6-sol'), false)
  assert.equal(modelRejectsChatCompletionsTools('gpt-6-luna'), false)
})
