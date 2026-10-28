import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { CUE_CATEGORY, CUE_GAP_MS, PICK_BANDS, isCue, makeThinner, newlyEarned, pickBand, toastTone, type CueId, type CueRequest } from '../sound/cues'
import { CUE_LEVEL, CUE_MAX_LEVEL, cueScore } from '../sound/voices'
import { CATEGORY, FLOOR, envAt, peakOf, scoreFor, scoreLength } from '../sound/scores'
import { categoryOn, parseVolume, setDraftSoundOn, setMatchSoundOn, setSoundVolume, setUiSoundOn, soundVolume } from '../sound/prefs'
import { MASTER_GAIN, gainNow, playSound } from '../sound/synth'
import { CUE_REQUESTS } from './cueRequests'

const name = (r: CueRequest) => JSON.stringify(r)
const level = (r: CueRequest) => cueScore(r).level
const len = (r: CueRequest) => scoreLength(cueScore(r).voices)

describe('the second pass’s cues', () => {
  it('asks for every cue at least once in the tests, and each one has a switch', () => {
    const ids = new Set(CUE_REQUESTS.map((r) => r.id))
    expect([...ids].sort()).toEqual(Object.keys(CUE_CATEGORY).sort())
    for (const id of Object.keys(CUE_CATEGORY)) {
      expect(isCue(id)).toBe(true)
      // A cue never shares a name with a palette sound, so a request means one thing
      expect(Object.keys(CATEGORY)).not.toContain(id)
    }
    expect(isCue('goal')).toBe(false)
  })

  it('is a well-formed, normalised score: voices rise and fall inside their length, from silence to silence', () => {
    for (const req of CUE_REQUESTS) {
      const s = cueScore(req)
      expect(s.id, name(req)).toBe(req.id)
      expect(s.category, name(req)).toBe(CUE_CATEGORY[req.id])
      expect(s.voices.length, name(req)).toBeGreaterThan(0)
      expect(peakOf(s.voices), name(req)).toBeCloseTo(s.level, 6)
      for (const v of s.voices) {
        expect(v.at, name(req)).toBeGreaterThanOrEqual(0)
        expect(v.attack, name(req)).toBeGreaterThan(0)
        expect(v.attack + (v.hold ?? 0), name(req)).toBeLessThan(v.dur)
        expect(envAt(v, v.at + v.dur)).toBeLessThanOrEqual(FLOOR * 1.0001)
        const freqs = v.kind === 'noise' ? [v.freq, v.freqTo ?? v.freq] : [v.freq, v.kind === 'tone' ? (v.glideTo ?? v.freq) : v.freq]
        for (const f of freqs) {
          expect(f, name(req)).toBeGreaterThanOrEqual(20)
          expect(f, name(req)).toBeLessThanOrEqual(16000)
        }
      }
      expect(cueScore(req)).toEqual(cueScore(req))
    }
  })

  it('stays short and quiet: under the match’s goal, the interface barely there', () => {
    const goal = scoreFor({ id: 'goal', tone: 'ours' }).level
    const theirs = scoreFor({ id: 'goal', tone: 'theirs' }).level
    for (const req of CUE_REQUESTS) {
      expect(level(req), name(req)).toBeLessThanOrEqual(CUE_MAX_LEVEL)
      expect(level(req), name(req)).toBeLessThan(goal)
      // The crowd's bed is the one long cue: laid end over end under the play (useBallSounds), never a moment
      expect(len(req), name(req)).toBeLessThan(req.id === 'crowd-bed' ? 5 : 2)
    }
    // The arena's kicks sit under the match's crowd, even a goal of theirs
    for (const req of CUE_REQUESTS.filter((r) => r.id === 'kick')) expect(level(req)).toBeLessThan(theirs + 0.05)
    for (const req of CUE_REQUESTS.filter((r) => CUE_CATEGORY[r.id] === 'ui')) {
      expect(level(req), name(req)).toBeLessThanOrEqual(scoreFor({ id: 'click' }).level + 0.01)
      expect(len(req), name(req)).toBeLessThan(0.4)
    }
    expect(len({ id: 'tab' })).toBeLessThan(0.05)
    expect(level({ id: 'tab' })).toBeLessThan(level({ id: 'toast' }))
    expect(level({ id: 'toast' })).toBeLessThan(level({ id: 'error' }))
    expect(level({ id: 'turn', mine: false })).toBeLessThan(level({ id: 'turn', mine: true }))
    expect(level({ id: 'bracket-tie', user: false })).toBeLessThan(level({ id: 'bracket-tie', user: true }))
    expect(level({ id: 'kick', scored: true, ours: true })).toBeGreaterThan(level({ id: 'kick', scored: true, ours: false }))
  })

  it('a pick rises with his band: louder, more voices and a higher top note each band up', () => {
    const bands = ['squad', 'solid', 'star', 'world'] as const
    const top = (r: CueRequest) => Math.max(...cueScore(r).voices.filter((v) => v.kind === 'tone' && v.peak > 0.02).map((v) => (v.kind === 'tone' ? v.freq : 0)))
    for (let i = 1; i < bands.length; i++) {
      const lo: CueRequest = { id: 'pick-band', band: bands[i - 1] }
      const hi: CueRequest = { id: 'pick-band', band: bands[i] }
      expect(level(hi)).toBeGreaterThan(level(lo))
      expect(cueScore(hi).voices.length).toBeGreaterThan(cueScore(lo).voices.length)
      expect(top(hi)).toBeGreaterThanOrEqual(top(lo))
    }
    expect(CUE_LEVEL.pickBand.world).toBeLessThanOrEqual(CUE_MAX_LEVEL)
  })

  it('reads the band from the overall, at the edges', () => {
    expect(pickBand(95)).toBe('world')
    expect(pickBand(88)).toBe('world')
    expect(pickBand(87)).toBe('star')
    expect(pickBand(83)).toBe('star')
    expect(pickBand(82)).toBe('solid')
    expect(pickBand(77)).toBe('solid')
    expect(pickBand(76)).toBe('squad')
    expect(pickBand(40)).toBe('squad')
    expect(PICK_BANDS.map(([, min]) => min)).toEqual([...PICK_BANDS.map(([, min]) => min)].sort((a, b) => b - a))
  })

  it('climbs the scale a rung at a time', () => {
    const first = (rung: number) => Math.min(...cueScore({ id: 'rung', rung }).voices.flatMap((v) => (v.kind === 'tone' && v.at > 0 ? [v.freq] : [])))
    for (let r = 1; r < 15; r++) expect(first(r)).toBeGreaterThan(first(r - 1))
    // Out of range is held at the ends
    expect(first(40)).toBe(first(14))
    expect(first(-3)).toBe(first(0))
  })

  it('drops the shimmer with reduced motion, as the first pass does, and keeps the rest', () => {
    const pairs: Array<[CueRequest, CueRequest]> = [
      [{ id: 'pick-band', band: 'world' }, { id: 'pick-band', band: 'world', reduced: true }],
      [{ id: 'hindsight', perfect: true }, { id: 'hindsight', perfect: true, reduced: true }],
      [{ id: 'squad-complete' }, { id: 'squad-complete', reduced: true }],
      [{ id: 'bonus' }, { id: 'bonus', reduced: true }],
      [{ id: 'badge' }, { id: 'badge', reduced: true }],
    ]
    for (const [full, reduced] of pairs) {
      expect(cueScore(reduced).voices.length, name(full)).toBeLessThan(cueScore(full).voices.length)
      expect(cueScore(reduced).voices.length, name(full)).toBeGreaterThan(0)
      // What goes is the shimmer: high pings only, at the end of the score
      const gone = cueScore(full).voices.slice(cueScore(reduced).voices.length)
      expect(gone.every((v) => v.kind === 'tone' && v.freq > 2000), name(full)).toBe(true)
    }
  })
})

