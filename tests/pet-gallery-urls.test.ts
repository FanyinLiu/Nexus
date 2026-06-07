import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isCodingPetsDetailUrl,
  isCodexPetGalleryDetailUrl,
  isCodexPetOrgDetailUrl,
  isCodexPetsNetDetailUrl,
  isKnownPetGalleryHost,
  isKnownPetGalleryZipUrl,
  resolveCodexPetFallbackSlug,
} from '../electron/services/petGalleryUrls.js'

test('detail-URL routers accept their own host + path and reject others', () => {
  assert.equal(isCodingPetsDetailUrl('https://codingpets.com/pets/bytecap'), true)
  assert.equal(isCodingPetsDetailUrl('https://www.codingpets.com/pets/bytecap'), true)
  assert.equal(isCodingPetsDetailUrl('https://codingpets.com/gallery/bytecap'), false)
  assert.equal(isCodingPetsDetailUrl('https://codex-pet.com/pets/bytecap'), false)

  assert.equal(isCodexPetGalleryDetailUrl('https://codex-pet.com/pets/fleta'), true)
  assert.equal(isCodexPetGalleryDetailUrl('https://cdn.codex-pet.com/pets/fleta'), true)
  assert.equal(isCodexPetGalleryDetailUrl('https://codex-pet.com/gallery'), false)
  assert.equal(isCodexPetGalleryDetailUrl('https://codex-pet.org/pets/fleta'), false)

  assert.equal(isCodexPetOrgDetailUrl('https://codex-pet.org/pets/fleta'), true)
  assert.equal(isCodexPetOrgDetailUrl('https://codex-pet.org/pets'), false) // needs a slug after /pets
  assert.equal(isCodexPetOrgDetailUrl('https://codex-pet.org/'), false)

  assert.equal(isCodexPetsNetDetailUrl('https://codexpets.net/pets/x'), true)
  assert.equal(isCodexPetsNetDetailUrl('https://codexpets.net/gallery/x'), true)
  assert.equal(isCodexPetsNetDetailUrl('https://codexpets.net/about'), false)
})

test('isKnownPetGalleryHost matches the four hosts + subdomains and rejects spoofed suffixes', () => {
  for (const host of ['codex-pet.com', 'codex-pet.org', 'codingpets.com', 'codexpets.net']) {
    assert.equal(isKnownPetGalleryHost(`https://${host}/x`), true, host)
    assert.equal(isKnownPetGalleryHost(`https://cdn.${host}/x`), true, `cdn.${host}`)
  }
  // A trusted host used as a left-label of an attacker domain must NOT match.
  assert.equal(isKnownPetGalleryHost('https://codex-pet.com.evil.com/x'), false)
  assert.equal(isKnownPetGalleryHost('https://evil.com/codex-pet.com'), false)
  assert.equal(isKnownPetGalleryHost('https://notcodex-pet.com/x'), false) // endsWith needs the dot
  assert.equal(isKnownPetGalleryHost('not a url'), false)
})

test('isKnownPetGalleryZipUrl recognises .zip (case-insensitive) and /download', () => {
  assert.equal(isKnownPetGalleryZipUrl('https://x/pack.zip'), true)
  assert.equal(isKnownPetGalleryZipUrl('https://x/PACK.ZIP'), true)
  assert.equal(isKnownPetGalleryZipUrl('https://x/api/storage/download'), true)
  assert.equal(isKnownPetGalleryZipUrl('https://x/pets/foo'), false)
  assert.equal(isKnownPetGalleryZipUrl('not a url'), false)
})

test('resolveCodexPetFallbackSlug extracts a slug from /pets/<slug> or slugifies a bare token', () => {
  assert.equal(resolveCodexPetFallbackSlug('https://codex-pet.org/pets/fleta/'), 'fleta')
  assert.equal(resolveCodexPetFallbackSlug('https://codex-pet.com/about'), '') // no /pets/<slug>
  assert.equal(resolveCodexPetFallbackSlug('fleta'), 'fleta') // bare token
  assert.equal(resolveCodexPetFallbackSlug(''), '')
})
