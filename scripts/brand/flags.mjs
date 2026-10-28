/**
 * Copy the flag icons the game needs into public/flags/<code>.svg.
 *
 * Source: the flag-icons package by Panayiotis Lipiridis (lipis),
 * https://github.com/lipis/flag-icons, version 7.6.0, MIT licence (the notice is
 * in docs/CREDITS.md and ships beside the SVGs as public/flags/LICENSE.txt).
 * The game draws flags as images because Windows shows emoji flags as two
 * letters ("BE", "AR").
 *
 * Which flags: every nation in the packs' `nations` tables (public/data/<league>/
 * meta.json), with its code derived from the emoji the data already carries, plus
 * `eu` for Europe and the seven league flags. A regional-indicator pair gives the
 * ISO 3166-1 alpha-2 code (🇧🇪 -> be); a black flag with a tag sequence gives the
 * subdivision (🏴 + "gbeng" -> gb-eng, likewise gb-sct and gb-wls). Northern
 * Ireland carries the UK emoji in the data, so it is mapped to gb-nir by hand.
 * Also every country an online account may carry (`COUNTRY_CODES` in
 * src/ui/online/countries.ts, read as text): the World boards and the account
 * chip draw those, and a missing one fell back to its two letters.
 * A nation with no derivable code, or one the package has no flag for, uses
 * public/flags/unknown.svg, a neutral flag of our own written by this script.
 * This mirrors `nationFlagCode` and `leagueFlagCode` in src/ui/format.ts; the
 * Vitest flags test (src/ui/__tests__/flags.test.ts) fails if they disagree.
 *
 * Rerun after a data rebuild that adds nations, or to change the package version:
 *
 *   mkdir -p /tmp/flags && cd /tmp/flags && npm pack flag-icons@7.6.0 && tar -xzf flag-icons-7.6.0.tgz
 *   node scripts/brand/flags.mjs /tmp/flags/package
 *
 * (Use an empty folder outside the repo and do not install the package.) The script
 * replaces the contents of public/flags, so a flag no nation needs any more goes.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA = path.join(ROOT, 'public', 'data')
const OUT = path.join(ROOT, 'public', 'flags')
const EXPECTED_VERSION = '7.6.0'

/** League id to flag code, as `leagueFlagCode` in src/ui/format.ts. */
export const LEAGUE_FLAGS = { england: 'gb-eng', spain: 'es', italy: 'it', germany: 'de', france: 'fr', netherlands: 'nl', portugal: 'pt', europe: 'eu' }
/** Nations whose emoji in the data is a stand-in for a flag the package does have. */
export const NATION_FLAG_OVERRIDE = { NIR: 'gb-nir' }
export const FALLBACK = 'unknown'

/** The flag-icons code for an emoji flag, or null when it is not a country or subdivision flag. */
export function flagCodeFromEmoji(emoji) {
  const cps = [...String(emoji ?? '')].map((c) => c.codePointAt(0))
  if (cps.length === 2 && cps.every((c) => c >= 0x1f1e6 && c <= 0x1f1ff)) return cps.map((c) => String.fromCharCode(c - 0x1f1e6 + 97)).join('')
  if (cps.length > 2 && cps[0] === 0x1f3f4 && cps[cps.length - 1] === 0xe007f) {
    const tag = cps.slice(1, -1).map((c) => (c >= 0xe0061 && c <= 0xe007a) || (c >= 0xe0030 && c <= 0xe0039) ? String.fromCharCode(c - 0xe0000) : '?').join('')
    if (/^[a-z]{2}[a-z0-9]{1,3}$/.test(tag)) return `${tag.slice(0, 2)}-${tag.slice(2)}`
  }
  return null
}

/** The account countries, lower case, from the list in src/ui/online/countries.ts (a TypeScript file, so read as text). */
export function accountCountries() {
  const text = readFileSync(path.join(ROOT, 'src', 'ui', 'online', 'countries.ts'), 'utf8')
  const m = text.match(/COUNTRY_CODES =\s*'([A-Z ]+)'/)
  if (!m) throw new Error('COUNTRY_CODES not found in src/ui/online/countries.ts')
  return m[1].split(' ').map((c) => c.toLowerCase())
}

