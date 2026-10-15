export declare function modelSupportsVision(model: string | null | undefined): boolean
export declare function modelSupportsSpeech(model: string | null | undefined): boolean
/**
 * True for GPT-6 Astra and GPT-6.1 Sol, which reject function tools on
 * Chat Completions.
 */
export declare function modelRejectsChatCompletionsTools(model: string | null | undefined): boolean
export declare function estimateModelContextWindowTokens(model: string | null | undefined): number | null
