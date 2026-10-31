import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import type { ClubSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { DRUM_LAND, dealReel, idleCards, type ReelCard, type ReelDeal } from '@game/logic/reel'
import type { DisplayTier } from '@game/logic/rarity'
import { ICONS_SEASON } from '@engine/icons'
import { clubName, seasonLabel, textColourFor } from '../format'
import { NeonFlow } from './Art'
import { EstimatedChip } from './bits'
import { startReelSound, type ReelSound } from '../sound/reel'
import { armAudio, unlockAudio } from '../sound/synth'
import { useSoundOn } from '../sound/prefs'
import { FULL_TIMING, OVERSHOOT, QUICK_TIMING, reelKeyframes, reelPosition, type ReelTiming } from '../reelCurve'
import { quickSpinPref, skipReelsPref, usePref } from '../viewerPrefs'
import { landedBefore, readLandedReel, reelMark, rememberLandedReel } from '../reelLanded'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'
import { reelTierName, tierColour, tierWord } from '../i18n/engineText'

const t = translator(draft)

/**
 * The timing lives in src/ui/reelCurve.ts: the season drum (DRUM_MS), the strip's start (SEASON_MS), its
 * slide with the overshoot and ease back (SPIN_MS, on STRIP_CURVE) and the reveal (SETTLE_MS, after a short
 * hold at rest). Quick spin and every re-spin run QUICK_TIMING. Change the curve and the measurements in
 * docs/GAME_DESIGN.md together.
 */
export { DRUM_MS, SEASON_MS, SPIN_MS, SETTLE_MS } from '../reelCurve'
const DRUM_EASE = 'cubic-bezier(0.2, 0.7, 0.25, 1)'
/** Reduced motion: no slide; the season shows at once and the landed card this long after. */
export const REDUCED_MS = 500

type Stage = 'season' | 'strip' | 'landed'

export interface CaseReelProps {
  u: LoadedUniverse
  /** The draft's leagues: the strip's clubs and the tier table come from these. */
  leagues: readonly string[]
  /** What the wheel could stop on this spin; those cards are lit, the rest dimmed. */
  pool: readonly ClubSeason[]
  /** The club-season the engine drew, or null between spins. */
  target: { clubId: string; season: number } | null
  /** Changes on every spin and re-spin, so landing on the same club-season twice still runs the reel. */
  spinKey: number
  /** Name of the twist on this spin ("Golden spin"), shown with the season. */
  twist?: string | null
  /** Called once per run, with its spinKey, when the strip lands (or the run is skipped to the landing). */
  onSettled?: (spinKey: number) => void
  /** The drawn club-season is a classic one: its ratings are TouchLine's estimate. */
  estimated?: boolean
  /**
   * The draft this reel belongs to (a game's id, the hot-seat's seed): a run that already landed for it on this device
   * shows landed at once after a reload, with no sound (`reelLanded.ts`). Without it every mount runs the reel.
   */
  scope?: string
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Sound on or off, beside the reel; the same setting as Profile's. Turning it on is a gesture, so it unlocks the audio too. */
export function SoundToggle() {
  const [on, setOn] = useSoundOn()
  return (
    <button type="button" className="reel-sound" data-testid="sound-toggle" aria-pressed={on} aria-label={t(on ? 'soundOnLabel' : 'soundOffLabel')} title={t(on ? 'mute' : 'soundOn')} onClick={(e) => { e.stopPropagation(); setOn(!on); if (!on) unlockAudio() }}>
      {on ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
    </button>
  )
}

/** "Gold · Elite" as a chip in its tier colour. */
export function TierChip({ tier }: { tier: DisplayTier }) {
  return (
    <span className="tier-chip" data-tier={tier} data-testid="tier-chip">
      {reelTierName(tier)}
    </span>
  )
}

/** A dot in the tier colour, for the draft log. */
export function TierDot({ tier }: { tier: DisplayTier }) {
  return <span className="tier-dot" data-tier={tier} role="img" aria-label={reelTierName(tier)} title={reelTierName(tier)} />
}

/** A season on the drum: "2017-18", or "Icons" for Gamble mode's Icons spin. */
function drumLabel(season: number): string {
  return season === ICONS_SEASON ? t('icons') : seasonLabel(season)
}

function Card({ c, landed }: { c: ReelCard; landed?: boolean }) {
  // The Icons card takes its look from the icons tier in styles.css, not from a club's colours
  const style = c.tier === 'icons' ? undefined : ({ background: c.colour, color: textColourFor(c.colour), '--secondary': c.secondary } as React.CSSProperties)
  return (
    <div className={`reel-card${c.lit ? '' : ' dim'}${landed ? ' landed' : ''}`} data-tier={c.tier} data-testid={c.tier === 'icons' ? 'icons-card' : undefined} style={style}>
      <span className="code">{c.code}</span>
      {c.league && <span className="lg">{c.league}</span>}
    </div>
  )
}

/**
 * The wheel as a case opening, season first. Each spin is its own run (keyed by
 * the spin), so nothing of the previous spin can show at the start of the next:
 *  1. the season drum rolls through the seasons this wheel could land on and stops on the drawn one;
 *  2. a strip of every club of that season slides under the marker and decelerates onto the drawn club,
 *     the ones the wheel could stop on lit, the rest dimmed;
 *  3. the landed card pops in its rarity colour and the result line shows club, season and tier.
 * A tap on the reel, or Space or Enter, skips to the landing. With reduced motion there is no slide.
 */
export function CaseReel(props: CaseReelProps) {
  const { target, spinKey } = props
  const runKey = target ? `${spinKey}:${target.clubId}@${target.season}` : ''
  // What the live region says, tagged with the run that said it, so a new run never repeats the last one's line
  const [said, setSaid] = useState({ run: '', text: '' })
  const announce = useCallback((text: string) => setSaid((s) => (s.run === runKey && s.text === text ? s : { run: runKey, text })), [runKey])
  // The Spin click (or key) is the gesture that creates the audio context, so listen before it lands
  useEffect(armAudio, [])
  // A re-spin replaces one drawn club-season with another, with no idle reel between: it runs quick, as does every run with Quick spin on
  const [quickSpin] = usePref(quickSpinPref)
  const [autoSkip] = usePref(skipReelsPref)
  const lastRun = useRef('')
  const respin = useRef({ run: '', quick: false })
  if (runKey && respin.current.run !== runKey) respin.current = { run: runKey, quick: lastRun.current !== '' }
  useEffect(() => {
    lastRun.current = runKey
  }, [runKey])
  const timing = quickSpin || (runKey && respin.current.quick) ? QUICK_TIMING : FULL_TIMING
  return (
    <div className="wheel-wrap reel-wrap" data-testid="case-reel">
      <SoundToggle />
      {target ? <ReelRun key={runKey} {...props} target={target} announce={announce} timing={timing} autoSkip={autoSkip} /> : <IdleReel u={props.u} leagues={props.leagues} pool={props.pool} />}
      {/* One live region for every run: the season once, then the club and its tier once, never the passing cards */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="reel-live">
        {target && said.run === runKey ? said.text : ''}
      </div>
    </div>
  )
}

/** Between spins: a still strip of clubs the next spin could land on. */
function IdleReel({ u, leagues, pool }: { u: LoadedUniverse; leagues: readonly string[]; pool: readonly ClubSeason[] }) {
  const cards = useMemo(() => idleCards(u, leagues, pool), [u, leagues, pool])
  return (
    <div className="reel-run idle" data-stage="idle">
      <div className="reel-season out">
        <span className="lbl">{t('ready')}</span>
        <div className="reel-drum-window">
          <div className="reel-drum">
            <div className="reel-drum-label">{t('spin')}</div>
          </div>
        </div>
      </div>
      <div className="reel-window" aria-hidden="true">
        <NeonFlow className="reel-accent" />
        <div className="reel-marker" />
        <div className="reel-strip">
          {cards.map((c) => (
            <Card key={c.key} c={c} />
          ))}
        </div>
      </div>
      <div className="reel-result" />
    </div>
  )
}

function ReelRun({ u, leagues, pool, target, spinKey, twist, onSettled, announce, estimated, scope, timing: runTiming, autoSkip }: CaseReelProps & { target: { clubId: string; season: number }; announce: (text: string) => void; timing: ReelTiming; autoSkip: boolean }) {
  // Dealt once per run; Math.random only shuffles cosmetic filler cards and the stop jitter, never the game
  const [deal] = useState<ReelDeal>(() => dealReel(u, { leagues, pool, target }, Math.random))
  const [reduced] = useState(prefersReducedMotion)
  // Fixed for the run: turning Quick spin on mid-run changes the next one
  const [timing] = useState(runTiming)
  // This run landed on this device before a reload: it mounts landed, with no slide and no sound
  const mark = scope ? reelMark(scope, spinKey, target) : ''
  const [already] = useState(() => landedBefore(mark, readLandedReel()))
  const [stage, setStage] = useState<Stage>(already ? 'landed' : 'season')
  const rootRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const drumRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<() => void>(() => undefined)
  const settled = useRef(false)
  const settledCb = useRef(onSettled)
  useLayoutEffect(() => {
    settledCb.current = onSettled
  })

  // Start the run before the first paint: the strip and the drum are measured and set off from zero
  useLayoutEffect(() => {
    const win = windowRef.current
    const strip = stripRef.current
    const drum = drumRef.current
    if (!win || !strip || !drum) return
    let alive = true
    const landCard = strip.children[deal.land] as HTMLElement | undefined
    // Where the strip stops, from the current layout: the landing card's centre (plus the jitter) under the marker
    const stripOffset = () => {
      const w = landCard?.offsetWidth ?? 0
      return landCard ? landCard.offsetLeft + w / 2 - win.clientWidth / 2 + deal.jitter * w : 0
    }
    const stripEnd = () => `translate3d(${(-stripOffset()).toFixed(1)}px, 0, 0)`
    // The slide: one curve past the stop point by a fraction of a card and back onto it
    const overshoot = () => OVERSHOOT * (landCard?.offsetWidth ?? 0)
    const frames = () => reelKeyframes(stripOffset(), overshoot(), timing)
    // The ticks: every card boundary (the middle of each gap) that crosses the marker, either way, timed on the same curve
    const soundOf = (anim: Animation | null): ReelSound => {
      const cards = Array.from(strip.children, (el) => el as HTMLElement)
      const gap = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft - cards[0].offsetWidth : 0
      const distance = stripOffset()
      const over = overshoot()
      return startReelSound({
        slide: anim,
        geometry: { boundaries: cards.map((c) => c.offsetLeft - gap / 2), marker: win.clientWidth / 2 },
        timing: { position: (ms) => reelPosition(ms, distance, over, timing), duration: timing.spin, bounce: timing.bounce, delay: timing.season },
        popAt: anim ? timing.drum : 0,
        reduced,
      })
    }
    let sound: ReelSound | null = null
    const label = drum.children[DRUM_LAND] as HTMLElement | undefined
    const drumTo = `translate3d(0, ${-(label?.offsetTop ?? 0)}px, 0)`
    let stripTo = stripEnd()
    let slide: Animation | null = null
    let done = false
    // A resize (a phone turned, a window dragged, the card size changing at the container breakpoint) moves the
    // landing card and the marker, so the stop is measured again: mid-slide the slide retargets, after it the strip moves.
    // Before the landing without a slide (reduced motion) the strip stays put, so the drawn card never shows early
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const next = stripEnd()
      if (next === stripTo) return
      stripTo = next
      if (slide?.effect instanceof KeyframeEffect) slide.effect.setKeyframes(frames())
      if (done) strip.style.transform = stripTo
    }) : null
    observer?.observe(win)
    if (landCard) observer?.observe(landCard)
    const land = () => {
      if (!alive || done) return
      done = true
      drum.style.transform = drumTo
      strip.style.transform = stripTo
      sound?.land(deal.target.tier)
      setStage('landed')
      if (mark) rememberLandedReel(mark)
      if (!settled.current) {
        settled.current = true
        settledCb.current?.(spinKey)
      }
    }
    // Landed before a reload: straight to the stop, before the first paint
    if (already) {
      land()
      skipRef.current = () => undefined
      return () => {
        alive = false
        observer?.disconnect()
      }
    }
    if (reduced || typeof strip.animate !== 'function') {
      drum.style.transform = drumTo
      sound = soundOf(null)
      const t = window.setTimeout(land, reduced ? REDUCED_MS : 0)
      skipRef.current = () => {
        window.clearTimeout(t)
        land()
      }
      return () => {
        alive = false
        window.clearTimeout(t)
        sound?.stop()
        observer?.disconnect()
        skipRef.current = () => undefined
      }
    }
    const roll = drum.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: drumTo }], { duration: timing.drum, easing: DRUM_EASE, fill: 'both' })
    const run = strip.animate(frames(), { duration: timing.spin, delay: timing.season, easing: 'linear', fill: 'both' })
    slide = run
    sound = soundOf(run)
    roll.finished.then(() => alive && setStage((s) => (s === 'season' ? 'strip' : s)), () => undefined)
    // At rest, a short hold, then the reveal; a skip lands at once
    let hold = 0
    let skipped = false
    run.finished.then(() => {
      if (skipped) land()
      else hold = window.setTimeout(land, timing.hold)
    }, () => undefined)
    skipRef.current = () => {
      skipped = true
      window.clearTimeout(hold)
      roll.finish()
      run.finish()
      if (run.playState === 'finished' && !done) land()
    }
    return () => {
      alive = false
      window.clearTimeout(hold)
      sound?.stop()
      observer?.disconnect()
      roll.cancel()
      run.cancel()
      skipRef.current = () => undefined
    }
    // One run per mount: a new spin mounts a new run, so nothing here needs to re-run
  }, [])

  useLayoutEffect(() => {
    if (autoSkip) skipRef.current()
  }, [autoSkip])

  const seasonOut = reduced || stage !== 'season'
  const tier = deal.target.tier
  const iconsSpin = tier === 'icons'
  const club = iconsSpin ? t('iconsCollection') : clubName(u, deal.target.clubId)
  const seasonText = iconsSpin ? t('iconsSpin') : t('seasonAnnounce', { season: seasonLabel(deal.season), twist: twist ? `, ${twist}` : '' })
  const landedText = iconsSpin ? t('iconsLanded') : `${club} ${seasonLabel(deal.season)}: ${tierColour(tier)}, ${tierWord(tier)}`
  useLayoutEffect(() => {
    announce(stage === 'landed' ? landedText : seasonOut ? seasonText : '')
  }, [announce, stage, seasonOut, seasonText, landedText])

  // Space or Enter skips while the reel runs, unless the key is meant for a field or another live control
  const running = stage !== 'landed'
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target instanceof Element ? e.target : null
      if (el && !rootRef.current?.contains(el) && el.closest('input, textarea, select, [contenteditable="true"], a[href], button:not(:disabled), [role="button"]')) return
      e.preventDefault()
      skipRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running])

  return (
    <div ref={rootRef} className={`reel-run stage-${stage}${reduced ? ' reduced' : ''}`} data-stage={stage} data-tier={stage === 'landed' ? tier : undefined} onClick={() => running && skipRef.current()}>
      <div className={`reel-season${seasonOut ? ' out' : ''}`}>
        <span className={`lbl${twist ? ' twist' : ''}`}>{iconsSpin ? t('rareSpin') : twist ?? t('season')}</span>
        <div className="reel-drum-window" aria-hidden="true">
          <div className="reel-drum" ref={drumRef}>
            {deal.drum.map((s, i) => (
              <div key={i} className="reel-drum-label">
                {drumLabel(s)}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="reel-window" ref={windowRef} aria-hidden="true">
        <NeonFlow className="reel-accent" />
        <div className="reel-marker" />
        <div className="reel-strip" ref={stripRef}>
          {deal.cards.map((c, i) => (
            <Card key={i} c={c} landed={stage === 'landed' && i === deal.land} />
          ))}
        </div>
        <div className="reel-veil" />
        {iconsSpin && stage === 'landed' && (
          <div className="icons-burst" data-testid="icons-burst">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} style={{ '--i': i } as React.CSSProperties}>★</span>
            ))}
          </div>
        )}
      </div>
      <div className="reel-result" data-testid="reel-result">
        {stage === 'landed' ? (
          <>
            <span className="reel-club">{club}</span>
            {!iconsSpin && <span className="reel-club-season">{seasonLabel(deal.season)}</span>}
            <TierChip tier={tier} />
            {estimated && <EstimatedChip compact />}
          </>
        ) : (
          <button type="button" className="reel-skip" data-testid="reel-skip" onClick={(e) => { e.stopPropagation(); skipRef.current() }}>
            {t('tapToSkip')}
          </button>
        )}
      </div>
    </div>
  )
}
