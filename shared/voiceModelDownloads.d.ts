export declare const LOCAL_SPEECH_INPUT_PROVIDER_IDS: readonly string[]

export declare function speechModelIdForProvider(providerId: unknown): string | null

export declare function selectMissingVoiceModelIds(
  models: Array<{ id?: string; required?: boolean; present?: boolean }> | null | undefined,
  providerId: unknown,
): string[]
