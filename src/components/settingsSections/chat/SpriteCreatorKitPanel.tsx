import type { SpritePetCreatorKitInspection } from '../../../features/pet'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'

type SpritePetPackageOutput = {
  packageDirectory: string
  packageDirectoryDisplay?: string
  manifestPath: string
  manifestPathDisplay?: string
  visualAuditPath?: string
  visualAuditPathDisplay?: string
  archivePath?: string
  archivePathDisplay?: string
} | null

type SpriteCreatorKitPanelProps = {
  creatorKitName: string
  setCreatorKitName: (value: string) => void
  creatorKitConcept: string
  setCreatorKitConcept: (value: string) => void
  creatorPromptText: string
  creatorPromptCopied: boolean
  creatingCreatorKit: boolean
  inspectingCreatorKit: boolean
  creatorKitInspection: SpritePetCreatorKitInspection | null
  assemblingCreatorKit: boolean
  lastCreatorKitDirectory: string
  lastCreatorKitDirectoryDisplay: string
  lastCreatorKitSourceRowsDirectory: string
  lastCreatorKitSourceRowsDirectoryDisplay: string
  assembledCreatorKitPackage: SpritePetPackageOutput
  ti: (key: TranslationKey, params?: TranslationParams) => string
  onShowCreatorPrompt: () => void
  onCopyCreatorPrompt: () => void
  onCreateCodexPetCreatorKit: (payload: {
    displayName?: string
    concept?: string
  }) => void
  onInspectCodexPetCreatorKit: () => void
  onAssembleCodexPetCreatorKit: () => void
  onInstallCodexPetCreatorKitToCodex: () => void
  onOpenCodexPetCreatorKitPath: (payload: {
    kitDirectory: string
    targetPath: string
    mode?: 'open' | 'reveal'
  }) => void
}

function joinCreatorKitPath(kitDirectory: string, relativePath: string) {
  const separator = kitDirectory.includes('\\') ? '\\' : '/'
  const base = kitDirectory.replace(/[\\/]+$/u, '')
  return `${base}${separator}${relativePath.split('/').join(separator)}`
}

