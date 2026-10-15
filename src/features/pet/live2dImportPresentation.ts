import { getLive2dImportMessageContract } from '../../../shared/live2dModelResources.js'
import type { TranslationKey, TranslationParams, Translator } from '../../types/i18n.ts'
import type {
  Live2dCompatibilityErrorCode,
  Live2dCompatibilityWarningCode,
  PetModelImportResult,
} from './models.ts'

const RESOURCE_KEY_BY_ERROR = {
  'invalid-model-file': 'settings.pet.compatibility_resource.model',
  'missing-moc': 'settings.pet.compatibility_resource.moc',
  'missing-texture': 'settings.pet.compatibility_resource.textures',
  'missing-motion': 'settings.pet.compatibility_resource.motions',
  'missing-expression': 'settings.pet.compatibility_resource.expressions',
  'missing-optional-resource': 'settings.pet.compatibility_resource.optional',
  'unsafe-resource-path': 'settings.pet.compatibility_resource.unsafe',
} as const satisfies Record<Live2dCompatibilityErrorCode, TranslationKey>

const RESOURCE_KEY_BY_WARNING = {
  'no-motions': 'settings.pet.compatibility_resource.motions',
  'no-expressions': 'settings.pet.compatibility_resource.expressions',
} as const satisfies Record<Live2dCompatibilityWarningCode, TranslationKey>

export type PetUserMessageResult = {
  message: string
  messageKey?: string
  messageParams?: TranslationParams
  recommendationKey?: PetModelImportResult['recommendationKey']
  compatibility?: PetModelImportResult['compatibility']
  model?: PetModelImportResult['model']
}

export type PetModelImportPresentation = {
  message: string
  recommendation?: string
}

function translateMappedKeys<T extends string>(
  values: unknown,
  map: Record<T, TranslationKey>,
  translate: Translator,
) {
  if (!Array.isArray(values)) return ''
  return values.flatMap((value) => {
    const key = map[value as T]
    return key ? [translate(key)] : []
  }).join(', ')
}

function resolveMessageParams(params: TranslationParams | undefined, translate: Translator) {
  if (!params) return undefined
  const next = { ...params }
  if (typeof next.sourceKey === 'string') {
    next.source = translate(next.sourceKey as TranslationKey)
  }
  return next
}

/** Format a pet-import IPC result. Keyed results are localized; legacy `message` passes through. */
export function formatPetModelImportPresentation(
  result: PetUserMessageResult,
  translate: Translator,
): PetModelImportPresentation {
  const compatibility = result.compatibility
  if (compatibility) {
    const fallbackContract = getLive2dImportMessageContract(
      compatibility.status,
      compatibility.errors,
    )
    const messageKey = result.messageKey ?? fallbackContract.messageKey
    let messageParams: TranslationParams | undefined

    if (compatibility.status === 'blocked') {
      messageParams = {
        resources: translateMappedKeys(compatibility.errors, RESOURCE_KEY_BY_ERROR, translate),
      }
    } else if (compatibility.status === 'limited') {
      messageParams = {
        name: result.model?.label ?? '',
        capabilities: translateMappedKeys(compatibility.warnings, RESOURCE_KEY_BY_WARNING, translate),
      }
    } else {
      messageParams = {
        name: result.model?.label ?? '',
        textures: compatibility.summary?.textureCount ?? 0,
        motions: compatibility.summary?.motionCount ?? 0,
        expressions: compatibility.summary?.expressionCount ?? 0,
      }
    }

    const message = translate(messageKey as TranslationKey, messageParams)
    const recommendationKey = result.recommendationKey ?? fallbackContract.recommendationKey
    return recommendationKey
      ? { message, recommendation: translate(recommendationKey) }
      : { message }
  }

  if (result.messageKey) {
    return {
      message: translate(
        result.messageKey as TranslationKey,
        resolveMessageParams(result.messageParams, translate),
      ),
    }
  }

  return { message: result.message }
}
