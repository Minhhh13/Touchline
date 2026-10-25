import { useEffect, useMemo, useRef, useState } from 'react'
import { ListOrdered, Search, Star as StarIcon, Trophy } from 'lucide-react'
import { useStore } from '@game/store'
import { ClubBadge, Flag, Info, Modal, Rating, Pos } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { AttributePanel } from '../components/AttributePanel'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, ordinal, seasonLabel } from '../format'
import type { Position } from '@engine/types'

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

/** Every season of one real player across all loaded leagues, with the ratings the engine uses. */
function CareerModal({ playerId, onClose }: { playerId: string | null; onClose: () => void }) {
  const { universe: u, shortlist, toggleShortlist } = useStore()
  const seasons = useMemo(() => (u && playerId ? Object.values(u.index).filter((p) => p.playerId === playerId).sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId)) : []), [u, playerId])
  if (!u || !playerId || !seasons.length) return null
  const best = [...seasons].sort((a, b) => b.overall - a.overall)[0]
  const latest = seasons[seasons.length - 1]
  const clubs = [...new Set(seasons.map((p) => p.clubId))]
  const peak = Math.max(...seasons.map((p) => p.overall))
  const low = Math.min(...seasons.map((p) => p.overall))
  const titles = seasons.filter((p) => p.accolades.includes('Champion')).length
  return (
    <Modal open onClose={onClose} title={latest.name} wide>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <Flag nation={latest.nationality} />
        <span className="chip">
          {seasons.length} season{seasons.length === 1 ? '' : 's'} · {clubs.length} club{clubs.length === 1 ? '' : 's'}
        </span>
        <span className="chip gold">Peak {peak}</span>
        <span className="chip">
          {latest.positions.map((x) => (
            <Pos key={x} p={x} />
          ))}
        </span>
        {titles > 0 && (
          <span className="chip gold icon-chip">
            <Trophy size={12} aria-hidden="true" /> {titles} title{titles === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="grid two">
        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Rating by season</div>
          <div className="row" style={{ gap: 3, alignItems: 'flex-end', height: 70 }}>
            {seasons.map((p) => (
              <div key={p.id} title={`${seasonLabel(p.season)} · ${clubName(u, p.clubId)} · ${p.overall}`} style={{ flex: 1, minWidth: 6, height: `${Math.max(8, ((p.overall - low + 4) / Math.max(1, peak - low + 4)) * 100)}%`, background: p === best ? 'var(--meter-mid)' : 'var(--accent)', borderRadius: 3, opacity: p === best ? 1 : 0.75 }} />
            ))}
          </div>
          <div className="row between small muted" style={{ marginTop: 4 }}>
            <span>{seasonLabel(seasons[0].season)}</span>
            <span>{seasonLabel(latest.season)}</span>
          </div>
          <div className="eyebrow" style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
            At his peak · {clubName(u, best.clubId)} {seasonLabel(best.season)}
          </div>
          <AttributePanel p={best} />
        </div>
        <div className="tbl-wrap career-tbl">
          <table className="tbl">
            <thead>
              <tr>
                <th>Season</th>
                <th>Club</th>
                <th className="num">Age</th>
                <th className="num">OVR</th>
                <th className="num">Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((p) => (
                <tr key={p.id} style={p === best ? { fontWeight: 700 } : undefined}>
                  <td>{seasonLabel(p.season)}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <ClubBadge clubId={p.clubId} size={18} /> {clubName(u, p.clubId)}
                      {p.accolades.includes('Champion') && <Trophy size={13} className="gold-ic" aria-label="Champions" />}
                    </span>
                  </td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td className="num">£{p.value}M</td>
                  <td>
                    <button type="button" className="btn sm ghost" onClick={() => toggleShortlist(p.id)} title="Shortlist this season" aria-label={shortlist.includes(p.id) ? 'Remove from shortlist' : 'Shortlist this season'} aria-pressed={shortlist.includes(p.id)}>
                      <Star on={shortlist.includes(p.id)} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

export function Explore() {
  const { universe: u, go, ensureLeagues, loadingLeagues, loadedLeagues, shortlist, toggleShortlist } = useStore()
  const [leagueId, setLeagueId] = useState('england')
  const [season, setSeason] = useState<number>(u?.lastSeason ?? 2026)
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
  if (!u) return null
  const seasons = Array.from({ length: u.lastSeason - u.firstSeason + 1 }, (_, i) => u.firstSeason + i)
  const table = u.tables[leagueId]?.[season] ?? []
  const clubsInSeason = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === season).sort((a, b) => (a.position || 99) - (b.position || 99))
  const selected = clubId ? u.clubSeasonByKey[`${clubId}@${season}`] : undefined

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
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="explore-bar">
        <div className="segmented" role="group" aria-label="League">
          {u.available.map((l) => (
            <button key={l.id} className={leagueId === l.id ? 'active' : ''} onClick={() => { setLeagueId(l.id); setClubId(''); void ensureLeagues([l.id]) }} disabled={loadingLeagues}>
              <LeagueFlag leagueId={l.id} /> {l.name}
            </button>
          ))}
        </div>
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
                    <tr key={cs.clubId} className={`clickable ${clubId === cs.clubId ? 'me' : ''}`} onClick={() => setClubId(cs.clubId)}>
                      <td>{cs.position || '–'}</td>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <ClubBadge clubId={cs.clubId} size={22} /> {clubName(u, cs.clubId)}
                          {cs.champions && <Trophy size={14} className="gold-ic" aria-label="Champions" />}
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
          {legends.map((p, i) => (
            <div key={p.id} className="legend-row">
              <span className="muted">{i + 1}</span>
              <Rating value={p.overall} />
              <span>
                <button type="button" className="link-btn" onClick={() => setCareerId(p.playerId)} title="Career">
                  {p.name}
                </button>{' '}
                <span className="muted small">{p.age}y</span>{' '}
                {p.positions.map((x) => (
                  <Pos key={x} p={x} />
                ))}
              </span>
              <span className="row small" style={{ gap: 6 }}>
                <ClubBadge clubId={p.clubId} size={18} /> {clubName(u, p.clubId)}
              </span>
              <span className="small muted">{seasonLabel(p.season)}</span>
              <button type="button" className="btn sm ghost" onClick={() => toggleShortlist(p.id)} title="Shortlist" aria-label={shortlist.includes(p.id) ? 'Remove from shortlist' : 'Shortlist'} aria-pressed={shortlist.includes(p.id)}>
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
      <CareerModal playerId={careerId} onClose={() => setCareerId(null)} />
    </div>
  )
}