/** A neutral 4:3 flag for nations without one: a grey field with a lighter diagonal. */
const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" id="flag-unknown" viewBox="0 0 640 480"><path fill="#8b95a1" d="M0 0h640v480H0z"/><path fill="#b9c0c8" d="M0 420 560 0h80v60L80 480H0z"/></svg>\n'

/** Refuse anything in a downloaded SVG that could run or fetch: the package is data, not code. */
function assertInert(svg, file) {
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg)) throw new Error(`${file}: unexpected active content, not copied`)
}

function main() {
  const pkgDir = process.argv[2]
  if (!pkgDir) {
    console.error('Usage: node scripts/brand/flags.mjs <path to the extracted flag-icons package>')
    process.exit(2)
  }
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  if (pkg.name !== 'flag-icons') throw new Error(`${pkgDir} is ${pkg.name}, not flag-icons`)
  if (pkg.version !== EXPECTED_VERSION) console.warn(`Warning: flag-icons ${pkg.version}, this script documents ${EXPECTED_VERSION}`)
  if (pkg.license !== 'MIT') throw new Error(`flag-icons ${pkg.version} is licensed ${pkg.license}, expected MIT`)
  const src = path.join(pkgDir, 'flags', '4x3')

  // Every nation in every pack, with the code its emoji gives
  const leagues = JSON.parse(readFileSync(path.join(DATA, 'leagues.json'), 'utf8')).leagues.map((l) => l.id)
  const nations = new Map()
  for (const id of leagues) {
    const meta = JSON.parse(readFileSync(path.join(DATA, id, 'meta.json'), 'utf8'))
    for (const [code, n] of Object.entries(meta.nations)) if (!nations.has(code)) nations.set(code, n)
  }
  const want = new Map() // flag code -> what needs it
  const withoutFlag = []
  for (const [code, n] of [...nations].sort((a, b) => a[0].localeCompare(b[0]))) {
    const flag = NATION_FLAG_OVERRIDE[code] ?? flagCodeFromEmoji(n.flag)
    if (!flag || !existsSync(path.join(src, `${flag}.svg`))) {
      withoutFlag.push(`${code} ${n.name}${flag ? ` (no ${flag}.svg in flag-icons)` : ''}`)
      continue
    }
    want.set(flag, [...(want.get(flag) ?? []), code])
  }
  for (const flag of accountCountries()) {
    if (!existsSync(path.join(src, `${flag}.svg`))) {
      withoutFlag.push(`account country ${flag} (no ${flag}.svg in flag-icons)`)
      continue
    }
    want.set(flag, [...(want.get(flag) ?? []), `country:${flag}`])
  }
  for (const [league, flag] of Object.entries(LEAGUE_FLAGS)) {
    if (!existsSync(path.join(src, `${flag}.svg`))) throw new Error(`no ${flag}.svg for ${league}`)
    want.set(flag, [...(want.get(flag) ?? []), `league:${league}`])
  }

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  for (const flag of [...want.keys()].sort()) {
    const from = path.join(src, `${flag}.svg`)
    assertInert(readFileSync(from, 'utf8'), from)
    copyFileSync(from, path.join(OUT, `${flag}.svg`))
  }
  writeFileSync(path.join(OUT, `${FALLBACK}.svg`), FALLBACK_SVG)
  writeFileSync(path.join(OUT, 'LICENSE.txt'), `Flag icons from flag-icons ${pkg.version} (https://github.com/lipis/flag-icons), MIT licence; ${FALLBACK}.svg is TouchLine's own.\n\n${readFileSync(path.join(pkgDir, 'LICENSE'), 'utf8')}`)

  const bytes = readdirSync(OUT).reduce((s, f) => s + statSync(path.join(OUT, f)).size, 0)
  console.log(`${nations.size} nations in ${leagues.length} packs -> ${want.size} flags from flag-icons ${pkg.version} + ${FALLBACK}.svg + LICENSE.txt`)
  console.log(`public/flags: ${readdirSync(OUT).length} files, ${bytes.toLocaleString()} bytes (${(bytes / 1024).toFixed(1)} KiB)`)
  console.log(`Nations without a flag (shown with ${FALLBACK}.svg): ${withoutFlag.length ? withoutFlag.join(', ') : 'none'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
