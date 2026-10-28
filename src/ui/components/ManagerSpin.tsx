import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { MANAGER_EDGE, MANAGER_STYLE_HELP, MANAGER_STYLE_LABEL, MANAGER_STYLES, type Manager } from '@engine/managers'
import { gameManagerWheel, managerSpinOdds, managerTier } from '@game/logic/managers'
import { edgeHint, edgeLine, managerEdge } from '@game/logic/managerEdge'
import { playerLookup } from '@game/logic/players'
import { dealItems, managerCard, type ItemDeal } from '@game/logic/itemReel'
import { reelLeagues } from '@game/logic/reel'
import { armAudio, unlockAudio } from '../sound/synth'
import { FULL_TIMING, QUICK_TIMING } from '../reelCurve'
import { quickSpinPref, skipReelsPref, usePref } from '../viewerPrefs'
import { clubName, seasonLabel } from '../format'
import { ItemReel } from './ItemReel'
import { SoundToggle, TierChip } from './CaseReel'
import { SpinOdds } from './SpinOdds'
import { ClubBadge, Segmented } from './bits'
import { useFocusOnLanding } from '../a11y'

/** How much later each reel to the right lands, ms (full timing; half with Quick spin), so the three stop one by one. */
const STAGGER_MS = 450

/** Fillers for the strips: up to this many managers drawn from the wheel for show (cosmetic, Math.random). */
const FILLERS = 48

function origin(u: LoadedUniverse, m: Manager): string {
  return m.archetype || !m.clubId || m.season === undefined ? 'Invented: no record on this wheel' : `${clubName(u, m.clubId)} · ${seasonLabel(m.season)}`
}

/**
 * The manager spin (`DraftRules.managerSpin`): three case reels side by side, spun at once like a multi-case opening,
 * each landing on one of the three managers the game already rolled (`game.managerSpin`, from a fork of its stream);
 * then the three cards, one of which the user picks (`pickManager`). The reels are presentation only: a reload shows
 * the same three again. Tap or Space skips to the landing; Quick spin (Profile) runs the short timing. Under the reels,
 * what each style would do for this XI (`managerEdge`), the landed styles lit.
 */
