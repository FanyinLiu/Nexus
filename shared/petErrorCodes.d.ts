export declare const PET_IPC_ERROR_CODES: {
  readonly ALREADY_IMPORTED: 'NEXUS_ERR_PET_ALREADY_IMPORTED'
  readonly IMPORT_INCOMPLETE: 'NEXUS_ERR_PET_IMPORT_INCOMPLETE'
  readonly UNSUPPORTED_FILE: 'NEXUS_ERR_PET_UNSUPPORTED_FILE'
  readonly GALLERY_INPUT: 'NEXUS_ERR_PET_GALLERY_INPUT'
  readonly GALLERY_FAILED: 'NEXUS_ERR_PET_GALLERY_FAILED'
  readonly NETWORK: 'NEXUS_ERR_PET_NETWORK'
}

export type PetIpcErrorCode = (typeof PET_IPC_ERROR_CODES)[keyof typeof PET_IPC_ERROR_CODES]

export declare const PET_IMPORT_MESSAGE_KEYS: Readonly<{
  imported: 'settings.pet.success.imported'
  importedFrom: 'settings.pet.success.imported_from'
  sourceCommunityZip: 'settings.pet.success.source.community_zip'
}>

export type PetImportMessageKey =
  (typeof PET_IMPORT_MESSAGE_KEYS)[keyof typeof PET_IMPORT_MESSAGE_KEYS]

export declare function buildPetIpcError(
  code: PetIpcErrorCode,
  options?: { cause?: unknown },
): Error

export declare function extractPetIpcErrorCode(error: unknown): PetIpcErrorCode | null
