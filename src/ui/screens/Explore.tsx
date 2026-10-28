import { useEffect, useMemo, useRef, useState } from 'react'
import { Columns3, Landmark, ListOrdered, Search, Shield, Star as StarIcon, Trophy } from 'lucide-react'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { EXPLORE } from '../boxSets'
import { useStore } from '@game/store'
import { ClubBadge, EstimatedChip, Info, Rating, Pos, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { PlayerCardModal } from '../components/PlayerCard'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, fixed, seasonLabel } from '../format'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'
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

const t = translator(explore)

const POS_FILTERS = ['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const

/** The position chips of Highest rated and the search (a player's first position). */
function PosFilter({ value, onChange }: { value: 'all' | Position; onChange: (p: 'all' | Position) => void }) {
  return (
    <div className="segmented scroll-x" role="group" aria-label={t('position')}>
      {POS_FILTERS.map((p) => (
        <button key={p} className={value === p ? 'active' : ''} aria-pressed={value === p} onClick={() => onChange(p)}>
          {p === 'all' ? t('allPositions') : p}
        </button>
      ))}
    </div>
  )
}

function Star({ on, onClick }: { on: boolean; onClick?: () => void }) {
  const icon = <StarIcon size={18} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
  // A real button when it toggles (round 4: it was a span with a button role, out of the Tab order)
  if (!onClick)
    return (
      <span className={on ? 'star on' : 'star'} title={t(on ? 'onShortlist' : 'addShortlist')}>
        {icon}
      </span>
    )
  return (
    <button type="button" className={on ? 'star on' : 'star'} title={t(on ? 'onShortlist' : 'addShortlist')} aria-label={t(on ? 'removeShortlist' : 'addShortlist')} aria-pressed={on} onClick={onClick}>
      {icon}
    </button>
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
      <Columns3 size={14} aria-hidden="true" /> {t(on ? 'inCompare' : 'addCompare')}
    </button>
  )
  return <PlayerCardModal title={latest.name} onClose={onClose} p={best} seasons={seasons} actions={actions} attrCaption={t('atPeak', { club: clubName(u, best.clubId), season: seasonLabel(best.season) })} />
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
    { id: 'browse', label: t('seasons'), icon: Trophy },
    { id: 'clubs', label: t('viewClubs'), icon: Shield },
    { id: 'league', label: t('viewLeague'), icon: Landmark },
    { id: 'legends', label: t('viewTop'), long: t('viewTopLong'), icon: ListOrdered },
    { id: 'search', label: t('viewSearch'), icon: Search },
    { id: 'compare', label: t('viewCompare'), icon: Columns3 },
  ]

  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{t('title')}</h1>
          <div className="screen-meta">
            <span>{t('meta')}</span>
            <Info label={t('aboutLabel')}>{t('about')}</Info>
          </div>
        </div>
        <div className="head-actions">
          {view === 'browse' && <BoxesMenu groups={[boxes]} />}
          <button className="btn ghost" onClick={() => go('home')}>
            {t('home')}
          </button>
        </div>
      </div>
      <div className="screen-body fill">
      <div className={`explore-bar ${view === 'search' || view === 'compare' ? 'all-leagues' : ''}`}>
        <div className="segmented" role="group" aria-label={t('league')}>
          {u.available.map((l) => (
            <button key={l.id} className={leagueId === l.id ? 'active' : ''} onClick={() => { setLeagueId(l.id); setClubId(''); setClubPage(''); void ensureLeagues([l.id]) }} disabled={loadingLeagues}>
              <LeagueFlag leagueId={l.id} /> {l.name}
            </button>
          ))}
        </div>
        {view === 'search' && <span className="chip info" data-testid="search-all-leagues">{t('searchAll')}</span>}
        {view === 'compare' && <span className="chip info">{t('compareAll')}</span>}
        {loadingLeagues && <span className="chip">{t('loadingLeague')}</span>}
        {!loadedLeagues.includes(leagueId) && !loadingLeagues && <span className="chip warn">{t('loading')}</span>}
      </div>
      <div className="segmented view-switch" role="group" aria-label={t('view')}>
        {views.map((x) => (
          <button key={x.id} className={view === x.id ? 'active' : ''} aria-pressed={view === x.id} onClick={() => setView(x.id)} data-testid={`explore-view-${x.id}`}>
            <x.icon size={14} aria-hidden="true" />
            <span>
              {x.label}
              {x.long && <span className="view-long">{x.long}</span>}
            </span>
            {x.id === 'compare' && compare.length > 0 && <span className="view-count">{compare.length}</span>}
          </button>
        ))}
      </div>

      {view === 'browse' && (
        <div className={`grid two ${browseGrid.className}`} style={browseGrid.style}>
          {boxes.on('table') && (
          <div className="panel">
            <div className="panel-head">
              <h3>{t('leagueTable')}</h3>
              <select className="input" style={{ width: 'auto' }} aria-label={t('season')} value={season} onChange={(e) => { setSeason(Number(e.target.value)); setClubId('') }}>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {t('seasonOption', { season: seasonLabel(s), estimated: s < u.firstSeason ? 'yes' : 'no' })}
                  </option>
                ))}
              </select>
            </div>
            {seasonEstimated && (
              <p className="help" style={{ marginTop: 0 }} data-testid="explore-estimated">
                <EstimatedChip compact />{t('tableEstimated')}
              </p>
            )}
            {table.length === 0 && clubsInSeason.length > 0 && (
              <p className="help" style={{ marginTop: 0 }} data-testid="explore-no-table">
                {t('noTable')}
              </p>
            )}
            <div className="tbl-wrap">
            <table className="tbl explore-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('colClub')}</th>
                  <th className="num">{t('colPts')}</th>
                  <th className="num">{t('colBest')}</th>
                  <th className="num">{t('colAvg')}</th>
                </tr>
              </thead>
              <tbody>
                {clubsInSeason.map((cs) => {
                  const row = table.find((r) => r.clubId === cs.clubId)
                  const top11 = cs.squad.slice(0, 11)
                  const avg = top11.length ? top11.reduce((s, p) => s + p.overall, 0) / top11.length : 0
                  return (
                    <tr key={cs.clubId} className={`clickable ${shownClubId === cs.clubId ? 'me' : ''}`} onClick={() => setClubId(cs.clubId)} {...pressable(() => setClubId(cs.clubId))} aria-current={shownClubId === cs.clubId ? 'true' : undefined}>
                      <td>{cs.position || '–'}</td>
                      <td className="club-cell">
                        <span className="row" style={{ gap: 8 }} title={clubName(u, cs.clubId)}>
                          <ClubBadge clubId={cs.clubId} size={22} /> <span className="ellipsis club-nm">{clubName(u, cs.clubId)}</span>
                          {cs.champions && <Trophy size={14} className="gold-ic" role="img" aria-label={t('champions')} />}
                        </span>
                      </td>
                      <td className="num">{row?.points ?? '–'}</td>
                      <td className="num">{cs.squad[0]?.overall ?? '–'}</td>
                      <td className="num">{fixed(avg, 1)}</td>
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
                <h3>{t('pickClub')}</h3>
                <p className="muted small">{t('pickClubHelp')}</p>
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
                        <span>{t('inProgress')}</span>
                      ) : selected.champions ? (
                        <span className="chip gold icon-chip">
                          <Trophy size={12} aria-hidden="true" /> {t('champions')}
                        </span>
                      ) : selected.position > 0 ? (
                        <span>{t('placedPoints', { pos: selected.position, points: selected.points })}</span>
                      ) : (
                        <span>{t('noFinalTable')}</span>
                      )}
                      {selected.complete && selected.position > 0 && (
                        <span className="mono">
                          {selected.won}-{selected.drawn}-{selected.lost}
                        </span>
                      )}
                      <span>{t('players', { n: selected.squad.length })}</span>
                      {selected.estimated && <EstimatedChip compact />}
                    </div>
                    <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 4 }}>
                      <WheelLine chance={wheelChanceOf(u, selected)} leagueName={leagueName} />
                      <button type="button" className="btn sm ghost" onClick={() => openClub(selected.clubId)} data-testid="open-club-page">
                        <Shield size={14} aria-hidden="true" /> {t('clubPage')}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="plist lined explore-list">
                  {selected.squad.map((p) => (
                    <PlayerRow key={p.id} p={p} hideChampion={selected.champions} onClick={() => setCareerId(p.playerId)} actions={<><CompareButton on={compare.includes(p.playerId)} full={compare.length >= COMPARE_MAX} onClick={() => flipCompare(p.playerId)} /><Star on={shortlist.includes(p.id)} onClick={() => toggleShortlist(p.id)} /></>} />
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
            <h3>{t(onePerPlayer ? 'topPlayers' : 'topSeasons')}</h3>
            <PosFilter value={posFilter} onChange={setPosFilter} />
          </div>
          <div className="row wrap explore-filters" style={{ gap: 'var(--space-2)' }}>
            <Segmented label={t('rowsLabel')} value={onePerPlayer ? 'player' : 'season'} onChange={(v) => setOnePerPlayer(v === 'player')} options={[{ value: 'season', label: t('everySeason'), testId: 'legends-every' }, { value: 'player', label: t('bestEach'), hint: t('bestEachHint'), testId: 'legends-one' }]} />
            <select className="input" style={{ width: 'auto' }} aria-label={t('season')} data-testid="legends-season" value={legendSeason} onChange={(e) => setLegendSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">{t('allSeasons')}</option>
              {[...seasons].reverse().map((s) => (
                <option key={s} value={s}>
                  {t('seasonOption', { season: seasonLabel(s), estimated: s < u.firstSeason ? 'yes' : 'no' })}
                </option>
              ))}
            </select>
            <span className="small muted" data-testid="legends-count">
              {legends.length ? t('topN', { n: legends.length }) : t('noMatch')}
            </span>
          </div>
          <div className="legend-row legend-head" aria-hidden="true">
            <span>#</span>
            <span>{t('colRtg')}</span>
            <span className="lg-name">{t('colPlayer')}</span>
            <span className="lg-age">{t('colAge')}</span>
            <span className="lg-pos">{t('colPos')}</span>
            <span className="lg-club">{t('colClub')}</span>
            <span className="lg-season">{t('season')}</span>
            <span className="lg-star" title={t('shortlist')}>
              <StarIcon size={14} aria-hidden="true" />
            </span>
          </div>
          {legends.map((p, i) => (
            <div key={p.id} className="legend-row">
              <span className="muted">{i + 1}</span>
              <Rating value={p.overall} />
              <span className="lg-name">
                <button type="button" className="link-btn" onClick={() => setCareerId(p.playerId)} title={t('career')}>
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
              <button type="button" className="lg-star btn sm ghost" onClick={() => toggleShortlist(p.id)} title={t(shortlist.includes(p.id) ? 'onShortlist' : 'shortlist')} aria-label={t(shortlist.includes(p.id) ? 'removeShortlist' : 'shortlist')} aria-pressed={shortlist.includes(p.id)}>
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
