import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Dices, Ghost, Package, Swords, Trophy } from 'lucide-react'
import { useStore } from '@game/store'
import { useStorePick } from '../useStorePick'
import { QUICK_RULES, SEASON_RULES, benchPlaces, forcedSlotOf, hasMode, benchRoom, canBench, canCloseBench, canSpin, canUse, chainAllows, chainBreakDue, eligibleSlots, fillingXI, isComplete, nationAllows, neededPositions, nextSpinTwisted, openSlots, picksMade, positionFirst, rulesTags, spinClubSeason, spinnableSlots, suggestSlot, targetSlot, twistDecade, upgraderOn, type DraftState } from '@engine/draft'
import { isIcons } from '@engine/icons'
import { canUpgrade, upgradeBaseRating, upgradeCandidates } from '@engine/upgrader'
import { tierOdds } from '@game/logic/tierOdds'
import { bestPick, gradeNote, pickGrades, type PickGrade } from '@game/logic/pickGrades'
import { ratingHidden, ratingShown, revealsOnPick } from '@game/logic/ratingVisibility'
import { SpinOdds } from '../components/SpinOdds'
import { Upgrader } from '../components/Upgrader'
import { runInProjectedLineup } from '@game/logic/runin'
import { PowerUpTray } from '../components/PowerUps'
import { HoverTips } from '../components/PowerUpButton'
import { powerUpsOn, trayKinds } from '@engine/powerups'
import { LockerBar } from '../components/Locker'
import { powerUpLog } from '@game/logic/powerups'
import { fitGroups, fitsFirst, slotLabelText } from '../draftFit'
import type { PlayerSeason, Position } from '@engine/types'
import { CaseReel, TierChip, TierDot } from '../components/CaseReel'
import { SPEEDRUN_SECONDS, activeModeCards } from '@engine/modes'
import { TWIST_INFO, TwistCard } from '../components/TwistCard'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, EstimatedChip, Info, Pos, Rating, Segmented, Tip } from '../components/bits'
import { MODE_ICON, PowerUpIcon, TWIST_ICON } from '../components/icons'
import { clubName, nationName, seasonLabel, formationName } from '../format'
import { NationFlag } from '../components/Flag'
import { playerLookup } from '@game/logic/players'
import { useFinishDraft } from '../useArenaWarmup'
import { useAfterPaint } from '../afterPaint'
import { RUN_IN_SPINS } from '@game/logic/runin'
import { finishDraftText, modeText } from '../i18n/modeText'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'
import { rich, B } from '../i18n/rich'
import { challengeHeadline } from '@game/logic/arenaClaim'
import { CapChip, CapChips } from '../components/CapControl'
import { ChainChip, ChainLogNote, ChainStatus } from '../components/ChainControl'
import { eraFirstSeason } from '@game/logic/era'
import { draftSlotChoices } from '@game/logic/slotSheet'
import { slotRating } from '@game/logic/slotRating'
import { costText, fitText, slotRatingText } from '../slotRatingText'
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
import { askConfirm } from '../confirm'
import { pickBand } from '../sound/cues'
import { prefersReducedMotion } from '../motion'
import { modeCardLine, modeCardTitle, ruleTagText } from '../i18n/engineText'

const t = translator(draft)

const GROUPS: Array<{ positions: Position[] }> = [{ positions: ['GK'] }, { positions: ['CB', 'LB', 'RB'] }, { positions: ['DM', 'CM', 'AM'] }, { positions: ['LW', 'RW', 'ST'] }]

/** The bonus spins already heard in this visit (`game id:picks made`), so a revisit or a re-render rings nothing. */
const bonusHeard = new Set<string>()