export function SpriteCreatorKitPanel({
  creatorKitName,
  setCreatorKitName,
  creatorKitConcept,
  setCreatorKitConcept,
  creatorPromptText,
  creatorPromptCopied,
  creatingCreatorKit,
  inspectingCreatorKit,
  creatorKitInspection,
  assemblingCreatorKit,
  lastCreatorKitDirectory,
  lastCreatorKitDirectoryDisplay,
  lastCreatorKitSourceRowsDirectory,
  lastCreatorKitSourceRowsDirectoryDisplay,
  assembledCreatorKitPackage,
  ti,
  onShowCreatorPrompt,
  onCopyCreatorPrompt,
  onCreateCodexPetCreatorKit,
  onInspectCodexPetCreatorKit,
  onAssembleCodexPetCreatorKit,
  onInstallCodexPetCreatorKitToCodex,
  onOpenCodexPetCreatorKitPath,
}: SpriteCreatorKitPanelProps) {
  const creatorStyleSamplesPath = lastCreatorKitDirectory
    ? joinCreatorKitPath(lastCreatorKitDirectory, 'references/style-samples.md')
    : ''
  const sourceRowsDisplayPath = lastCreatorKitSourceRowsDirectoryDisplay || lastCreatorKitSourceRowsDirectory

  return (
    <div className="settings-mini-group settings-pet-workflow-card settings-pet-workflow-card--creator">
      <div className="settings-mini-group__head">
        <h5>{ti('settings.chat.codex_pet_creator')}</h5>
        <span>{ti('settings.chat.codex_pet_creator_hint')}</span>
      </div>
      <div className="settings-inline-row">
        <input
          aria-label={ti('settings.chat.codex_pet_creator_name_label')}
          value={creatorKitName}
          placeholder={ti('settings.chat.codex_pet_creator_name_placeholder')}
          onChange={(event) => setCreatorKitName(event.target.value)}
        />
        <input
          aria-label={ti('settings.chat.codex_pet_creator_concept_label')}
          value={creatorKitConcept}
          placeholder={ti('settings.chat.codex_pet_creator_concept_placeholder')}
          onChange={(event) => setCreatorKitConcept(event.target.value)}
        />
      </div>
      <div className="settings-inline-row settings-pet-creator-actions">
        <button
          type="button"
          className="ghost-button"
          onClick={onShowCreatorPrompt}
          disabled={!creatorKitName.trim() && !creatorKitConcept.trim()}
        >
          {ti('settings.chat.codex_pet_creator_prompt')}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onCreateCodexPetCreatorKit({
            displayName: creatorKitName.trim(),
            concept: creatorKitConcept.trim(),
          })}
          disabled={creatingCreatorKit || (!creatorKitName.trim() && !creatorKitConcept.trim())}
        >
          {creatingCreatorKit
            ? ti('settings.chat.codex_pet_creator_creating')
            : ti('settings.chat.codex_pet_creator_create')}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={onInspectCodexPetCreatorKit}
          disabled={inspectingCreatorKit}
        >
          {inspectingCreatorKit
            ? ti('settings.chat.codex_pet_creator_checking')
            : ti('settings.chat.codex_pet_creator_check')}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={onAssembleCodexPetCreatorKit}
          disabled={assemblingCreatorKit}
        >
          {assemblingCreatorKit
            ? ti('settings.chat.codex_pet_creator_assembling')
            : ti('settings.chat.codex_pet_creator_assemble')}
        </button>
      </div>
      {lastCreatorKitDirectory ? (
        <div className="settings-pet-kit-output">
          <p className="settings-mini-group__note">
            {ti('settings.chat.codex_pet_creator_current_kit')}{' '}
            <code>{lastCreatorKitDirectoryDisplay || lastCreatorKitDirectory}</code>
          </p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onOpenCodexPetCreatorKitPath({
              kitDirectory: lastCreatorKitDirectory,
              targetPath: lastCreatorKitDirectory,
              mode: 'open',
            })}
          >
            {ti('settings.chat.codex_pet_creator_open_kit')}
          </button>
          {creatorStyleSamplesPath ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => onOpenCodexPetCreatorKitPath({
                kitDirectory: lastCreatorKitDirectory,
                targetPath: creatorStyleSamplesPath,
                mode: 'open',
              })}
            >
              {ti('settings.chat.codex_pet_creator_open_style_samples')}
            </button>
          ) : null}
          {lastCreatorKitSourceRowsDirectory ? (
            <button
              type="button"
              className="ghost-button"
              title={sourceRowsDisplayPath}
              onClick={() => onOpenCodexPetCreatorKitPath({
                kitDirectory: lastCreatorKitDirectory,
                targetPath: lastCreatorKitSourceRowsDirectory,
                mode: 'open',
              })}
            >
              {ti('settings.chat.codex_pet_creator_open_source_rows')}
            </button>
          ) : null}
        </div>
      ) : null}
      {creatorPromptText ? (
        <div className="settings-pet-creator-prompt">
          <textarea
            readOnly
            aria-label={ti('settings.chat.codex_pet_creator_prompt')}
            value={creatorPromptText}
          />
          <button
            type="button"
            className="ghost-button"
            onClick={onCopyCreatorPrompt}
          >
            {creatorPromptCopied
              ? ti('settings.chat.codex_pet_creator_copied')
              : ti('settings.chat.codex_pet_creator_copy_prompt')}
          </button>
        </div>
      ) : null}
      {assembledCreatorKitPackage ? (
        <div className="settings-pet-kit-status" role="status" aria-live="polite" aria-atomic="true">
          <div className="settings-pet-kit-status__head">
            <strong>{ti('settings.chat.codex_pet_creator_final_package')}</strong>
            <span>{ti('settings.chat.codex_pet_creator_final_package_hint')}</span>
          </div>
          <div className="settings-pet-kit-output">
            <p className="settings-mini-group__note">
              <code>{assembledCreatorKitPackage.packageDirectoryDisplay ?? assembledCreatorKitPackage.packageDirectory}</code>
            </p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onOpenCodexPetCreatorKitPath({
                kitDirectory: lastCreatorKitDirectory,
                targetPath: assembledCreatorKitPackage.packageDirectory,
                mode: 'open',
              })}
            >
              {ti('settings.chat.codex_pet_creator_open_final_package')}
            </button>
          </div>
          {assembledCreatorKitPackage.archivePath ? (
            <div className="settings-pet-kit-output">
              <p className="settings-mini-group__note">
                <span>{ti('settings.chat.codex_pet_creator_archive')}</span>{' '}
                <code>{assembledCreatorKitPackage.archivePathDisplay ?? assembledCreatorKitPackage.archivePath}</code>
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: lastCreatorKitDirectory,
                  targetPath: assembledCreatorKitPackage.archivePath ?? '',
                  mode: 'reveal',
                })}
              >
                {ti('settings.chat.codex_pet_creator_open_archive')}
              </button>
            </div>
          ) : null}
          <div className="settings-inline-row">
            <button
              type="button"
              className="ghost-button"
              onClick={onInstallCodexPetCreatorKitToCodex}
            >
              {ti('settings.chat.codex_pet_creator_install_codex')}
            </button>
          </div>
        </div>
      ) : null}
      {creatorKitInspection ? (
        <div className="settings-pet-kit-status" role="status" aria-live="polite" aria-atomic="true">
          <div className="settings-pet-kit-status__head">
            <strong>{creatorKitInspection.displayName}</strong>
            <span>
              {creatorKitInspection.ready
                ? ti('settings.chat.codex_pet_creator_ready')
                : ti('settings.chat.codex_pet_creator_missing_count', {
                    ready: creatorKitInspection.readyCount,
                    total: creatorKitInspection.rows.length,
                  })}
            </span>
          </div>
          <div className="settings-pet-kit-rows">
            {creatorKitInspection.rows.map((row) => (
              <span
                key={`${row.row}-${row.state}`}
                className={!row.ready ? 'is-missing' : row.warnings?.length ? 'is-warning' : 'is-ready'}
                title={row.warnings?.join('\n') || undefined}
              >
                {row.row} {row.state}
                {row.warnings?.length ? ' !' : ''}
              </span>
            ))}
          </div>
          {creatorKitInspection.contactSheetPath ? (
            <div className="settings-pet-kit-output">
              <p className="settings-mini-group__note">
                {ti('settings.chat.codex_pet_creator_contact_sheet')}{' '}
                <code>{creatorKitInspection.contactSheetPathDisplay ?? creatorKitInspection.contactSheetPath}</code>
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: creatorKitInspection.kitDirectory,
                  targetPath: creatorKitInspection.contactSheetPath ?? '',
                  mode: 'reveal',
                })}
              >
                {ti('settings.chat.codex_pet_creator_show_qa')}
              </button>
            </div>
          ) : null}
          {creatorKitInspection.motionPreviewPath ? (
            <div className="settings-pet-kit-output">
              <p className="settings-mini-group__note">
                {ti('settings.chat.codex_pet_creator_motion_preview')}{' '}
                <code>{creatorKitInspection.motionPreviewPathDisplay ?? creatorKitInspection.motionPreviewPath}</code>
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: creatorKitInspection.kitDirectory,
                  targetPath: creatorKitInspection.motionPreviewPath ?? '',
                  mode: 'open',
                })}
              >
                {ti('settings.chat.codex_pet_creator_open_preview')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
