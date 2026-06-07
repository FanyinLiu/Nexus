import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CODEX_PETS_NET_GALLERY_HOME_URL,
  CODING_PETS_GALLERY_HOME_URL,
  CODEX_PET_GALLERY_HOME_URL,
  CODEX_PET_ORG_HOME_URL,
  OPENPETS_CATALOG_URL,
  fetchCodexPetGalleryCatalog,
  filterCodexPetGalleryCatalog,
  parseCodexPetGalleryCatalog,
  parseCodexPetGalleryPage,
  parseCodexPetOrgCatalog,
  parseCodexPetOrgPage,
  parseCodexPetsNetCatalog,
  parseCodingPetsCatalog,
  parseCodingPetsPage,
  resolveCodexPetGalleryUrl,
  resolveCodexPetsNetDownloadUrl,
} from '../electron/services/codexPetGallery.js'

test('parses codex-pet gallery articles into importable catalog items', () => {
  const catalog = parseCodexPetGalleryCatalog(`
    <main>
      <p>617 pets ready to install.</p>
      <article>
        <a href="/pets/froge-openai-mascot">
          <div role="img" aria-label="Froge, OpenAI&#x27;s Mascot"></div>
          <h3>Froge, OpenAI&#x27;s Mascot</h3>
        </a>
        <button><span>npx codex-pet-cli add froge-openai-mascot</span></button>
      </article>
      <article>
        <a href="/pets/fleta">
          <h3>Fleta</h3>
          <p>A plush silver-white cat with round cheeks.</p>
        </a>
        <button><span>npx codex-pet-cli add fleta</span></button>
      </article>
    </main>
  `)

  assert.equal(catalog.totalCount, 617)
  assert.equal(catalog.pets.length, 2)
  assert.deepEqual(catalog.pets[0], {
    id: 'froge-openai-mascot',
    slug: 'froge-openai-mascot',
    displayName: "Froge, OpenAI's Mascot",
    description: '',
    sourceUrl: 'https://codex-pet.com/pets/froge-openai-mascot',
    installCommand: 'npx codex-pet-cli add froge-openai-mascot',
  })
  assert.equal(catalog.pets[1].description, 'A plush silver-white cat with round cheeks.')
})

test('filters codex-pet gallery catalog by name, slug, or description', () => {
  const catalog = parseCodexPetGalleryCatalog(`
    <article>
      <a href="/pets/froge-openai-mascot"><h3>Froge</h3></a>
      <button><span>npx codex-pet-cli add froge-openai-mascot</span></button>
    </article>
    <article>
      <a href="/pets/fleta"><h3>Fleta</h3><p>silver cat coding companion</p></a>
      <button><span>npx codex-pet-cli add fleta</span></button>
    </article>
  `)

  assert.deepEqual(
    filterCodexPetGalleryCatalog(catalog, { query: 'silver cat', limit: 5 }).pets.map((pet) => pet.slug),
    ['fleta'],
  )
  assert.deepEqual(
    filterCodexPetGalleryCatalog(catalog, { query: 'froge', limit: 5 }).pets.map((pet) => pet.slug),
    ['froge-openai-mascot'],
  )
})

test('fetchCodexPetGalleryCatalog uses the caller-provided fetcher for all community sources', async () => {
  const requestedUrls: string[] = []
  const fixtures = new Map([
    [CODEX_PET_GALLERY_HOME_URL, '<article><a href="/pets/fleta"><h3>Fleta</h3></a><button><span>npx codex-pet-cli add fleta</span></button></article>'],
    [CODEX_PET_ORG_HOME_URL, '<main><strong>0</strong><span>pets</span></main>'],
    [CODING_PETS_GALLERY_HOME_URL, '<main><span>0/0</span></main>'],
    [CODEX_PETS_NET_GALLERY_HOME_URL, '<section><span>0 pets</span></section>'],
    [OPENPETS_CATALOG_URL, '{"pets":[]}'],
  ])

  const catalog = await fetchCodexPetGalleryCatalog({
    limit: 10,
    fetchText: async (url: string) => {
      requestedUrls.push(url)
      return fixtures.get(url) ?? ''
    },
  })

  assert.deepEqual(requestedUrls.sort(), [...fixtures.keys()].sort())
  assert.equal(catalog.pets.length, 1)
  assert.equal(catalog.pets[0].slug, 'fleta')
})

test('fetchCodexPetGalleryCatalog reports the browsable pet count, not the sum of sites self-declared totals', async () => {
  // Coding Pets self-declares 29 pets ("29/29") but only ships one importable
  // card here. The merged totalCount must reflect what the user can actually
  // reach (1), not the unreachable 29.
  const codingPetsHtml = `
    <main>
      <span>29/29</span>
      <article aria-label="View Bytecap">
        <h3>
          <a href="/pets/bytecap-wes" aria-label="View Bytecap Codex pet page">
            Bytecap<span class="sr-only"> Codex pet page</span>
          </a>
        </h3>
        <p class="pet-description">A tiny mushroom cap pet with a keyboard-key face.</p>
        <a href="https://precious-ptarmigan-848.convex.cloud/api/storage/zip-bytecap" aria-label="Download Bytecap ZIP">
          <span>Download ZIP</span>
        </a>
      </article>
    </main>
  `
  const fixtures = new Map([
    [CODING_PETS_GALLERY_HOME_URL, codingPetsHtml],
    [OPENPETS_CATALOG_URL, '{"pets":[]}'],
  ])
  const catalog = await fetchCodexPetGalleryCatalog({
    limit: 10,
    fetchText: async (url: string) => fixtures.get(url) ?? '',
  })

  assert.equal(catalog.pets.length, 1)
  assert.equal(catalog.totalCount, 1)
})

