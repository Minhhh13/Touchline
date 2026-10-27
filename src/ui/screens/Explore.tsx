import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns3, Landmark, ListOrdered, Search, Shield, Star as StarIcon, Trophy } from 'lucide-react'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { EXPLORE } from '../boxSets'
import { useStore } from '@game/store'
import { ClubBadge, EstimatedChip, Info, Rating, Pos, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { PlayerCardModal } from '../components/PlayerCard'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, ordinal, seasonLabel } from '../format'
import type { Position } from '@engine/types'
import { classicFromFor, isEstimated } from '@game/logic/era'
import { careerSeasons } from '@game/logic/playerCard'
import { topPlayerSeasons } from '@game/logic/exploreSearch'
import { BLANK_SEARCH, type SearchForm } from '@game/logic/exploreFilter'
import { COMPARE_MAX, toggleCompare, wheelChanceOf } from '@game/logic/exploreDb'
import { pressable } from '../a11y'
import { ClubView, CompareButton, CompareView, LeagueView, SearchView, WheelLine } from './ExploreViews'

type ExploreView = 'browse' | 'clubs' | 'league' | 'legends' | 'search' | 'compare'

/** The compare list is a per-viewer convenience: its own key, read and written inside try/catch. */
const COMPARE_KEY = 'touchline-explore-compare'

function readCompare(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COMPARE_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-COMPARE_MAX) : []
  } catch {
    return []
  }
}

function writeCompare(ids: string[]): void {
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(ids))
  } catch {
    // A private window or a full storage: the list lives for this visit only
  }
}

