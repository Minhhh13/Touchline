import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

// The server bundles' guard against browser and Node globals (scripts/online/forbidden.mjs)
const url = pathToFileURL(path.resolve(__dirname, '..', '..', '..', 'scripts', 'online', 'forbidden.mjs')).href
const load = async () => (await import(/* @vite-ignore */ url)) as { forbiddenIn(code: string): string[] }

describe('forbiddenIn', () => {
  it('finds every global a server cannot run, through globalThis and self too', async () => {
    const { forbiddenIn } = await load()
    for (const [code, g] of [
      ['a=window.location', 'window.'],
      ['(window.x)', 'window.'],
      ['globalThis.window.x', 'window.'],
      ['self.document.body', 'document.'],
      [';document.body', 'document.'],
      ['globalThis.localStorage', 'localStorage'],
      ['x.sessionStorage', 'sessionStorage'],
      ['process.env.X', 'process.'],
      ['require("node:fs")', 'require('],
      ['navigator.onLine', 'navigator.'],
    ]) expect(forbiddenIn(code), code).toEqual([g])
  })

  it("passes another object's property of the same name: the Season loop's transfer window", async () => {
    const { forbiddenIn } = await load()
    for (const code of ['e.window.offers', 'game.window.listings', 'x?.window.y', 'myWindow.x', 'e.process.x', 'a.\n  window.days']) expect(forbiddenIn(code), code).toEqual([])
  })
})
