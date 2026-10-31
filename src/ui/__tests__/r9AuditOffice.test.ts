import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { translator } from '../i18n'
import { office } from '../i18n/en/office'

const t = translator(office)
const source = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

describe('the Office tab words its terms as whole messages (r9 audit)', () => {
  it('a sell-on and a contract length are one message each, plural included', () => {
    expect(t('sellOnPct', { pct: 10 })).toBe('Sell-on 10%')
    expect(t('sellOnNone')).toBe('Sell-on: none')
    expect(t('yearsN', { n: 1 })).toBe('1 season')
    expect(t('yearsN', { n: 3 })).toBe('3 seasons')
  })

  it('the fee talks glue no fragments together', () => {
    const src = source('screens/OfficeTab.tsx')
    expect(src).not.toContain("${t('sellOn')}")
    expect(src).not.toContain("{y} · {t('years')}")
  })
})
