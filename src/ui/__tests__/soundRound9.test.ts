import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIERS } from '@game/logic/rarity'
import { CATEGORY, CLICK_LEVEL, DRAFT_LEVEL, FANFARE_LEVEL, LANDING_LEVEL, scoreFor, type Score, type SoundRequest, type Voice } from '../sound/scores'
import { cueScore } from '../sound/voices'
import { CUE_CATEGORY, CUE_GAP_MS } from '../sound/cues'
import { SEASON_CATEGORY, SEASON_MAX_LEVEL, seasonScoreFor, type SeasonSoundRequest } from '../sound/seasonScores'
import { VOLUME_EXPONENT, volumeGain } from '../sound/prefs'
import { CUE_REQUESTS } from './cueRequests'

/*
 * Round 9's sound pass (everything but the match day): a warmer palette, levels balanced across the categories, a
 * perceptual volume slider, and every cue through its switch and its gap, never before a gesture.
 */

/** The palette's sounds this round owns (the match day's whistle, goal, ooh, save, card and sub are another session's). */
const DRAFT_AND_REWARD: SoundRequest[] = [
  ...TIERS.map((tier): SoundRequest => ({ id: 'landing', tier })),
  { id: 'pick' },
  { id: 'upgrade', won: true },
  { id: 'upgrade', won: false },
  { id: 'fanfare', treble: false },
  { id: 'fanfare', treble: true },
  ...(['A', 'B', 'C', 'D'] as const).map((grade): SoundRequest => ({ id: 'grade', grade })),
  { id: 'click' },
  { id: 'tick', rate: 1 },
  { id: 'whoosh' },
  { id: 'pop' },
]
const MATCH_CUES = new Set(['kick', 'ball', 'crowd-swell', 'crowd-bed'])
const OWN_CUES = CUE_REQUESTS.filter((r) => !MATCH_CUES.has(r.id))
const SEASON: SeasonSoundRequest[] = [
  { id: 'result', outcome: 'W' },
  { id: 'result', outcome: 'D' },
  { id: 'result', outcome: 'L' },
  { id: 'result', outcome: 'W', thin: true },
  { id: 'goals', goals: 3 },
  { id: 'batch', won: 3, drawn: 1, lost: 1 },
  { id: 'batch', won: 0, drawn: 1, lost: 4 },
  { id: 'tension', level: 1, dur: 1 },
  { id: 'halfway' },
  ...(['perfect-alive', 'perfect-broken', 'top4', 'top', 'title', 'relegated'] as const).map((kind): SeasonSoundRequest => ({ id: 'stinger', kind })),
  ...(['champion', 'top4', 'mid', 'drop'] as const).map((finish): SeasonSoundRequest => ({ id: 'season-end', finish, perfect: false })),
]
const named = (r: object) => JSON.stringify(r)

/** The tones' brightness: their mean frequency weighted by how much each sounds (peak times length). */
function brightness(voices: readonly Voice[]): number {
  let w = 0
  let f = 0
  for (const v of voices) {
    if (v.kind !== 'tone') continue
    const k = v.peak * v.dur
    w += k
    f += k * v.freq
  }
  return w ? f / w : 0
}
const owned = (): Array<{ name: string; s: Pick<Score, 'voices' | 'level'> }> => [
  ...DRAFT_AND_REWARD.map((r) => ({ name: named(r), s: scoreFor(r) })),
  ...OWN_CUES.map((r) => ({ name: named(r), s: cueScore(r) })),
  ...SEASON.map((r) => ({ name: named(r), s: seasonScoreFor(r) })),
]

