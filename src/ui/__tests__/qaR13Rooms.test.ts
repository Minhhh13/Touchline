/**
 * QA round 9 (r13, docs/QA.md): the room code box over what round 12 changed (`roomCodeFrom`'s `%23` and full-width
 * input, R11-O2). A sweep of 4,000 pastes built at random from the invite as the game writes it, a link and a typed
 * code, each passed through what a phone, a messaging app or a Japanese keyboard does to text (URL encoding whole or
 * as a form, full-width letters, a dash swapped for an en dash or the katakana long mark, cut at the box's length),
 * must read as the room's code whenever the code survived; text with no code must read as none.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Rng } from '@engine/rng'
import { ROOM_CODE_INPUT_MAX, roomCodeFrom, roomInviteText } from '../../online/rooms'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const NAME_PARTS = ['Alexander', 'Arnoldsson', 'Mia', 'Christopher', 'Wellington', 'José', 'Ødegaard', 'Lee', 'Nguyễn', 'O’Brien', 'Saint-Maximin']

const fullWidth = (s: string) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))

function paste(rng: Rng, code: string): string {
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
  const name = () => Array.from({ length: rng.int(1, 3) }, () => rng.pick(NAME_PARTS)).join(' ').slice(0, 24)
  const link = `https://touchline.quest/#h=${rng.next() < 0.5 ? code : pretty}`
  const kind = rng.int(0, 5)
  let text =
    kind === 0 ? pretty
    : kind === 1 ? link
    : kind === 2 ? roomInviteText(rng.next() < 0.7 ? name() : null, code)
    : kind === 3 ? roomInviteText(name(), code, { of: 'AAAABBBB', opponent: rng.next() < 0.7 ? name() : null })
    : `${roomInviteText(name(), code, rng.next() < 0.5 ? { of: 'AAAABBBB', opponent: name() } : null)} ${link}`
  // What the way it travelled did to it
  const dash = rng.int(0, 3)
  if (dash === 1) text = text.replace(pretty, `${code.slice(0, 4)}–${code.slice(4)}`)
  if (dash === 2) text = text.replace(pretty, `${code.slice(0, 4)}ー${code.slice(4)}`)
  const wrap = rng.int(0, 4)
  if (wrap === 1) text = encodeURIComponent(text)
  else if (wrap === 2) text = encodeURIComponent(text).replace(/%20/g, '+')
  else if (wrap === 3) text = fullWidth(text)
  // The box keeps what fits
  text = text.slice(0, ROOM_CODE_INPUT_MAX)
  return text
}

describe('the room code box (R13-2, R13-3)', () => {
  it('reads the code from 4,000 pastes as phones and keyboards send them', () => {
    const rng = new Rng('qa-r13-room-paste')
    const wrong: string[] = []
    for (let i = 0; i < 4000; i++) {
      const code = Array.from({ length: 8 }, () => rng.pick([...ALPHABET])).join('')
      const text = paste(rng, code)
      const got = roomCodeFrom(text)
      if (got !== code) wrong.push(`${JSON.stringify(text)} -> ${got} (want ${code})`)
    }
    expect(wrong.slice(0, 8)).toEqual([])
  })

  it('reads a rematch invite with two 24-letter names, URL-encoded and cut at the old 200 characters', () => {
    const invite = `${roomInviteText('Alexander Arnoldssonxxxx', 'K7Q2MX9A', { of: 'AAAABBBB', opponent: 'Christopher Wellingtonxx' })} https://touchline.quest/#h=K7Q2MX9A`
    const encoded = encodeURIComponent(invite)
    expect(encoded.length).toBeGreaterThan(200)
    expect(encoded.length).toBeLessThanOrEqual(ROOM_CODE_INPUT_MAX)
    expect(roomCodeFrom(encoded)).toBe('K7Q2MX9A')
    // A cut inside an escape ("%2") or a broken multi-byte escape no longer hides the printed code
    for (let n = 150; n <= 200; n++) {
      const cut = encoded.slice(0, n)
      if (cut.includes('K7Q2-MX9A')) expect(roomCodeFrom(cut), cut).toBe('K7Q2MX9A')
    }
    expect(roomCodeFrom('Room%20K7Q2-MX9A%2C%E0%A4 no account')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('Room K7Q2–MX9A, no account needed.')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('Room K7Q2−MX9A')).toBe('K7Q2MX9A')
  })

  it('still reads no code in text without one', () => {
    for (const x of ['head-to-head', 'Join me for a TouchLine head-to-head – no account needed.', '100% fun', '%E2%80%93', 'NICE–ROOM', 'Join%20me', 'ｈｅｌｌｏ　ｗｏｒｌｄ', 'twenty-five-a-side']) expect(roomCodeFrom(x), x).toBeNull()
  })

  it('both code boxes take the longer paste', () => {
    const src = readFileSync('src/ui/online/Rooms.tsx', 'utf8')
    expect(src.match(/maxLength=\{ROOM_CODE_INPUT_MAX\}/g)?.length).toBe(2)
    expect(src).not.toMatch(/placeholder="K7Q2-MX9A" maxLength=\{\d+\}/)
  })
})

describe('the rematch paste box (R13-4)', () => {
  it('keeps the code whole and lets a longer button wrap under it', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8')
    const row = /\.room-join-rematch \.row \{([^}]*)\}/.exec(css)?.[1] ?? ''
    const input = /\.room-join-rematch \.input \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(row).toMatch(/flex-wrap: wrap/)
    expect(input).toMatch(/min-width: calc\(9ch \+ 28px\)/)
    expect(input).not.toMatch(/min-width: 0/)
  })
})
