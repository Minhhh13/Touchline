import { useEffect, useMemo, useRef, useState } from 'react'
import { Dices, Ghost, Package, Trophy } from 'lucide-react'
import { useStore } from '@game/store'
import { QUICK_RULES, SEASON_RULES, benchPlaces, forcedSlotOf, hasMode, benchRoom, canBench, canCloseBench, canSpin, canUse, chainAllows, chainBreakDue, eligibleSlots, fillingXI, isComplete, nationAllows, neededPositions, nextSpinTwisted, openSlots, picksMade, positionFirst, rulesTags, spinClubSeason, spinnableSlots, suggestSlot, targetSlot, twistDecade, upgraderOn, type DraftState } from '@engine/draft'
import { isIcons } from '@engine/icons'
import { canUpgrade, upgradeBaseRating, upgradeCandidates } from '@engine/upgrader'
import { tierOdds } from '@game/logic/tierOdds'
import { bestPick, pickGrades, type PickGrade } from '@game/logic/pickGrades'
import { ratingHidden, ratingShown, revealsOnPick } from '@game/logic/ratingVisibility'
import { SpinOdds } from '../components/SpinOdds'
import { Upgrader } from '../components/Upgrader'
import { PowerUpTray } from '../components/PowerUps'
import { powerUpsOn, trayKinds } from '@engine/powerups'
import { LockerBar } from '../components/Locker'
import { powerUpLog } from '@game/logic/powerups'
import { bestFit, describeFit } from '@engine/positions'
import type { PlayerSeason, Position } from '@engine/types'
import { CaseReel, TierChip, TierDot } from '../components/CaseReel'
import { MODE_INFO, SPEEDRUN_SECONDS, activeModeCards } from '@engine/modes'
import { TWIST_INFO, TwistCard } from '../components/TwistCard'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, EstimatedChip, Info, Pos, Rating, Segmented, Tip } from '../components/bits'
import { MODE_ICON, PowerUpIcon, TWIST_ICON } from '../components/icons'
import { clubName, nationName, ordinal, seasonLabel, formationName } from '../format'
import { NationFlag } from '../components/Flag'
import { playerLookup } from '@game/logic/players'
import { finishDraftLabel } from '@game/logic/modes'
import { challengeHeadline } from '@game/logic/arenaClaim'
import { CapChip, CapChips } from '../components/CapControl'
import { ChainChip, ChainLogNote, ChainStatus } from '../components/ChainControl'
import { eraFirstSeason } from '@game/logic/era'
import { draftSlotChoices } from '@game/logic/slotSheet'
import { costLabel, slotRating, slotRatingLine } from '@game/logic/slotRating'
import { draftTurnKey } from '@game/logic/draftTurn'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { DRAFT } from '../boxSets'
import { useFocusOnLanding } from '../a11y'
import { tierTable, type TierTable } from '@game/logic/rarity'
import { draftReelPool, reelLeagues } from '@game/logic/reel'
import { canPickManager, quickManagerOptions } from '@game/logic/managers'
import { resultsFinished } from '@game/logic/onboarding'
import { ManagerPick } from '../components/ManagerPick'
import { DraftRecap } from '../components/DraftRecap'
import { draftRecap } from '@game/logic/draftRecap'
import { playSound } from '../sound/synth'

const GROUPS: Array<{ label: string; positions: Position[] }> = [
  { label: 'Goalkeepers', positions: ['GK'] },
  { label: 'Defenders', positions: ['CB', 'LB', 'RB'] },
  { label: 'Midfielders', positions: ['DM', 'CM', 'AM'] },
  { label: 'Forwards', positions: ['LW', 'RW', 'ST'] },
]

