import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PlayerSeason } from '@engine/types'
import { UPGRADE_BOOSTS, upgradeChance, upgradeGain, upgradeLoss, type UpgradeBoost } from '@engine/upgrader'
import type { Tier } from '@game/logic/rarity'
import { Modal, Pos } from './bits'
import { POWER_UP_INFO } from '@engine/powerups'
import { PowerUpIcon } from './icons'
import { PowerUpButton } from './PowerUpButton'
import { armAudio, playDialTick, playUpgradeResult, unlockAudio } from '../sound/synth'
import { quickSpinPref, usePref } from '../viewerPrefs'
import { DIAL_FULL_MS, DIAL_HOLD_MS, DIAL_QUICK_MS, DIAL_REDUCED_MS, dialTravel, landingAngle, needleAngle, ticksPassed } from '../upgradeDial'
import { SoundToggle } from './CaseReel'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'
import { rich, B } from '../i18n/rich'

const t = translator(draft)

/** The dial's win arc takes a rarity colour by how big the gamble is. */
const BOOST_TIER: Record<UpgradeBoost, Tier> = { 2: 'purple', 5: 'pink', 10: 'red' }
/** The three boosts as presets: how big a gamble each is. */

/** What the Upgrader shows of a gamble made: the logic's record of it (`DraftUpgrade`, `JanuaryUpgradeResult`). */
export interface UpgradeShown {
  id: string
  boost: number
  chance: number
  roll: number
  won: boolean
  delta: number
  locked?: boolean
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const R = 96
const C = 2 * Math.PI * R
const MARKS = Array.from({ length: 100 }, (_, i) => i)

/**
 * The Upgrader's dial, as an upgrader site draws one: a big ring with the win arc sized to the chance (from twelve
 * o'clock clockwise, in the boost's rarity colour), a hundred marks, and a needle. Given a roll, the needle spins
 * several turns with a long ease-out, ticking past the marks, and lands on that roll (`src/ui/upgradeDial.ts`): inside
 * the arc on a win, then a glow and a shake; outside on a loss, then the dial dims. The roll is the logic's, made
 * before the needle moves. `animate` false shows it landed (a reload); a change of `skip` lands at once; reduced
 * motion skips the spin; Quick spin (Profile) runs the short one.
 */
export function UpgradeDial({ chance, tier, roll, won, animate, skip = 0, onLanded, verdict }: { chance: number; tier: Tier; roll: number | null; won: boolean; animate: boolean; skip?: number; onLanded?: () => void; /** The centre's text once landed: "+5", "-3". */ verdict?: string }) {
  const [reduced] = useState(prefersReducedMotion)
  const [quick] = usePref(quickSpinPref)
  const needle = useRef<SVGGElement>(null)
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'landed'>(roll === null ? 'idle' : animate ? 'spinning' : 'landed')
  const landedCb = useRef(onLanded)
  const skipRef = useRef<() => void>(() => undefined)
  useLayoutEffect(() => {
    landedCb.current = onLanded
  })
  useEffect(armAudio, [])
  useLayoutEffect(() => {
    const setAngle = (a: number) => needle.current?.setAttribute('transform', `rotate(${a.toFixed(2)} 120 120)`)
    if (roll === null) {
      setAngle(0)
      setPhase('idle')
      return
    }
    if (!animate) {
      setAngle(landingAngle(roll))
      setPhase('landed')
      return
    }
    let alive = true
    let done = false
    let raf = 0
    let hold = 0
    const travel = dialTravel(roll)
    const total = reduced ? 0 : quick ? DIAL_QUICK_MS : DIAL_FULL_MS
    setPhase('spinning')
    const land = () => {
      if (!alive || done) return
      done = true
      cancelAnimationFrame(raf)
      setAngle(travel)
      hold = window.setTimeout(() => {
        if (!alive) return
        setPhase('landed')
        playUpgradeResult(won, reduced)
        landedCb.current?.()
      }, reduced ? 0 : DIAL_HOLD_MS)
    }
    skipRef.current = land
    if (total === 0 || typeof requestAnimationFrame !== 'function') {
      setAngle(0)
      hold = window.setTimeout(land, DIAL_REDUCED_MS)
    } else {
      const start = performance.now()
      let lastTick = 0
      let lastSound = 0
      const frame = (now: number) => {
        if (!alive) return
        const ms = now - start
        const a = needleAngle(ms, total, roll)
        setAngle(a)
        const t = ticksPassed(a)
        // One tick per mark passed, never closer than 28 ms (the fast start would be a buzz), higher while it is fast
        if (t !== lastTick) {
          lastTick = t
          if (now - lastSound > 28) {
            lastSound = now
            playDialTick(0.92 + 0.28 * Math.max(0, 1 - ms / total))
          }
        }
        if (ms >= total) land()
        else raf = requestAnimationFrame(frame)
      }
      setAngle(0)
      raf = requestAnimationFrame(frame)
    }
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.clearTimeout(hold)
      skipRef.current = () => undefined
    }
    // One spin per roll: the roll arrives once, from the logic
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll])
  useEffect(() => {
    if (skip) skipRef.current()
  }, [skip])

