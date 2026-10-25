import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@game/store'
import { canSpin, canUse, eligibleSlots, fillingXI, isComplete, nationAllows, neededPositions, nextSpinTwisted, openSlots, picksMade, suggestSlot, twistDecade, wheelPool } from '@engine/draft'
import { bestFit, describeFit } from '@engine/positions'
import type { PlayerSeason, Position } from '@engine/types'
import { CaseReel } from '../components/CaseReel'
import { TWIST_INFO, TwistCard } from '../components/TwistCard'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, EstimatedChip, Pos, Rating, Tip } from '../components/bits'
import { clubName, flag, nationName, ordinal, seasonLabel } from '../format'
import { playerLookup } from '@game/logic/players'
import { draftSlotChoices } from '@game/logic/slotSheet'
import { leagueSegments } from '../components/leagueSegments'

const GROUPS: Array<{ label: string; positions: Position[] }> = [
  { label: 'Goalkeepers', positions: ['GK'] },
  { label: 'Defenders', positions: ['CB', 'LB', 'RB'] },
  { label: 'Midfielders', positions: ['DM', 'CM', 'AM'] },
  { label: 'Forwards', positions: ['LW', 'RW', 'ST'] },
]

export function Draft() {
  const { universe: u, game, spin, respin, pickPlayer, autoDraftRest, finishDraft, go, showToast } = useStore()
  const [spinning, setSpinning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [sort, setSort] = useState<'rating' | 'position'>('rating')
  const d = game?.draft
  const get = useMemo(() => (game && u ? playerLookup(game, u) : () => undefined), [game, u])

  const segments = useMemo(() => {
    if (!u || !d) return []
    const pool = wheelPool(u, d)
    const leagues = [...new Set(pool.map((cs) => cs.leagueId))]
    // Across several leagues the wheel shows leagues as segments; within one league, the clubs.
    if (leagues.length > 1) return leagueSegments(u, leagues)
    const clubs = [...new Set(pool.map((cs) => cs.clubId))]
    const sorted = clubs.sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b))
    return sorted.map((id) => ({ id, label: u.clubById[id]?.code ?? id.slice(0, 3).toUpperCase(), colour: u.clubById[id]?.colours.primary ?? '#555', secondary: u.clubById[id]?.colours.secondary ?? '#fff' }))
    // Recompute only when the current spin changes so the wheel is stable while a pick is pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u, d?.spins, d?.rules])
  const wheelTarget = useMemo(() => {
    if (!u || !d?.current) return null
    const cs = u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`]
    return segments.length && segments[0].id.startsWith('league:') ? `league:${cs?.leagueId ?? ''}` : d.current.clubId
  }, [u, d?.current, segments])

  // A one-nation wheel can run out of eligible players; checked after every pick, not only on a spin
  const dry = useMemo(() => !!u && !!d && !d.current && !isComplete(d) && !canSpin(u, d), [u, d])

  useEffect(() => {
    if (d?.current) {
      setSpinning(true)
      setRevealed(false)
      setSelectedPlayer(null)
    }
  }, [d?.current?.clubId, d?.current?.season, d?.spins])

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
  const hide = d.rules.hardMode || twist === 'blind'
  const complete = isComplete(d)
  const total = d.rules.squadSize
  const made = picksMade(d)
  const fillingStarters = fillingXI(d)
  const needs = neededPositions(d)
  const selected = selectedPlayer ? get(selectedPlayer) : undefined
  const selectedEligible = selected ? eligibleSlots(d, selected).map((s) => s.id) : []
  const isDynastySummer = game.settings.mode === 'dynasty' && game.year > 1

  const nation = d.rules.onlyNation
  const nationLabel = nation ? `${flag(u, nation)} ${nationName(u, nation)}` : ''
  // The ghost: what the challenger did on this spin number. Hidden under hard mode, and absent when the picks could not be resolved on this data
  const challenge = game.settings.challenge
  const ghost = challenge && !d.rules.hardMode && d.current && d.spins > 0 ? challenge.picks[d.spins - 1] : undefined
  const ghostPlayer = ghost?.id ? get(ghost.id) : undefined
  const ghostSameWheel = !!ghost && !!d.current && ghost.clubId === d.current.clubId && ghost.season === d.current.season

  const squad = current ? [...current.squad] : []
  const usable = (p: PlayerSeason) => canUse(d, p)

  const onPick = (p: PlayerSeason) => {
    if (!usable(p)) return
    const slots = eligibleSlots(d, p)
    if (fillingStarters) {
      if (slots.length === 1) pickPlayer(p.id, slots[0].id)
      else setSelectedPlayer(p.id)
    } else {
      pickPlayer(p.id, 'bench')
    }
  }
  const onSlot = (slotId: string) => {
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
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div>
          <h1>{isDynastySummer ? `Summer draft · Year ${game.year}` : 'The Draft'}</h1>
          <div className="muted small">
            {game.settings.teamName} · {game.settings.formationId} · {challenge ? `vs ${challenge.name} (${challenge.claim.pts} pts) · ` : ''}{d.rules.onlyClub ? `${clubName(u, d.rules.onlyClub)} only · ` : ''}
            {nation ? `${nationLabel} only · ` : ''}
            {d.rules.fromSeason || d.rules.toSeason ? `${seasonLabel(d.rules.fromSeason ?? u.firstSeason)} to ${seasonLabel(d.rules.toSeason ?? u.lastSeason)} · ` : ''}
            {d.rules.classic ? 'Classic seasons · ' : ''}
            {d.rules.hardMode ? 'Hard mode · ' : ''}
            {d.rules.twists ? 'Twists · ' : ''}seed {game.settings.seed}
          </div>
        </div>
        <div className="row">
          <span className="chip">
            Pick {Math.min(made + 1, total)} of {total}
          </span>
          <span className="chip">{d.respinsLeft} re-spin{d.respinsLeft === 1 ? '' : 's'} left</span>
          {game.bonusSpins > 0 && <span className="chip gold">+{game.bonusSpins} bonus</span>}
          <button className="btn ghost sm" onClick={() => go('home')}>
            Home
          </button>
        </div>
      </div>

      <div className={`grid draft ${d.rules.hardMode ? 'hidden-ratings' : ''}`}>
        {/* Wheel column */}
        <div className="col">
          <div className="panel col">
            {d.rules.twists && !complete && <TwistCard twist={twist} decade={twistDecade(d)} next={!d.current && !dry && nextSpinTwisted(d)} />}
            <CaseReel segments={segments} targetId={wheelTarget} year={d.current?.season ?? null} spinning={spinning} spinKey={d.spins} twist={twist ? TWIST_INFO[twist].title.replace(' spin', '') : null} onSettled={() => { setSpinning(false); setRevealed(true) }} />
            {ghost && challenge && revealed && (
              <div className="chip" data-testid="ghost-chip" title={`${challenge.name}'s spin ${d.spins}`} style={{ alignSelf: 'center', whiteSpace: 'normal', textAlign: 'center' }}>
                👻{' '}
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
                The wheel has run dry for {nationLabel || 'this draft'}: no one left to draft.{' '}
                {fillingStarters ? `Slots are still open (${needs.join(', ')}), so this side cannot start a season. Go home and choose another nation or a wider wheel.` : `You can go on with the ${made} players drafted.`}
              </div>
            )}
            {!complete && dry && !fillingStarters && (
              <button className="btn primary spin-btn display" onClick={() => finishDraft()}>
                {game.settings.mode === 'quick' || game.settings.mode === 'daily' ? 'Simulate the season' : isDynastySummer ? 'Into the new season' : `Go to pre-season with ${made}`}
              </button>
            )}
            {!complete && !dry && (
              <>
                <button className="btn primary spin-btn display" disabled={!!d.current || spinning} onClick={() => spin()}>
                  {d.current ? (spinning ? 'Spinning…' : 'Pick a player') : made === 0 ? 'Spin the wheel' : 'Spin again'}
                </button>
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
                {game.settings.mode === 'quick' || game.settings.mode === 'daily' ? 'Simulate the season' : isDynastySummer ? 'Into the new season' : 'Go to pre-season'}
              </button>
            )}
          </div>
          <div className="panel tight">
            <div className="small muted" style={{ marginBottom: 6 }}>
              {fillingStarters ? 'Still need' : complete ? 'Squad complete' : `Bench: ${total - made} more pick${total - made === 1 ? '' : 's'}`}
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
              <div className="small muted" style={{ marginBottom: 6 }}>
                Draft log
              </div>
              <div className="col" style={{ gap: 4, maxHeight: 220, overflow: 'auto' }}>
                {[...d.history].reverse().map((h, i) => {
                  const p = h.pickedId ? get(h.pickedId) : undefined
                  return (
                    <div key={i} className="row small" style={{ gap: 8 }}>
                      <ClubBadge clubId={h.clubId} size={20} />
                      <span className="muted">{seasonLabel(h.season)}</span>
                      {h.twist && (
                        <span title={TWIST_INFO[h.twist].title} aria-label={TWIST_INFO[h.twist].title}>
                          {TWIST_INFO[h.twist].icon}
                        </span>
                      )}
                      <span style={{ fontWeight: 600 }}>{p ? p.name : <span className="muted">{h.skipped ? 'skipped' : 're-spun'}</span>}</span>
                      {/* A blind pick keeps its secret in the log; the squad screens show it afterwards */}
                      {p && !d.rules.hardMode && h.twist !== 'blind' && <Rating value={p.overall} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Squad list column */}
        <div className="panel col draft-squad" ref={squadRef} data-testid="draft-squad">
          {!current && (
            <div className="col" style={{ alignItems: 'center', padding: '40px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>🎡</div>
              <h3>{complete ? 'All picks made' : isDynastySummer ? `Summer signings: ${total - made} spin${total - made === 1 ? '' : 's'} to add depth` : 'Spin to land on a club and season'}</h3>
              {isDynastySummer && !complete && <p className="muted small">Your squad carries over (best eleven shown on the pitch). Each spin adds one player to the squad; the summer market is open in the Dugout too.</p>}
              <p className="muted small">The wheel only stops on squads with a player who can fill a slot you still need, so there are no dead spins. A player can be drafted once, whichever season you catch him in.</p>
            </div>
          )}
          {current && spinning && !revealed && (
            <div className="row">
              <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
              <div>
                <h2 style={{ fontSize: 26 }}>Opening…</h2>
                <div className="muted small">The reel is landing on a club and a season.</div>
              </div>
            </div>
          )}
          {current && (!spinning || revealed) && (
            <>
              <div className="row between wrap">
                <div className="row">
                  <ClubBadge clubId={current.clubId} size={44} />
                  <div>
                    <h2 style={{ fontSize: 26 }}>{clubName(u, current.clubId)}</h2>
                    <div className="muted small">
                      {seasonLabel(current.season)} · {!current.complete ? 'season in progress' : current.champions ? '🏆 Champions' : current.position > 0 ? `${ordinal(current.position)} · ${current.points} pts` : 'final table not on record'}{current.position > 0 ? ` · ${current.won}-${current.drawn}-${current.lost}` : ''}
                      {current.estimated && <> <EstimatedChip /></>}
                    </div>
                  </div>
                </div>
                <div className="segmented">
                  <button className={sort === 'rating' ? 'active' : ''} onClick={() => setSort('rating')}>
                    By rating
                  </button>
                  <button className={sort === 'position' ? 'active' : ''} onClick={() => setSort('position')}>
                    By position
                  </button>
                </div>
              </div>
              {!revealed && spinning && <div className="notice">The reel is running…</div>}
              {revealed && twist === 'blind' && <div className="notice">Blind pick: ratings stay hidden until you have chosen. Positions and ages are still shown.</div>}
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
                <div className="plist" style={{ maxHeight: 560, overflow: 'auto' }}>
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
                        hideRatings={hide}
                        onClick={() => onPick(p)}
                        extra={taken ? <span className="chip">already drafted</span> : foreign ? <span className="chip">not {nationName(u, nation ?? '')}</span> : fillingStarters && slots.length ? <span className={`chip ${best === 'natural' ? 'good' : 'warn'}`}>{best === 'natural' ? 'fits' : 'can cover'} {[...new Set(slots.map((s) => s.position))].join('/')}</span> : null}
                        right={ok ? <span className="btn sm primary">{fillingStarters ? 'Draft' : 'Bench'}</span> : null}
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
              <span className="small muted">{Object.keys(d.lineup).length}/11 starters</span>
            </div>
            <Pitch formation={d.formation} lineup={d.lineup} getPlayer={get} onSlotClick={onSlot} eligibleSlots={selectedEligible} hideRatings={hide} />
            {selected && suggestSlot(d, selected) && suggestSlot(d, selected) !== 'bench' && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(suggestSlot(d, selected) as string)}>
                Put {selected.name} at {openSlots(d).find((s) => s.id === suggestSlot(d, selected))?.position}
              </button>
            )}
          </div>
          {(d.bench.length > 0 || !fillingStarters) && (
            <div className="panel">
              <div className="panel-head">
                <h3>Bench</h3>
                <span className="small muted">{d.bench.length}</span>
              </div>
              <div className="plist">
                {d.bench.map((id) => {
                  const p = get(id)
                  return p ? <PlayerRow key={id} p={p} hideRatings={hide} showClub /> : null
                })}
                {d.bench.length === 0 && <div className="muted small">Fill the XI first, then bench picks follow.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
