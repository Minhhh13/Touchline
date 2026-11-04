import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { home } from '../i18n/en/home'

const read = (file: string) => readFileSync(resolve(__dirname, '../../..', file), 'utf8')
const homepage = 'https://touchline.quest/'
const html = read('index.html')

describe('public homepage discovery', () => {
  it('uses the production homepage in search, sharing and structured data', () => {
    expect(html).toContain(`<link rel="canonical" href="${homepage}"`)
    expect(html).toContain(`property="og:url" content="${homepage}"`)
    const json = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)?.[1]
    expect(JSON.parse(json ?? '{}')['@graph']).toEqual(expect.arrayContaining([
      expect.objectContaining({ '@type': 'WebSite', name: 'TouchLine', alternateName: ['TouchLine Quest', 'touchline.quest'], url: homepage }),
      expect.objectContaining({ '@type': 'VideoGame', name: 'TouchLine', alternateName: 'TouchLine Quest', url: homepage }),
    ]))
  })

  it('introduces the game before JavaScript runs and lists only the public homepage', () => {
    expect(html).toMatch(/<h1>TouchLine[^<]*Football Draft/)
    expect(html).toContain('Pick one footballer')
    expect(read('public/robots.txt')).toContain(`Sitemap: ${homepage}sitemap.xml`)
    expect([...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual([homepage])
  })

  it('supports the alternate name in both the initial introduction and Home copy', () => {
    const body = html.split('<body>')[1]
    expect(body).toMatch(/<p>TouchLine Quest\b/)
    expect(body).toContain(`<a href="${homepage}">touchline.quest</a>`)
    expect(home.messages.footer).toContain('TouchLine Quest')
  })
})