  const result = phase === 'landed' && roll !== null ? (won ? 'won' : 'lost') : ''
  return (
    <div className={`udial ${phase} ${result}${reduced ? ' reduced' : ''}`} data-tier={tier} data-testid="upgrader-dial" data-phase={phase} data-result={result || undefined}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle className="udial-face" cx="120" cy="120" r="118" />
        <circle className="udial-track" cx="120" cy="120" r={R} />
        <circle className="udial-win" cx="120" cy="120" r={R} strokeDasharray={`${(chance / 100) * C} ${C}`} transform="rotate(-90 120 120)" />
        {MARKS.map((i) => {
          const a = (i * 3.6 * Math.PI) / 180
          const major = i % 5 === 0
          const r1 = major ? 106 : 108
          const r2 = major ? 115 : 112
          return <line key={i} className={`udial-mark${major ? ' major' : ''}${i < chance ? ' in' : ''}`} x1={120 + r1 * Math.sin(a)} y1={120 - r1 * Math.cos(a)} x2={120 + r2 * Math.sin(a)} y2={120 - r2 * Math.cos(a)} />
        })}
        <g ref={needle} className="udial-needle" transform="rotate(0 120 120)">
          <line x1="120" y1="120" x2="120" y2="30" />
          <polygon points="120,14 111,34 129,34" />
        </g>
      </svg>
      <div className="udial-centre">
        {phase === 'landed' && verdict ? (
          <>
            <b data-testid="upgrader-verdict">{verdict}</b>
            <span>{t(won ? 'upgraded' : 'missed')}</span>
          </>
        ) : (
          <>
            <b data-testid="upgrader-chance">{chance}%</b>
            <span>{t(phase === 'spinning' ? 'rolling' : 'toWin')}</span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The Upgrader's stage: choose one of `players` and a boost (three presets, each with its exact chance, the dial's
 * arc following the choice), see what a win and a loss do, and spin. `onConfirm` asks the logic for the gamble; the
 * dial then spins onto the roll it made (`result`) and the verdict shows. Used by the Gamble mode's sheet and by
 * the January Upgrader. Tap the dial, the skip button, Space or Enter to land at once.
 */
export function UpgraderStage({ players, ratingOf, hideRatings, result, onConfirm, lockedId, doneLabel, onDone, onSpinning, back, intro }: { players: PlayerSeason[]; ratingOf: (id: string) => number; hideRatings: boolean; result: UpgradeShown | null | undefined; onConfirm: (id: string, boost: UpgradeBoost) => void; lockedId?: string | null; doneLabel: string; onDone: () => void; onSpinning?: (spinning: boolean) => void; /** A way back before the gamble is made. */ back?: ReactNode; intro?: ReactNode }) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [boost, setBoost] = useState<UpgradeBoost>(5)
  // A result already there when the stage opened is shown landed; one made here spins first
  const [rolled, setRolled] = useState(false)
  const [landed, setLanded] = useState(!!result)
  const [skip, setSkip] = useState(0)
  const spinning = !!result && !landed
  const spinCb = useRef(onSpinning)
  useLayoutEffect(() => {
    spinCb.current = onSpinning
  })
  useEffect(() => {
    spinCb.current?.(spinning)
  }, [spinning])
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

  const pick = chosen && players.some((p) => p.id === chosen) ? chosen : null
  const player = pick ? players.find((p) => p.id === pick) : undefined
  const base = pick ? ratingOf(pick) : 0
  const chance = result ? result.chance : pick ? upgradeChance(base, boost) : upgradeChance(70, boost)
  const shownBoost = (result?.boost ?? boost) as UpgradeBoost
  const resultPlayer = result ? players.find((p) => p.id === result.id) : undefined
  const locked = !!pick && pick === lockedId
  const verdict = result ? (result.locked ? '±0' : result.delta > 0 ? `+${result.delta}` : String(result.delta)) : undefined
  const resultBase = result ? ratingOf(result.id) : 0

  return (
    <div className="upg-stage col" data-testid="upgrader-stage" data-state={result ? (landed ? 'landed' : 'spinning') : 'choose'}>
      {!result && intro}
      {!result && (
        <div className="upg-players" role="listbox" aria-label={t('yourPlayers')}>
          {players.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={pick === p.id} className={`upg-player${pick === p.id ? ' on' : ''}`} onClick={() => setChosen(p.id)} data-testid="upgrader-player">
              <Pos p={p.positions[0]} />
              <span className="nm">{p.name}</span>
              {!hideRatings && <b>{ratingOf(p.id)}</b>}
            </button>
          ))}
        </div>
      )}
      <div className="upg-main">
        <div className="upg-dial-wrap" onClick={() => spinning && setSkip((n) => n + 1)}>
          <UpgradeDial key={result ? 'rolled' : 'choose'} chance={chance} tier={BOOST_TIER[shownBoost] ?? 'pink'} roll={result ? result.roll : null} won={!!result?.won} animate={rolled} skip={skip} verdict={verdict} onLanded={() => setLanded(true)} />
        </div>
        <div className="upg-side col">
          {!result && (
            <>
              <div className="upg-presets" role="group" aria-label={t('boost')}>
                {UPGRADE_BOOSTS.map((b) => (
                  <button key={b} type="button" className={`upg-preset${boost === b ? ' on' : ''}`} data-tier={BOOST_TIER[b]} onClick={() => setBoost(b)} aria-pressed={boost === b} data-testid={`boost-${b}`}>
                    <span className="upg-preset-boost">+{b}</span>
                    <span className="upg-preset-name">{t(`boost_${b}`)}</span>
                    <b className="upg-preset-chance">{pick ? `${upgradeChance(base, b)}%` : '–'}</b>
                  </button>
                ))}
              </div>
              {player ? (
                <div className="upg-odds small col">
                  <b className="upg-odds-name">{player.name}</b>
                  <span className="upg-win-line">
                    {t('winLine', { chance, what: hideRatings ? `+${upgradeGain(base, boost)}` : `${base} → ${base + upgradeGain(base, boost)}` })}
                  </span>
                  <span className="upg-lose-line">
                    {t('loseLine', { chance: 100 - chance, what: locked ? t('lockedNoChange') : hideRatings ? `-${upgradeLoss(boost)}` : `${base} → ${base - upgradeLoss(boost)}` })}
                  </span>
                </div>
              ) : (
                <span className="small muted">{t('upgPickHint')}</span>
              )}
            </>
          )}
          {result && !landed && (
            <div className="upg-rolling small" aria-live="polite">
              {rich(t('upgRolling', { name: resultPlayer?.name ?? t('yourPlayerCap'), chance: result.chance, boost: result.boost }), B)}
            </div>
          )}
          {result && landed && (
            <div className={`upg-result ${result.won ? 'won' : 'lost'}`} data-testid="upgrader-result" data-won={result.won}>
              <b>{t(result.won ? 'upgradedBang' : result.locked ? 'lockHeldThe' : 'downgraded')}</b>
              <span>
                {t('resultLine', { name: resultPlayer?.name ?? t('yourPlayerCap'), change: result.locked ? t('keepsRating') : result.delta > 0 ? `+${result.delta}` : String(result.delta) })}
                {!hideRatings && !result.locked && ` (${resultBase} → ${resultBase + result.delta})`}
              </span>
              <span className="small">
                {t('rolledAgainst', { roll: result.roll, chance: result.chance })}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="row wrap upg-actions">
        {!result ? (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={!pick}
              onClick={() => {
                if (!pick) return
                unlockAudio()
                setRolled(true)
                setLanded(false)
                onConfirm(pick, boost)
              }}
              data-testid="upgrader-confirm"
            >
              {pick ? t('upgradeAt', { chance }) : t('choosePlayer')}
            </button>
            {back}
          </>
        ) : spinning ? (
          <button type="button" className="reel-skip" onClick={() => setSkip((n) => n + 1)} data-testid="upgrader-skip">
            {t('tapToSkip')}
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={onDone} data-testid="upgrader-close">
            {doneLabel}
          </button>
        )}
        <span className="upg-sound">
          <SoundToggle />
        </span>
      </div>
      <div className="tiny-note small muted">{t('inGameOnlyChance')}</div>
    </div>
  )
}

/**
 * The Player Upgrader: a panel by the reel and, when opened, a sheet with the Upgrader's stage. The gamble itself is
 * the store's (`upgradePlayer`); the stage only shows the odds the engine uses (`upgradeChance`) and spins the dial
 * onto the roll the engine made.
 */
export function Upgrader({ players, ratingOf, available, result, hideRatings, onConfirm, tray, lockedId, turn = '', onRolling }: { players: PlayerSeason[]; ratingOf: (id: string) => number; available: boolean; result: UpgradeShown | null | undefined; hideRatings: boolean; onConfirm: (id: string, boost: UpgradeBoost) => void; /** In the power-up tray: a tray button instead of a panel. */ tray?: boolean; /** The player under the Lock power-up, whose loss costs nothing. */ lockedId?: string | null; /** The draft turn (`draftTurnKey`): the sheet shows only on the turn it was opened on. */ turn?: string; /** The dial is turning in the open sheet. */ onRolling?: (rolling: boolean) => void }) {
  // The turn the sheet was opened on; a later turn (a pick, a Speedrun timeout) closes it
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn !== null && openOn === turn
  const setOpen = (on: boolean) => setOpenOn(on ? turn : null)
  const [rolling, setRolling] = useState(false)
  const rollingCb = useRef(onRolling)
  useLayoutEffect(() => {
    rollingCb.current = onRolling
  })
  useEffect(() => {
    rollingCb.current?.(open && rolling)
  }, [open, rolling])
  useEffect(() => () => rollingCb.current?.(false), [])
  const resultPlayer = result ? players.find((p) => p.id === result.id) : undefined
  const done = !!result && !rolling
  const summary = result ? (done ? t(result.won ? 'summaryWon' : result.locked ? 'summaryLockHeld' : 'summaryLost', { name: resultPlayer?.name ?? t('yourPlayerCap'), delta: result.delta, chance: result.chance }) : t('dialSpinning')) : t('oncePerDraft')

  return (
    <div className={tray ? 'pu-upgrader' : 'panel tight upg-panel'} data-testid="upgrader">
      {tray ? (
        <PowerUpButton icon={<PowerUpIcon kind="upgrader" />} title={POWER_UP_INFO.upgrader.title} line={POWER_UP_INFO.upgrader.line} status={result ? (done ? t(result.won ? 'statusWon' : result.locked ? 'statusLockHeld' : 'statusLost', { delta: result.delta }) : t('spinning')) : t(available ? 'ready' : 'draftAPlayer')} used={!!result} disabled={!available} onClick={() => setOpen(true)} testId="pu-upgrader" />
      ) : (
        <div className="row between">
          <div>
            <b>⬆️ {t('playerUpgrader')}</b>
            <div className="small muted">{summary}</div>
          </div>
          {!result && (
            <button className="btn sm primary" disabled={!available} onClick={() => setOpen(true)} data-testid="upgrader-open" title={available ? undefined : t('draftPlayerFirst')}>
              {t('upgrade')}
            </button>
          )}
        </div>
      )}
      <Modal open={open} onClose={() => !rolling && setOpen(false)} title={t('playerUpgrader')} sheet testId="upgrader-sheet" className="upg-sheet">
        <UpgraderStage
          players={players}
          ratingOf={ratingOf}
          hideRatings={hideRatings}
          result={result}
          lockedId={lockedId}
          onConfirm={onConfirm}
          onSpinning={setRolling}
          doneLabel={t('backToDraft')}
          onDone={() => setOpen(false)}
          intro={<div className="small muted">{t('upgIntro')}</div>}
        />
      </Modal>
    </div>
  )
}
