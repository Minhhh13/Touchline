/**
 * The pseudo-locale's leftover English (docs/DESIGN_SYSTEM.md section 17), shared by `i18nScreens.test.ts` and
 * `i18nR10.test.ts`: the text a server render shows, and the segments of it that skipped `t()`.
 */
import type { LoadedUniverse } from '@engine/universe'
import { isPseudo } from '../i18n/pseudo'
import { surname } from '../match/shirts'
import { surname as shortSurname } from '@game/logic/slotSheet'

/** Data on screen is never English to translate: names of players, clubs, nations and leagues, and the test's teams. */
export function dataNames(u: LoadedUniverse, extra: string[] = []): Set<string> {
  const data = new Set<string>(['QA XI', 'QA United', 'QAX', 'QAU', 'Ann', 'Bob', 'Touchline XI', 'TouchLine', ...extra])
  for (const p of Object.values(u.index)) [p.name, surname(p.name), shortSurname(p.name)].forEach((n) => data.add(n))
  for (const c of Object.values(u.clubById)) [c.name, c.shortName].forEach((n) => n && data.add(n))
  for (const n of Object.values(u.nations)) data.add(n.name)
  for (const l of u.available) data.add(l.name)
  return data
}

/** The text a render shows: text nodes and the attributes a screen reader or a tooltip reads. */
export function texts(html: string): string[] {
  // The share text stays English on purpose (docs/DESIGN_SYSTEM.md section 17): its <pre> is left out
  const clean = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<pre[^>]*share-text[^>]*>[\s\S]*?<\/pre>/g, '')
  const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  const out: string[] = []
  for (const m of clean.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) out.push(decode(m[1]))
  for (const seg of clean.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]+>/)) out.push(decode(seg))
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** English that skipped `t()`: a segment with an all lower-case word of three letters or more that is neither pseudo nor data. */
export function leftover(html: string, data: Set<string>): string[] {
  return texts(html).filter((s) => {
    if (isPseudo(s) || data.has(s)) return false
    const rest = s
      .split(/\s*(?:·|,|:|—|–|\(|\)|\/|\|)\s*/)
      // A scorer line starts with a football glyph; the following player name is still data.
      .map((x) => x.replace(/^⚽\s*/, '').replace(/\b\d{4}-\d{2}\b|[\d.,%'+−-]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((x) => x && !data.has(x) && !isPseudo(x))
    // A word is a run of letters, accents included, so "Martínez" is a name and not the English word "nez"
    return rest.some((x) => (x.match(/\p{L}+/gu) ?? []).some((w) => /^[a-z]{3,}$/.test(w)))
  })
}