export function ManagerSpin({ u, game }: { u: LoadedUniverse; game: Game }) {
  const pickManager = useStore((s) => s.pickManager)
  const options = useMemo(() => game.managerSpin?.options ?? [], [game.managerSpin])
  const leagues = useMemo(() => reelLeagues(u, game.settings.rules), [u, game.settings.rules])
  const odds = useMemo(() => managerSpinOdds(u, game), [u, game])
  // Each style's edge on this XI with the current instructions, as the season would apply it
  const edges = useMemo(() => {
    const get = playerLookup(game, u)
    return Object.fromEntries(MANAGER_STYLES.map((st) => [st, managerEdge(game, st, get)])) as Record<Manager['style'], ReturnType<typeof managerEdge>>
  }, [u, game])
  const [quick, setQuick] = usePref(quickSpinPref)
  const [skipReels, setSkipReels] = usePref(skipReelsPref)
  const [run, setRun] = useState(0)
  const [landedAt, setLandedAt] = useState<boolean[]>([])
  const landed = landedAt.filter(Boolean).length
  const [skip, setSkip] = useState(0)
  const [shownManager, setShownManager] = useState(0)
  const managerRow = useRef<HTMLDivElement>(null)
  useEffect(armAudio, [])
  // Dealt once per run: the fillers are cosmetic draws from the wheel, the landing cards are the rolled three
  const deals = useMemo<ItemDeal[]>(() => {
    if (!run) return []
    const wheel = gameManagerWheel(game, u)
    const pool = Array.from({ length: Math.min(FILLERS, wheel.length) }, () => managerCard(u, leagues, wheel[Math.floor(Math.random() * wheel.length)]))
    return options.map((m) => dealItems(managerCard(u, leagues, m), pool, Math.random))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])
  const spinning = run > 0 && landed < options.length
  const done = run > 0 && landed >= options.length
  const timing = quick ? QUICK_TIMING : FULL_TIMING
  const stagger = quick ? STAGGER_MS / 2 : STAGGER_MS
  // Landed: the focus goes to the first Pick (the Skip that held it is gone)
  const firstPick = useRef<HTMLButtonElement>(null)
  useFocusOnLanding(done, firstPick)
  useEffect(() => {
    if (spinning && skipReels) setSkip((n) => n + 1)
  }, [spinning, skipReels])
  useEffect(() => {
    if (!spinning) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return
      e.preventDefault()
      setSkip((n) => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spinning])
  const showManager = (i: number) => {
    const row = managerRow.current
    const card = row?.children[i] as HTMLElement | undefined
    if (!row || !card) return
    row.scrollTo({ left: card.offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setShownManager(i)
  }
  const trackManager = () => {
    const row = managerRow.current
    if (!row) return
    const cards = Array.from(row.children) as HTMLElement[]
    const nearest = cards.reduce((best, card, i) => (Math.abs(card.offsetLeft - row.scrollLeft) < Math.abs(cards[best].offsetLeft - row.scrollLeft) ? i : best), 0)
    setShownManager((current) => (current === nearest ? current : nearest))
  }

  return (
    <div className="page fit" data-testid="manager-spin">
      <div className="fit-head screen-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>Spin your manager</h1>
          <span className="small muted">Three reels, three real managers from this wheel's clubs. Pick one for the season.</span>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <SpinOdds odds={odds} label="Each reel" />
          <label className="mspin-speed small">
            Reel speed
            <Segmented
              value={skipReels ? 'skip' : quick ? 'quick' : 'full'}
              onChange={(v) => {
                setSkipReels(v === 'skip')
                if (v !== 'skip') setQuick(v === 'quick')
              }}
              options={[{ value: 'full', label: 'Full' }, { value: 'quick', label: 'Quick' }, { value: 'skip', label: 'Skip reels' }]}
            />
          </label>
          <span className="mspin-sound">
            <SoundToggle />
          </span>
        </div>
      </div>
      <div className={`mspin${spinning ? ' running' : ''}`} ref={managerRow} onScroll={trackManager} onClick={() => spinning && setSkip((n) => n + 1)}>
        {options.map((m, i) => {
          const tier = managerTier(u, leagues, m)
          const show = done || !!landedAt[i]
          return (
            <div key={m.id} className="mspin-col" data-testid={`mspin-col-${i}`}>
              {run > 0 ? (
                <ItemReel key={run} deal={deals[i]} timing={timing} stagger={i * stagger} sound={i === 0} skip={skip} onSettled={() => setLandedAt((a) => Object.assign([...a], { [i]: true }))} testId={`mspin-reel-${i}`} />
              ) : (
                <div className="reel-run item-reel idle">
                  <div className="reel-window" aria-hidden="true">
                    <div className="reel-marker" />
                    <div className="mspin-idle">?</div>
                  </div>
                </div>
              )}
              <div className={`mspin-card choice-card${show ? '' : ' hidden'}`} data-tier={show ? tier : undefined} aria-hidden={!show}>
                {!show && (
                  <span className="mspin-wait">
                    <b>Reel {i + 1}</b>
                    <span className="cline">{run > 0 ? 'Spinning…' : 'A real manager from this wheel lands here'}</span>
                  </span>
                )}
                {show && (
                  <>
                    <span className="row" style={{ gap: 8 }}>
                      {m.clubId && !m.archetype ? <ClubBadge clubId={m.clubId} size={28} /> : <span className="manager-mono" aria-hidden="true">?</span>}
                      <span className="ctitle manager-name">{m.name}</span>
                    </span>
                    <span className="cline">{origin(u, m)}</span>
                    <span className="row wrap" style={{ gap: 6 }}>
                      <TierChip tier={tier} />
                      <span className="chip manager-style">{MANAGER_STYLE_LABEL[m.style]}</span>
                    </span>
                    <span className="cline manager-help">{MANAGER_STYLE_HELP[m.style]}</span>
                    <span className="cline manager-edge" data-testid={`mspin-edge-${i}`}>
                      On your XI: <b>{edgeLine(edges[m.style])}</b>
                    </span>
                    <button ref={i === 0 ? firstPick : undefined} type="button" className="btn primary sm" disabled={!done} onClick={(e) => { e.stopPropagation(); pickManager(m.id) }} data-testid={`mspin-pick-${i}`}>
                      Pick {m.name.split(/\s+/).slice(-1)[0]}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mspin-foot">
        {run === 0 ? (
          <button type="button" className="btn primary big display" onClick={() => { unlockAudio(); setRun(1) }} data-testid="mspin-go">
            Spin 3 managers
          </button>
        ) : spinning ? (
          <button type="button" className="reel-skip" onClick={() => setSkip((n) => n + 1)} data-testid="mspin-skip">
            Skip animation
          </button>
        ) : (
          <>
            <span className="small muted" data-testid="mspin-landed">Swipe or use the dots to compare all three.</span>
            <span className="mspin-pager" role="group" aria-label="Compare managers">
              {options.map((manager, i) => (
                <button key={manager.id} type="button" className={shownManager === i ? 'active' : ''} aria-label={`Show ${manager.name}`} aria-pressed={shownManager === i} onClick={() => showManager(i)}>
                  <span aria-hidden="true">{i + 1}</span>
                </button>
              ))}
            </span>
          </>
        )}
        {/* The reels are hidden from screen readers: the landing is said once, here */}
        <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="mspin-live">
          {done ? `Landed: ${options.map((m) => `${m.name}, ${MANAGER_STYLE_LABEL[m.style]}`).join('; ')}. Pick your manager.` : ''}
        </span>
      </div>
      <div className="panel mspin-guide" data-testid="mspin-guide">
        <div className="panel-head">
          <h3>What a manager brings</h3>
          <span className="small muted">Each style's edge on your XI with your current instructions: at most {Math.round(MANAGER_EDGE * 100)}% either way, for every game of the season</span>
        </div>
        <div className="mspin-styles">
          {MANAGER_STYLES.map((st) => {
            const e = edges[st]
            const landedHere = done && options.some((m) => m.style === st)
            return (
              <div key={st} className={`mspin-style${landedHere ? ' landed' : ''}`} data-testid={`mspin-style-${st}`}>
                <span className="row between" style={{ gap: 8 }}>
                  <b>{MANAGER_STYLE_LABEL[st]}</b>
                  <span className="mspin-style-edge">{edgeLine(e)}</span>
                </span>
                <span className="small muted">{MANAGER_STYLE_HELP[st]}</span>
                {edgeHint(st, e) && <span className="small mspin-style-hint">{edgeHint(st, e)}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
