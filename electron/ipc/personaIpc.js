import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import * as personaLoader from '../services/personaLoader.js'
import { acceptPersonaSoulContent } from '../services/personaProfileLoader.js'
import { parseCharacterCard } from '../services/characterCardParser.js'
import { mapCardToPersona } from '../services/characterCardMapper.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('persona:load-soul', async (event) => {
    requireTrustedSender(event)
    return personaLoader.loadSoul()
  })

  ipcMain.handle('persona:load-memory', async (event) => {
    requireTrustedSender(event)
    return personaLoader.loadPersonaMemory()
  })

  ipcMain.handle('persona:save-soul', async (event, payload) => {
    requireTrustedSender(event)
    const rawContent = payload?.content
    if (rawContent != null && typeof rawContent !== 'string') return { ok: false }
    const content = acceptPersonaSoulContent(rawContent == null ? '' : String(rawContent))
    if (content == null) return { ok: false }
    // Optional profileId writes that profile's soul.md on the same panel-only
    // channel. An id that is present but not a safe segment is refused, and
    // is not redirected onto the global SOUL file.
    const profileId = payload && typeof payload === 'object' ? payload.profileId : undefined
    if (profileId != null && profileId !== '') {
      if (typeof profileId !== 'string') return { ok: false }
      const saved = await personaLoader.savePersonaProfileSoul(profileId, content)
      return { ok: saved }
    }
    await personaLoader.saveSoul(content)
    return { ok: true }
  })

  ipcMain.handle('persona:save-memory', async (event, payload) => {
    requireTrustedSender(event)
    await personaLoader.savePersonaMemory(String(payload?.content ?? ''))
    return { ok: true }
  })

  ipcMain.handle('persona:paths', async (event) => {
    requireTrustedSender(event)
    return personaLoader.getPersonaPaths()
  })

  ipcMain.handle('persona:open-dir', async (event) => {
    requireTrustedSender(event)
    const paths = personaLoader.getPersonaAbsolutePaths()
    await personaLoader.ensurePersonaDir('')
    shell.openPath(paths.personaDir)
    return { ok: true }
  })

  ipcMain.handle('persona:init', async (event, payload) => {
    requireTrustedSender(event)
    return personaLoader.ensurePersonaDir(String(payload?.defaultSoul ?? ''))
  })

  // ── v2 per-profile persona (soul/memory/examples/style/voice/tools) ──
  ipcMain.handle('persona:load-profile', async (event, payload) => {
    requireTrustedSender(event)
    const profileId = String(payload?.profileId ?? '').trim()
    if (!profileId) {
      throw new Error('persona:load-profile 需要非空的 profileId。')
    }
    return personaLoader.loadPersonaProfile(profileId)
  })

  ipcMain.handle('persona:profile-dir', async (event, payload) => {
    requireTrustedSender(event)
    const profileId = String(payload?.profileId ?? '').trim()
    if (!profileId) {
      throw new Error('persona:profile-dir 需要非空的 profileId。')
    }
    return { dir: personaLoader.getPersonaProfileDisplayDir(profileId) }
  })

  ipcMain.handle('persona:import-card', async (event) => {
    requireTrustedSender(event)
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const selection = await dialog.showOpenDialog(sourceWindow, {
      title: 'Import Character Card',
      filters: [
        { name: 'Character Card', extensions: ['png', 'json'] },
      ],
      properties: ['openFile'],
    })
    if (selection.canceled || !selection.filePaths.length) return null

    const card = await parseCharacterCard(selection.filePaths[0])
    const mapped = mapCardToPersona(card)
    await personaLoader.writePersonaProfile(mapped.profileId, mapped.files)

    return {
      profile: mapped.profile,
      greeting: mapped.greeting,
      lorebookEntries: mapped.lorebookEntries,
    }
  })
}
