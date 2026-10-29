import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roomCodeFrom, roomInviteText } from '../../online/rooms'
import { paceLine } from '@game/logic/gameByGame'
import { POWER_UPS } from '@engine/powerups'
import { formatText, setLocaleMessages } from '../i18n'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { logicText } from '../i18n/en/logicText'
import { logicLine, matchLogicLine } from '../i18n/logicText'
import { caseRowTitle } from '../i18n/engineText'

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
