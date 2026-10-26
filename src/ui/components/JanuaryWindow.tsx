import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpCircle, Dices, ShoppingBag, SkipForward } from 'lucide-react'
import { useStore } from '@game/store'
import type { Game, QuickJanuary } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'
import { getFormation } from '@engine/formations'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { ratingAt } from '@engine/positions'
import { playerLookup } from '@game/logic/players'
import { openSpinChoices, quickSeasonGames } from '@game/logic/quick'
import { foldResults, goalDifferenceLabel, paceLine } from '@game/logic/gameByGame'
import { januaryGambleOn, januarySpinFillers, januarySpinOdds, januarySpinPool } from '@game/logic/januaryGamble'
import { dealItems, playerCard, type ItemDeal } from '@game/logic/itemReel'
import { PlayerRow } from './PlayerRow'
import { Pos } from './bits'
import { CaptainAndPenalties, TeamInstructions } from './TacticsControls'
import { ItemReel } from './ItemReel'
import { SoundToggle, TierChip } from './CaseReel'
import { SpinOdds } from './SpinOdds'
import { UpgraderStage } from './Upgrader'
import { armAudio, unlockAudio } from '../sound/synth'
import { FULL_TIMING, QUICK_TIMING } from '../reelCurve'
import { quickSpinPref, usePref } from '../viewerPrefs'
import { money, ordinal } from '../format'
import { useFocusOnLanding } from '../a11y'

type Stage = 'halfway' | 'market' | 'spin' | 'upgrade'

/**
 * The January window at the halfway mark, as 38-0 stops the season: a "Halfway there" panel (won-drawn-lost, points
 * and goal difference, one line on the pace), then the window's one deal. A Quick Draft offers four, casino style:
 * the January spin (a case that lands on a player of the wheel, at the tier odds shown, who can take a slot he can
 * cover), the January Upgrader (one roll on one of the XI), the transfer market (the budget and three to five
 * listings) and Skip. The Daily and the weekly keep the plain window: the market or stick. The second-half tactics
 * fold sits under every step. Every draw and every check is the store's; this only shows them.
 */
