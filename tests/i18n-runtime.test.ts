import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AVAILABLE_LOCALES,
  ensureLocaleLoaded,
  getDictionary,
  isLocaleLoaded,
  setLocale,
  t,
} from '../src/i18n/runtime.ts'
import type { TranslationKey } from '../src/types/i18n.ts'

const FIRST_RUN_EVIDENCE_KEYS = [
  'onboarding.first_run_evidence.title',
  'onboarding.first_run_evidence.description',
  'onboarding.first_run_evidence.ready',
  'onboarding.first_run_evidence.needs_work',
  'onboarding.first_run_evidence.copy',
  'onboarding.first_run_evidence.copy_copied',
  'onboarding.first_run_evidence.copy_failed',
  'onboarding.first_run_evidence.model.ready',
  'onboarding.first_run_evidence.model.needs_check',
  'onboarding.first_run_evidence.model.unreachable',
  'onboarding.first_run_evidence.model.unavailable',
  'onboarding.first_run_evidence.model.needs_repair',
  'onboarding.first_run_evidence.conversation.ready',
  'onboarding.first_run_evidence.conversation.missing',
  'onboarding.first_run_evidence.conversation.failed',
  'onboarding.first_run_evidence.conversation.slow',
  'onboarding.first_run_evidence.privacy',
  'onboarding.first_run_evidence.next.done',
  'onboarding.first_run_evidence.next.test_model',
  'onboarding.first_run_evidence.next.first_message',
  'onboarding.first_run_evidence.next.repair_model',
  'onboarding.first_run_evidence.next.review',
  'onboarding.first_run_evidence.action.set_base_url',
  'onboarding.first_run_evidence.action.select_model',
  'onboarding.first_run_evidence.action.add_api_key',
  'onboarding.first_run_evidence.action.check_connection',
  'onboarding.first_run_evidence.action.start_ollama',
  'onboarding.first_run_evidence.action.start_local_service',
  'onboarding.first_run_evidence.action.check_remote_status',
  'onboarding.first_run_evidence.action.pull_ollama_model',
  'onboarding.first_run_evidence.action.install_local_model',
  'onboarding.first_run_evidence.action.choose_available_model',
  'onboarding.first_run_evidence.action.rerun_readiness',
  'onboarding.first_run_evidence.action.tighten_budget',
  'onboarding.first_run_evidence.action.run_first_message',
  'onboarding.first_run_evidence.action.retry_first_message',
  'onboarding.first_run_evidence.action.reduce_latency',
] as const satisfies readonly TranslationKey[]

const FIRST_RUN_PANEL_KEYS = [
  'panel.first_run.title',
  'panel.first_run.ready',
  'panel.first_run.waiting_user',
  'panel.first_run.waiting_assistant',
  'panel.first_run.failed',
  'panel.first_run.slow',
  'panel.first_run.action',
  'panel.first_run.retry_action',
  'panel.first_run.prompt',
] as const satisfies readonly TranslationKey[]

const M1_MODEL_REPAIR_KEYS = [
  'settings.model.m1_repair_title',
  'settings.model.m1_repair_hint',
] as const satisfies readonly TranslationKey[]

test('i18n runtime lazy-loads non-default locale dictionaries', async () => {
  assert.equal(isLocaleLoaded('zh-CN'), true)

  const lazyLocale = AVAILABLE_LOCALES.find((locale) => (
    locale !== 'zh-CN' && !isLocaleLoaded(locale)
  ))
  assert.ok(lazyLocale, 'expected at least one non-default locale to remain unloaded')

  const dictionary = await ensureLocaleLoaded(lazyLocale)
  assert.equal(isLocaleLoaded(lazyLocale), true)
  assert.equal(dictionary['common.ok'], getDictionary(lazyLocale)['common.ok'])

  setLocale(lazyLocale)
  assert.equal(t('common.ok'), dictionary['common.ok'])
})

test('first-run evidence onboarding copy exists in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)

    for (const key of [...FIRST_RUN_EVIDENCE_KEYS, ...FIRST_RUN_PANEL_KEYS, ...M1_MODEL_REPAIR_KEYS]) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale} missing ${key}`)
      assert.ok(value.trim().length > 0, `${locale} empty ${key}`)
    }
  }
})