export function Draft() {
  const { universe: u, game, spin, respin, chooseSlot, pickPlayer, autoDraftRest, speedrunPick, finishDraft, pickManager, go, showToast, upgradePlayer } = useStore()
  // A manager's first draft ever (nothing finished yet): one plain line under the first spin
  const firstDraft = useStore((s) => resultsFinished(s.profile) === 0)
  // The spin whose reel has landed. A new spin or re-spin is a new `current` object, so it reads as spinning in
  // the same render the store hands it over: no stale squad, no stale landed state, no second re-spin mid-reel
  const [settled, setSettled] = useState<DraftState['current']>(null)
  // A selected player belongs to the draft turn he was selected on (`draftTurnKey`): a pick or a Speedrun timeout drops him
  const [picked, setPicked] = useState<{ id: string; turn: string } | null>(null)
  // The Upgrader's dial is turning: the Speedrun clock waits for it as it waits for the reel
  const [dialRolling, setDialRolling] = useState(false)
  const [sort, setSort] = useState<'rating' | 'position'>('rating')
  const d = game?.draft
  const get = useMemo(() => (game && u ? playerLookup(game, u) : () => undefined), [game, u])

  const spinning = !!d?.current && settled !== d.current
  const revealed = !!d?.current && settled === d.current
  const turn = d ? draftTurnKey(d) : ''
  const selectedPlayer = picked && picked.turn === turn ? picked.id : null
  const setSelectedPlayer = (id: string | null) => setPicked(id && d ? { id, turn } : null)

  // The reel: the draft's leagues, their tiers, and what this spin could land on (recomputed per spin and per pick)
  const leagues = useMemo(() => (u && d ? reelLeagues(u, d.rules) : []), [u, d?.rules])
  const tiers = useMemo<TierTable>(() => (u ? tierTable(u, leagues) : {}), [u, leagues])
  const pool = useMemo(
    () => (u && d ? draftReelPool(u, d) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, d?.spins, d?.rules, d?.history.length],
  )

  // The exact odds of each rarity tier on the next spin (a re-spin while one is showing), from the engine's own draw
  const odds = useMemo(() => (u && d && !isComplete(d) ? tierOdds(u, d, leagues) : []), [u, d, leagues])

  // A one-nation wheel can run out of eligible players; checked after every pick, not only on a spin
  const dry = useMemo(() => !!u && !!d && !d.current && !isComplete(d) && !canSpin(u, d), [u, d])
  // Teammate Chain: whether the next spin is a free one because no teammate of the last pick is left on the wheel
  const chainDue = useMemo(() => !!u && !!d && !d.current && !isComplete(d) && chainBreakDue(u, d), [u, d])
  // Position First: the open slots a spin could fill, offered on the pitch before each spin
  const choosable = useMemo(() => (u && d && positionFirst(d) && !d.current ? spinnableSlots(u, d).map((s) => s.id) : []), [u, d])

  // Speedrun: a clock per pick, paused while the reel runs (and while the Upgrader's dial turns). It is only the UI's; on expiry the assistant makes the pick
  // through the store (`speedrunPick`), a deterministic choice, so a replay of the same picks lands the same way
  const speedrun = !!d && hasMode(d.rules, 'speedrun') && !isComplete(d) && !dry
  const pickNo = d ? picksMade(d) : 0
  const [clock, setClock] = useState(SPEEDRUN_SECONDS)
  useEffect(() => setClock(SPEEDRUN_SECONDS), [pickNo])
  // The "revealed" moment: a pick made without seeing his rating flips it in on the pitch and in the log, once, in this view
  const [revealId, setRevealId] = useState<string | null>(null)
  const picksSeen = useRef(pickNo)
  useEffect(() => {
    const before = picksSeen.current
    picksSeen.current = pickNo
    if (!d || pickNo <= before) return
    playSound({ id: 'pick' })
    const last = [...d.history].reverse().find((h) => h.pickedId)
    setRevealId(last?.pickedId && revealsOnPick(d.rules, last.twist) ? last.pickedId : null)
    const t = window.setTimeout(() => setRevealId(null), 1200)
    return () => window.clearTimeout(t)
  }, [pickNo])
  const paused = spinning || dialRolling
  useEffect(() => {
    if (!speedrun || paused) return
    const t = setInterval(() => setClock((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [speedrun, paused])
  useEffect(() => {
    if (!speedrun || paused || clock > 0) return
    setClock(SPEEDRUN_SECONDS)
    setSelectedPlayer(null)
    speedrunPick()
  }, [clock, speedrun, paused, speedrunPick])

  // On a phone the columns stack, so the landed squad would sit under the wheel: bring it on screen when it is revealed
  const squadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!revealed || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 720px)').matches) return
    squadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [revealed])
  // The landing moves the focus to the club's name (the Spin button under it is disabled), so the squad is the next Tab
  const clubHeadRef = useRef<HTMLHeadingElement>(null)
  useFocusOnLanding(revealed, clubHeadRef)

  const allBoxes = useBoxes(DRAFT)
  if (!u || !game || !d) return null
  const current = spinClubSeason(u, d)
  const iconsSpin = isIcons(d.current)
  // Odds before each spin, and before a re-spin while one is showing and re-spins are left
  const oddsLabel = !d.current ? (positionFirst(d) && !targetSlot(d) ? 'Next spin, any open slot' : 'Next spin') : d.respinsLeft > 0 ? 'If you re-spin' : null
  // Blind mode and a blind spin hide the ratings of the players on offer until the pick; the squad always shows his
  const twist = d.twist ?? null
  const hide = ratingHidden(d.rules, 'offer', { twist })
  const hideSquad = ratingHidden(d.rules, 'squad')
  const choosing = positionFirst(d) && !d.current && !isComplete(d)
  // Position First: the slot this spin fills, kept until the pick; the list lights up whoever can play there
  const target = targetSlot(d)
  const modeCards = activeModeCards(d.rules)
  // Hard shows as a mode chip when the Modes row is in play, so the tag line does not say it twice
  const tags = rulesTags(d.rules, game.settings.mode === 'season' || game.settings.mode === 'dynasty' ? SEASON_RULES : QUICK_RULES).filter((t) => !(t === 'Hard' && modeCards.length > 1))
  const forced = forcedSlotOf(d)
  const surprise = d.surprise && d.surprise.atSpin === d.spins && !d.current ? d.surprise : null
  const complete = isComplete(d)
  // Pick grades once the squad is complete (nothing left to choose, so blind mode shows them too): each XI pick against the best on its spin
  const graded = ratingShown(d.rules, 'grades', { complete }) ? pickGrades(u, d, get) : []
  const grades = new Map(graded.map((g) => [g.spin, g]))
  const top = bestPick(graded)
  const gradeLine = top ? `Best pick: spin ${top.spin + 1}, ${get(top.pickedId)?.name ?? ''} (${top.grade}) · ${graded.filter((g) => g.grade === 'A').length} of ${graded.length} picks graded A` : null
  // A Quick Draft bench: the XI's eleven picks, then up to `places` more, optional
  const places = benchPlaces(d.rules)
  const total = places ? 11 + places : d.rules.squadSize
  const made = picksMade(d)
  const canClose = canCloseBench(d)
  const roomOnBench = benchRoom(d)
  const fillingStarters = fillingXI(d)
  const needs = neededPositions(d)
  const selected = selectedPlayer ? get(selectedPlayer) : undefined
  const selectedEligible = selected ? eligibleSlots(d, selected).map((s) => s.id) : []
  const isDynastySummer = game.settings.mode === 'dynasty' && game.year > 1
  // The power-ups used, newest first, above the spins in the draft log
  const puLog = powerUpLog(d, (id) => get(id)?.name ?? 'your player', seasonLabel).sort((a, b) => b.at - a.at)
  // Quick Draft managers: offered once the draft is done or may close, from the club-seasons drafted
  const managerChoice = !d.current && !spinning && canPickManager(game, u) ? quickManagerOptions(game) : []

  const nation = d.rules.onlyNation
  const nationLabel = nation ? (
    <>
      <NationFlag nation={nation} named /> {nationName(u, nation)}
    </>
  ) : null
  // The ghost: what the challenger did on this spin number. Hidden in blind mode while choosing, and absent when the picks could not be resolved on this data
  const challenge = game.settings.challenge
  const ghost = challenge && ratingShown(d.rules, 'ghost') && d.current && d.spins > 0 ? challenge.picks[d.spins - 1] : undefined
  const ghostPlayer = ghost?.id ? get(ghost.id) : undefined
  const ghostSameWheel = !!ghost && !!d.current && ghost.clubId === d.current.clubId && ghost.season === d.current.season

  // Through the lookup, so Prime ratings show in the list
  const squad = current ? current.squad.map((p) => get(p.id) ?? p) : []
  const usable = (p: PlayerSeason) => canUse(d, p) || canBench(d, p)

  const onPick = (p: PlayerSeason) => {
    if (!usable(p)) return
    const slots = eligibleSlots(d, p)
    if (fillingStarters) {
      // With bench room a pick may go either way, so the manager chooses; a player who fits no open slot goes to the bench
      if (!slots.length) pickPlayer(p.id, 'bench')
      else if (slots.length === 1 && !roomOnBench) pickPlayer(p.id, slots[0].id)
      else setSelectedPlayer(p.id)
    } else {
      pickPlayer(p.id, 'bench')
    }
  }
  const onSlot = (slotId: string) => {
    if (choosing) {
      if (choosable.includes(slotId)) chooseSlot(slotId)
      else if (d.lineup[slotId]) showToast('That slot is filled')
      else showToast('No club left on the wheel can fill that slot')
      return
    }
    if (!selected) return
    if (!selectedEligible.includes(slotId)) {
      showToast(`${selected.name} cannot play there`)
      return
    }
    pickPlayer(selected.id, slotId)
    setSelectedPlayer(null)
  }
  const sortedSquad = [...squad].sort((a, b) => (sort === 'rating' ? b.overall - a.overall : GROUPS.findIndex((g) => g.positions.includes(a.positions[0])) - GROUPS.findIndex((g) => g.positions.includes(b.positions[0])) || b.overall - a.overall))

  // The Boxes control: the side boxes this draft has now (the reel and the landed squad always stay)
  const benchBox = d.bench.length > 0 || !fillingStarters || places > 0
  const boxes = allBoxes.only([...(complete ? [] : ['needs']), ...(d.history.length > 0 || puLog.length > 0 ? ['log'] : []), 'pitch', ...(benchBox ? ['bench'] : [])])
  const pitchCol = boxes.on('pitch') || (benchBox && boxes.on('bench'))
  const draftGrid = boxes.grid([
    { track: '300px', ids: [] },
    { track: 'minmax(0, 1fr)', ids: [] },
    { track: '360px', ids: ['pitch', 'bench'] },
  ])
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{isDynastySummer ? `Summer draft · Year ${game.year}` : game.settings.mode === 'runin' ? 'Reinforcements' : 'The draft'}</h1>
          <div className="screen-meta">
            <span>
              {game.settings.teamName} · {formationName(game.settings.formationId)}
            </span>
            {challenge && <span className="chip info">vs {challenge.name} · {challengeHeadline(challenge, game.settings.arena?.format)}</span>}
            {d.rules.onlyClub && <span className="chip">{clubName(u, d.rules.onlyClub)} only</span>}
            {nation && <span className="chip">{nationLabel} only</span>}
            {(d.rules.fromSeason || d.rules.toSeason) && (
              <span className="chip">
                {seasonLabel(eraFirstSeason(u, d.rules))} to {seasonLabel(d.rules.toSeason ?? u.lastSeason)}
              </span>
            )}
            {tags.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
            {d.rules.classic && <span className="chip">Classic seasons</span>}
            {d.rules.twists && <span className="chip">Twists</span>}
            {d.rules.chain && <span className="chip">Teammate chain</span>}
            <span className="mono">seed {game.settings.seed}</span>
          </div>
          {((modeCards.length > 0 && (modeCards.length > 1 || modeCards[0] !== 'hard')) || powerUpsOn(d)) && (
            <div className="pill-list" data-testid="draft-modes" style={{ marginTop: 6 }}>
              {modeCards.map((c) => {
                const Icon = MODE_ICON[c]
                return (
                  <span key={c} className="chip" title={MODE_INFO[c].line}>
                    <Icon size={12} aria-hidden="true" /> {MODE_INFO[c].title}
                  </span>
                )
              })}
              {powerUpsOn(d) && (
                <span className="chip" title="Six one-use power-ups in the tray under the reel">
                  <Package size={12} aria-hidden="true" /> Power-ups
                </span>
              )}
            </div>
          )}
        </div>
        <div className="draft-progress">
          <div className="row between" style={{ gap: 'var(--space-2)' }}>
            <span className="draft-count" data-testid="pick-count" role="img" aria-label={places && !fillingStarters ? `Bench ${d.bench.length} of ${places}` : `Pick ${Math.min(made + 1, total)} of ${total}`}>
              {places && !fillingStarters ? (
                <>
                  <span className="eyebrow">Bench</span> <b>{d.bench.length}</b> / {places}
                </>
              ) : (
                <>
                  <span className="eyebrow">Pick</span> <b>{Math.min(made + 1, total)}</b> / {total}
                </>
              )}
            </span>
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              {speedrun && (
                <span className={`chip speedrun-clock ${clock <= 5 ? 'low' : ''}`} data-testid="speedrun-clock" aria-live="off" title="Speedrun: the assistant picks when the clock runs out">
                  ⏱️ {clock}s
                </span>
              )}
              {game.bonusSpins > 0 && <span className="chip gold">+{game.bonusSpins} bonus</span>}
              <CapChip d={d} />
              <BoxesMenu groups={[boxes]} />
              <button className="btn ghost sm" onClick={() => go('home')}>
                Home
              </button>
            </span>
          </div>
          <div className="pick-track" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={i < made ? 'done' : i === made && !complete ? 'now' : ''} />
            ))}
          </div>
        </div>
      </div>

      <div className={`grid draft fill ${draftGrid.className}`} style={draftGrid.style}>
        {/* Wheel column */}
        <div className="col">
          <div className="panel col">
            {d.rules.twists && !complete && <TwistCard twist={twist} decade={twistDecade(d)} next={!d.current && !dry && nextSpinTwisted(d)} every={hasMode(d.rules, 'crazy')} coming={d.current ? null : d.forcedTwist ?? null} />}
            {/* Once every pick is made the reel has nothing left to spin: a "Squad ready" line takes its place (U15) */}
            {complete && !d.current ? (
              <div className="draft-ready" data-testid="draft-ready">
                <span className="eyebrow">Squad ready</span>
                <b>{picksMade(d)} picks made</b>
              </div>
            ) : (
              <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} twist={twist ? TWIST_INFO[twist].title : null} estimated={!!current?.estimated} onSettled={() => setSettled(d.current)} />
            )}
            {oddsLabel && !complete && !dry && !spinning && <SpinOdds odds={odds} label={oddsLabel} />}
            {ghost && challenge && revealed && (
              <div className="chip info ghost-chip" data-testid="ghost-chip" title={`${challenge.name}'s spin ${d.spins}`}>
                <Ghost size={14} aria-hidden="true" />
                {ghost.id === null
                  ? `Last time here: ${challenge.name} re-spun`
                  : ghostPlayer
                    ? ghostSameWheel
                      ? `Last time here: ${ghostPlayer.name}`
                      : `${challenge.name}'s spin ${d.spins}: ${ghostPlayer.name} (${isIcons(ghost) ? 'Icons' : `${clubName(u, ghost.clubId)} ${seasonLabel(ghost.season)}`})`
                    : `${challenge.name}'s spin ${d.spins} is not in this data`}
              </div>
            )}
            {!complete && !dry && (!spinning || revealed) && <ChainStatus u={u} d={d} due={chainDue} />}
            {!complete && dry && (
              <div className="notice">
                No one left to draft for {nationLabel ?? 'this draft'}.{' '}
                {fillingStarters ? `Still open: ${needs.join(', ')}. Go home and widen the wheel.` : `Go on with the ${made} drafted.`}
              </div>
            )}
            {!complete && dry && !fillingStarters && (
              <button className="btn primary spin-btn display" onClick={() => finishDraft()}>
                {finishDraftLabel(game, made)}
              </button>
            )}
            {surprise && !complete && (
              <div className="notice" data-testid="crazy-surprise">
                🌀 <b>Surprise!</b>{' '}
                {surprise.kind === 'respin' ? 'A free re-spin is added to your budget.' : surprise.kind === 'golden' ? 'The next spin is golden: champions only.' : `The next pick must fill ${d.formation.slots.find((x) => x.id === surprise.slotId)?.position ?? 'a set slot'}.`}
              </div>
            )}
            {forced && !complete && !surprise && (
              <div className="notice small" data-testid="crazy-forced">
                🌀 Forced position: this pick fills {forced.position}; the wheel only stops on a club with someone who can play there.
              </div>
            )}
            {!complete && !dry && (
              <>
                {choosing && !forced && (
                  <div className="notice small" data-testid="position-first">
                    {target ? `Filling ${target.position}: the wheel only stops on a club with someone who can play there.` : 'Position First: tap an open slot on the pitch, then spin for a club to fill it.'}
                  </div>
                )}
                <button className="btn primary spin-btn display" disabled={!!d.current || spinning || (choosing && !target)} onClick={() => spin()}>
                  {d.current ? (spinning ? 'Spinning…' : 'Pick a player') : choosing ? (target ? `Spin for ${target.position}` : 'Choose a slot') : made === 0 ? 'Spin the wheel' : places && !fillingStarters ? 'Spin for the bench' : 'Spin again'}
                </button>
                {firstDraft && made === 0 && !d.current && !spinning && !choosing && (
                  <p className="help first-spin-help" data-testid="first-spin-help">
                    The wheel lands on a real club in a real season. Then you pick one of its players for your XI.
                  </p>
                )}
                {canClose && (
                  <button className="btn" disabled={spinning} onClick={() => finishDraft()} data-testid="finish-draft">
                    {d.bench.length ? `On to kick-off with ${d.bench.length} on the bench` : 'On to kick-off without a bench'}
                  </button>
                )}
                <div className="row between wrap">
                  <button className="btn sm" disabled={!d.current || spinning || d.respinsLeft <= 0} onClick={() => respin()}>
                    Re-spin ({d.respinsLeft})
                  </button>
                  <button className="btn sm ghost" disabled={spinning} onClick={() => confirm('Let the assistant finish the draft automatically?') && autoDraftRest()}>
                    Auto-complete
                  </button>
                </div>
              </>
            )}
            {complete && (
              <button className="btn primary spin-btn display" onClick={() => finishDraft()}>
                {finishDraftLabel(game)}
              </button>
            )}
          </div>
          {/* Nothing left to need once the squad is complete ("Squad ready" says so above) */}
          {!complete && boxes.on('needs') && (
            <div className="panel tight">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                {fillingStarters ? 'Still need' : `Bench · ${total - made} more pick${total - made === 1 ? '' : 's'}${places ? ', optional' : ''}`}
              </div>
              <div className="pill-list">
                {needs.map((p) => (
                  <Pos key={p} p={p} />
                ))}
              </div>
              {!fillingStarters && !dry && <Tip id="draft-bench">Bench picks can be anyone un-drafted; cover every position, injuries will come.</Tip>}
            </div>
          )}
          {(d.history.length > 0 || puLog.length > 0) && boxes.on('log') && (
            <div className="panel tight">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Draft log
              </div>
              {puLog.length > 0 && (
                <div className="col pu-log" data-testid="power-up-log" style={{ gap: 2 }}>
                  {puLog.map((l, i) => (
                    <div key={i} className="row small" style={{ gap: 8 }}>
                      <PowerUpIcon kind={l.kind} size={14} />
                      <span>{l.text}</span>
                    </div>
                  ))}
                </div>
              )}
              {gradeLine && (
                <div className="small muted" data-testid="best-pick" style={{ marginBottom: 'var(--space-2)' }}>
                  {gradeLine}
                </div>
              )}
              <ol className="draft-log">
                {[...d.history].reverse().map((h, i) => {
                  const p = h.pickedId ? get(h.pickedId) : undefined
                  const TwistIcon = h.twist ? TWIST_ICON[h.twist] : null
                  const tier = tiers[`${h.clubId}@${h.season}`]
                  // The pick before this one, for the chain's link
                  const at = d.history.length - 1 - i
                  const prevId = d.rules.chain ? d.history.slice(0, at).reverse().find((x) => x.pickedId)?.pickedId : undefined
                  return (
                    <li key={i}>
                      {isIcons(h) ? <span className="icons-badge" style={{ width: 22, height: 22 }} role="img" aria-label="Icons collection">★</span> : <ClubBadge clubId={h.clubId} size={22} />}
                      <span className="who">
                        <span className={p ? 'name' : 'muted'}>{p ? p.name : h.skipped ? 'Skipped' : 'Re-spun'}</span>
                        <span className="when">
                          {isIcons(h) ? <TierDot tier="icons" /> : tier && <TierDot tier={tier} />}
                          {isIcons(h) ? 'Icons' : seasonLabel(h.season)}
                          {grades.has(at) && (
                            <span className={`chip pick-grade ${GRADE_CLASS[grades.get(at)!.grade]}`} data-testid="pick-grade" title={`${grades.get(at)!.rating} in his slot; the best on that spin was ${grades.get(at)!.best} (${grades.get(at)!.bestName})`}>
                              {grades.get(at)!.grade}
                            </span>
                          )}
                          {h.twist && TwistIcon && (
                            <span className="log-twist" title={TWIST_INFO[h.twist].title} role="img" aria-label={TWIST_INFO[h.twist].title}>
                              <TwistIcon size={12} aria-hidden="true" />
                            </span>
                          )}
                        </span>
                      </span>
                      {/* A pick is in the squad, so his rating shows, flipping in when it was hidden while choosing */}
                      {p && <Rating value={p.overall} hidden={hideSquad} reveal={p.id === revealId} />}
                      {p && d.rules.chain && <ChainLogNote u={u} h={h} prevName={prevId ? get(prevId)?.name : undefined} name={p.name} />}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>

        {/* Squad list column */}
        {/* The power-ups sit over the landed squad, so the reel's column stays one box high on a desktop */}
        <div className="panel col draft-squad" ref={squadRef} data-testid="draft-squad">
          <LockerBar game={game} busy={spinning} />
          {trayKinds(d).length > 0 && <PowerUpTray u={u} d={d} get={get} hideRatings={hideSquad} busy={spinning} onRerolled={() => setSelectedPlayer(null)} onRolling={setDialRolling} />}
          {!powerUpsOn(d) && upgraderOn(d.rules) && d.upgradeRng && (
            <Upgrader
              turn={turn}
              onRolling={setDialRolling}
              players={upgradeCandidates(d).flatMap((id) => get(id) ?? [])}
              ratingOf={(id) => upgradeBaseRating(u, d, id) ?? 0}
              available={canUpgrade(d) && game.phase === 'draft'}
              result={d.upgrade}
              hideRatings={hideSquad}
              onConfirm={(id, boost) => upgradePlayer(id, boost)}
            />
          )}
          {!current && managerChoice.length > 0 && <ManagerPick options={managerChoice} picked={game.manager?.id ?? null} onPick={pickManager} />}
          {!current && !managerChoice.length && complete && <DraftRecap recap={draftRecap(u, d, get, ratingShown(d.rules, 'grades', { complete }))} get={get} slotName={(id) => d.formation.slots.find((x) => x.id === id)?.position ?? id} />}
          {!current && !managerChoice.length && !complete && (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <Dices size={26} />
              </span>
              <h3>
                {isDynastySummer ? `${total - made} summer spin${total - made === 1 ? '' : 's'} to add depth` : 'Spin for a club and a season'}{' '}
                <Info label="How the wheel works">
                  {isDynastySummer ? 'Your squad carries over, best eleven on the pitch; each spin adds one player, and the summer market is open in the Dugout. ' : ''}The wheel only stops on squads with someone who fits a slot you still need, so there are no dead spins. Each player can be drafted once, whichever season you catch him in.
                </Info>
              </h3>
              <p className="muted small">Then pick one player from that squad.</p>
            </div>
          )}
          {current && spinning && !revealed && (
            <div className="club-head">
              <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
              <div>
                <h2>Opening…</h2>
                <div className="muted small">Landing on a club and a season</div>
              </div>
            </div>
          )}
          {current && (!spinning || revealed) && (
            <>
              <div className="row between wrap">
                <div className="club-head">
                  {iconsSpin ? <span className="icons-badge" style={{ width: 44, height: 44 }} aria-hidden="true">★</span> : <ClubBadge clubId={current.clubId} size={44} />}
                  {iconsSpin ? (
                    <div data-testid="icons-header">
                      <h2 ref={clubHeadRef} tabIndex={-1}>Icons collection</h2>
                      <div className="club-sub">
                        <span>The {current.squad.length} best players of all time on this wheel, each at his peak</span>
                        <TierChip tier="icons" />
                      </div>
                    </div>
                  ) : (
                  <div>
                    <h2 ref={clubHeadRef} tabIndex={-1}>{clubName(u, current.clubId)}</h2>
                    <div className="club-sub">
                      <span>{seasonLabel(current.season)}</span>
                      {!current.complete ? (
                        <span>season in progress</span>
                      ) : current.champions ? (
                        <span className="chip gold icon-chip">
                          <Trophy size={12} aria-hidden="true" /> Champions
                        </span>
                      ) : current.position > 0 ? (
                        <span>
                          {ordinal(current.position)} · {current.points} pts
                        </span>
                      ) : (
                        <span>final table not on record</span>
                      )}
                      {current.position > 0 && (
                        <span className="mono">
                          {current.won}-{current.drawn}-{current.lost}
                        </span>
                      )}
                      {tiers[`${current.clubId}@${current.season}`] && <TierChip tier={tiers[`${current.clubId}@${current.season}`]} />}
                      {current.estimated && <EstimatedChip compact />}
                    </div>
                  </div>
                  )}
                </div>
                <Segmented<'rating' | 'position'> value={sort} onChange={setSort} options={[{ value: 'rating', label: 'By rating' }, { value: 'position', label: 'By position' }]} />
              </div>
              {!revealed && spinning && <div className="notice">The reel is running…</div>}
              {revealed && twist === 'blind' && <div className="notice">Blind pick: ratings stay hidden until you choose.</div>}
              {revealed && selected && (
                <div className="notice slot-choices" data-testid="slot-choices">
                  <div>
                    Where does <b>{selected.name}</b> play? Tap a slot here or on the pitch.
                  </div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {draftSlotChoices(d, selected).map((c) => {
                      // Led by the number his pitch disc will show there, with his overall and the cost (DESIGN_SYSTEM.md, ratings)
                      const r = slotRating(selected, c.position)
                      return (
                        <button key={c.slotId} type="button" className={`chip slot-chip ${c.fit === 'fits' ? 'good' : 'warn'}`} data-testid="slot-chip" onClick={() => onSlot(c.slotId)} title={hide ? undefined : slotRatingLine(r, c.label, { attributes: true })} aria-label={hide ? `${c.label}, ${c.fit}` : `${slotRatingLine(r, c.label)}, ${c.fit}`}>
                          <b>{c.label}</b> {hide ? '?' : r.inSlot} · {c.fit}
                          {!hide && r.cost > 0 && (
                            <span className="slot-cost" data-testid="slot-cost">
                              {' '}({r.overall} overall, {costLabel(r)})
                            </span>
                          )}
                        </button>
                      )
                    })}
                    {canBench(d, selected) && (
                      <button type="button" className="btn sm" onClick={() => { pickPlayer(selected.id, 'bench'); setSelectedPlayer(null) }} data-testid="to-bench">
                        Send him to the bench
                      </button>
                    )}
                    <button type="button" className="btn sm ghost" onClick={() => setSelectedPlayer(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {revealed && fillingStarters && (
                <Tip id="draft-first-reveal">Tap a player to draft him. The number is his overall rating: green fits is his own position, amber can cover plays him out of position for a few points less. Your re-spins last the whole draft.</Tip>
              )}
              {revealed && (
                <div className="plist lined draft-list">
                  {sortedSquad.map((p) => {
                    const ok = usable(p)
                    const taken = d.takenPlayers.includes(p.playerId)
                    const foreign = !nationAllows(d, p)
                    const slots = eligibleSlots(d, p)
                    const best = fillingStarters ? bestFit(slots.map((s) => describeFit(p, s.position))) : undefined
                    return (
                      <PlayerRow
                        key={p.id}
                        p={p}
                        dim={!ok}
                        selected={selectedPlayer === p.id}
                        highlight={!!target && ok}
                        hideRatings={hide}
                        showClub={iconsSpin}
                        hideChampion={current.champions}
                        onClick={() => onPick(p)}
                        extra={<><ChainChip u={u} d={d} p={p} show={!taken && !foreign} /><CapChips d={d} p={p} show={!taken && !foreign && chainAllows(d, p)} />{taken ? <span className="chip">already drafted</span> : foreign ? <span className="chip">not {nationName(u, nation ?? '')}</span> : fillingStarters && slots.length ? <span className={`chip ${best === 'natural' ? 'good' : 'warn'}`}>{best === 'natural' ? 'fits' : 'can cover'} {[...new Set(slots.map((s) => s.position))].join('/')}</span> : null}</>}
                        right={ok ? <span className={`btn sm ${selectedPlayer === p.id ? 'primary' : ''}`}>{fillingStarters && slots.length ? 'Draft' : 'Bench'}</span> : null}
                      />
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pitch column */}
        {pitchCol && (
        <div className="col draft-pitch">
          {boxes.on('pitch') && (
          <div className="panel">
            <div className="panel-head">
              <h3>{formationName(game.settings.formationId)}</h3>
              <span className={`chip ${Object.keys(d.lineup).length === 11 ? 'good' : ''}`}>{Object.keys(d.lineup).length}/11 starters</span>
            </div>
            <Pitch formation={d.formation} lineup={d.lineup} getPlayer={get} onSlotClick={onSlot} eligibleSlots={choosing ? choosable : selectedEligible} selectedSlot={target?.id ?? null} hideRatings={hideSquad} revealId={revealId} />
            {selected && suggestSlot(d, selected) && suggestSlot(d, selected) !== 'bench' && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(suggestSlot(d, selected) as string)}>
                Put {selected.name} at {openSlots(d).find((s) => s.id === suggestSlot(d, selected))?.position}
              </button>
            )}
          </div>
          )}
          {benchBox && boxes.on('bench') && (
            <div className="panel" data-testid="draft-bench">
              <div className="panel-head">
                <h3>Bench</h3>
                <span className="chip">{places ? `${d.bench.length}/${places}` : d.bench.length}</span>
              </div>
              <div className="plist lined">
                {d.bench.map((id) => {
                  const p = get(id)
                  return p ? <PlayerRow key={id} p={p} hideRatings={hideSquad} showClub /> : null
                })}
                {d.bench.length === 0 && <div className="muted small">{places ? (
                      <>
                        Up to {places}, optional.{' '}
                        <Info label="How the bench works">Send any pick here instead of a slot, or spin for the bench once the XI is full. In the season: 3 changes, and injured starters are covered from here.</Info>
                      </>
                    ) : (
                      'Bench picks follow the XI.'
                    )}</div>}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

const GRADE_CLASS: Record<PickGrade, string> = { A: 'good', B: 'info', C: 'warn', D: 'bad' }