export function JanuaryWindow({ game, u, j }: { game: Game; u: LoadedUniverse; j: QuickJanuary }) {
  const { closeJanuary, setTactics, setCaptain } = useStore()
  const gamble = januaryGambleOn(game)
  // A reload after the case was opened or the dial rolled comes back to that step
  const [stage, setStage] = useState<Stage>(j.spin ? 'spin' : j.upgrade ? 'upgrade' : 'halfway')
  const [tactics, setShowTactics] = useState(false)
  const get = playerLookup(game, u)
  // The Upgrader and the captain picker act on the user's own XI, so their ratings show even in blind mode
  const hide = ratingHidden(game.settings.rules, 'squad')
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  const totalGames = quickSeasonGames(u, game.settings)
  const t = foldResults(j.firstHalf)
  const teams = totalGames / 2 + 1
  const boxes: Array<{ key: string; label: string; value: string }> = [
    { key: 'wdl', label: 'W-D-L', value: `${t.won}-${t.drawn}-${t.lost}` },
    { key: 'pts', label: 'Points', value: String(t.points) },
    { key: 'gd', label: 'GD', value: goalDifferenceLabel(t.goalsFor, t.goalsAgainst) },
  ]
  const title = stage === 'market' ? 'The transfer market' : stage === 'spin' ? 'January spin' : stage === 'upgrade' ? 'January Upgrader' : 'Halfway there'
  return (
    <div className="panel col january-panel" data-testid="january-window" data-stage={stage} data-gamble={gamble || undefined}>
      <div className="sc-head jw-head">
        <span className="sc-kicker">January transfer window</span>
        <h2>{title}</h2>
        {stage !== 'halfway' && (
          <span className="small muted jw-mini" data-testid="january-mini">
            {ordinal(j.position)} · {t.won}-{t.drawn}-{t.lost} · {t.points} pts
          </span>
        )}
      </div>
      {stage === 'halfway' && (
        <>
          <div className="jw-boxes" data-testid="january-halfway">
            {boxes.map((b) => (
              <div key={b.key} className={`tally-box ${b.key}`} data-testid={`january-${b.key}`}>
                <span className="tally-num">{b.value}</span>
                <span className="tally-label">{b.label}</span>
              </div>
            ))}
          </div>
          <p className="jw-pace" data-testid="january-pace">
            {paceLine(t, totalGames, teams)}
          </p>
          {gamble ? (
            <div className="jw-options" data-testid="january-options">
              <button type="button" className="jw-option spin" onClick={() => setStage('spin')} data-testid="january-option-spin">
                <Dices size={22} aria-hidden="true" />
                <b>January spin</b>
                <span>Open a case: a player from this wheel to bring in, or not.</span>
              </button>
              <button type="button" className="jw-option upgrade" onClick={() => setStage('upgrade')} data-testid="january-option-upgrade">
                <ArrowUpCircle size={22} aria-hidden="true" />
                <b>January Upgrader</b>
                <span>One roll on one of your XI: +2, +5 or +10.</span>
              </button>
              <button type="button" className="jw-option market" onClick={() => setStage('market')} data-testid="january-enter">
                <ShoppingBag size={22} aria-hidden="true" />
                <b>Transfer market</b>
                <span>
                  {money(j.budget)} budget, {j.listings.length} offer{j.listings.length === 1 ? '' : 's'}.
                </span>
              </button>
              <button type="button" className="jw-option skip" onClick={() => closeJanuary(null)} data-testid="january-stick">
                <SkipForward size={22} aria-hidden="true" />
                <b>Skip</b>
                <span>Keep your XI and play on.</span>
              </button>
            </div>
          ) : (
            <div className="jw-choice">
              <button className="btn primary big" onClick={() => setStage('market')} data-testid="january-enter">
                Enter the transfer market
              </button>
              <button className="btn big" onClick={() => closeJanuary(null)} data-testid="january-stick">
                Stick with your XI
              </button>
            </div>
          )}
        </>
      )}
      {stage === 'market' && <Market game={game} u={u} j={j} onBack={() => setStage('halfway')} />}
      {stage === 'spin' && <JanuarySpin game={game} u={u} j={j} onBack={() => setStage('halfway')} />}
      {stage === 'upgrade' && <JanuaryUpgrade j={j} xi={xi} hide={hide} onBack={() => setStage('halfway')} />}
      <button type="button" className="fold-head" onClick={() => setShowTactics(!tactics)} aria-expanded={tactics} data-testid="january-tactics-toggle">
        <b>Second-half tactics</b>
        <span className="small muted">{tactics ? 'Hide ▴' : 'Change ▾'}</span>
      </button>
      {tactics && (
        <div className="col">
          <TeamInstructions t={game.tactics} onChange={setTactics} />
          <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={game.tactics.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...game.tactics.setPieces, penalties: id } })} hideRatings={hide} />
        </div>
      )}
    </div>
  )
}

