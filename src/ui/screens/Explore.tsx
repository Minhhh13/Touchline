import { useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { ClubBadge, Rating, Pos } from '../components/bits'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, ordinal, seasonLabel } from '../format'
import type { Position } from '@engine/types'

function Star({ on }: { on: boolean }) {
  return (
    <span className={on ? 'star on' : 'star'} title={on ? 'On your shortlist' : 'Add to shortlist'}>
      {on ? '★' : '☆'}
    </span>
  )
}

export function Explore() {
  const { universe: u, go, ensureLeagues, loadingLeagues, loadedLeagues, shortlist, toggleShortlist } = useStore()
  const [leagueId, setLeagueId] = useState('england')
  const [season, setSeason] = useState<number>(u?.lastSeason ?? 2026)
  const [clubId, setClubId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'browse' | 'legends' | 'search'>('browse')
  const [posFilter, setPosFilter] = useState<'all' | Position>('all')
  if (!u) return null
  const seasons = Array.from({ length: u.lastSeason - u.firstSeason + 1 }, (_, i) => u.firstSeason + i)
  const table = u.tables[leagueId]?.[season] ?? []
  const clubsInSeason = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === season).sort((a, b) => (a.position || 99) - (b.position || 99))
  const selected = clubId ? u.clubSeasonByKey[`${clubId}@${season}`] : undefined
  const legends = useMemo(() => {
    const all = Object.values(u.index).filter((p) => (posFilter === 'all' || p.positions[0] === posFilter) && u.clubById[p.clubId]?.leagueId === leagueId)
    return all.sort((a, b) => b.overall - a.overall).slice(0, 60)
  }, [u, posFilter, leagueId])
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return Object.values(u.index)
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => a.playerId.localeCompare(b.playerId) || a.season - b.season)
      .slice(0, 120)
  }, [u, query])

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div>
          <h1>Explore</h1>
          <div className="muted small">Every club-season on the wheel, with its real squad and the ratings the engine uses.</div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="segmented">
          {u.available.map((l) => (
            <button key={l.id} className={leagueId === l.id ? 'active' : ''} onClick={() => { setLeagueId(l.id); setClubId(''); void ensureLeagues([l.id]) }} disabled={loadingLeagues}>
              {l.name}
            </button>
          ))}
        </div>
        {loadingLeagues && <span className="chip">Loading league…</span>}
        {!loadedLeagues.includes(leagueId) && !loadingLeagues && <span className="chip warn">Loading…</span>}
      </div>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={view === 'browse' ? 'active' : ''} onClick={() => setView('browse')}>
          Seasons
        </button>
        <button className={view === 'legends' ? 'active' : ''} onClick={() => setView('legends')}>
          Highest rated
        </button>
        <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}>
          Search players
        </button>
      </div>

      {view === 'browse' && (
        <div className="grid two">
          <div className="panel">
            <div className="panel-head">
              <h3>League table</h3>
              <select className="input" style={{ width: 'auto' }} value={season} onChange={(e) => { setSeason(Number(e.target.value)); setClubId('') }}>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {seasonLabel(s)}
                  </option>
                ))}
              </select>
            </div>
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
                    <tr key={cs.clubId} className={`clickable ${clubId === cs.clubId ? 'me' : ''}`} onClick={() => setClubId(cs.clubId)}>
                      <td>{cs.position || '–'}</td>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <ClubBadge clubId={cs.clubId} size={22} /> {clubName(u, cs.clubId)}
                          {cs.champions && ' 🏆'}
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
          <div className="panel">
            {!selected && <div className="muted">Pick a club to see its squad that season.</div>}
            {selected && (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <ClubBadge clubId={selected.clubId} size={44} />
                  <div>
                    <h2 style={{ fontSize: 24 }}>{clubName(u, selected.clubId)}</h2>
                    <div className="small muted">
                      {seasonLabel(selected.season)} · {selected.complete ? `${ordinal(selected.position)} · ${selected.points} pts · ${selected.won}-${selected.drawn}-${selected.lost}` : 'season in progress'} · {selected.squad.length} players
                    </div>
                  </div>
                </div>
                <div className="plist" style={{ maxHeight: 620, overflow: 'auto' }}>
                  {selected.squad.map((p) => (
                    <PlayerRow key={p.id} p={p} onClick={() => toggleShortlist(p.id)} right={<Star on={shortlist.includes(p.id)} />} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {view === 'legends' && (
        <div className="panel">
          <div className="panel-head">
            <h3>Highest rated player-seasons</h3>
            <div className="segmented">
              {(['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => (
                <button key={p} className={posFilter === p ? 'active' : ''} onClick={() => setPosFilter(p)}>
                  {p === 'all' ? 'All' : p}
                </button>
              ))}
            </div>
          </div>
          {legends.map((p, i) => (
            <div key={p.id} className="legend-row">
              <span className="muted">{i + 1}</span>
              <Rating value={p.overall} />
              <span>
                <b>{p.name}</b> <span className="muted small">{p.age}y</span>{' '}
                {p.positions.map((x) => (
                  <Pos key={x} p={x} />
                ))}
              </span>
              <span className="row small" style={{ gap: 6 }}>
                <ClubBadge clubId={p.clubId} size={18} /> {clubName(u, p.clubId)}
              </span>
              <span className="small muted">{seasonLabel(p.season)}</span>
              <button type="button" className="btn sm ghost" onClick={() => toggleShortlist(p.id)} title="Shortlist">
                <Star on={shortlist.includes(p.id)} />
              </button>
            </div>
          ))}
        </div>
      )}

      {view === 'search' && (
        <div className="panel">
          <input className="input" placeholder="Search a player name…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="plist" style={{ marginTop: 10 }}>
            {results.map((p) => (
              <PlayerRow key={p.id} p={p} showClub onClick={() => toggleShortlist(p.id)} right={<Star on={shortlist.includes(p.id)} />} />
            ))}
            {query.length >= 2 && results.length === 0 && <div className="muted small">No players match.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
