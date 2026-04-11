import { ipcMain } from 'electron'
import * as skillStore from '../services/skillStore.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('skill:save', async (event, payload) => {
    requireTrustedSender(event)
    const { id, title, trigger, summary, content } = payload ?? {}
    return skillStore.saveSkill(id, title, trigger, summary, content)
  })

  ipcMain.handle('skill:search', async (event, payload) => {
    requireTrustedSender(event)
    const { query, limit } = payload ?? {}
    return skillStore.searchSkills(query, limit)
  })

  ipcMain.handle('skill:list', async (event) => {
    requireTrustedSender(event)
    return skillStore.listSkills()
  })

  ipcMain.handle('skill:get', async (event, payload) => {
    requireTrustedSender(event)
    return skillStore.getSkill(String(payload?.id ?? ''))
  })

  ipcMain.handle('skill:remove', async (event, payload) => {
    requireTrustedSender(event)
    return skillStore.removeSkill(String(payload?.id ?? ''))
  })

  ipcMain.handle('skill:mark-used', async (event, payload) => {
    requireTrustedSender(event)
    await skillStore.markSkillUsed(String(payload?.id ?? ''))
    return { ok: true }
  })

  ipcMain.handle('skill:stats', async (event) => {
    requireTrustedSender(event)
    return skillStore.getStats()
  })
}
