import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roomCodeFrom, roomInviteText } from '../../online/rooms'

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
