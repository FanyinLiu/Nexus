export declare const CHAT_IPC_ERROR_CODES: {
  readonly UNSAFE_BASE_URL: 'NEXUS_ERR_CHAT_UNSAFE_BASE_URL'
  readonly MISSING_API_KEY: 'NEXUS_ERR_CHAT_MISSING_API_KEY'
  readonly API_KEY_HEADER_UNSAFE: 'NEXUS_ERR_CHAT_API_KEY_HEADER_UNSAFE'
  readonly AUTH_FAILED: 'NEXUS_ERR_CHAT_AUTH_FAILED'
  readonly UNREACHABLE: 'NEXUS_ERR_CHAT_UNREACHABLE'
  readonly TIMEOUT: 'NEXUS_ERR_CHAT_TIMEOUT'
  readonly FORBIDDEN: 'NEXUS_ERR_CHAT_FORBIDDEN'
  readonly NOT_FOUND: 'NEXUS_ERR_CHAT_NOT_FOUND'
  readonly RATE_LIMITED: 'NEXUS_ERR_CHAT_RATE_LIMITED'
  readonly PROVIDER_SERVER_ERROR: 'NEXUS_ERR_CHAT_PROVIDER_SERVER_ERROR'
  readonly PROVIDER_STATUS: 'NEXUS_ERR_CHAT_PROVIDER_STATUS'
  readonly EMPTY_CONTENT: 'NEXUS_ERR_CHAT_EMPTY_CONTENT'
}

export type ChatIpcErrorCode = (typeof CHAT_IPC_ERROR_CODES)[keyof typeof CHAT_IPC_ERROR_CODES]

export declare function buildChatIpcError(
  code: ChatIpcErrorCode,
  detail?: string,
  options?: { cause?: unknown },
): Error

export declare function extractChatIpcErrorCode(error: unknown): ChatIpcErrorCode | null