export function Draft() {
  const { universe: u, game, spin, respin, chooseSlot, pickPlayer, autoDraftRest, speedrunPick, finishDraft, pickManager, go, showToast, upgradePlayer } = useStorePick('universe', 'game', 'spin', 'respin', 'chooseSlot', 'pickPlayer', 'autoDraftRest', 'speedrunPick', 'finishDraft', 'pickManager', 'go', 'showToast', 'upgradePlayer')
  // A manager's first draft ever (nothing finished yet): one plain line under the first spin
  const firstDraft = useStore((s) => resultsFinished(s.profile) === 0)
  // An arena run's first field pass is finished in slices with the busy state painted (useArenaWarmup.ts)
  const finishing = useFinishDraft(finishDraft)
  // Auto-complete paints its busy state (and the closed question) before the assistant drafts the rest
  const [autoBusy, runAuto] = useAfterPaint()
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
  // The odds panel follows the draft a moment later, in a render of its own (about 90 ms on a 4x-throttled phone), so
  // the screen's first render and each pick's are not held up by it; it starts empty
  const oddsDraft = useDeferredValue(d, null)
  const odds = useMemo(() => (u && oddsDraft && !isComplete(oddsDraft) ? tierOdds(u, oddsDraft, leagues) : []), [u, oddsDraft, leagues])

  // A one-nation wheel can run out of eligible players; checked after every pick, not only on a spin
  const dry = useMemo(() => !!u && !!d && !d.current && !isComplete(d) && !canSpin(u, d), [u, d])
  // Teammate Chain: whether the next spin is a free one because no teammate of the last pick is left on the wheel
  const chainDue = useMemo(() => !!u && !!d && !d.current && !isComplete(d) && chainBreakDue(u, d), [u, d])
  // Position First: the open slots a spin could fill, offered on the pitch before each spin
  const choosable = useMemo(() => (u && d && positionFirst(d) && !d.current ? spinnableSlots(u, d).map((s) => s.id) : []), [u, d])
  // A run-in's reinforcements go to the bench in the draft; the pitch shows the XI the job will start with
  const runInXI = useMemo(() => (u && game ? runInProjectedLineup(game, u) : null), [u, game])

  // Speedrun: a clock per pick, paused while the reel runs (and while the Upgrader's dial turns). It is only the UI's; on expiry the assistant makes the pick
  // through the store (`speedrunPick`), a deterministic choice, so a replay of the same picks lands the same way
  const speedrun = !!d && hasMode(d.rules, 'speedrun') && !isComplete(d) && !dry
  const pickNo = d ? picksMade(d) : 0
  const [clock, setClock] = useState(SPEEDRUN_SECONDS)
  useEffect(() => setClock(SPEEDRUN_SECONDS), [pickNo])
  // The "revealed" moment: a pick made without seeing his rating flips it in on the pitch and in the log, once, in this view
  const [revealId, setRevealId] = useState<string | null>(null)
  // Every pick lands with a pop on his pitch disc and his new log row (presentation only, gone after the moment)
  const [landedId, setLandedId] = useState<string | null>(null)
  const picksSeen = useRef(pickNo)
  useEffect(() => {
    const before = picksSeen.current
    picksSeen.current = pickNo
    if (!d || pickNo <= before) return
    const last = [...d.history].reverse().find((h) => h.pickedId)
    // The pick lands by his band (cues.ts `pickBand`), unless his rating is hidden in the squad: then the plain pick, which gives nothing away
    const picked = last?.pickedId ? get(last.pickedId) : undefined
    if (picked && !ratingHidden(d.rules, 'squad')) playSound({ id: 'pick-band', band: pickBand(picked.overall), reduced: prefersReducedMotion() })
    else playSound({ id: 'pick' })
    setRevealId(last?.pickedId && revealsOnPick(d.rules, last.twist) ? last.pickedId : null)
    setLandedId(last?.pickedId ?? null)
    const timer = window.setTimeout(() => {
      setRevealId(null)
      setLandedId(null)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [pickNo])
  // A bonus spin to draft (the Gauntlet's, a Dynasty summer's): its bells once per spin owed, in this visit
  const bonus = game?.bonusSpins ?? 0
  const owed = bonus > 0 && !!d && !isComplete(d)
  useEffect(() => {
    const key = `${game?.id}:${pickNo}`
    if (!owed || bonusHeard.has(key)) return
    bonusHeard.add(key)
    playSound({ id: 'bonus', reduced: prefersReducedMotion() })
  }, [game?.id, owed, pickNo])
  const paused = spinning || dialRolling
  useEffect(() => {
    if (!speedrun || paused) return
    const tick = setInterval(() => setClock((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(tick)
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
    // The club's head at the top of the screen (under the top bar, `scroll-margin-top`), so the best players are in view;
    // a frame later, so the focus moved to the club's name below (an instant scroll of its own) does not cut it short
    const frame = requestAnimationFrame(() => squadRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [revealed])
  // "Where does he play?" sits above the squad list: a player tapped further down brings it into view, so the slot
  // choice is never off screen (on a phone the page scrolls, on a desktop the squad box)
  const slotChoicesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedPlayer) return
    const box = slotChoicesRef.current
    box?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' })
    // Opened from a squad row (Enter, Space or a tap): the focus goes to the first choice, which sits above the rows in
    // the page's order, so a keyboard user is not left Tabbing away from it (QA r11)
    if (box && document.activeElement?.closest('.prow')) box.querySelector<HTMLElement>('[data-testid="slot-chip"], [data-testid="to-bench"]')?.focus({ preventScroll: true })
  }, [selectedPlayer])
  // The landing moves the focus to the club's name (the Spin button under it is disabled), so the squad is the next Tab
  const clubHeadRef = useRef<HTMLHeadingElement>(null)
  useFocusOnLanding(revealed, clubHeadRef)
  // After a pick the row that was pressed has gone: the focus goes to the next thing to press, Spin, or the finish button
  // once the squad is complete
  const spinRef = useRef<HTMLButtonElement>(null)
  const finishRef = useRef<HTMLButtonElement>(null)
  const draftDone = !!d && isComplete(d)
  useFocusOnLanding(!!d && !d.current && !spinning && pickNo > 0 && !draftDone, spinRef)
  useFocusOnLanding(draftDone, finishRef)

  const allBoxes = useBoxes(DRAFT)
  // The pick grades and the recap follow a beat behind (a deferred, interruptible render), so the tap that completes
  // the draft (Auto-complete, the last pick) is not also the one that grades every spin and searches the Hindsight XI
  const gradedDraft = useDeferredValue(d)
  const settledDone = !!gradedDraft && isComplete(gradedDraft)
  const settledGrades = !!gradedDraft && ratingShown(gradedDraft.rules, 'grades', { complete: settledDone })
  const gradedNow = useMemo(() => (u && gradedDraft && settledGrades ? pickGrades(u, gradedDraft, get) : []), [u, gradedDraft, settledGrades, get])
  const recapNow = useMemo(() => (u && gradedDraft && settledDone ? draftRecap(u, gradedDraft, get, settledGrades) : null), [u, gradedDraft, settledDone, settledGrades, get])
  // Only ever this draft's: a new draft never shows the last one's grades while the deferred render catches up
  const graded = gradedDraft === d ? gradedNow : []
  const recap = gradedDraft === d ? recapNow : null
  if (!u || !game || !d) return null
  const current = spinClubSeason(u, d)
  const iconsSpin = isIcons(d.current)
  // Odds before each spin, and before a re-spin while one is showing and re-spins are left
  const oddsLabel = !d.current ? t(positionFirst(d) && !targetSlot(d) ? 'oddsAnySlot' : 'oddsNext') : d.respinsLeft > 0 ? t('oddsRespin') : null
  // Blind mode and a blind spin hide the ratings of the players on offer until the pick; the squad always shows his
  const twist = d.twist ?? null
  const hide = ratingHidden(d.rules, 'offer', { twist })
  const hideSquad = ratingHidden(d.rules, 'squad')
  const choosing = positionFirst(d) && !d.current && !isComplete(d)
  // Position First: the slot this spin fills, kept until the pick; the list lights up whoever can play there
  const target = targetSlot(d)
  const modeCards = activeModeCards(d.rules)
  // Hard shows as a mode chip when the Modes row is in play, so the tag line does not say it twice
  const tags = rulesTags(d.rules, game.settings.mode === 'season' || game.settings.mode === 'dynasty' ? SEASON_RULES : QUICK_RULES).filter((tag) => !(tag === 'Hard' && modeCards.length > 1))
  const forced = forcedSlotOf(d)
  const surprise = d.surprise && d.surprise.atSpin === d.spins && !d.current ? d.surprise : null
  const complete = isComplete(d)
  // Pick grades once the squad is complete (nothing left to choose, so blind mode shows them too): each XI pick against the best on its spin
  const grades = new Map(graded.map((g) => [g.spin, g]))
  const slotPos = (id: string) => d.formation.slots.find((x) => x.id === id)?.position ?? id
  const top = bestPick(graded)
  const gradeLine = top ? t('gradeLine', { spin: top.spin + 1, name: get(top.pickedId)?.name ?? '', grade: top.grade, a: graded.filter((g) => g.grade === 'A').length, n: graded.length }) : null
  // A Quick Draft bench: the XI's eleven picks, then up to `places` more, optional
  const places = benchPlaces(d.rules)
  const total = places ? 11 + places : d.rules.squadSize
  const made = picksMade(d)
  const canClose = canCloseBench(d)
  const roomOnBench = benchRoom(d)
  const fillingStarters = fillingXI(d)
  // A run-in's draft starts with the club's own squad in it: the count is of the signings the brief gives, not the squad
  const signings = game.settings.mode === 'runin' ? { base: Math.max(0, total - RUN_IN_SPINS) } : null
  const needs = neededPositions(d)
  const selected = selectedPlayer ? get(selectedPlayer) : undefined
  const selectedEligible = selected ? eligibleSlots(d, selected).map((s) => s.id) : []
  const isDynastySummer = game.settings.mode === 'dynasty' && game.year > 1
  // A Gauntlet's bonus spin mid-run (after rungs 2, 4, 6 and 8): the heading says why the draft is back
  const gauntletBonus = game.arena?.format === 'gauntlet' && game.arena.step > 0
  // The power-ups used, newest first, above the spins in the draft log
  const puLog = powerUpLog(d, (id) => get(id)?.name ?? t('yourPlayer'), seasonLabel).sort((a, b) => b.at - a.at)
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
      else if (d.lineup[slotId]) showToast(t('slotFilled'))
      else showToast(t('slotNoClub'))
      return
    }
    if (!selected) return
    if (!selectedEligible.includes(slotId)) {
      showToast(t('cannotPlayThere', { name: selected.name }))
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
          <h1>{isDynastySummer ? t('summerDraft', { year: game.year }) : gauntletBonus ? t('gauntletBonus', { n: game.arena!.step }) : t(game.settings.mode === 'runin' ? 'reinforcements' : 'theDraft')}</h1>
          <div className="screen-meta">
            {/* What this draft is for, where its title does not say: the Daily, the Weekly, an arena format */}
            {(game.settings.mode === 'daily' || game.settings.mode === 'weekly' || game.settings.mode === 'arena') && (
              <span className="chip info" data-testid="draft-mode-chip">
                {modeText(game, 'short')}
              </span>
            )}
            <span>
              {game.settings.teamName} · {formationName(game.settings.formationId)}
            </span>
            {challenge && (
              <span className="chip challenge-chip" data-testid="challenge-playing">
                <Swords size={14} aria-hidden="true" />
                {rich(t('playingDraft', { name: challenge.name, headline: challengeHeadline(challenge, game.settings.arena?.format) }), B)}
              </span>
            )}
            {d.rules.onlyClub && <span className="chip">{t('clubOnly', { club: clubName(u, d.rules.onlyClub) })}</span>}
            {nation && <span className="chip">{rich(t('nationOnly'), { nation: () => nationLabel })}</span>}
            {(d.rules.fromSeason || d.rules.toSeason) && (
              <span className="chip">
                {t('seasonRange', { from: seasonLabel(eraFirstSeason(u, d.rules)), to: seasonLabel(d.rules.toSeason ?? u.lastSeason) })}
              </span>
            )}
            {tags.map((tag) => (
              <span key={tag} className="chip">
                {ruleTagText(tag)}
              </span>
            ))}
            {d.rules.classic && <span className="chip">{t('classicSeasons')}</span>}
            {d.rules.twists && <span className="chip">{t('twists')}</span>}
            {d.rules.chain && <span className="chip">{t('teammateChain')}</span>}
            <span className="mono">{t('seed', { seed: game.settings.seed })}</span>
          </div>
          {((modeCards.length > 0 && (modeCards.length > 1 || modeCards[0] !== 'hard')) || powerUpsOn(d)) && (
            <div className="pill-list" data-testid="draft-modes" style={{ marginTop: 6 }}>
              {modeCards.map((c) => {
                const Icon = MODE_ICON[c]
                return (
                  <span key={c} className="chip" title={modeCardLine(c)}>
                    <Icon size={12} aria-hidden="true" /> {modeCardTitle(c)}
                  </span>
                )
              })}
              {powerUpsOn(d) && (
                <span className="chip" title={t('powerUpsTip')}>
                  <Package size={12} aria-hidden="true" /> {t('powerUps')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="draft-progress">
          <div className="row between" style={{ gap: 'var(--space-2)' }}>
            <span className="draft-count" data-testid="pick-count" role="img" aria-label={signings ? t('signingCountLabel', { n: Math.min(made - signings.base + 1, RUN_IN_SPINS), of: RUN_IN_SPINS }) : places && !fillingStarters ? t('benchCountLabel', { n: d.bench.length, of: places }) : t('pickCountLabel', { n: Math.min(made + 1, total), of: total })}>
              {signings ? (
                <>
                  <span className="eyebrow">{t('signing')}</span> <b key={made} className="count-tick">{Math.min(made - signings.base + 1, RUN_IN_SPINS)}</b> / {RUN_IN_SPINS}
                </>
              ) : places && !fillingStarters ? (
                <>
                  <span className="eyebrow">{t('bench')}</span> <b key={made} className="count-tick">{d.bench.length}</b> / {places}
                </>
              ) : (
                <>
                  <span className="eyebrow">{t('pick')}</span> <b key={made} className="count-tick">{Math.min(made + 1, total)}</b> / {total}
                </>
              )}
            </span>
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              {speedrun && (
                <span className={`chip speedrun-clock ${clock <= 5 ? 'low' : ''}`} data-testid="speedrun-clock" aria-live="off" title={t('speedrunTip')}>
                  {t('clock', { n: clock })}
                </span>
              )}
              {game.bonusSpins > 0 && <span className="chip gold">{t('bonus', { n: game.bonusSpins })}</span>}
              <CapChip d={d} />
              <BoxesMenu groups={[boxes]} />
              <button className="btn ghost sm" onClick={() => go('home')}>
                {t('home')}
              </button>
            </span>
          </div>
          <div className="pick-track" aria-hidden="true">
            {Array.from({ length: signings ? RUN_IN_SPINS : total }, (_, k) => {
              const i = k + (signings?.base ?? 0)
              return <span key={i} className={i < made ? 'done' : i === made && !complete ? 'now' : ''} />
            })}
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
                <span className="eyebrow">{t('squadReady')}</span>
                <b>{t('picksMade', { n: picksMade(d) })}</b>
              </div>
            ) : (
              <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} twist={twist ? TWIST_INFO[twist].title : null} estimated={!!current?.estimated} onSettled={() => setSettled(d.current)} />
            )}
            {oddsLabel && !complete && !dry && !spinning && <SpinOdds odds={odds} label={oddsLabel} />}
            {ghost && challenge && revealed && (
              <div className="chip info ghost-chip" data-testid="ghost-chip" title={t('ghostTitle', { name: challenge.name, n: d.spins })}>
                <Ghost size={14} aria-hidden="true" />
                {ghost.id === null
                  ? t('ghostRespun', { name: challenge.name })
                  : ghostPlayer
                    ? ghostSameWheel
                      ? t('ghostSame', { player: ghostPlayer.name })
                      : t('ghostOther', { name: challenge.name, n: d.spins, player: ghostPlayer.name, where: isIcons(ghost) ? t('icons') : `${clubName(u, ghost.clubId)} ${seasonLabel(ghost.season)}` })
                    : t('ghostMissing', { name: challenge.name, n: d.spins })}
              </div>
            )}
            {!complete && !dry && (!spinning || revealed) && <ChainStatus u={u} d={d} due={chainDue} />}
            {!complete && dry && (
              <div className="notice">
                {nationLabel ? rich(t('dryNation'), { nation: () => nationLabel }) : t('dryDraft')}{' '}
                {fillingStarters ? t('dryStillOpen', { needs: needs.join(', ') }) : t('dryGoOn', { n: made })}
              </div>
            )}
            {!complete && dry && !fillingStarters && (
              <button className="btn primary spin-btn display" onClick={finishing.finish} disabled={finishing.busy} aria-busy={finishing.busy || undefined}>
                {finishing.busy ? t('gettingReady') : finishDraftText(game, made)}
              </button>
            )}
            {surprise && !complete && (
              <div className="notice" data-testid="crazy-surprise">
                {rich(surprise.kind === 'respin' ? t('surpriseRespin') : surprise.kind === 'golden' ? t('surpriseGolden') : t('surpriseSlot', { pos: d.formation.slots.find((x) => x.id === surprise.slotId)?.position ?? t('aSetSlot') }), B)}
              </div>
            )}
            {forced && !complete && !surprise && (
              <div className="notice small" data-testid="crazy-forced">
                {t('forced', { pos: forced.position })}
              </div>
            )}
            {!complete && !dry && (
              <>
                {choosing && !forced && (
                  <div className="notice small" data-testid="position-first">
                    {target ? t('filling', { pos: target.position }) : t('positionFirst')}
                  </div>
                )}
                <button ref={spinRef} className={`btn primary spin-btn display${d.current ? ' waiting' : ''}`} disabled={!!d.current || spinning || (choosing && !target)} onClick={() => spin()}>
                  {d.current ? t(spinning ? 'spinning' : 'pickAPlayer') : choosing ? (target ? t('spinFor', { pos: target.position }) : t('chooseSlot')) : t(made === 0 || (isDynastySummer && !d.history.length) ? 'spinWheel' : places && !fillingStarters ? 'spinBench' : 'spinAgain')}
                </button>
                {firstDraft && made === 0 && !d.current && !spinning && !choosing && (
                  <p className="help first-spin-help" data-testid="first-spin-help">
                    {t('firstSpinHelp')}
                  </p>
                )}
                {canClose && (
                  <button className="btn" disabled={spinning} onClick={() => finishDraft()} data-testid="finish-draft">
                    {d.bench.length ? t('kickOffWithBench', { n: d.bench.length }) : t('kickOffNoBench')}
                  </button>
                )}
                <div className="row between wrap">
                  <button className="btn sm" disabled={!d.current || spinning || d.respinsLeft <= 0} onClick={() => respin()} title={t('respinTip', { n: d.respinsLeft })} data-testid="respin">
                    {t('respin', { n: d.respinsLeft })}
                  </button>
                  <button className="btn sm ghost" data-testid="auto-complete" disabled={spinning || autoBusy} aria-busy={autoBusy || undefined} onClick={() => void askConfirm(t('autoConfirm'), { ok: t('autoComplete') }).then((ok) => { if (ok) runAuto(() => autoDraftRest()) })}>
                    {t(autoBusy ? 'autoCompleting' : 'autoComplete')}
                  </button>
                </div>
              </>
            )}
            {complete && (
              <button ref={finishRef} className="btn primary spin-btn display" onClick={finishing.finish} disabled={finishing.busy} aria-busy={finishing.busy || undefined} data-testid="finish-draft-go">
                {finishing.busy ? t('gettingReady') : finishDraftText(game)}
              </button>
            )}
          </div>
          {/* Nothing left to need once the squad is complete ("Squad ready" says so above) */}
          {!complete && boxes.on('needs') && (
            <div className="panel tight">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                {fillingStarters ? t('stillNeed') : t('benchMore', { n: total - made, optional: places ? 'yes' : 'no' })}
              </div>
              <div className="pill-list">
                {needs.map((p) => (
                  <Pos key={p} p={p} />
                ))}
              </div>
              {!fillingStarters && !dry && <Tip id="draft-bench">{t('benchTip')}</Tip>}
            </div>
          )}
          {(d.history.length > 0 || puLog.length > 0) && boxes.on('log') && (
            <div className="panel tight">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                {t('draftLog')}
              </div>
              {puLog.length > 0 && (
                <div className="col pu-log" data-testid="power-up-log" style={{ gap: 2 }}>
                  {puLog.map((l) => (
                    <div key={`${l.at}:${l.kind}:${l.text}`} className="row small" style={{ gap: 8 }}>
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
              {/* A grade's note (the best play on that spin) on hover, focus or a tap, so a phone sees it too */}
              <HoverTips testId="grade-tip" className="draft-log-tips">
              <ol className="draft-log">
                {[...d.history].reverse().map((h, i) => {
                  const p = h.pickedId ? get(h.pickedId) : undefined
                  const TwistIcon = h.twist ? TWIST_ICON[h.twist] : null
                  const tier = tiers[`${h.clubId}@${h.season}`]
                  // The pick before this one, for the chain's link
                  const at = d.history.length - 1 - i
                  const prevId = d.rules.chain ? d.history.slice(0, at).reverse().find((x) => x.pickedId)?.pickedId : undefined
                  return (
                    <li key={at} className={p && at === d.history.length - 1 && p.id === landedId ? 'fresh' : undefined}>
                      {isIcons(h) ? <span className="icons-badge" style={{ width: 22, height: 22 }} role="img" aria-label={t('iconsCollection')}>★</span> : <ClubBadge clubId={h.clubId} size={22} />}
                      <span className="who">
                        <span className={p ? 'name' : 'muted'}>{p ? p.name : t(h.skipped ? 'skipped' : 'respun')}</span>
                        <span className="when">
                          {isIcons(h) ? <TierDot tier="icons" /> : tier && <TierDot tier={tier} />}
                          {isIcons(h) ? t('icons') : seasonLabel(h.season)}
                          {grades.has(at) && (
                            <button type="button" className={`chip pick-grade ${GRADE_CLASS[grades.get(at)!.grade]}`} data-testid="pick-grade" data-tip={gradeNote(grades.get(at)!, slotPos)} aria-label={t('gradeLabel', { grade: grades.get(at)!.grade, note: gradeNote(grades.get(at)!, slotPos) })}>
                              {grades.get(at)!.grade}
                            </button>
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
              </HoverTips>
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
          {!current && !managerChoice.length && complete && recap && <DraftRecap recap={recap} get={get} slotName={(id) => d.formation.slots.find((x) => x.id === id)?.position ?? id} />}
          {!current && !managerChoice.length && !complete && (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <Dices size={26} />
              </span>
              <h3>
                {isDynastySummer ? t('summerSpins', { n: total - made }) : t('spinForClub')}{' '}
                <Info label={t('wheelInfoLabel')}>
                  {isDynastySummer ? t('wheelInfoSummer') : ''}{t('wheelInfo')}
                </Info>
              </h3>
              <p className="muted small">{t('thenPick')}</p>
            </div>
          )}
          {current && spinning && !revealed && (
            <div className="club-head">
              <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
              <div>
                <h2>{t('opening')}</h2>
                <div className="muted small">{t('landing')}</div>
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
                      <h2 ref={clubHeadRef} tabIndex={-1}>{t('iconsCollection')}</h2>
                      <div className="club-sub">
                        <span>{t('iconsSub', { n: current.squad.length })}</span>
                        <TierChip tier="icons" />
                      </div>
                    </div>
                  ) : (
                  <div>
                    <h2 ref={clubHeadRef} tabIndex={-1}>{clubName(u, current.clubId)}</h2>
                    <div className="club-sub">
                      <span>{seasonLabel(current.season)}</span>
                      {!current.complete ? (
                        <span>{t('inProgress')}</span>
                      ) : current.champions ? (
                        <span className="chip gold icon-chip">
                          <Trophy size={12} aria-hidden="true" /> {t('champions')}
                        </span>
                      ) : current.position > 0 ? (
                        <span>
                          {t('placePoints', { pos: current.position, pts: current.points })}
                        </span>
                      ) : (
                        <span>{t('noTable')}</span>
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
                <Segmented<'rating' | 'position'> label={t('sortPlayers')} value={sort} onChange={setSort} options={[{ value: 'rating', label: t('byRating') }, { value: 'position', label: t('byPosition') }]} />
              </div>
              {!revealed && spinning && <div className="notice">{t('reelRunning')}</div>}
              {revealed && twist === 'blind' && <div className="notice">{t('blindPick')}</div>}
              {revealed && selected && (
                <div className="notice slot-choices" data-testid="slot-choices" ref={slotChoicesRef}>
                  <div>
                    {rich(t('whereDoes', { name: selected.name }), B)}
                  </div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {fitsFirst(draftSlotChoices(d, selected)).map((c) => {
                      // Led by the number his pitch disc will show there, with his overall and the cost (DESIGN_SYSTEM.md, ratings)
                      const r = slotRating(selected, c.position)
                      return (
                        <button key={c.slotId} type="button" className={`chip slot-chip ${c.fit === 'fits' ? 'good' : 'warn'}`} data-testid="slot-chip" onClick={() => onSlot(c.slotId)} title={hide ? undefined : slotRatingText(r, slotLabelText(c.label), { attributes: true })} aria-label={hide ? `${slotLabelText(c.label)}, ${fitText(c.fit)}` : `${slotRatingText(r, slotLabelText(c.label))}, ${fitText(c.fit)}`}>
                          <b>{slotLabelText(c.label)}</b> {hide ? '?' : r.inSlot} · {fitText(c.fit)}
                          {!hide && r.cost > 0 && (
                            <span className="slot-cost" data-testid="slot-cost">
                              {' '}{t('slotCost', { n: r.overall, cost: costText(r) })}
                            </span>
                          )}
                        </button>
                      )
                    })}
                    {canBench(d, selected) && (
                      <button type="button" className="btn sm" onClick={() => { pickPlayer(selected.id, 'bench'); setSelectedPlayer(null) }} data-testid="to-bench">
                        {t('toBench')}
                      </button>
                    )}
                    <button type="button" className="btn sm ghost" onClick={() => setSelectedPlayer(null)}>
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              )}
              {revealed && fillingStarters && (
                <Tip id="draft-first-reveal">{t('firstRevealTip')}</Tip>
              )}
              {revealed && (
                <div className="plist lined draft-list">
                  {sortedSquad.map((p) => {
                    const ok = usable(p)
                    const taken = d.takenPlayers.includes(p.playerId)
                    const foreign = !nationAllows(d, p)
                    const slots = eligibleSlots(d, p)
                    const groups = fillingStarters ? fitGroups(p, slots.map((s) => s.position)) : null
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
                        extra={<><ChainChip u={u} d={d} p={p} show={!taken && !foreign} /><CapChips d={d} p={p} show={!taken && !foreign && chainAllows(d, p)} />{taken ? <span className="chip">{t('alreadyDrafted')}</span> : foreign ? <span className="chip">{t('notNation', { nation: nationName(u, nation ?? '') })}</span> : groups && slots.length ? <>{groups.fits.length > 0 && <span className="chip good">{t('fitsPos', { pos: groups.fits.join('/') })}</span>}{groups.covers.length > 0 && <span className="chip warn">{t('coversPos', { pos: groups.covers.join('/') })}</span>}</> : null}</>}
                        right={ok ? <span className={`btn sm ${selectedPlayer === p.id ? 'primary' : ''}`}>{t(fillingStarters && slots.length ? 'draftBtn' : 'bench')}</span> : null}
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
              <span className={`chip ${Object.keys(d.lineup).length === 11 ? 'good' : ''}`}>{t('starters', { n: Object.keys(d.lineup).length })}</span>
            </div>
            <Pitch formation={d.formation} lineup={runInXI ?? d.lineup} getPlayer={get} onSlotClick={onSlot} eligibleSlots={choosing ? choosable : selectedEligible} selectedSlot={target?.id ?? null} hideRatings={hideSquad} revealId={revealId} landedId={landedId} />
            {runInXI && <p className="small muted" style={{ margin: '6px 0 0' }} data-testid="runin-xi-note">{t('runInXI')}</p>}
            {selected && suggestSlot(d, selected) && suggestSlot(d, selected) !== 'bench' && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(suggestSlot(d, selected) as string)}>
                {t('putAt', { name: selected.name, pos: openSlots(d).find((s) => s.id === suggestSlot(d, selected))?.position })}
              </button>
            )}
          </div>
          )}
          {benchBox && boxes.on('bench') && (
            <div className="panel" data-testid="draft-bench">
              <div className="panel-head">
                <h3>{t('bench')}</h3>
                <span className="chip">{places ? `${d.bench.length}/${places}` : d.bench.length}</span>
              </div>
              <div className="plist lined">
                {d.bench.map((id) => {
                  const p = get(id)
                  return p ? <PlayerRow key={id} p={p} hideRatings={hideSquad} showClub /> : null
                })}
                {d.bench.length === 0 && <div className="muted small">{places ? (
                      <>
                        {t('upTo', { n: places })}{' '}
                        <Info label={t('benchInfoLabel')}>{t('benchInfo')}</Info>
                      </>
                    ) : (
                      t('benchFollows')
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