describe('round 9: a warmer palette', () => {
  it('never starts a note with a click: every tone rises over at least 1.5 ms, every noise over 1 ms', () => {
    for (const { name, s } of owned()) for (const v of s.voices) expect(v.attack, name).toBeGreaterThanOrEqual(v.kind === 'tone' ? 0.0015 : 0.001)
  })

  it('sits in the warm middle: the tones’ weighted pitch under 1.6 kHz in every sound, under 1 kHz on average', () => {
    const all = owned().map(({ name, s }) => ({ name, b: brightness(s.voices) }))
    for (const { name, b } of all) expect(b, name).toBeLessThan(1600)
    const mean = all.reduce((m, x) => m + x.b, 0) / all.length
    expect(mean).toBeLessThan(1000)
  })

  it('keeps the glints a garnish: the tones above 2 kHz never carry a fifth of a sound’s weight', () => {
    for (const { name, s } of owned()) {
      const tones = s.voices.filter((v) => v.kind === 'tone')
      const total = tones.reduce((m, v) => m + v.peak * v.dur, 0)
      const high = tones.filter((v) => v.kind === 'tone' && v.freq > 2000).reduce((m, v) => m + v.peak * v.dur, 0)
      if (total) expect(high / total, name).toBeLessThan(0.2)
    }
  })

  it('ticks the reel with a soft knock near 2 kHz (it was a 3.2 kHz click), a falling tock under it', () => {
    for (const rate of [0.92, 1, 1.08]) {
      const v = scoreFor({ id: 'tick', rate }).voices
      const knock = v.find((x) => x.kind === 'noise')
      expect(knock && knock.kind === 'noise' && knock.freq).toBeLessThan(2500)
      const tock = v.find((x) => x.kind === 'tone')
      expect(tock && tock.kind === 'tone' && (tock.glideTo ?? 0) < tock.freq).toBe(true)
    }
    // The rate is rounded, so a run of ticks builds few scores, and an out-of-range rate is held
    expect(scoreFor({ id: 'tick', rate: 1.001 }).voices).toEqual(scoreFor({ id: 'tick', rate: 1 }).voices)
    expect(scoreFor({ id: 'tick', rate: 9 }).voices).toEqual(scoreFor({ id: 'tick', rate: 1.3 }).voices)
    expect(CATEGORY.tick).toBe('draft')
    expect(CATEGORY.whoosh).toBe('draft')
    expect(CATEGORY.pop).toBe('draft')
  })
})

describe('round 9: the balance across categories', () => {
  it('steps up from the interface to the draft to the rewards, the season far under them all', () => {
    const ui = [...OWN_CUES.filter((r) => CUE_CATEGORY[r.id] === 'ui').map((r) => cueScore(r).level), CLICK_LEVEL]
    // Every draft sound but the other seat's turn (the quiet one by design: it is not this screen's pick)
    const draftMoments = [...OWN_CUES.filter((r) => CUE_CATEGORY[r.id] === 'draft' && !(r.id === 'turn' && !r.mine)).map((r) => cueScore(r).level), DRAFT_LEVEL.pick, ...Object.values(LANDING_LEVEL)]
    expect(Math.max(...ui)).toBeLessThan(Math.min(...draftMoments) / 1.6)
    // The reel's rattle sits under the landing it leads to
    for (const k of ['tick', 'whoosh', 'pop'] as const) expect(DRAFT_LEVEL[k]).toBeLessThan(LANDING_LEVEL.blue)
    // A gold landing is a big moment, but a trophy is bigger
    expect(Math.max(...draftMoments)).toBeLessThan(FANFARE_LEVEL.cup)
    expect(FANFARE_LEVEL.cup).toBeLessThan(FANFARE_LEVEL.treble)
    expect(SEASON_MAX_LEVEL).toBeLessThanOrEqual(FANFARE_LEVEL.cup / 1.6)
    // The volume's reference note is the everyday pick's level
    expect(cueScore({ id: 'volume' }).level).toBe(DRAFT_LEVEL.pick)
  })
})

describe('round 9: the perceptual volume', () => {
  it('is silent at 0 and full at 100, rising smoothly, with half way about half as loud (-10 dB)', () => {
    expect(volumeGain(0)).toBe(0)
    expect(volumeGain(100)).toBe(1)
    let prev = -1
    for (let p = 0; p <= 100; p += 5) {
      expect(volumeGain(p)).toBeGreaterThan(prev)
      prev = volumeGain(p)
    }
    const db = (p: number) => 20 * Math.log10(volumeGain(p))
    expect(db(50)).toBeGreaterThan(-11)
    expect(db(50)).toBeLessThan(-9)
    expect(db(10)).toBeLessThan(-30)
    // Equal steps of the slider are equal steps of loudness (gain to the power 0.6)
    const loud = (p: number) => Math.pow(volumeGain(p), 1 / VOLUME_EXPONENT)
    for (let p = 5; p <= 100; p += 5) expect(loud(p) - loud(p - 5)).toBeCloseTo(0.05, 9)
    // Out of range is held, as the stored figure is
    expect(volumeGain(250)).toBe(1)
    expect(volumeGain(-5)).toBe(0)
  })
})

