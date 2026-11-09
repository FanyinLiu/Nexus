/**
 * Real React root for hook tests that need effect cleanup to run exactly as it
 * does in the renderer. The repo has no jsdom dependency, so this module
 * supplies the tiny DOM surface react-dom/client touches for a null-rendering
 * component and drives updates through React.act.
 *
 * Callers own `window` (localStorage and the fake timers); this helper only
 * installs the document/iframe globals React DOM reads.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

type DocumentStub = {
  nodeType: number
  activeElement: null
  addEventListener: () => void
  removeEventListener: () => void
  createElement: () => { style: Record<string, unknown> }
}

type ContainerStub = {
  nodeType: number
  nodeName: string
  tagName: string
  namespaceURI: string
  ownerDocument: DocumentStub
  addEventListener: () => void
  removeEventListener: () => void
  childNodes: unknown[]
  firstChild: null
  appendChild: () => void
  removeChild: () => void
}

function installRealReactDom(): void {
  const documentStub: DocumentStub = {
    nodeType: 9,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    createElement: () => ({ style: {} }),
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: documentStub,
  })
  Object.defineProperty(globalThis, 'HTMLIFrameElement', {
    configurable: true,
    writable: true,
    value: class {},
  })
  const windowStub = (globalThis as { window?: Record<string, unknown> }).window
  if (windowStub && !windowStub.document) windowStub.document = documentStub
  if (windowStub && !windowStub.HTMLIFrameElement) windowStub.HTMLIFrameElement = class {}
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
}

export type RealReactRoot = {
  render: (element: React.ReactNode) => Promise<void>
  act: (callback: () => void) => Promise<void>
  unmount: () => Promise<void>
}

/** Mount a fresh react-dom/client root with the minimal DOM react-dom needs. */
export function createRealReactRoot(): RealReactRoot {
  installRealReactDom()
  const documentStub = (globalThis as unknown as { document: DocumentStub }).document
  const container: ContainerStub = {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: documentStub,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    childNodes: [],
    firstChild: null,
    appendChild: () => undefined,
    removeChild: () => undefined,
  }
  const root = createRoot(container as unknown as Element)
  return {
    async render(element) {
      await React.act(async () => {
        root.render(element)
      })
    },
    async act(callback) {
      await React.act(async () => {
        callback()
      })
    },
    async unmount() {
      await React.act(async () => {
        root.unmount()
      })
    },
  }
}
