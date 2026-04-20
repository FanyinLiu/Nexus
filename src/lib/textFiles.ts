import { t } from '../i18n/runtime.ts'
import type {
  FileDialogFilter,
  TextFileOpenRequest,
  TextFileOpenResponse,
  TextFileSaveRequest,
  TextFileSaveResponse,
} from '../types'

type BrowserFilePickerType = {
  description: string
  accept: Record<string, string[]>
}

function normalizeFilters(filters?: FileDialogFilter[]) {
  if (!Array.isArray(filters)) {
    return []
  }

  return filters
    .map((filter) => {
      const name = String(filter?.name ?? '').trim()
      const extensions = Array.isArray(filter?.extensions)
        ? filter.extensions
          .map((extension) => String(extension ?? '').trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean)
        : []

      if (!name || !extensions.length) {
        return null
      }

      return {
        name,
        extensions,
      }
    })
    .filter((filter): filter is NonNullable<typeof filter> => Boolean(filter))
}

export function buildBrowserFileInputAccept(filters?: FileDialogFilter[]) {
  return normalizeFilters(filters)
    .flatMap((filter) => filter.extensions.map((extension) => `.${extension}`))
    .join(',')
}

export function buildBrowserFilePickerTypes(filters?: FileDialogFilter[]): BrowserFilePickerType[] {
  return normalizeFilters(filters).map((filter) => ({
    description: filter.name,
    accept: {
      'text/plain': filter.extensions.map((extension) => `.${extension}`),
    },
  }))
}

function ensureBrowserFileApis() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error(t('file.error.not_supported'))
  }
}

export async function saveTextFileWithFallback(payload: TextFileSaveRequest): Promise<TextFileSaveResponse> {
  if (window.desktopPet?.saveTextFile) {
    return window.desktopPet.saveTextFile(payload)
  }

  ensureBrowserFileApis()

  const defaultFileName = String(payload.defaultFileName ?? '').trim() || `nexus-${Date.now()}.txt`
  const blob = new Blob([String(payload.content ?? '')], {
    type: 'text/plain;charset=utf-8',
  })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = objectUrl
  link.download = defaultFileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl)
  }, 0)

  return {
    canceled: false,
    message: t('file.saved.downloaded', { fileName: defaultFileName }),
  }
}

async function readTextFromFile(file: File) {
  return (await file.text()).replace(/^\uFEFF/, '')
}

async function openTextFileWithPicker(payload: TextFileOpenRequest): Promise<TextFileOpenResponse> {
  const picker = (window as Window & {
    showOpenFilePicker?: (options: Record<string, unknown>) => Promise<Array<{
      getFile: () => Promise<File>
    }>>
  }).showOpenFilePicker

  if (typeof picker !== 'function') {
    throw new Error('showOpenFilePicker is unavailable')
  }

  try {
    const handles = await picker({
      multiple: false,
      excludeAcceptAllOption: buildBrowserFilePickerTypes(payload.filters).length > 0,
      types: buildBrowserFilePickerTypes(payload.filters),
    })
    const [handle] = handles
    if (!handle) {
      return {
        canceled: true,
        message: '已取消打开。',
      }
    }

    const file = await handle.getFile()
    const content = await readTextFromFile(file)

    return {
      canceled: false,
      filePath: file.name,
      content,
      message: `已读取 ${file.name}`,
    }
  } catch (error) {
    if (
      error instanceof DOMException
      && (error.name === 'AbortError' || error.name === 'SecurityError')
    ) {
      return {
        canceled: true,
        message: '已取消打开。',
      }
    }

    throw error
  }
}

async function openTextFileWithInput(payload: TextFileOpenRequest): Promise<TextFileOpenResponse> {
  ensureBrowserFileApis()

  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    const accept = buildBrowserFileInputAccept(payload.filters)
    let settled = false
    let focusTimeoutId: number | null = null

    const cleanup = () => {
      if (focusTimeoutId !== null) {
        window.clearTimeout(focusTimeoutId)
        focusTimeoutId = null
      }

      window.removeEventListener('focus', handleWindowFocus)
      input.removeEventListener('change', handleInputChange)
      input.removeEventListener('cancel', handleInputCancel as EventListener)
      input.remove()
    }

    const finish = (result: TextFileOpenResponse) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(result)
    }

    const fail = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }

    async function handleInputChange() {
      const file = input.files?.[0]
      if (!file) {
        finish({
          canceled: true,
          message: '已取消打开。',
        })
        return
      }

      try {
        const content = await readTextFromFile(file)
        finish({
          canceled: false,
          filePath: file.name,
          content,
          message: `已读取 ${file.name}`,
        })
      } catch (error) {
        fail(new Error(error instanceof Error ? error.message : '读取文件失败，请稍后再试。'))
      }
    }

    function handleInputCancel() {
      finish({
        canceled: true,
        message: '已取消打开。',
      })
    }

    function handleWindowFocus() {
      focusTimeoutId = window.setTimeout(() => {
        if (!settled && !input.files?.length) {
          finish({
            canceled: true,
            message: '已取消打开。',
          })
        }
      }, 250)
    }

    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', handleInputChange)
    input.addEventListener('cancel', handleInputCancel as EventListener)
    window.addEventListener('focus', handleWindowFocus)
    input.click()
  })
}

export async function openTextFileWithFallback(payload: TextFileOpenRequest): Promise<TextFileOpenResponse> {
  if (window.desktopPet?.openTextFile) {
    return window.desktopPet.openTextFile(payload)
  }

  ensureBrowserFileApis()

  const picker = (window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker
  if (typeof picker === 'function') {
    return openTextFileWithPicker(payload)
  }

  return openTextFileWithInput(payload)
}