// ---- The live rules, on a fake Web Audio ------------------------------------------------------------------

class FakeParam {
  value = 0
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v
  }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  Q = new FakeParam()
  playbackRate = new FakeParam()
  curve: Float32Array | null = null
  oversample = 'none'
  type = ''
  buffer: unknown = null
  loop = false
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
  addEventListener() {}
}
let sources = 0
const made: FakeContext[] = []
class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 0
  sampleRate = 8000
  destination = new FakeNode()
  constructor() {
    made.push(this)
  }
  createGain() {
    return new FakeNode()
  }
  createWaveShaper() {
    return new FakeNode()
  }
  createBiquadFilter() {
    return new FakeNode()
  }
  createOscillator() {
    sources++
    return new FakeNode()
  }
  createBufferSource() {
    sources++
    return new FakeNode()
  }
  createBuffer(_c: number, n: number) {
    const data = new Float32Array(n)
    return { getChannelData: () => data }
  }
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

async function freshSynth(activated = true) {
  vi.resetModules()
  made.length = 0
  sources = 0
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  const activation = { hasBeenActive: activated }
  vi.stubGlobal('navigator', { userActivation: activation })
  const listeners = new Map<string, Array<(e: Event) => void>>()
  vi.stubGlobal('window', { AudioContext: FakeContext, addEventListener: (type: string, l: (e: Event) => void) => listeners.set(type, [...(listeners.get(type) ?? []), l]) })
  const gesture = (trusted = true) => listeners.get('pointerdown')?.forEach((l) => l({ isTrusted: trusted, target: null } as unknown as Event))
  const prefs = await import('../sound/prefs')
  const synth = await import('../sound/synth')
  const seasons = await import('../sound/seasonScores')
  synth.armAudio()
  return { prefs, synth, seasons, gesture, activation }
}