describe('the thinning', () => {
  it('drops a rapid repeat of the same sound and lets it through once the gap has passed', () => {
    const allow = makeThinner({ tab: 110 })
    expect(allow('tab', 1000)).toBe(true)
    expect(allow('tab', 1050)).toBe(false)
    expect(allow('tab', 1100)).toBe(false)
    expect(allow('tab', 1110)).toBe(true)
    // A dropped repeat does not push the window on
    expect(allow('tab', 1150)).toBe(false)
    expect(allow('tab', 1220)).toBe(true)
  })

  it('never thins one sound for another, nor a sound with no gap (the match’s own cues)', () => {
    const allow = makeThinner()
    expect(allow('tab', 0)).toBe(true)
    expect(allow('toast', 1)).toBe(true)
    expect(allow('error', 2)).toBe(true)
    for (let t = 0; t < 100; t += 10) expect(allow('goal', t)).toBe(true)
    // A clock that went back (a new page's timer) never blocks forever
    expect(allow('tab', 5000)).toBe(true)
    expect(allow('tab', 10)).toBe(true)
  })

  it('has a gap for every interface and draft cue, so none can rattle', () => {
    for (const id of Object.keys(CUE_CATEGORY) as CueId[]) expect(CUE_GAP_MS[id], id).toBeGreaterThan(0)
    expect(CUE_GAP_MS.click).toBeGreaterThan(0)
  })
})

