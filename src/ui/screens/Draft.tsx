import { useEffect, useMemo, useRef, useState } from 'react'
import { Dices, Ghost, Trophy } from 'lucide-react'
import { useStore } from '@game/store'
import { QUICK_RULES, SEASON_RULES, benchPlaces, benchRoom, canBench, canCloseBench, canSpin, canUse, eligibleSlots, fillingXI, isComplete, nationAllows, neededPositions, nextSpinTwisted, openSlots, picksMade, positionFirst, ratingsHidden, rulesTags, spinnableSlots, suggestSlot, targetSlot, twistDecade, type DraftState } from '@engine/draft'
import { bestFit, describeFit } from '@engine/positions'
import type { PlayerSeason, Position } from '@engine/types'
import { CaseReel, TierChip, TierDot } from '../components/CaseReel'
import { TWIST_INFO, TwistCard } from '../components/TwistCard'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Info, Pos, Rating, Segmented, Tip } from '../components/bits'
import { TWIST_ICON } from '../components/icons'
import { clubName, nationName, ordinal, seasonLabel } from '../format'
import { NationFlag } from '../components/Flag'
import { playerLookup } from '@game/logic/players'
import { draftSlotChoices } from '@game/logic/slotSheet'
import { tierTable, type TierTable } from '@game/logic/rarity'
import { draftReelPool, reelLeagues } from '@game/logic/reel'

const GROUPS: Array<{ label: string; positions: Position[] }> = [
  { label: 'Goalkeepers', positions: ['GK'] },
  { label: 'Defenders', positions: ['CB', 'LB', 'RB'] },
  { label: 'Midfielders', positions: ['DM', 'CM', 'AM'] },
  { label: 'Forwards', positions: ['LW', 'RW', 'ST'] },
]

