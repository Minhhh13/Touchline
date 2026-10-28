import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { answerConfirm, askConfirm, currentConfirm } from '../confirm'

describe('askConfirm: the game’s own yes-or-no question', () => {
  it('shows one question at a time, in the order asked, and resolves each with its answer', async () => {
    const first = askConfirm('Abandon the current game?', { ok: 'Abandon', danger: true })
    const second = askConfirm('Let the assistant finish the draft?')
    const shown = currentConfirm()
    expect(shown).toMatchObject({ message: 'Abandon the current game?', ok: 'Abandon', danger: true })
    expect(shown!.cancel).toBeUndefined()
    answerConfirm(shown!.id, false)
    await expect(first).resolves.toBe(false)
    const next = currentConfirm()
    expect(next).toMatchObject({ message: 'Let the assistant finish the draft?', danger: false })
    expect(next!.ok).toBeUndefined()
    answerConfirm(next!.id, true)
    await expect(second).resolves.toBe(true)
    expect(currentConfirm()).toBeNull()
  })

  it('ignores an answer to a question no longer on screen', async () => {
    const q = askConfirm('Discard this parked game?')
    const id = currentConfirm()!.id
    answerConfirm(id, true)
    answerConfirm(id, false)
    await expect(q).resolves.toBe(true)
    expect(currentConfirm()).toBeNull()
  })

  it('no screen calls the browser’s window.confirm any more', () => {
    const root = join(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__') walk(p)
        } else if (p.endsWith('.tsx') || p.endsWith('.ts')) files.push(p)
      }
    }
    walk(root)
    const offenders = files.filter((f) => /(^|\W)confirm\(/.test(readFileSync(f, 'utf8').replace(/askConfirm\(|answerConfirm\(/g, '')))
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([])
  })
})
