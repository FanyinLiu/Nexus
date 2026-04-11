import { ipcMain, shell } from 'electron'
import * as personaLoader from '../services/personaLoader.js'
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
    await personaLoader.saveSoul(String(payload?.content ?? ''))
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
    const paths = personaLoader.getPersonaPaths()
    await personaLoader.ensurePersonaDir('')
    shell.openPath(paths.personaDir)
    return { ok: true }
  })

  ipcMain.handle('persona:init', async (event, payload) => {
    requireTrustedSender(event)
    return personaLoader.ensurePersonaDir(String(payload?.defaultSoul ?? ''))
  })
}
