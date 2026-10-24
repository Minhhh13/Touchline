import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { eligibleSlots, fillingXI, isComplete, neededPositions, openSlots, picksMade, suggestSlot, wheelPool } from '@engine/draft'
import { describeFit } from '@engine/positions'
import type { PlayerSeason, Position } from '@engine/types'
import { Wheel } from '../components/Wheel'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Pos, Rating } from '../components/bits'
import { clubName, ordinal, seasonLabel } from '../format'
import { playerLookup } from '@game/logic/players'

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
    const clubs = [...new Set(pool.map((cs) => cs.clubId))]
    const sorted = clubs.sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b))
    return sorted.map((id) => ({ id, label: u.clubById[id]?.code ?? id.slice(0, 3).toUpperCase(), colour: u.clubById[id]?.colours.primary ?? '#555', secondary: u.clubById[id]?.colours.secondary ?? '#fff' }))
    // Recompute only when the current spin changes so the wheel is stable while a pick is pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u, d?.spins, d?.rules])

  useEffect(() => {
    if (d?.current) {
      setSpinning(true)
      setRevealed(false)
      setSelectedPlayer(null)
    }
  }, [d?.current?.clubId, d?.current?.season, d?.spins])

  if (!u || !game || !d) return null
  const current = d.current ? u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] : null
  const hide = d.rules.hardMode
  const complete = isComplete(d)
  const total = d.rules.squadSize
  const made = picksMade(d)
  const fillingStarters = fillingXI(d)
  const needs = neededPositions(d)
  const selected = selectedPlayer ? get(selectedPlayer) : undefined
  const selectedEligible = selected ? eligibleSlots(d, selected).map((s) => s.id) : []
  const isDynastySummer = game.settings.mode === 'dynasty' && game.year > 1

  const squad = current ? [...current.squad] : []
  const usable = (p: PlayerSeason) => {
    if (d.takenPlayers.includes(p.playerId)) return false
    if (fillingStarters) return eligibleSlots(d, p).length > 0
    return true
  }

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
            {game.settings.teamName} · {game.settings.formationId} · {d.rules.onlyClub ? `${clubName(u, d.rules.onlyClub)} only · ` : ''}
            {d.rules.fromSeason || d.rules.toSeason ? `${seasonLabel(d.rules.fromSeason ?? u.firstSeason)} to ${seasonLabel(d.rules.toSeason ?? u.lastSeason)} · ` : ''}
            {hide ? 'Hard mode · ' : ''}seed {game.settings.seed}
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

      <div className={`grid draft ${hide ? 'hidden-ratings' : ''}`}>
        {/* Wheel column */}
        <div className="col">
          <div className="panel col">
            <Wheel segments={segments} targetId={d.current?.clubId ?? null} year={d.current?.season ?? null} spinning={spinning} onSettled={() => { setSpinning(false); setRevealed(true) }} />
            {!complete && (
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
                      <span style={{ fontWeight: 600 }}>{p ? p.name : <span className="muted">re-spun</span>}</span>
                      {p && !hide && <Rating value={p.overall} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Squad list column */}
        <div className="panel col">
          {!current && (
            <div className="col" style={{ alignItems: 'center', padding: '40px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>🎡</div>
              <h3>{complete ? 'All picks made' : 'Spin to land on a club and season'}</h3>
              <p className="muted small">The wheel only stops on squads with a player who can fill a slot you still need, so there are no dead spins. A player can be drafted once, whichever season you catch him in.</p>
            </div>
          )}
          {current && (
            <>
              <div className="row between wrap">
                <div className="row">
                  <ClubBadge clubId={current.clubId} size={44} />
                  <div>
                    <h2 style={{ fontSize: 26 }}>{clubName(u, current.clubId)}</h2>
                    <div className="muted small">
                      {seasonLabel(current.season)} · {current.complete ? (current.champions ? '🏆 Champions' : `${ordinal(current.position)} · ${current.points} pts`) : 'season in progress'} · {current.won}-{current.drawn}-{current.lost}
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
              {!revealed && spinning && <div className="notice">The wheel is spinning…</div>}
              {revealed && selected && (
                <div className="notice">
                  Choose a slot for <b>{selected.name}</b> on the pitch, or{' '}
                  <button className="btn sm" onClick={() => setSelectedPlayer(null)}>
                    cancel
                  </button>
                </div>
              )}
              {revealed && (
                <div className="plist" style={{ maxHeight: 560, overflow: 'auto' }}>
                  {sortedSquad.map((p) => {
                    const ok = usable(p)
                    const taken = d.takenPlayers.includes(p.playerId)
                    const slots = eligibleSlots(d, p)
                    const best = fillingStarters ? slots.map((s) => describeFit(p, s.position)).sort()[0] : undefined
                    return (
                      <PlayerRow
                        key={p.id}
                        p={p}
                        dim={!ok}
                        selected={selectedPlayer === p.id}
                        hideRatings={hide}
                        onClick={() => onPick(p)}
                        extra={taken ? <span className="chip">already drafted</span> : fillingStarters && slots.length ? <span className={`chip ${best === 'natural' ? 'good' : 'warn'}`}>{slots.map((s) => s.position).join('/')}</span> : null}
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
