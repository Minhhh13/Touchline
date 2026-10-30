import { useEffect, useMemo, useRef, useState } from 'react'
import { ListOrdered, Search, Star as StarIcon, Trophy } from 'lucide-react'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { EXPLORE } from '../boxSets'
import { useStore } from '@game/store'
import { ClubBadge, EstimatedChip, Info, Rating, Pos } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { PlayerCardModal } from '../components/PlayerCard'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, ordinal, seasonLabel } from '../format'
import type { Position } from '@engine/types'
import { classicFromFor, isEstimated } from '@game/logic/era'
import { careerSeasons } from '@game/logic/playerCard'
import { pressable } from '../a11y'

function Star({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <span
      className={on ? 'star on' : 'star'}
      title={on ? 'On your shortlist' : 'Add to shortlist'}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? (on ? 'Remove from shortlist' : 'Add to shortlist') : undefined}
      aria-pressed={onClick ? on : undefined}
      onClick={(e) => {
        if (!onClick) return
        e.stopPropagation()
        onClick()
      }}
    >
      <StarIcon size={18} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
    </span>
  )
}

/** Every season of one real player across all loaded leagues, on the shared player card at his peak season. */
function CareerModal({ playerId, onClose }: { playerId: string | null; onClose: () => void }) {
  const u = useStore((s) => s.universe)
  const seasons = useMemo(() => (u && playerId ? careerSeasons(u, playerId) : []), [u, playerId])
  if (!u || !playerId || !seasons.length) return null
  const best = [...seasons].sort((a, b) => b.overall - a.overall)[0]
  const latest = seasons[seasons.length - 1]
  return <PlayerCardModal title={latest.name} onClose={onClose} p={best} seasons={seasons} attrCaption={<>at his peak, {clubName(u, best.clubId)} {seasonLabel(best.season)}</>} />
}

