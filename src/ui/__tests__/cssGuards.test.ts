import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const UI = join(__dirname, '..')

function cssFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...cssFiles(p))
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

/** Every `file:line` whose text matches `bad` and not `ok`. */
function offenders(bad: RegExp, ok?: RegExp): string[] {
  const out: string[] = []
  for (const f of cssFiles(UI)) {
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (bad.test(line) && !(ok && ok.test(line))) out.push(`${relative(UI, f)}:${i + 1}: ${line.trim()}`)
      })
  }
  return out
}

describe('the stylesheets', () => {
  it('size type on the --fs-* tokens: a fixed px font size carries a /* px: why */ note (a pitch disc, a badge box, the 16 px iOS input)', () => {
    expect(cssFiles(UI).length).toBeGreaterThan(0)
    expect(offenders(/font-size:\s*[0-9.]+px/, /\/\*\s*px:/)).toEqual([])
  })

  it('never animate left or top (DESIGN_SYSTEM section 12, rule 2: transform and opacity only)', () => {
    expect(offenders(/transition(-property)?:[^;]*\b(left|top)\b/)).toEqual([])
  })
})
