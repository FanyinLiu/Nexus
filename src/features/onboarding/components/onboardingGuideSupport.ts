import { isSenseVoiceSpeechInputProvider } from '../../../lib/audioProviders'
import type { AppSettings } from '../../../types'
import type { OnboardingStep, OnboardingStepId } from './guideSteps'

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: '认识一下',
    description: '先确认你和陪伴体的称呼，后面的提示词、语音和记忆都会围绕这段关系展开。',
  },
  {
    id: 'text',
    title: '主对话模型',
    description: '配置角色思考和回复要使用的主模型，这是整个陪伴体验的核心。',
  },
  {
    id: 'voice',
    title: '语音链路',
    description: '先选一套最顺手的输入和播报组合，让她能听懂，也能开口。',
  },
  {
    id: 'companion',
    title: '陪伴方式',
    description: '选角色、默认语音方式和开机行为，完成第一轮可日用配置。',
  },
]

export function getOnboardingFinishHint(
  draft: AppSettings,
  textProviderRequiresApiKey: boolean,
) {
  if (textProviderRequiresApiKey && !draft.apiKey.trim()) {
    return '你还没有填写文本模型接口密钥。保存后仍可先体验界面、角色和语音链路，真正开始聊天前再补上即可。'
  }

  return '后续还可以在设置里继续细调工具权限、桌面上下文和记忆策略。'
}

export function getOnboardingStepError(
  draft: AppSettings,
  stepId: OnboardingStepId,
) {
  if (stepId === 'welcome') {
    if (!draft.userName.trim()) return '先填一个你希望桌宠怎么称呼你。'
    if (!draft.companionName.trim()) return '先给桌宠起个名字。'
    return null
  }

  if (stepId === 'text') {
    if (!draft.apiBaseUrl.trim()) return '文本模型的接口地址还没有填写。'
    if (!draft.model.trim()) return '文本模型名称还没有填写。'
    return null
  }

  if (stepId === 'voice') {
    if (draft.speechInputEnabled) {
      if (!draft.speechInputProviderId.trim()) return '先选择一个语音输入方案。'
      if (
        !isSenseVoiceSpeechInputProvider(draft.speechInputProviderId)
        && !draft.speechInputApiBaseUrl.trim()
      ) {
        return '当前语音输入方案需要填写接口地址。'
      }
    }

    if (draft.speechOutputEnabled) {
      if (!draft.speechOutputProviderId.trim()) return '先选择一个语音输出方案。'
      if (!draft.speechOutputApiBaseUrl.trim()) {
        return '当前语音输出方案需要填写接口地址。'
      }
    }

    return null
  }

  return null
}

export function sanitizeOnboardingSettings(
  draft: AppSettings,
  fallback: AppSettings,
) {
  return {
    ...draft,
    companionName: draft.companionName.trim() || fallback.companionName,
    userName: draft.userName.trim() || fallback.userName,
    apiBaseUrl: draft.apiBaseUrl.trim(),
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim(),
    speechInputApiBaseUrl: draft.speechInputApiBaseUrl.trim(),
    speechInputApiKey: draft.speechInputApiKey.trim(),
    speechOutputApiBaseUrl: draft.speechOutputApiBaseUrl.trim(),
    speechOutputApiKey: draft.speechOutputApiKey.trim(),
    speechOutputVoice: draft.speechOutputVoice.trim(),
  }
}