test('parses Coding Pets ZIP gallery cards into importable catalog items', () => {
  const catalog = parseCodingPetsCatalog(`
    <main>
      <span>29/29</span>
      <article aria-label="View Bytecap">
        <h3>
          <a href="/pets/bytecap-wes" aria-label="View Bytecap Codex pet page">
            Bytecap<span class="sr-only"> Codex pet page</span>
          </a>
        </h3>
        <p class="pet-description">A tiny mushroom cap pet with a keyboard-key face.</p>
        <a href="https://precious-ptarmigan-848.convex.cloud/api/storage/zip-bytecap" aria-label="Download Bytecap ZIP">
          <span>Download ZIP</span>
        </a>
      </article>
    </main>
  `)

  assert.equal(catalog.totalCount, 29)
  assert.deepEqual(catalog.pets[0], {
    id: 'bytecap-wes',
    slug: 'bytecap-wes',
    displayName: 'Bytecap',
    description: 'A tiny mushroom cap pet with a keyboard-key face.',
    sourceName: 'Coding Pets',
    sourceUrl: 'https://codingpets.com/pets/bytecap-wes',
    downloadUrl: 'https://precious-ptarmigan-848.convex.cloud/api/storage/zip-bytecap',
    installCommand: 'Download ZIP',
  })
})

test('parses Coding Pets detail pages for ZIP imports', () => {
  const page = parseCodingPetsPage(`
    <h1>Bytecap Codex Pet</h1>
    <meta name="description" content="Bytecap is packaged with animated sprite states."/>
    <a href="https://precious-ptarmigan-848.convex.cloud/api/storage/zip-bytecap" download="" aria-label="Download Bytecap ZIP">
      <span>Download ZIP</span>
    </a>
  `, 'https://codingpets.com/pets/bytecap-wes')

  assert.equal(page.id, 'bytecap-wes')
  assert.equal(page.displayName, 'Bytecap')
  assert.equal(page.downloadUrl, 'https://precious-ptarmigan-848.convex.cloud/api/storage/zip-bytecap')
  assert.equal(page.sourceName, 'Coding Pets')
})

test('parses CodexPets.net checked gallery entries into ZIP imports', () => {
  const catalog = parseCodexPetsNetCatalog(`
    <section>
      <span>842 pets</span>
      <script>
        self.__next_f.push([1,"{\\"pet\\":{\\"key\\":\\"codexpets:pixel-coder\\",\\"slug\\":\\"pixel-coder\\",\\"name\\":\\"Pixel Coder\\",\\"description\\":\\"A friendly pixel coder companion.\\",\\"tags\\":[\\"pixel\\"],\\"contributorName\\":\\"CodexPets.net\\",\\"contributorUrl\\":\\"https://codexpets.net\\",\\"spritesheetUrl\\":\\"https://cdn.example/pixel-coder/spritesheet.png\\",\\"previewFrames\\":6,\\"detailHref\\":\\"/pets/pixel-coder\\",\\"downloadHref\\":\\"/api/pets/pixel-coder/download\\",\\"downloadFilename\\":\\"pixel-coder.zip\\"}}"])
        self.__next_f.push([1,"{\\"pet\\":{\\"key\\":\\"imported:guilmon\\",\\"slug\\":\\"guilmon\\",\\"name\\":\\"Guilmon\\",\\"description\\":\\"A red digital monster.\\",\\"tags\\":[\\"pixel\\"],\\"contributorName\\":\\"jwzoom\\",\\"spritesheetUrl\\":\\"https://cdn.example/guilmon/spritesheet.webp\\",\\"previewFrames\\":6,\\"detailHref\\":\\"/gallery/guilmon\\",\\"downloadHref\\":\\"/api/gallery-pets/guilmon/download\\",\\"downloadFilename\\":\\"0789-guilmon.zip\\"}}"])
      </script>
    </section>
  `)

  assert.equal(catalog.totalCount, 842)
  assert.deepEqual(catalog.pets[0], {
    id: 'pixel-coder',
    slug: 'pixel-coder',
    displayName: 'Pixel Coder',
    description: 'A friendly pixel coder companion.',
    sourceName: 'CodexPets.net',
    sourceUrl: 'https://codexpets.net/pets/pixel-coder',
    downloadUrl: 'https://codexpets.net/api/pets/pixel-coder/download',
    installCommand: 'Download ZIP',
  })
  assert.equal(catalog.pets[1].sourceUrl, 'https://codexpets.net/gallery/guilmon')
  assert.equal(catalog.pets[1].downloadUrl, 'https://codexpets.net/api/gallery-pets/guilmon/download')
})