/** The market: the budget and three to five deals, one of which can be done, or the XI kept after all. */
function Market({ game, u, j, onBack }: { game: Game; u: LoadedUniverse; j: QuickJanuary; onBack: () => void }) {
  const { closeJanuary } = useStore()
  const [chosen, setChosen] = useState<number | null>(null)
  const get = playerLookup(game, u)
  // The deals are players from outside the squad: hidden in blind mode, as every offer is
  const hide = ratingHidden(game.settings.rules, 'market')
  const formation = getFormation(game.tactics.formationId)
  const slotOf = (slotId: string) => formation.slots.find((x) => x.id === slotId)
  const pick = chosen === null ? null : j.listings[chosen]
  return (
    <>
      <div className="row between wrap" style={{ gap: 8 }}>
        <p className="help" style={{ margin: 0 }}>
          {ordinal(j.position)} after {j.firstHalf.length} games. The board backs one deal: sign a player with the budget or swap one of your XI for him. It can help or hurt, and there is no undo.
        </p>
        <span className="chip">Budget {money(j.budget)}</span>
      </div>
      {j.listings.length === 0 && <div className="notice">Nobody fits this wheel's rules this January.</div>}
      <div className="col" style={{ gap: 6 }}>
        {j.listings.map((l, i) => {
          const incoming = get(l.playerSeasonId)
          const out = get(l.outId)
          const slot = slotOf(l.slotId)
          if (!incoming || !out || !slot) return null
          const gain = Math.round(ratingAt(incoming, slot.position) - ratingAt(out, slot.position))
          return (
            <div key={`${l.playerSeasonId}-${l.slotId}`} className={`jw-deal ${chosen === i ? 'selected' : ''}`} data-testid="january-listing">
              <PlayerRow p={incoming} showClub hideRatings={hide} selected={chosen === i} onClick={() => setChosen(chosen === i ? null : i)} right={<span className={`chip ${l.kind === 'sign' ? '' : 'gold'}`}>{l.kind === 'sign' ? money(l.fee) : 'Swap'}</span>} />
              <div className="small muted jw-out">
                <Pos p={slot.position} /> {l.kind === 'sign' ? 'Replaces' : 'In exchange for'} {out.name}
                {!hide && ` · ${gain >= 0 ? '+' : ''}${gain} in that slot`}
              </div>
            </div>
          )
        })}
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn primary" disabled={!pick} onClick={() => chosen !== null && closeJanuary(chosen)} data-testid="january-deal">
          {pick ? (pick.kind === 'sign' ? `Sign ${get(pick.playerSeasonId)?.name ?? ''} and play on` : `Do the swap and play on`) : 'Choose a deal'}
        </button>
        <button className="btn" onClick={() => closeJanuary(null)} data-testid="january-pass">
          Stick with your XI
        </button>
        <button className="btn ghost" onClick={onBack} data-testid="january-back">
          Back
        </button>
      </div>
    </>
  )
}

/**
 * The January spin: the tier odds and an idle reel, then (once the case is opened, the store's draw) the reel slides
 * onto the player drawn, and the slots he can take, best for the XI first, or keep the XI. Tap, Space or Enter skips
 * the slide; Quick spin (Profile) runs the short one; a reload after opening shows him landed.
 */
function JanuarySpin({ game, u, j, onBack }: { game: Game; u: LoadedUniverse; j: QuickJanuary; onBack: () => void }) {
  const { januarySpin, closeJanuarySpin } = useStore()
  const [quick] = usePref(quickSpinPref)
  const get = playerLookup(game, u)
  // The player the case lands on is still being chosen until he is brought in: hidden in blind mode, as any offer;
  // the XI man he would replace is the user's own, so his rating shows
  const hide = ratingHidden(game.settings.rules, 'offer')
  const pool = useMemo(() => januarySpinPool(game, u, game.lineup, game.bench, playerLookup(game, u)), [game, u])
  const odds = useMemo(() => januarySpinOdds(pool), [pool])
  const [opened, setOpened] = useState(false)
  // Landed already when the case was opened before this step was shown (a reload)
  const [landed, setLanded] = useState(!!j.spin)
  const [skip, setSkip] = useState(0)
  const [slot, setSlot] = useState<string | null>(null)
  useEffect(armAudio, [])
  const spin = j.spin
  const p = spin ? get(spin.playerSeasonId) : undefined
  // Dealt once, when the case opens: the fillers are the pool's players as often as their tier's odds, shuffled for show
  const deal = useMemo<ItemDeal | null>(() => {
    if (!spin || !p) return null
    const fillers = januarySpinFillers(pool).map((c) => playerCard(c.p, c.tier))
    return dealItems(playerCard(p, spin.tier), fillers, Math.random)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.playerSeasonId])
  const spinning = opened && !!spin && !landed
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
  const choices = landed ? openSpinChoices(game, u) : []
  const chosen = choices.find((c) => c.slotId === slot) ?? null
  // Landed in this view: the focus goes to his first slot, or Keep my XI when he fits none (the Skip that held it is gone)
  const action = useRef<HTMLButtonElement>(null)
  useFocusOnLanding(opened && landed, action)
  const empty = odds.every((o) => o.p === 0)
  return (
    <div className="jw-spin col" data-testid="january-spin" data-landed={landed || undefined}>
      {!(spin && landed) && (
        <div className="row between wrap jw-spin-head" style={{ gap: 8 }}>
          <SpinOdds odds={odds} label="January case" />
          <span className="jw-sound">
            <SoundToggle />
          </span>
        </div>
      )}
      <div className={`jw-reel${spinning ? ' running' : ''}`} onClick={() => spinning && setSkip((n) => n + 1)}>
        {spin && deal && opened ? (
          <ItemReel deal={deal} timing={quick ? QUICK_TIMING : FULL_TIMING} skip={skip} onSettled={() => setLanded(true)} testId="january-spin-reel" />
        ) : (
          <div className={`reel-run item-reel${spin ? ' stage-landed' : ' idle'}`} data-tier={spin?.tier}>
            <div className="reel-window" aria-hidden="true">
              <div className="reel-marker" />
              {spin && p ? (
                <div className="reel-strip jw-static">
                  <div className="reel-card item-card landed" data-tier={spin.tier}>
                    <span className="code">{playerCard(p, spin.tier).face}</span>
                    <span className="item-lbl">{playerCard(p, spin.tier).label}</span>
                  </div>
                </div>
              ) : (
                <div className="mspin-idle">?</div>
              )}
            </div>
          </div>
        )}
      </div>
      {!spin && (
        <>
          <p className="help" style={{ margin: 0 }}>
            One case from this wheel's players, each at his best season and ranked into the reel's colours. Once it is open it is your January deal: bring him into a slot he can cover, or keep your XI.
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn primary big display"
              disabled={empty}
              onClick={() => {
                unlockAudio()
                setOpened(true)
                setLanded(false)
                januarySpin()
              }}
              data-testid="january-spin-open"
            >
              Open the January case
            </button>
            <button type="button" className="btn ghost" onClick={onBack} data-testid="january-back">
              Back
            </button>
          </div>
        </>
      )}
      {/* The reel is hidden from screen readers: the landing is said once, here */}
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="january-spin-live">
        {opened && landed && p ? `${p.name} landed. ${choices.length ? 'Choose his slot, or keep your XI' : 'He fits no slot of your XI'}` : ''}
      </span>
      {spinning && (
        <button type="button" className="reel-skip" onClick={() => setSkip((n) => n + 1)} data-testid="january-spin-skip">
          Tap to skip
        </button>
      )}
      {spin && p && landed && (
        <div className="jw-landed col" data-testid="january-spin-landed" data-tier={spin.tier}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <TierChip tier={spin.tier} />
            <span className="small muted">{choices.length ? 'Choose his slot, or keep your XI' : 'He fits no slot of your XI'}</span>
          </div>
          <PlayerRow p={p} showClub hideRatings={hide} />
          <div className="jw-slots" role="listbox" aria-label="His slot">
            {choices.map((c, i) => {
              const gain = c.rating - c.outRating
              return (
                <button ref={i === 0 ? action : undefined} key={c.slotId} type="button" role="option" aria-selected={slot === c.slotId} className={`jw-slot${slot === c.slotId ? ' on' : ''}`} onClick={() => setSlot(slot === c.slotId ? null : c.slotId)} data-testid="january-spin-choice">
                  <span className="jw-slot-pos">{c.label}</span>
                  <span className="jw-slot-out">for {c.outName}</span>
                  {hide ? (
                    <b>? v {c.outRating}</b>
                  ) : (
                    <b className={gain > 0 ? 'up' : gain < 0 ? 'down' : ''}>
                      {c.rating} v {c.outRating} ({gain >= 0 ? '+' : ''}
                      {gain})
                    </b>
                  )}
                  {c.fit === 'can cover' && <span className="chip">covers</span>}
                </button>
              )
            })}
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <button type="button" className="btn primary" disabled={!chosen} onClick={() => chosen && closeJanuarySpin(chosen.slotId)} data-testid="january-spin-sign">
              {chosen ? `Bring ${p.name.split(/\s+/).slice(-1)[0]} in for ${chosen.outName.split(/\s+/).slice(-1)[0]}` : 'Choose a slot'}
            </button>
            <button ref={choices.length ? undefined : action} type="button" className="btn" onClick={() => closeJanuarySpin(null)} data-testid="january-spin-keep">
              Keep my XI
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The January Upgrader: the Upgrader's stage on the XI; once the dial lands, the second half is played with the result. */
function JanuaryUpgrade({ j, xi, hide, onBack }: { j: QuickJanuary; xi: PlayerSeason[]; hide: boolean; onBack: () => void }) {
  const { januaryUpgrade, closeJanuary } = useStore()
  const ratingOf = (id: string) => xi.find((p) => p.id === id)?.overall ?? 0
  return (
    <div className="jw-upgrade" data-testid="january-upgrade">
      <UpgraderStage
        players={xi}
        ratingOf={ratingOf}
        hideRatings={hide}
        result={j.upgrade}
        onConfirm={(id, boost) => januaryUpgrade(id, boost)}
        doneLabel="Play the second half"
        onDone={() => closeJanuary(null)}
        back={
          <button type="button" className="btn ghost" onClick={onBack} data-testid="january-back">
            Back
          </button>
        }
        intro={<p className="help" style={{ margin: 0 }}>One of your XI, one boost, the second half. Lose and he drops by half the boost. No undo.</p>}
      />
    </div>
  )
}