export function Draft() {
  const { universe: u, game, spin, respin, chooseSlot, pickPlayer, autoDraftRest, finishDraft, go, showToast } = useStore()
  // The spin whose reel has landed. A new spin or re-spin is a new `current` object, so it reads as spinning in
  // the same render the store hands it over: no stale squad, no stale landed state, no second re-spin mid-reel
  const [settled, setSettled] = useState<DraftState['current']>(null)
  // A selected player belongs to the spin he was selected on
  const [picked, setPicked] = useState<{ id: string; spin: number } | null>(null)
  const [sort, setSort] = useState<'rating' | 'position'>('rating')
  const d = game?.draft
  const get = useMemo(() => (game && u ? playerLookup(game, u) : () => undefined), [game, u])
  const spinning = !!d?.current && settled !== d.current
  const revealed = !!d?.current && settled === d.current
  const selectedPlayer = picked && picked.spin === d?.spins ? picked.id : null
  const setSelectedPlayer = (id: string | null) => setPicked(id && d ? { id, spin: d.spins } : null)

  // The reel: the draft's leagues, their tiers, and what this spin could land on (recomputed per spin and per pick)
  const leagues = useMemo(() => (u && d ? reelLeagues(u, d.rules) : []), [u, d?.rules])
  const tiers = useMemo<TierTable>(() => (u ? tierTable(u, leagues) : {}), [u, leagues])
  const pool = useMemo(
    () => (u && d ? draftReelPool(u, d) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, d?.spins, d?.rules, d?.history.length],
  )

  // A one-nation wheel can run out of eligible players; checked after every pick, not only on a spin
  const dry = useMemo(() => !!u && !!d && !d.current && !isComplete(d) && !canSpin(u, d), [u, d])
  // Position First: the open slots a spin could fill, offered on the pitch before each spin
  const choosable = useMemo(() => (u && d && positionFirst(d) && !d.current ? spinnableSlots(u, d).map((s) => s.id) : []), [u, d])

  // On a phone the columns stack, so the landed squad would sit under the wheel: bring it on screen when it is revealed
  const squadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!revealed || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 720px)').matches) return
    squadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [revealed])

  if (!u || !game || !d) return null
  const current = d.current ? u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] : null
  // A blind spin hides ratings like hard mode does, until the pick is made
  const twist = d.twist ?? null
  const hide = ratingsHidden(d.rules) || twist === 'blind'
  const hiddenAll = ratingsHidden(d.rules)
  const choosing = positionFirst(d) && !d.current && !isComplete(d)
  // Position First: the slot this spin fills, kept until the pick; the list lights up whoever can play there
  const target = targetSlot(d)
  const tags = rulesTags(d.rules, game.settings.mode === 'season' || game.settings.mode === 'dynasty' ? SEASON_RULES : QUICK_RULES)
  const complete = isComplete(d)
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

  const nation = d.rules.onlyNation
  const nationLabel = nation ? (
    <>
      <NationFlag nation={nation} named /> {nationName(u, nation)}
    </>
  ) : null
  // The ghost: what the challenger did on this spin number. Hidden under hard mode, and absent when the picks could not be resolved on this data
  const challenge = game.settings.challenge
  const ghost = challenge && !hiddenAll && d.current && d.spins > 0 ? challenge.picks[d.spins - 1] : undefined
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

  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{isDynastySummer ? `Summer draft · Year ${game.year}` : 'The draft'}</h1>
          <div className="screen-meta">
            <span>
              {game.settings.teamName} · {game.settings.formationId}
            </span>
            {challenge && <span className="chip info">vs {challenge.name} · {challenge.claim.pts} pts</span>}
            {d.rules.onlyClub && <span className="chip">{clubName(u, d.rules.onlyClub)} only</span>}
            {nation && <span className="chip">{nationLabel} only</span>}
            {(d.rules.fromSeason || d.rules.toSeason) && (
              <span className="chip">
                {seasonLabel(d.rules.fromSeason ?? u.firstSeason)} to {seasonLabel(d.rules.toSeason ?? u.lastSeason)}
              </span>
            )}
            {tags.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
            {d.rules.twists && <span className="chip">Twists</span>}
            <span className="mono">seed {game.settings.seed}</span>
          </div>
        </div>
        <div className="draft-progress">
          <div className="row between" style={{ gap: 'var(--space-2)' }}>
            <span className="draft-count" data-testid="pick-count" aria-label={places && !fillingStarters ? `Bench ${d.bench.length} of ${places}` : `Pick ${Math.min(made + 1, total)} of ${total}`}>
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
              {game.bonusSpins > 0 && <span className="chip gold">+{game.bonusSpins} bonus</span>}
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

      <div className={`grid draft ${hiddenAll ? 'hidden-ratings' : ''}`}>
        {/* Wheel column */}
        <div className="col">
          <div className="panel col">
            {d.rules.twists && !complete && <TwistCard twist={twist} decade={twistDecade(d)} next={!d.current && !dry && nextSpinTwisted(d)} />}
            <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} twist={twist ? TWIST_INFO[twist].title : null} onSettled={() => setSettled(d.current)} />
            {ghost && challenge && revealed && (
              <div className="chip info ghost-chip" data-testid="ghost-chip" title={`${challenge.name}'s spin ${d.spins}`}>
                <Ghost size={14} aria-hidden="true" />
                {ghost.id === null
                  ? `Last time here: ${challenge.name} re-spun`
                  : ghostPlayer
                    ? ghostSameWheel
                      ? `Last time here: ${ghostPlayer.name}`
                      : `${challenge.name}'s spin ${d.spins}: ${ghostPlayer.name} (${clubName(u, ghost.clubId)} ${seasonLabel(ghost.season)})`
                    : `${challenge.name}'s spin ${d.spins} is not in this data`}
              </div>
            )}
            {!complete && dry && (
              <div className="notice">
                No one left to draft for {nationLabel ?? 'this draft'}.{' '}
                {fillingStarters ? `Still open: ${needs.join(', ')}. Go home and widen the wheel.` : `Go on with the ${made} drafted.`}
              </div>
            )}
            {!complete && dry && !fillingStarters && (
              <button className="btn primary spin-btn display" onClick={() => finishDraft()}>
                {game.settings.mode === 'quick' || game.settings.mode === 'daily' ? 'On to kick-off' : isDynastySummer ? 'Into the new season' : `Go to pre-season with ${made}`}
              </button>
            )}
            {!complete && !dry && (
              <>
                {choosing && (
                  <div className="notice small" data-testid="position-first">
                    {target ? `Filling ${target.position}: the wheel only stops on a club with someone who can play there.` : 'Position First: tap an open slot on the pitch, then spin for a club to fill it.'}
                  </div>
                )}
                <button className="btn primary spin-btn display" disabled={!!d.current || spinning || (choosing && !target)} onClick={() => spin()}>
                  {d.current ? (spinning ? 'Spinning…' : 'Pick a player') : choosing ? (target ? `Spin for ${target.position}` : 'Choose a slot') : made === 0 ? 'Spin the wheel' : places && !fillingStarters ? 'Spin for the bench' : 'Spin again'}
                </button>
                {canClose && (
                  <button className="btn" disabled={spinning} onClick={() => finishDraft()} data-testid="finish-draft">
                    {d.bench.length ? `On to kick-off with ${d.bench.length} on the bench` : 'On to kick-off without a bench'}
                  </button>
                )}
                <div className="row between">
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
                {game.settings.mode === 'quick' || game.settings.mode === 'daily' ? 'On to kick-off' : isDynastySummer ? 'Into the new season' : 'Go to pre-season'}
              </button>
            )}
          </div>
          <div className="panel tight">
            <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
              {fillingStarters ? 'Still need' : complete ? 'Squad complete' : `Bench · ${total - made} more pick${total - made === 1 ? '' : 's'}${places ? ', optional' : ''}`}
            </div>
            <div className="pill-list">
              {needs.map((p) => (
                <Pos key={p} p={p} />
              ))}
            </div>
            {!fillingStarters && !complete && !dry && <Tip id="draft-bench">Bench picks can be anyone un-drafted; cover every position, injuries will come.</Tip>}
          </div>
          {d.history.length > 0 && (
            <div className="panel tight">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Draft log
              </div>
              <ol className="draft-log">
                {[...d.history].reverse().map((h, i) => {
                  const p = h.pickedId ? get(h.pickedId) : undefined
                  const TwistIcon = h.twist ? TWIST_ICON[h.twist] : null
                  const tier = tiers[`${h.clubId}@${h.season}`]
                  return (
                    <li key={i}>
                      <ClubBadge clubId={h.clubId} size={22} />
                      <span className="who">
                        <span className={p ? 'name' : 'muted'}>{p ? p.name : h.skipped ? 'Skipped' : 'Re-spun'}</span>
                        <span className="when">
                          {tier && <TierDot tier={tier} />}
                          {seasonLabel(h.season)}
                          {h.twist && TwistIcon && (
                            <span className="log-twist" title={TWIST_INFO[h.twist].title} aria-label={TWIST_INFO[h.twist].title}>
                              <TwistIcon size={12} aria-hidden="true" />
                            </span>
                          )}
                        </span>
                      </span>
                      {/* A blind pick keeps its secret in the log; the squad screens show it afterwards */}
                      {p && !hiddenAll && h.twist !== 'blind' && <Rating value={p.overall} />}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>

        {/* Squad list column */}
        <div className="panel col draft-squad" ref={squadRef} data-testid="draft-squad">
          {!current && (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <Dices size={26} />
              </span>
              <h3>
                {complete ? 'All picks made' : isDynastySummer ? `${total - made} summer spin${total - made === 1 ? '' : 's'} to add depth` : 'Spin for a club and a season'}{' '}
                {!complete && (
                  <Info label="How the wheel works">
                    {isDynastySummer ? 'Your squad carries over, best eleven on the pitch; each spin adds one player, and the summer market is open in the Dugout. ' : ''}The wheel only stops on squads with someone who fits a slot you still need, so there are no dead spins. Each player can be drafted once, whichever season you catch him in.
                  </Info>
                )}
              </h3>
              {!complete && <p className="muted small">Then pick one player from that squad.</p>}
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
                  <ClubBadge clubId={current.clubId} size={44} />
                  <div>
                    <h2>{clubName(u, current.clubId)}</h2>
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
                    </div>
                  </div>
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
                    {draftSlotChoices(d, selected).map((c) => (
                      <button key={c.slotId} type="button" className={`chip slot-chip ${c.fit === 'fits' ? 'good' : 'warn'}`} data-testid="slot-chip" onClick={() => onSlot(c.slotId)}>
                        <b>{c.label}</b> {hide ? '?' : c.rating} · {c.fit}
                      </button>
                    ))}
                    {canBench(d, selected) && (
                      <button type="button" className="btn sm primary" onClick={() => { pickPlayer(selected.id, 'bench'); setSelectedPlayer(null) }} data-testid="to-bench">
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
                <Tip id="draft-first-reveal">Green fits means his natural position; amber can cover means he plays there at a penalty, which is the number you will see on the pitch. Re-spins are a budget for the whole draft.</Tip>
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
                        hideChampion={current.champions}
                        onClick={() => onPick(p)}
                        extra={taken ? <span className="chip">already drafted</span> : foreign ? <span className="chip">not {nationName(u, nation ?? '')}</span> : fillingStarters && slots.length ? <span className={`chip ${best === 'natural' ? 'good' : 'warn'}`}>{best === 'natural' ? 'fits' : 'can cover'} {[...new Set(slots.map((s) => s.position))].join('/')}</span> : null}
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
        <div className="col draft-pitch">
          <div className="panel">
            <div className="panel-head">
              <h3>{game.settings.formationId}</h3>
              <span className={`chip ${Object.keys(d.lineup).length === 11 ? 'good' : ''}`}>{Object.keys(d.lineup).length}/11 starters</span>
            </div>
            <Pitch formation={d.formation} lineup={d.lineup} getPlayer={get} onSlotClick={onSlot} eligibleSlots={choosing ? choosable : selectedEligible} selectedSlot={target?.id ?? null} hideRatings={hide} />
            {selected && suggestSlot(d, selected) && suggestSlot(d, selected) !== 'bench' && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(suggestSlot(d, selected) as string)}>
                Put {selected.name} at {openSlots(d).find((s) => s.id === suggestSlot(d, selected))?.position}
              </button>
            )}
          </div>
          {(d.bench.length > 0 || !fillingStarters || places > 0) && (
            <div className="panel" data-testid="draft-bench">
              <div className="panel-head">
                <h3>Bench</h3>
                <span className="chip">{places ? `${d.bench.length}/${places}` : d.bench.length}</span>
              </div>
              <div className="plist lined">
                {d.bench.map((id) => {
                  const p = get(id)
                  return p ? <PlayerRow key={id} p={p} hideRatings={hide} showClub /> : null
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
      </div>
    </div>
  )
}
