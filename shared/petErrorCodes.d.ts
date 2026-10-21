export declare const PET_IPC_ERROR_CODES: {
  readonly ALREADY_IMPORTED: 'NEXUS_ERR_PET_ALREADY_IMPORTED'
  readonly IMPORT_INCOMPLETE: 'NEXUS_ERR_PET_IMPORT_INCOMPLETE'
  readonly UNSUPPORTED_FILE: 'NEXUS_ERR_PET_UNSUPPORTED_FILE'
}

export type PetIpcErrorCode = (typeof PET_IPC_ERROR_CODES)[keyof typeof PET_IPC_ERROR_CODES]

export declare function buildPetIpcError(
  code: PetIpcErrorCode,
  options?: { cause?: unknown },
): Error

export declare function extractPetIpcErrorCode(error: unknown): PetIpcErrorCode | null