export function Explore() {
  const { universe: u, go, ensureLeagues, ensureClassic, loadingLeagues, loadedLeagues, shortlist, toggleShortlist } = useStore()
  // The database shows the classic seasons too: their pack loads on the first visit here, not at the game's start
  useEffect(() => {
    void ensureClassic(true)
  }, [ensureClassic, loadedLeagues])
  const [leagueId, setLeagueId] = useState('england')
  const [pickedSeason, setSeason] = useState<number>(u?.lastSeason ?? 2026)
  const [clubId, setClubId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [careerId, setCareerId] = useState<string | null>(null)
  const [view, setView] = useState<'browse' | 'legends' | 'search'>('browse')
  const [posFilter, setPosFilter] = useState<'all' | Position>('all')
  // On a phone the squad sits under the whole table: bring it into view when a club is picked
  const squadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!clubId || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 720px)').matches) return
    squadRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [clubId])
  // Every hook runs before the early return below
  const legends = useMemo(() => {
    if (!u) return []
    const all = Object.values(u.index).filter((p) => (posFilter === 'all' || p.positions[0] === posFilter) && u.clubById[p.clubId]?.leagueId === leagueId)
    return all.sort((a, b) => b.overall - a.overall).slice(0, 60)
  }, [u, posFilter, leagueId])
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!u || q.length < 2) return []
    return Object.values(u.index)
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => a.playerId.localeCompare(b.playerId) || a.season - b.season)
      .slice(0, 120)
  }, [u, query])
  const boxes = useBoxes(EXPLORE)
  if (!u) return null
  // Classic seasons (estimated ratings) come first for a league that has them
  const firstShown = classicFromFor(u, [leagueId]) ?? u.firstSeason
  const seasons = Array.from({ length: u.lastSeason - firstShown + 1 }, (_, i) => firstShown + i)
  // A classic season picked in one league is not on another league's list: show that league's first season instead
  const season = Math.max(pickedSeason, firstShown)
  const table = u.tables[leagueId]?.[season] ?? []
  const clubsInSeason = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === season).sort((a, b) => (a.position || 99) - (b.position || 99))
  // Nothing picked yet: open on the champions (or the first club listed), so the squad panel is never an empty box
  const shownClubId = clubId || (clubsInSeason.find((cs) => cs.champions) ?? clubsInSeason[0])?.clubId || ''
  const selected = shownClubId ? u.clubSeasonByKey[`${shownClubId}@${season}`] : undefined
  const seasonEstimated = clubsInSeason.some((cs) => cs.estimated)
  const browseGrid = boxes.grid([{ track: '1fr', ids: ['table'] }, { track: '1fr', ids: ['squad'] }])

  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Explore database</h1>
          <div className="screen-meta">
            <span>Every club-season on the wheel</span>
            <Info label="About Explore">Each club-season has its real squad and the ratings the engine uses. Tap a player for his whole career; the star shortlists that season for the market.</Info>
          </div>
        </div>
        <div className="head-actions explore-head-actions">
          <button className="btn ghost" onClick={() => go('home')}>
            ← Home
          </button>
          {view === 'browse' && <BoxesMenu groups={[boxes]} />}
        </div>
      </div>
      <div className="screen-body fill">
      <div className={`explore-bar ${view === 'search' ? 'all-leagues' : ''}`}>
        <div className="segmented" role="group" aria-label="League">
          {u.available.map((l) => (
            <button key={l.id} className={leagueId === l.id ? 'active' : ''} onClick={() => { setLeagueId(l.id); setClubId(''); void ensureLeagues([l.id]) }} disabled={loadingLeagues}>
              <LeagueFlag leagueId={l.id} /> {l.name}
            </button>
          ))}
        </div>
        {view === 'search' && <span className="chip info" data-testid="search-all-leagues">Search covers every league</span>}
        {loadingLeagues && <span className="chip">Loading league…</span>}
        {!loadedLeagues.includes(leagueId) && !loadingLeagues && <span className="chip warn">Loading…</span>}
      </div>
      <div className="segmented view-switch" role="group" aria-label="View">
        <button className={view === 'browse' ? 'active' : ''} onClick={() => setView('browse')}>
          <Trophy size={14} aria-hidden="true" /> Seasons
        </button>
        <button className={view === 'legends' ? 'active' : ''} onClick={() => setView('legends')}>
          <ListOrdered size={14} aria-hidden="true" /> Highest rated
        </button>
        <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}>
          <Search size={14} aria-hidden="true" /> Search players
        </button>
      </div>

      {view === 'browse' && (
        <div className={`grid two ${browseGrid.className}`} style={browseGrid.style}>
          {boxes.on('table') && (
          <div className="panel">
            <div className="panel-head">
              <h3>League table</h3>
              <select className="input" style={{ width: 'auto' }} aria-label="Season" value={season} onChange={(e) => { setSeason(Number(e.target.value)); setClubId('') }}>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {seasonLabel(s)}
                    {s < u.firstSeason ? ' (est.)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {seasonEstimated && (
              <p className="help" style={{ marginTop: 0 }} data-testid="explore-estimated">
                <EstimatedChip compact /> Real squads and table; ratings are TouchLine's estimate.
              </p>
            )}
            {table.length === 0 && clubsInSeason.length > 0 && (
              <p className="help" style={{ marginTop: 0 }} data-testid="explore-no-table">
                No final table in the data for this league, so the clubs are not ranked.
              </p>
            )}
            <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Club</th>
                  <th className="num">Pts</th>
                  <th className="num">Best</th>
                  <th className="num">XI avg</th>
                </tr>
              </thead>
              <tbody>
                {clubsInSeason.map((cs) => {
                  const t = table.find((r) => r.clubId === cs.clubId)
                  const top11 = cs.squad.slice(0, 11)
                  const avg = top11.length ? top11.reduce((s, p) => s + p.overall, 0) / top11.length : 0
                  return (
                    <tr key={cs.clubId} className={`clickable ${shownClubId === cs.clubId ? 'me' : ''}`} onClick={() => setClubId(cs.clubId)} {...pressable(() => setClubId(cs.clubId))} aria-current={shownClubId === cs.clubId ? 'true' : undefined}>
                      <td>{cs.position || '–'}</td>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <ClubBadge clubId={cs.clubId} size={22} /> {clubName(u, cs.clubId)}
                          {cs.champions && <Trophy size={14} className="gold-ic" role="img" aria-label="Champions" />}
                        </span>
                      </td>
                      <td className="num">{t?.points ?? '–'}</td>
                      <td className="num">{cs.squad[0]?.overall ?? '–'}</td>
                      <td className="num">{avg.toFixed(1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
          )}
          {boxes.on('squad') && (
          <div className="panel explore-squad" ref={squadRef}>
            {!selected && (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <Search size={26} />
                </span>
                <h3>Pick a club</h3>
                <p className="muted small">Its squad that season appears here.</p>
              </div>
            )}
            {selected && (
              <>
                <div className="club-head" style={{ marginBottom: 'var(--space-3)' }}>
                  <ClubBadge clubId={selected.clubId} size={44} />
                  <div>
                    <h2>{clubName(u, selected.clubId)}</h2>
                    <div className="club-sub">
                      <span>{seasonLabel(selected.season)}</span>
                      {!selected.complete ? (
                        <span>season in progress</span>
                      ) : selected.champions ? (
                        <span className="chip gold icon-chip">
                          <Trophy size={12} aria-hidden="true" /> Champions
                        </span>
                      ) : selected.position > 0 ? (
                        <span>
                          {ordinal(selected.position)} · {selected.points} pts
                        </span>
                      ) : (
                        <span>no final table</span>
                      )}
                      {selected.complete && selected.position > 0 && (
                        <span className="mono">
                          {selected.won}-{selected.drawn}-{selected.lost}
                        </span>
                      )}
                      <span>{selected.squad.length} players</span>
                      {selected.estimated && <EstimatedChip compact />}
                    </div>
                  </div>
                </div>
                <div className="plist lined explore-list">
                  {selected.squad.map((p) => (
                    <PlayerRow key={p.id} p={p} hideChampion={selected.champions} onClick={() => setCareerId(p.playerId)} right={<Star on={shortlist.includes(p.id)} onClick={() => toggleShortlist(p.id)} />} />
                  ))}
                </div>
              </>
            )}
          </div>
          )}
        </div>
      )}

      {view === 'legends' && (
        <div className="panel">
          <div className="panel-head">
            <h3>Highest rated player-seasons</h3>
            <div className="segmented scroll-x" role="group" aria-label="Position">
              {(['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => (
                <button key={p} className={posFilter === p ? 'active' : ''} onClick={() => setPosFilter(p)}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
            </div>
          </div>
          <div className="legend-row legend-head" aria-hidden="true">
            <span>#</span>
            <span>Rtg</span>
            <span className="lg-name">Player</span>
            <span className="lg-age">Age</span>
            <span className="lg-pos">Pos</span>
            <span className="lg-club">Club</span>
            <span className="lg-season">Season</span>
            <span className="lg-star" title="Shortlist">
              <StarIcon size={14} aria-hidden="true" />
            </span>
          </div>
          {legends.map((p, i) => (
            <div key={p.id} className="legend-row">
              <span className="muted">{i + 1}</span>
              <Rating value={p.overall} />
              <span className="lg-name">
                <button type="button" className="link-btn" onClick={() => setCareerId(p.playerId)} title="Career">
                  {p.name}
                </button>
              </span>
              <span className="lg-age muted small">{p.age}</span>
              <span className="lg-pos">
                {p.positions.map((x) => (
                  <Pos key={x} p={x} />
                ))}
              </span>
              <span className="lg-club row small" style={{ gap: 6 }}>
                <ClubBadge clubId={p.clubId} size={18} /> <span className="ellipsis">{clubName(u, p.clubId)}</span>
              </span>
              <span className="lg-season small muted">
                {seasonLabel(p.season)}
                {isEstimated(u, p.id) && <> <EstimatedChip compact /></>}
              </span>
              <button type="button" className="lg-star btn sm ghost" onClick={() => toggleShortlist(p.id)} title={shortlist.includes(p.id) ? 'On your shortlist' : 'Shortlist'} aria-label={shortlist.includes(p.id) ? 'Remove from shortlist' : 'Shortlist'} aria-pressed={shortlist.includes(p.id)}>
                <Star on={shortlist.includes(p.id)} />
              </button>
            </div>
          ))}
        </div>
      )}

      {view === 'search' && (
        <div className="panel">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input className="input" placeholder="Search a player name…" aria-label="Search a player name" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          <div className="plist lined" style={{ marginTop: 'var(--space-3)' }}>
            {results.map((p) => (
              <PlayerRow key={p.id} p={p} showClub onClick={() => setCareerId(p.playerId)} right={<Star on={shortlist.includes(p.id)} onClick={() => toggleShortlist(p.id)} />} />
            ))}
            {query.length >= 2 && results.length === 0 && <div className="muted small">No players match.</div>}
          </div>
          {query.length < 2 && <p className="help">Tap a player for his career; the star shortlists him.</p>}
        </div>
      )}
      </div>
      <CareerModal playerId={careerId} onClose={() => setCareerId(null)} />
    </div>
  )
}
