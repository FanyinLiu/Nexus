import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings } from '../../../../types'

export type OnboardingStepId = 'ai_disclosure' | 'welcome' | 'text' | 'voice' | 'companion'

export type OnboardingStep = {
  id: OnboardingStepId
  title: string
  description: string
}

export type OnboardingDraftSetter = Dispatch<SetStateAction<AppSettings>>