const POS_FILTERS = ['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const

/** The position chips of Highest rated and the search (a player's first position). */
function PosFilter({ value, onChange }: { value: 'all' | Position; onChange: (p: 'all' | Position) => void }) {
  return (
    <div className="segmented scroll-x" role="group" aria-label="Position">
      {POS_FILTERS.map((p) => (
        <button key={p} className={value === p ? 'active' : ''} aria-pressed={value === p} onClick={() => onChange(p)}>
          {p === 'all' ? 'All' : p}
        </button>
      ))}
    </div>
  )
}

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
function CareerModal({ playerId, onClose, compare, onCompare }: { playerId: string | null; onClose: () => void; compare: string[]; onCompare: (playerId: string) => void }) {
  const u = useStore((s) => s.universe)
  const ensureLeagues = useStore((s) => s.ensureLeagues)
  // His whole career: the leagues not loaded yet load behind the card, and it fills in when they arrive
  useEffect(() => {
    if (playerId && u) void ensureLeagues(u.available.map((l) => l.id))
  }, [playerId, u, ensureLeagues])
  const seasons = useMemo(() => (u && playerId ? careerSeasons(u, playerId) : []), [u, playerId])
  if (!u || !playerId || !seasons.length) return null
  const best = [...seasons].sort((a, b) => b.overall - a.overall)[0]
  const latest = seasons[seasons.length - 1]
  const on = compare.includes(playerId)
  const actions = (
    <button type="button" className={`btn sm ${on ? 'primary' : 'ghost'}`} onClick={() => onCompare(playerId)} aria-pressed={on} data-testid="card-compare">
      <Columns3 size={14} aria-hidden="true" /> {on ? 'In Compare' : 'Add to compare'}
    </button>
  )
  return <PlayerCardModal title={latest.name} onClose={onClose} p={best} seasons={seasons} actions={actions} attrCaption={<>at his peak, {clubName(u, best.clubId)} {seasonLabel(best.season)}</>} />
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
  const [careerId, setCareerId] = useState<string | null>(null)
  const [view, setView] = useState<ExploreView>('browse')
  const [clubPage, setClubPage] = useState('')
  const [form, setForm] = useState<SearchForm>(BLANK_SEARCH)
  const [compare, setCompareState] = useState<string[]>(readCompare)
  const setCompare = (ids: string[]) => {
    setCompareState(ids)
    writeCompare(ids)
  }
  const flipCompare = (playerId: string) => setCompare(toggleCompare(compare, playerId))
  const [posFilter, setPosFilter] = useState<'all' | Position>('all')
  const [onePerPlayer, setOnePerPlayer] = useState(false)
  const [legendSeason, setLegendSeason] = useState<'all' | number>('all')
  // On a phone the squad sits under the whole table: bring it into view when a club is picked
  const squadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!clubId || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 720px)').matches) return
    squadRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [clubId])
  // Every hook runs before the early return below
  const legends = useMemo(() => (u ? topPlayerSeasons(u, { leagueId, position: posFilter === 'all' ? undefined : posFilter, onePerPlayer, season: legendSeason === 'all' ? undefined : legendSeason }) : []), [u, posFilter, leagueId, onePerPlayer, legendSeason])
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
  const leagueName = u.available.find((l) => l.id === leagueId)?.name ?? leagueId
  const openClub = (id: string) => {
    const club = u.clubById[id]
    if (club && club.leagueId !== leagueId) {
      setLeagueId(club.leagueId)
      void ensureLeagues([club.leagueId])
    }
    setClubPage(id)
    setView('clubs')
  }
  const views: Array<{ id: ExploreView; label: string; long?: string; icon: typeof Trophy }> = [
    { id: 'browse', label: 'Seasons', icon: Trophy },
    { id: 'clubs', label: 'Clubs', icon: Shield },
    { id: 'league', label: 'League', icon: Landmark },
    { id: 'legends', label: 'Top', long: ' rated', icon: ListOrdered },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'compare', label: 'Compare', icon: Columns3 },
  ]

  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Explore database</h1>
          <div className="screen-meta">
            <span>Every club-season on the wheel</span>
            <Info label="About Explore">Each club-season has its real squad and the ratings the engine uses. Clubs and League hold every season of a club and a league; Search filters every player; Compare lines up to three side by side. Tap a player for his whole career; the star shortlists that season for the market.</Info>
          </div>
        </div>
        <div className="head-actions">
          {view === 'browse' && <BoxesMenu groups={[boxes]} />}
          <button className="btn ghost" onClick={() => go('home')}>
            ← Home
          </button>
        </div>
      </div>
      <div className="screen-body fill">
      <div className={`explore-bar ${view === 'search' || view === 'compare' ? 'all-leagues' : ''}`}>
        <div className="segmented" role="group" aria-label="League">
          {u.available.map((l) => (
            <button key={l.id} className={leagueId === l.id ? 'active' : ''} onClick={() => { setLeagueId(l.id); setClubId(''); setClubPage(''); void ensureLeagues([l.id]) }} disabled={loadingLeagues}>
              <LeagueFlag leagueId={l.id} /> {l.name}
            </button>
          ))}
        </div>
        {view === 'search' && <span className="chip info" data-testid="search-all-leagues">Search covers every league</span>}
        {view === 'compare' && <span className="chip info">Compare covers every league</span>}
        {loadingLeagues && <span className="chip">Loading league…</span>}
        {!loadedLeagues.includes(leagueId) && !loadingLeagues && <span className="chip warn">Loading…</span>}
      </div>
      <div className="segmented view-switch" role="group" aria-label="View">
        {views.map((x) => (
          <button key={x.id} className={view === x.id ? 'active' : ''} aria-pressed={view === x.id} onClick={() => setView(x.id)} data-testid={`explore-view-${x.id}`}>
            <x.icon size={14} aria-hidden="true" /> {x.label}
            {x.long && <span className="view-long">{x.long}</span>}
            {x.id === 'compare' && compare.length > 0 && <span className="view-count">{compare.length}</span>}
          </button>
        ))}
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
            <table className="tbl explore-table">
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
                      <td className="club-cell">
                        <span className="row" style={{ gap: 8 }} title={clubName(u, cs.clubId)}>
                          <ClubBadge clubId={cs.clubId} size={22} /> <span className="ellipsis club-nm">{clubName(u, cs.clubId)}</span>
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
                    <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 4 }}>
                      <WheelLine chance={wheelChanceOf(u, selected)} leagueName={leagueName} />
                      <button type="button" className="btn sm ghost" onClick={() => openClub(selected.clubId)} data-testid="open-club-page">
                        <Shield size={14} aria-hidden="true" /> Club page
                      </button>
                    </div>
                  </div>
                </div>
                <div className="plist lined explore-list">
                  {selected.squad.map((p) => (
                    <PlayerRow key={p.id} p={p} hideChampion={selected.champions} onClick={() => setCareerId(p.playerId)} right={<span className="row" style={{ gap: 2 }}><CompareButton on={compare.includes(p.playerId)} full={compare.length >= COMPARE_MAX} onClick={() => flipCompare(p.playerId)} /><Star on={shortlist.includes(p.id)} onClick={() => toggleShortlist(p.id)} /></span>} />
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
            <h3>{onePerPlayer ? 'Highest rated players' : 'Highest rated player-seasons'}</h3>
            <PosFilter value={posFilter} onChange={setPosFilter} />
          </div>
          <div className="row wrap explore-filters" style={{ gap: 'var(--space-2)' }}>
            <Segmented value={onePerPlayer ? 'player' : 'season'} onChange={(v) => setOnePerPlayer(v === 'player')} options={[{ value: 'season', label: 'Every season', testId: 'legends-every' }, { value: 'player', label: 'Best season each', hint: "Each player once, at his best season in this league", testId: 'legends-one' }]} />
            <select className="input" style={{ width: 'auto' }} aria-label="Season" data-testid="legends-season" value={legendSeason} onChange={(e) => setLegendSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All seasons</option>
              {[...seasons].reverse().map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(s)}
                  {s < u.firstSeason ? ' (est.)' : ''}
                </option>
              ))}
            </select>
            <span className="small muted" data-testid="legends-count">
              {legends.length ? `Top ${legends.length}` : 'No players match'}
            </span>
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

      {view === 'clubs' && <ClubView leagueId={leagueId} clubId={clubPage} onClub={openClub} onPlayer={setCareerId} />}
      {view === 'league' && <LeagueView leagueId={leagueId} onClub={openClub} onPlayer={setCareerId} />}
      {view === 'search' && <SearchView form={form} setForm={setForm} onPlayer={setCareerId} compare={compare} toggleCompare={flipCompare} />}
      {view === 'compare' && <CompareView ids={compare} setIds={setCompare} onPlayer={setCareerId} />}
      </div>
      <CareerModal playerId={careerId} onClose={() => setCareerId(null)} compare={compare} onCompare={flipCompare} />
    </div>
  )
}
