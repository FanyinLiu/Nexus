import type { CodexPetGalleryCatalogResult } from '../../../features/pet'
import { PetControlIcon } from '../../PetControlIcon'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'

type StatusMessage = {
  ok: boolean
  message: string
} | null

const CODEX_PET_COMMUNITY_LINKS: Array<{ href: string; labelKey: TranslationKey }> = [
  {
    href: 'https://codex-pet.com/',
    labelKey: 'settings.chat.codex_pet_source_gallery',
  },
  {
    href: 'https://codex-pet.org/',
    labelKey: 'settings.chat.codex_pet_source_directory',
  },
  {
    href: 'https://codexpets.net/gallery',
    labelKey: 'settings.chat.codex_pet_source_checked',
  },
  {
    href: 'https://openpets.app/pets',
    labelKey: 'settings.chat.codex_pet_source_verified',
  },
  {
    href: 'https://openpets.dev/',
    labelKey: 'settings.chat.codex_pet_source_openpets',
  },
  {
    href: 'https://codingpets.com/',
    labelKey: 'settings.chat.codex_pet_source_downloads',
  },
  {
    href: 'https://www.getyourownpet.com/',
    labelKey: 'settings.chat.codex_pet_source_petforge',
  },
  {
    href: 'https://spritesheep.com/',
    labelKey: 'settings.chat.codex_pet_source_sprite_editor',
  },
  {
    href: 'https://www.codingpets.dev/',
    labelKey: 'settings.chat.codex_pet_source_generator',
  },
]

type CodexPetGalleryPanelProps = {
  codexPetInput: string
  setCodexPetInput: (value: string) => void
  codexPetCatalogQuery: string
  setCodexPetCatalogQuery: (value: string) => void
  codexPetCatalog: CodexPetGalleryCatalogResult | null
  codexPetCatalogLoading: boolean
  codexPetCatalogStatus: StatusMessage
  importingPetModel: boolean
  ti: (key: TranslationKey, params?: TranslationParams) => string
  onImportCodexPetGallery: (input: string) => void
  onLoadCodexPetGallery: (query?: string) => void
}

export function CodexPetGalleryPanel({
  codexPetInput,
  setCodexPetInput,
  codexPetCatalogQuery,
  setCodexPetCatalogQuery,
  codexPetCatalog,
  codexPetCatalogLoading,
  codexPetCatalogStatus,
  importingPetModel,
  ti,
  onImportCodexPetGallery,
  onLoadCodexPetGallery,
}: CodexPetGalleryPanelProps) {
  return (
    <div className="settings-mini-group settings-pet-workflow-card settings-pet-workflow-card--community">
      <div className="settings-mini-group__head">
        <h5>{ti('settings.chat.codex_pet_import')}</h5>
        <span>{ti('settings.chat.codex_pet_import_hint')}</span>
      </div>
      <div
        className="settings-community-links"
        aria-label={ti('settings.chat.codex_pet_sources')}
      >
        <span className="settings-community-links__label">{ti('settings.chat.codex_pet_sources')}</span>
        {CODEX_PET_COMMUNITY_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            <span className="settings-community-links__text">{ti(link.labelKey)}</span>
            <PetControlIcon name="external-link" />
          </a>
        ))}
      </div>
      <div className="settings-inline-row">
        <input
          aria-label={ti('settings.chat.codex_pet_import')}
          value={codexPetInput}
          placeholder={ti('settings.chat.codex_pet_placeholder')}
          onChange={(event) => setCodexPetInput(event.target.value)}
        />
        <button
          type="button"
          className="ghost-button"
          onClick={() => onImportCodexPetGallery(codexPetInput.trim())}
          disabled={importingPetModel || !codexPetInput.trim()}
        >
          {importingPetModel
            ? ti('settings.chat.importing_model')
            : ti('settings.chat.import_codex_pet')}
        </button>
      </div>
      <div className="settings-inline-row">
        <input
          aria-label={ti('settings.chat.codex_pet_catalog_search_label')}
          value={codexPetCatalogQuery}
          placeholder={ti('settings.chat.codex_pet_catalog_query_placeholder')}
          onChange={(event) => setCodexPetCatalogQuery(event.target.value)}
        />
        <button
          type="button"
          className="ghost-button"
          onClick={() => onLoadCodexPetGallery(codexPetCatalogQuery.trim())}
          disabled={codexPetCatalogLoading}
        >
          {codexPetCatalogLoading
            ? ti('settings.chat.codex_pet_catalog_loading')
            : ti('settings.chat.codex_pet_catalog_load')}
        </button>
      </div>
      {codexPetCatalogStatus ? (
        <div
          className={codexPetCatalogStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
          role={codexPetCatalogStatus.ok ? 'status' : 'alert'}
          aria-live={codexPetCatalogStatus.ok ? 'polite' : 'assertive'}
          aria-atomic="true"
        >
          {codexPetCatalogStatus.message}
        </div>
      ) : null}
      {codexPetCatalog && codexPetCatalog.pets.length === 0 ? (
        <p className="settings-mini-group__note">
          {ti('settings.chat.codex_pet_catalog_empty')}
        </p>
      ) : null}
      {codexPetCatalog && codexPetCatalog.pets.length > 0 ? (
        <div className="settings-pet-gallery-list">
          {codexPetCatalog.pets.map((pet) => (
            <article key={`${pet.sourceName ?? 'codex-pet.com'}:${pet.slug}`} className="settings-pet-gallery-item">
              <div className="settings-pet-gallery-item__body">
                <strong>{pet.displayName}</strong>
                <code>{pet.sourceName ? `${pet.sourceName} · ${pet.slug}` : pet.slug}</code>
                {pet.description ? (
                  <p>{pet.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onImportCodexPetGallery(pet.downloadUrl || pet.sourceUrl)}
                disabled={importingPetModel}
              >
                {ti('settings.chat.codex_pet_catalog_import')}
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
