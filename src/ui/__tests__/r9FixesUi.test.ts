import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** QA round 4 (r9): the screens' fixes that are guards over the source. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? (f === '__tests__' ? [] : tsxFiles(p)) : p.endsWith('.tsx') ? [p] : []
  })
}

describe('R9-6: every radio group moves its choice with the arrows and is one Tab stop', () => {
  it('each role="radiogroup" takes onRadioGroupKey, and its radios a roving tabIndex', () => {
    const bad: string[] = []
    for (const file of tsxFiles(path.resolve(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/<[a-z]+[^>]*role="radiogroup"[^>]*>/g)) {
        if (!m[0].includes('onRadioGroupKey')) bad.push(`${path.basename(file)}: ${m[0].slice(0, 90)}`)
        // The radios that follow, up to the group's close, carry a roving tabIndex
        const body = src.slice(m.index! + m[0].length, src.indexOf('</div>', m.index! + m[0].length))
        for (const r of body.matchAll(/<button[^>]*role="radio"[^>]*>/g)) if (!/tabIndex=\{radioTabIndex\(/.test(r[0])) bad.push(`${path.basename(file)}: a radio without radioTabIndex`)
      }
    }
    expect(bad).toEqual([])
  })
})