/** Lets the cues' voices chunk (a dynamic import on the first gesture) arrive. */
async function voicesIn() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('round 9: nothing before a gesture, every cue through its switch and its gap', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes no context and plays nothing before a real gesture: not on a script’s click, not before the page has been used', async () => {
    const { synth, gesture, activation, prefs } = await freshSynth(false)
    expect(synth.playSound({ id: 'pick' })).toEqual([])
    expect(synth.playTick(0, 1)).toBeNull()
    gesture()
    expect(made.length).toBe(0)
    // Turning the volume or a switch is no gesture of its own while the page has had none
    prefs.setSoundVolume(30)
    prefs.setSoundOn(true)
    expect(made.length).toBe(0)
    // A synthetic event never unlocks, even once the page has been used
    activation.hasBeenActive = true
    gesture(false)
    expect(made.length).toBe(0)
    // Once it has, the switch's own press makes the context
    prefs.setSoundVolume(40)
    expect(made.length).toBe(1)
    expect(synth.liveAudio()).not.toBeNull()
  })

  it('plays the palette and the reel only while their switch is on', async () => {
    const { synth, prefs, gesture } = await freshSynth()
    gesture()
    expect(made.length).toBe(1)
    prefs.setDraftSoundOn(false)
    expect(synth.playSound({ id: 'pick' })).toEqual([])
    expect(synth.playTick(0, 1)).toBeNull()
    expect(synth.playWhoosh(0)).toBeNull()
    expect(synth.playPop(0)).toBeNull()
    const before = sources
    synth.playDialTick(1)
    expect(sources).toBe(before)
    prefs.setDraftSoundOn(true)
    expect(synth.playSound({ id: 'pick' }).length).toBeGreaterThan(0)
    expect(synth.playTick(0, 1)).not.toBeNull()
    expect(synth.playWhoosh(0)).not.toBeNull()
    expect(synth.playPop(0)).not.toBeNull()
    prefs.setUiSoundOn(false)
    expect(synth.playSound({ id: 'click' })).toEqual([])
    prefs.setUiSoundOn(true)
    expect(synth.playSound({ id: 'click' }).length).toBeGreaterThan(0)
  })

  it('plays every cue only while its switch is on, and a second one inside its gap not at all', async () => {
    const { synth, prefs, gesture } = await freshSynth()
    gesture()
    await voicesIn()
    const setters = { match: prefs.setMatchSoundOn, draft: prefs.setDraftSoundOn, ui: prefs.setUiSoundOn } as const
    const seen = new Set<string>()
    for (const req of CUE_REQUESTS) {
      if (seen.has(req.id)) continue
      seen.add(req.id)
      const cat = CUE_CATEGORY[req.id]
      if (cat !== 'reward') {
        setters[cat](false)
        expect(synth.playSound(req), named(req)).toEqual([])
        setters[cat](true)
      }
      expect(synth.playSound(req).length, named(req)).toBeGreaterThan(0)
      if ((CUE_GAP_MS[req.id] ?? 0) > 20) expect(synth.playSound(req), named(req)).toEqual([])
    }
    // A reward follows the master alone: every other switch off, it still plays
    prefs.setMatchSoundOn(false)
    prefs.setDraftSoundOn(false)
    prefs.setUiSoundOn(false)
    expect(synth.playSound({ id: 'fanfare', treble: false }).length).toBeGreaterThan(0)
    expect(synth.playSound({ id: 'fanfare', treble: false })).toEqual([])
    prefs.setSoundOn(false)
    expect(synth.playSound({ id: 'landing', tier: 'gold' })).toEqual([])
  })

  it('plays the season’s cues through their switch and their gap: the games on Match sounds, the big moments on Sound alone', async () => {
    const { synth, prefs, seasons, gesture } = await freshSynth()
    gesture()
    const play = (r: SeasonSoundRequest) => synth.playScore(seasons.seasonScoreFor(r))
    prefs.setMatchSoundOn(false)
    for (const r of SEASON) {
      if (SEASON_CATEGORY[r.id] === 'match') expect(play(r), named(r)).toEqual([])
    }
    expect(play({ id: 'stinger', kind: 'title' }).length).toBeGreaterThan(0)
    prefs.setMatchSoundOn(true)
    expect(play({ id: 'result', outcome: 'W' }).length).toBeGreaterThan(0)
    // A double inside the gap is dropped; another cue is not
    expect(play({ id: 'result', outcome: 'L' })).toEqual([])
    expect(play({ id: 'goals', goals: 2 }).length).toBeGreaterThan(0)
    // The batch and its closing stinger of one step are different cues, so both sound
    expect(play({ id: 'batch', won: 2, drawn: 0, lost: 0 }).length).toBeGreaterThan(0)
    // Two stingers in one breath (never one step's) play once
    expect(play({ id: 'stinger', kind: 'relegated' })).toEqual([])
    for (const id of Object.keys(SEASON_CATEGORY)) if (id !== 'tension') expect(CUE_GAP_MS[`season:${id}`], id).toBeGreaterThan(0)
  })

  it('caps the Upgrader dial at one tick each 15 ms, as the reel is', async () => {
    const { synth, gesture } = await freshSynth()
    gesture()
    // The page's clock held in hand: on a loaded machine three real calls can be more than 15 ms apart (r10)
    let t = 1000
    const now = vi.spyOn(performance, 'now').mockImplementation(() => t)
    const before = sources
    synth.playDialTick(1)
    const one = sources - before
    expect(one).toBeGreaterThan(0)
    t += 5
    synth.playDialTick(1)
    t += 9
    synth.playDialTick(1.1)
    expect(sources - before).toBe(one)
    // The first tick past the gap sounds again
    t += 1
    synth.playDialTick(1)
    expect(sources - before).toBe(2 * one)
    now.mockRestore()
    expect(synth.DIAL_TICK_GAP_MS).toBe(15)
  })
})
