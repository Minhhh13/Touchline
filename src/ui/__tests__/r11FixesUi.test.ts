import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roomCodeFrom, roomInviteText } from '../../online/rooms'
import { paceLine } from '@game/logic/gameByGame'
import { gapLine, type LiveRow } from '@game/logic/liveTable'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '@engine/h2h'
import { getFormation } from '@engine/formations'
import { Rng } from '@engine/rng'
import { h2hRules } from '@game/logic/h2h'
import { roomLogLine } from '@game/logic/h2hRoom'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { POWER_UPS } from '@engine/powerups'
import { formatText, setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { logicText } from '../i18n/en/logicText'
import { logicLine, matchLogicLine } from '../i18n/logicText'
import { caseRowTitle, playStyleLabel } from '../i18n/engineText'
import { arenaTierText, gauntletBandText } from '../arenaText'
import { arenaTierLabel, ARENA_TIER_LABEL, type ArenaTier } from '@engine/knockout'
import { GAUNTLET_RUNGS, rungBandLabel } from '@engine/gauntlet'
import { STYLE_LABEL } from '@engine/tactics'
import type { PlayStyle } from '@engine/types'

/** QA round 6 (r11, docs/QA.md): the screen fixes. The browser checks are in docs/QA.md; these hold the code to them. */
const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
const css = src('styles.css')

describe('R11-2: a room code read from the invite’s words alone', () => {
  it('finds the code the invite prints when a share sheet or app passed the text without its link', () => {
    expect(roomCodeFrom(roomInviteText('Ann', 'K7FAAAAB'))).toBe('K7FAAAAB')
    expect(roomCodeFrom(roomInviteText(null, 'K7FAAAAB'))).toBe('K7FAAAAB')
    expect(roomCodeFrom(roomInviteText('Ann', 'K7Q2MX9A', { of: 'K7FAAAAB', opponent: 'Bob' }))).toBe('K7Q2MX9A')
    expect(roomCodeFrom('Room K7Q2-MX9A')).toBe('K7Q2MX9A')
    // A link whose code keeps its dash, or a capital H
    expect(roomCodeFrom('https://touchline.quest/#h=K7Q2-MX9A')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('https://touchline.quest/#H=k7q2mx9a.')).toBe('K7Q2MX9A')
  })

  it('still reads what it read, and refuses what it refused', () => {
    expect(roomCodeFrom('K7Q2-MX9A')).toBe('K7Q2MX9A')
    expect(roomCodeFrom(' k7q2 mx9a ')).toBe('K7Q2MX9A')
    expect(roomCodeFrom(`${roomInviteText('Ann', 'K7FAAAAB')} https://touchline.quest/#h=K7Q2MX9A`)).toBe('K7Q2MX9A')
    for (const no of ['', '   ', 'https://touchline.quest/#s=K7Q2MX9A plus words', 'K7Q2-MX9O', 'a good back-pass and a nice cross-ball', 'see you at the game tonight']) expect(roomCodeFrom(no), no).toBeNull()
  })
})

describe('R11-3: both managers pressed Rematch at once', () => {
  it('the rematch’s waiting room offers the friend’s code too, and joining it closes your own empty room', () => {
    const rooms = src('online/Rooms.tsx')
    const waiting = rooms.split('function RoomWaiting(')[1].split('\nfunction ')[0]
    expect(waiting).toMatch(/<JoinRematch name=\{again\} own=\{view\.code\} \/>/)
    const join = rooms.split('function JoinRematch(')[1].split('\nfunction ')[0]
    expect(join).toMatch(/if \(own\) await leaveRoom\(\)\s+await openRoom\(typed\)/)
    expect(join).toContain('typed === own')
  })
})

describe('R11-4: a tab key pressed on a focused tab of the Dugout’s strip moves the focus with it', () => {
  it('the focus follows to the selected tab, which holds the roving tabIndex', () => {
    const dugout = src('screens/Dugout.tsx')
    const onKey = dugout.split('const onKey = (e: KeyboardEvent) => {')[1].split("window.addEventListener('pointerdown'")[0]
    expect(onKey).toMatch(/stripTab\?\.closest\('\.tabs-row'\)/)
    expect(onKey).toMatch(/runAfterPaint\(\(\) => strip\.querySelector<HTMLElement>\('\[role="tab"\]\[aria-selected="true"\]'\)\?\.focus\(\)\)/)
  })
})

describe('R11-5: Setup’s defaults link hands the focus on', () => {
  it('to the change link beside it, unless the focus is somewhere real', () => {
    const setup = src('screens/Setup.tsx')
    const reset = setup.split('const resetChoices = () => {')[1].split('\n  }\n')[0]
    expect(reset).toMatch(/focusHasFallen\(.*\) changeRef\.current\?\.focus\(\)/)
    expect(setup).toMatch(/data-testid="setup-change" ref=\{changeRef\}/)
  })
})

describe('R11-6: the Dugout’s next fixture keeps a long midweek line inside its box', () => {
  it('the facts column may shrink, so the line ends in its ellipsis', () => {
    expect(css).toMatch(/\.cta-fixture > div \{\s+min-width: 0;\s+\}/)
    expect(css).toMatch(/\.cta-then \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
  })
})

describe('R11-7: Explore’s range fields say “to” in the viewer’s language', () => {
  it('no screen prints a bare English word between two tags', () => {
    const files = (dir: string): string[] => readdirSync(join(__dirname, '..', dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === '__tests__' ? [] : files(join(dir, d.name))) : d.name.endsWith('.tsx') ? [join(dir, d.name)] : []))
    const bare: string[] = []
    for (const f of files('.')) for (const m of src(f).matchAll(/>\s*([a-z][a-z' ]+)\s*<\//g)) bare.push(`${f}: ${m[1]}`)
    expect(bare).toEqual([])
    expect(src('screens/ExploreViews.tsx')).toContain("{tx('rangeBetween')}")
  })
})

describe('R11-8: January’s pace line and the case reel’s items in the viewer’s language', () => {
  const lines = (): string[] => {
    const out = [paceLine({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, position: 0 }, 38, 20)]
    for (let position = 1; position <= 20; position++) for (const points of [3, 19, 25, 40, 57]) out.push(paceLine({ played: 19, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points, position }, 38, 20))
    return out
  }

  it('every pace line the logic writes is a logicText message, read back character for character', () => {
    for (const line of lines()) {
      const hit = matchLogicLine(line)
      expect(hit, line).not.toBeNull()
      expect(hit!.key.startsWith('gameByGame_'), line).toBe(true)
      expect(formatText(logicText.messages[hit!.key as keyof typeof logicText.messages], hit!.vars)).toBe(line)
    }
  })

  it('in the pseudo-locale the pace line and the case items are translated; English is untouched', () => {
    expect(caseRowTitle({ item: 'icon', title: 'Icon' })).toBe('Icon')
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    try {
      for (const line of lines()) expect(isPseudo(logicLine(line)), line).toBe(true)
      expect(isPseudo(caseRowTitle({ item: 'icon', title: 'Icon' }))).toBe(true)
      for (const k of POWER_UPS) expect(isPseudo(caseRowTitle({ item: k, title: k }))).toBe(true)
    } finally {
      setLocaleMessages({ id: 'en', messages: {} })
    }
    expect(src('components/JanuaryWindow.tsx')).toContain('{logicLine(paceLine(f, totalGames, teams))}')
    expect(src('components/ItemReel.tsx')).toContain('caseRowTitle({ item: c.key, title: c.label })')
  })
})

describe('R11-9: “Where does he play?” takes the focus from the row that opened it', () => {
  it('the first slot choice (or Send him to the bench) is focused when the choice opens from a squad row', () => {
    const draft = src('screens/Draft.tsx')
    const effect = draft.split('const slotChoicesRef = useRef<HTMLDivElement>(null)')[1].split('}, [selectedPlayer])')[0]
    expect(effect).toMatch(/document\.activeElement\?\.closest\('\.prow'\)/)
    expect(effect).toMatch(/querySelector<HTMLElement>\('\[data-testid="slot-chip"\], \[data-testid="to-bench"\]'\)\?\.focus\(\{ preventScroll: true \}\)/)
  })
})

describe('R11-10: the arena’s banner, the Gauntlet’s ladder ends and a club’s way of playing in the viewer’s language', () => {
  const tiers = Object.keys(ARENA_TIER_LABEL) as ArenaTier[]
  const styles = Object.keys(STYLE_LABEL) as PlayStyle[]

  it('say the engine’s English word for word in English', () => {
    for (const tier of tiers) for (const score of [0, 1, 2, 7, 15]) expect(arenaTierText(tier, score)).toBe(arenaTierLabel(tier, score))
    for (let rung = 1; rung <= GAUNTLET_RUNGS; rung++) if (rung === 1 || !/^top /.test(rungBandLabel(rung))) expect(gauntletBandText(rung)).toBe(rungBandLabel(rung))
    for (const k of styles) expect(playStyleLabel(k)).toBe(STYLE_LABEL[k])
  })

  it('are translated in the pseudo-locale, and the screens read them', () => {
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    try {
      for (const tier of tiers) expect(isPseudo(arenaTierText(tier, 3)), tier).toBe(true)
      for (let rung = 1; rung <= GAUNTLET_RUNGS; rung++) expect(isPseudo(gauntletBandText(rung)), `rung ${rung}`).toBe(true)
      for (const k of styles) expect(isPseudo(playStyleLabel(k)), k).toBe(true)
    } finally {
      setLocaleMessages({ id: 'en', messages: {} })
    }
    expect(src('screens/ArenaSummary.tsx')).toMatch(/\{bannerText\}/)
    expect(src('screens/ProfileScreen.tsx')).not.toContain('arenaTierLabel(')
    for (const f of ['screens/Dugout.tsx', 'screens/OppositionReport.tsx']) expect(src(f)).not.toContain('STYLE_LABEL[')
  })
})

describe('R11-11: the market’s log and a scouting range’s tip in the viewer’s language', () => {
  it('every line the window’s log is opened or grown with is a logicText message, read back as written', () => {
    const lines = ['The January window is open. 36 players are available.', 'The summer window is open. 1 players are available.', '1 new player listed: Harry Kane.', '3 new players listed: A. B, C. D, E. F.']
    for (const line of lines) {
      const hit = matchLogicLine(line)
      expect(hit, line).not.toBeNull()
      expect(formatText(logicText.messages[hit!.key as keyof typeof logicText.messages], hit!.vars)).toBe(line)
    }
    expect(src('../engine/market.ts')).toContain("log: [`The ${kind === 'summer' ? 'summer' : 'January'} window is open. ${listings.length} players are available.`]")
    expect(src('../engine/market.ts')).toContain("`${extra.length} new player${extra.length > 1 ? 's' : ''} listed: ${extra.map((l) => u.index[l.playerSeasonId]?.name).join(', ')}.`")
    expect(src('screens/Dugout.tsx')).toMatch(/\{w\.log\.map\(\(l, i\) => \(\s+<div key=\{i\} className="muted">\s+\{logicLine\(l\)\}/)
  })

  it('the rating range’s tip goes through the catalogue', () => {
    expect(src('components/bits.tsx')).not.toContain('scout him to know')
    expect(src('components/bits.tsx')).toContain("t('ratingRangeTip', { lo: range.lo, hi: range.hi })")
  })
})

describe('R11-12: the playback’s points gap in the viewer’s language', () => {
  it('every gap the logic writes is a logicText message, read back as written, and translated in the pseudo-locale', () => {
    const row = (teamId: string, points: number): LiveRow => ({ teamId, points, played: 10, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 })
    const lines = new Set<string>()
    for (let me = 0; me < 8; me++) for (const step of [0, 1, 3]) {
      const table = Array.from({ length: 8 }, (_, i) => row(i === me ? 'you' : `c${i}`, 40 - i * step))
      const line = gapLine(table, 'you')
      if (line) lines.add(line)
    }
    expect(lines.size).toBeGreaterThan(5)
    for (const line of lines) {
      const hit = matchLogicLine(line)
      expect(hit, line).not.toBeNull()
      expect(hit!.key.startsWith('liveTable_'), line).toBe(true)
      expect(formatText(logicText.messages[hit!.key as keyof typeof logicText.messages], hit!.vars)).toBe(line)
    }
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    try {
      for (const line of lines) expect(isPseudo(logicLine(line)), line).toBe(true)
    } finally {
      setLocaleMessages({ id: 'en', messages: {} })
    }
    expect(src('screens/SeasonPlayback.tsx')).toContain('{logicLine(gap)}')
  })
})

describe('R11-13: the head-to-head draft log in the viewer’s language', () => {
  it('every line of hot-seat drafts and their online rooms’ form is a logicText message, read back as written', () => {
    const u = loadTestUniverse(['england'])
    const lines = new Set<string>()
    for (const seed of ['r11-h2h-a', 'r11-h2h-b', 'r11-h2h-c']) {
      const h = newH2HDraft([getFormation('4-3-3'), getFormation('3-5-2')], h2hRules(['england'], false))
      const rng = new Rng(seed)
      for (let i = 0; i < 80 && !h2hComplete(h); i++) {
        if (!h.current) h2hSpin(u, h, rng)
        h2hAutoPick(u, h)
        if (h.current) h2hAutoPick(u, h)
      }
      for (const l of h.log) {
        lines.add(l)
        lines.add(roomLogLine(l, [{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'everton' }, { name: 'Bob Dee', shortName: 'BOB', formationId: '3-5-2', hostClubId: 'fulham' }]))
      }
    }
    expect(lines.size).toBeGreaterThan(40)
    for (const line of lines) {
      const hit = matchLogicLine(line)
      expect(hit, line).not.toBeNull()
      expect(formatText(logicText.messages[hit!.key as keyof typeof logicText.messages], hit!.vars)).toBe(line)
    }
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    try {
      for (const line of lines) expect(isPseudo(logicLine(line)), line).toBe(true)
    } finally {
      setLocaleMessages({ id: 'en', messages: {} })
    }
    // Both draft logs are the shared box (round 13), which says each line through logicLine; the room's in its own form
    expect(src('components/H2HBoard.tsx')).toContain('<li key={i}>{logicLine(l)}</li>')
    expect(src('screens/H2H.tsx')).toContain('log={d.log}')
    expect(src('online/Rooms.tsx')).toContain('log={d.log.map((l) => roomLogLine(l, view.managers))}')
  })
})
