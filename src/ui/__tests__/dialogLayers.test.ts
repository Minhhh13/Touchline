import { describe, expect, it } from 'vitest'
import { closeLayer, isTopLayer, openLayer, openLayers, pathSiblings, trapIndex, type LayerNode } from '../dialogLayers'

interface Fake extends LayerNode {
  name: string
  kids: Fake[]
  attrs: string[]
}

function node(name: string, kids: Fake[] = [], attrs: string[] = []): Fake {
  const n: Fake = { name, kids, attrs, parentElement: null, children: kids, inert: false, hasAttribute: (a) => attrs.includes(a) }
  for (const k of kids) k.parentElement = n
  return n
}

/** body > [root > [topbar, main > [sim5], back(digest) > [dialog]], toast, keep] like the app shell with the digest open. */
function page() {
  const dialog = node('dialog')
  const digest = node('digest-back', [dialog])
  const sim5 = node('sim5')
  const main = node('main', [sim5])
  const topbar = node('topbar')
  const app = node('app', [topbar, main, digest])
  const toast = node('toast', [], ['data-dialog-keep'])
  const already = node('already-inert')
  already.inert = true
  const body = node('body', [app, toast, already])
  return { body, app, topbar, main, sim5, digest, dialog, toast, already }
}

describe('dialog layers', () => {
  it('makes everything beside the open dialog inert, and gives it back on close', () => {
    const p = page()
    expect(pathSiblings(p.digest, p.body).map((n) => (n as Fake).name).sort()).toEqual(['already-inert', 'main', 'toast', 'topbar'])
    openLayer(p.digest, p.body)
    expect(isTopLayer(p.digest)).toBe(true)
    expect(p.topbar.inert).toBe(true)
    expect(p.main.inert).toBe(true)
    // The dialog's own path stays live; the toast is kept live on purpose
    expect(p.app.inert).toBe(false)
    expect(p.digest.inert).toBe(false)
    expect(p.toast.inert).toBe(false)
    closeLayer(p.digest, p.body)
    expect(openLayers()).toBe(0)
    expect(p.topbar.inert).toBe(false)
    expect(p.main.inert).toBe(false)
    // Only what the layers set is cleared
    expect(p.already.inert).toBe(true)
  })

  it('stacks: only the top dialog is live, the one under it becomes the top again when it closes', () => {
    const p = page()
    const inner = node('inner-dialog')
    const second = node('second-back', [inner])
    p.app.kids.push(second)
    second.parentElement = p.app
    openLayer(p.digest, p.body)
    openLayer(second, p.body)
    expect(isTopLayer(second)).toBe(true)
    expect(isTopLayer(p.digest)).toBe(false)
    expect(p.digest.inert).toBe(true)
    expect(second.inert).toBe(false)
    closeLayer(second, p.body)
    expect(isTopLayer(p.digest)).toBe(true)
    expect(p.digest.inert).toBe(false)
    expect(second.inert).toBe(true)
    expect(p.main.inert).toBe(true)
    closeLayer(p.digest, p.body)
    expect(second.inert).toBe(false)
    expect(openLayers()).toBe(0)
  })

  it('closes in any order', () => {
    const p = page()
    const other = node('other-back')
    p.app.kids.push(other)
    other.parentElement = p.app
    openLayer(p.digest, p.body)
    openLayer(other, p.body)
    closeLayer(p.digest, p.body)
    expect(isTopLayer(other)).toBe(true)
    expect(p.digest.inert).toBe(true)
    closeLayer(other, p.body)
    expect(p.digest.inert).toBe(false)
    expect(p.main.inert).toBe(false)
  })

  it('a dialog not under the root makes nothing inert', () => {
    const p = page()
    const stray = node('stray')
    expect(pathSiblings(stray, p.body)).toEqual([])
  })
})

describe('trapIndex', () => {
  it('wraps Tab from the last to the first and Shift+Tab from the first to the last, and leaves the rest to the browser', () => {
    expect(trapIndex(3, 2, false)).toBe(0)
    expect(trapIndex(3, 0, true)).toBe(2)
    expect(trapIndex(3, 1, false)).toBeNull()
    expect(trapIndex(3, 1, true)).toBeNull()
    // The dialog itself focused (just opened): Tab goes to the first control, Shift+Tab to the last
    expect(trapIndex(3, -1, false)).toBe(0)
    expect(trapIndex(3, -1, true)).toBe(2)
    expect(trapIndex(1, 0, false)).toBe(0)
    expect(trapIndex(0, -1, false)).toBeNull()
  })
})