test('resolves CodexPets.net detail page URLs to package downloads', () => {
  assert.equal(
    resolveCodexPetsNetDownloadUrl('https://codexpets.net/pets/pixel-coder'),
    'https://codexpets.net/api/pets/pixel-coder/download',
  )
  assert.equal(
    resolveCodexPetsNetDownloadUrl('https://codexpets.net/gallery/guilmon'),
    'https://codexpets.net/api/gallery-pets/guilmon/download',
  )
})

test('parses codex-pet detail pages and resolves slug URLs', () => {
  const page = parseCodexPetGalleryPage([
    '<script>',
    '$R[1]={pet:$R[2]={slug:"sample-pet",displayName:"Sample Pet",',
    'description:"Gallery pet",spritesheetUrl:"https://cdn.codex-pet.com/pets/sample/spritesheet.webp",',
    'spritesheetExt:"webp",petJson:$R[3]={id:"sample-pet"}}}',
    '</script>',
  ].join(''), 'https://codex-pet.com/pets/sample-pet')

  assert.equal(resolveCodexPetGalleryUrl('sample-pet'), 'https://codex-pet.com/pets/sample-pet')
  assert.equal(page.id, 'sample-pet')
  assert.equal(page.displayName, 'Sample Pet')
  assert.equal(page.spriteExtension, 'webp')
  assert.equal(page.sourcePageUrl, 'https://codex-pet.com/pets/sample-pet')
})

test('parses codex-pet.org detail pages into importable spritesheet metadata', () => {
  const page = parseCodexPetOrgPage(`
    <link rel="canonical" href="https://codex-pet.org/pets/solid-box/"/>
    <script>
      self.__next_f.push([1,"{
        \\"pet\\":{\\"slug\\":\\"solid-box\\",\\"name\\":\\"Solid Box\\",\\"description\\":\\"A tiny stealth operative.\\",\\"image_url\\":\\"https://assets.codex-pet.org/owner/solid-box/spritesheet.webp\\"},
        \\"assetLinks\\":{\\"isPackage\\":true,\\"manifestUrl\\":\\"https://assets.codex-pet.org/owner/solid-box/pet.json\\",\\"spritesheetUrl\\":\\"https://assets.codex-pet.org/owner/solid-box/spritesheet.webp\\",\\"packageName\\":\\"solid-box.codex-pet.zip\\"}
      }"])
    </script>
  `, 'https://codex-pet.org/pets/solid-box/')

  assert.equal(page.id, 'solid-box')
  assert.equal(page.displayName, 'Solid Box')
  assert.equal(page.description, 'A tiny stealth operative.')
  assert.equal(page.spriteUrl, 'https://assets.codex-pet.org/owner/solid-box/spritesheet.webp')
  assert.equal(page.spriteExtension, 'webp')
  assert.equal(page.manifestUrl, 'https://assets.codex-pet.org/owner/solid-box/pet.json')
  assert.equal(page.sourceName, 'codex-pet.org')
  assert.equal(page.sourcePageUrl, 'https://codex-pet.org/pets/solid-box/')
})

test('parses codex-pet.org catalog pets into importable detail page items', () => {
  const catalog = parseCodexPetOrgCatalog(`
    <main>
      <strong>987</strong><span>pets</span>
      <script>
        self.__next_f.push([1,"{\\"pets\\":[
          {\\"slug\\":\\"solid-box\\",\\"name\\":\\"Solid Box\\",\\"creator\\":\\"jeansolopreneur\\",\\"species\\":\\"Person\\",\\"tags\\":[\\"Codex Pet\\"],\\"description\\":\\"A tiny stealth operative.\\",\\"image_url\\":\\"https://assets.codex-pet.org/owner/solid-box/spritesheet.webp\\",\\"command\\":\\"npx codex-pet-installer add solid-box\\"},
          {\\"slug\\":\\"guga\\",\\"name\\":\\"咕嘎\\",\\"creator\\":\\"CIRCUS\\",\\"species\\":\\"Person\\",\\"tags\\":[\\"Codex Pet\\"],\\"description\\":\\"A rounder chibi penguin hoodie pet.\\",\\"image_url\\":\\"https://assets.codex-pet.org/owner/guga/spritesheet.webp\\",\\"command\\":\\"npx codex-pet-installer add guga\\"}
        ]}"])
      </script>
    </main>
  `)

  assert.equal(catalog.totalCount, 987)
  assert.deepEqual(catalog.pets[0], {
    id: 'solid-box',
    slug: 'solid-box',
    displayName: 'Solid Box',
    description: 'A tiny stealth operative.',
    sourceName: 'codex-pet.org',
    sourceUrl: 'https://codex-pet.org/pets/solid-box/',
    spriteUrl: 'https://assets.codex-pet.org/owner/solid-box/spritesheet.webp',
    installCommand: 'npx codex-pet-installer add solid-box',
  })
  assert.equal(catalog.pets[1].displayName, '咕嘎')
})
