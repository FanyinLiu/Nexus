import { ipcMain } from 'electron'
import * as skillStore from '../services/skillStore.js'
import {
  validateSkillIdPayload,
  validateSkillSavePayload,
  validateSkillSearchPayload,
} from './payloadSchemas.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('skill:save', async (event, payload) => {
    requireTrustedSender(event)
    const { id, title, trigger, summary, content } = validateSkillSavePayload(payload)
    return skillStore.saveSkill(id, title, trigger, summary, content)
  })

  ipcMain.handle('skill:search', async (event, payload) => {
    requireTrustedSender(event)
    const { query, limit } = validateSkillSearchPayload(payload)
    return skillStore.searchSkills(query, limit)
  })

  ipcMain.handle('skill:list', async (event) => {
    requireTrustedSender(event)
    return skillStore.listSkills()
  })

  ipcMain.handle('skill:get', async (event, payload) => {
    requireTrustedSender(event)
    const { id } = validateSkillIdPayload('skill:get', payload)
    return skillStore.getSkill(id)
  })

  ipcMain.handle('skill:remove', async (event, payload) => {
    requireTrustedSender(event)
    const { id } = validateSkillIdPayload('skill:remove', payload)
    return skillStore.removeSkill(id)
  })

  ipcMain.handle('skill:mark-used', async (event, payload) => {
    requireTrustedSender(event)
    const { id } = validateSkillIdPayload('skill:mark-used', payload)
    await skillStore.markSkillUsed(id)
    return { ok: true }
  })

  ipcMain.handle('skill:stats', async (event) => {
    requireTrustedSender(event)
    return skillStore.getStats()
  })
}
