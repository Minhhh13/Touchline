/**
 * The pseudo-locale (`en-XA`), for development: every string through `t()` comes out accented, bracketed and about
 * 30 % longer ("Setup" reads "[!! Ŝéţûþ !!]"), so a string still in plain English is one that never went through
 * `t()`, and a layout that breaks here will break in German. Pure.
 */

const ACCENTS: Record<string, string> = {
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Ŝ', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
}

/** The pseudo-locale's id: a private-use English variant, as Android and Chromium name it. */
export const PSEUDO_LOCALE = 'en-XA'

/** The pseudo-locale's open and close marks. */
export const PSEUDO_OPEN = '[!! '
export const PSEUDO_CLOSE = ' !!]'

/** Accent a run of literal text (letters only; digits, spaces and punctuation stay). */
export function accent(text: string): string {
  let out = ''
  for (const c of text) out += ACCENTS[c] ?? c
  return out
}

/** Wrap a formatted string in the marks, padded so the whole is about 30 % longer than the English (`length` of it). */
export function wrapPseudo(formatted: string, englishLength: number): string {
  if (!formatted) return formatted
  const extra = Math.ceil(englishLength * 0.3) - PSEUDO_OPEN.length - PSEUDO_CLOSE.length
  // The padding breaks like words do ("~~~~ ~~~~"): one unbroken run would overflow a narrow box no translation would
  return `${PSEUDO_OPEN}${formatted}${extra > 0 ? ' ~~~~'.repeat(Math.ceil(extra / 5)).slice(0, extra) : ''}${PSEUDO_CLOSE}`
}

/** True when a string came out of the pseudo-locale (a test's check for text that skipped `t()`). */
export function isPseudo(text: string): boolean {
  return text.includes(PSEUDO_OPEN.trim()) || /[ÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŜŢÛṼŴẊÝŽáƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýž]/.test(text)
}