describe('the screens’ small decisions', () => {
  it('tells an error toast from a plain one by its words', () => {
    for (const t of ['Could not copy. Select the text manually.', 'Something went wrong: boom', 'Could not load league data: offline', 'Saka cannot play there. Pick a highlighted slot.', 'Not saving: this browser’s storage is full.']) expect(toastTone(t), t).toBe('error')
    for (const t of ['Link copied.', 'The coach marks will show again where they first appeared.', 'Saka in at RW, Bowen to the bench']) expect(toastTone(t), t).toBe('toast')
  })

  it('names the badges earned since they were last heard; nothing when none is new', () => {
    expect(newlyEarned(null, ['titles:bronze'])).toEqual(['titles:bronze'])
    expect(newlyEarned(['titles:bronze'], ['titles:bronze'])).toEqual([])
    expect(newlyEarned(['titles:bronze'], ['titles:silver', 'cups:bronze'])).toEqual(['titles:silver', 'cups:bronze'])
    expect(newlyEarned(['a:gold', 'b:gold'], [])).toEqual([])
  })
})

describe('the switches and the volume', () => {
  it('lets each category through only while its switch is on; rewards follow the master alone', () => {
    try {
      setMatchSoundOn(false)
      expect(categoryOn('match')).toBe(false)
      expect(categoryOn('draft')).toBe(true)
      setDraftSoundOn(false)
      expect(categoryOn('draft')).toBe(false)
      setUiSoundOn(false)
      expect(categoryOn('ui')).toBe(false)
      expect(categoryOn('reward')).toBe(true)
    } finally {
      setMatchSoundOn(true)
      setDraftSoundOn(true)
      setUiSoundOn(true)
    }
    expect(['match', 'draft', 'ui', 'reward'].every((c) => categoryOn(c as 'match'))).toBe(true)
  })

  it('reads a stored volume back as a whole per cent, the default for anything else', () => {
    expect(parseVolume(null)).toBe(100)
    expect(parseVolume('')).toBe(100)
    expect(parseVolume('nonsense')).toBe(100)
    expect(parseVolume('40')).toBe(40)
    expect(parseVolume('42.6')).toBe(43)
    expect(parseVolume('-5')).toBe(0)
    expect(parseVolume('250')).toBe(100)
  })

  it('scales the master by the volume and never above the first pass’s master', () => {
    try {
      setSoundVolume(50)
      expect(soundVolume()).toBe(50)
      expect(gainNow()).toBeCloseTo(MASTER_GAIN / 2, 9)
      setSoundVolume(0)
      expect(gainNow()).toBe(0)
      setSoundVolume(300)
      expect(gainNow()).toBeCloseTo(MASTER_GAIN, 9)
    } finally {
      setSoundVolume(100)
    }
  })

  it('plays nothing and throws nothing for any cue without Web Audio (node)', () => {
    for (const req of CUE_REQUESTS) expect(playSound(req)).toEqual([])
  })
})

describe('the first download', () => {
  it('loads the cues’ voices only with import(): no module imports voices.ts statically', () => {
    const root = path.resolve(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f)
        if (statSync(p).isDirectory()) {
          if (f !== '__tests__') walk(p)
        } else if (/\.tsx?$/.test(f)) files.push(p)
      }
    }
    walk(path.resolve(root, '..'))
    const statics = files.filter((f) => /^import [^\n]*from '[./]*(sound\/)?voices'/m.test(readFileSync(f, 'utf8')))
    expect(statics).toEqual([])
    expect(readFileSync(path.join(root, 'sound', 'synth.ts'), 'utf8')).toContain("import('./voices')")
  })
})
