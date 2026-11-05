import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(__dirname, '../../..', file), 'utf8')
const homepage = 'https://touchline.quest/'
const html = read('index.html')
const json = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)?.[1]
const graph = JSON.parse(json ?? '{}')['@graph'] as Record<string, unknown>[]

describe('public homepage discovery', () => {
  it('uses the production homepage in search, sharing and structured data', () => {
    expect(html).toContain(`<link rel="canonical" href="${homepage}"`)
    expect(html).toContain(`property="og:url" content="${homepage}"`)
    expect(graph).toEqual(expect.arrayContaining([
      expect.objectContaining({ '@type': 'WebSite', name: 'TouchLine', url: homepage, alternateName: ['Touchline', 'touchline.quest', 'Touchline Quest'], about: { '@id': `${homepage}#game` } }),
      expect.objectContaining({ '@type': 'VideoGame', name: 'TouchLine', url: homepage, mainEntityOfPage: { '@id': `${homepage}#website` } }),
    ]))
  })

  it('associates the TouchLine brand with its canonical domain in the initial document', () => {
    expect(html).toContain('<title>TouchLine – Football Draft &amp; Management Game | touchline.quest</title>')
    expect(html).toContain('<meta name="application-name" content="TouchLine"')
    expect(html).toContain('TouchLine</strong> at <strong>touchline.quest</strong> is a free football draft and management game')
    expect(html).toContain('<meta name="google-site-verification"')
  })

  it('introduces the game before JavaScript runs and lists only the public homepage', () => {
    expect(html).toMatch(/<h1>TouchLine[^<]*Football Draft/)
    expect(html).toContain('Pick one footballer')
    expect(read('public/robots.txt')).toContain(`Sitemap: ${homepage}sitemap.xml`)
    expect([...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual([homepage])
  })
})
