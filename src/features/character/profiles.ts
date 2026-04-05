import type { AppSettings, CharacterProfile } from '../../types'

export function createCharacterProfile(
  settings: AppSettings,
  label: string,
): CharacterProfile {
  return {
    id: `char-${crypto.randomUUID().slice(0, 8)}`,
    label: label || settings.companionName,
    companionName: settings.companionName,
    systemPrompt: settings.systemPrompt,
    petModelId: settings.petModelId,
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: settings.speechOutputVoice,
    speechOutputApiBaseUrl: settings.speechOutputApiBaseUrl,
    speechOutputApiKey: settings.speechOutputApiKey,
    speechOutputModel: settings.speechOutputModel,
    speechOutputInstructions: settings.speechOutputInstructions,
  }
}

export function applyCharacterProfile(
  settings: AppSettings,
  profile: CharacterProfile,
): AppSettings {
  return {
    ...settings,
    companionName: profile.companionName,
    systemPrompt: profile.systemPrompt,
    petModelId: profile.petModelId,
    activeCharacterProfileId: profile.id,
    speechOutputProviderId: profile.speechOutputProviderId ?? settings.speechOutputProviderId,
    speechOutputVoice: profile.speechOutputVoice ?? settings.speechOutputVoice,
    speechOutputApiBaseUrl: profile.speechOutputApiBaseUrl ?? settings.speechOutputApiBaseUrl,
    speechOutputApiKey: profile.speechOutputApiKey ?? settings.speechOutputApiKey,
    speechOutputModel: profile.speechOutputModel ?? settings.speechOutputModel,
    speechOutputInstructions: profile.speechOutputInstructions ?? settings.speechOutputInstructions,
  }
}

export function updateCharacterProfile(
  profiles: CharacterProfile[],
  profileId: string,
  patch: Partial<CharacterProfile>,
): CharacterProfile[] {
  return profiles.map((profile) =>
    profile.id === profileId ? { ...profile, ...patch } : profile,
  )
}

export function removeCharacterProfile(
  profiles: CharacterProfile[],
  profileId: string,
): CharacterProfile[] {
  return profiles.filter((profile) => profile.id !== profileId)
}

export function syncCurrentToProfile(
  settings: AppSettings,
): AppSettings {
  if (!settings.activeCharacterProfileId) return settings

  const profile = settings.characterProfiles.find(
    (p) => p.id === settings.activeCharacterProfileId,
  )
  if (!profile) return settings

  const updatedProfile: CharacterProfile = {
    ...profile,
    companionName: settings.companionName,
    systemPrompt: settings.systemPrompt,
    petModelId: settings.petModelId,
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: settings.speechOutputVoice,
    speechOutputApiBaseUrl: settings.speechOutputApiBaseUrl,
    speechOutputApiKey: settings.speechOutputApiKey,
    speechOutputModel: settings.speechOutputModel,
    speechOutputInstructions: settings.speechOutputInstructions,
  }

  return {
    ...settings,
    characterProfiles: updateCharacterProfile(
      settings.characterProfiles,
      profile.id,
      updatedProfile,
    ),
  }
}
