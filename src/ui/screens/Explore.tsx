import { useEffect, useMemo, useRef, useState } from 'react'
import { ListOrdered, Search, Star as StarIcon, Trophy } from 'lucide-react'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { EXPLORE } from '../boxSets'
import { useStore } from '@game/store'
import { ClubBadge, EstimatedChip, Info, Rating, Pos, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { PlayerCardModal } from '../components/PlayerCard'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, clubShort, fixed, seasonLabel } from '../format'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'
import { rich } from '../i18n/rich'
import type { Position } from '@engine/types'
import { classicFromFor, isEstimated } from '@game/logic/era'
import { careerSeasons } from '@game/logic/playerCard'
import { searchPlayers, SEARCH_LIMIT, topPlayerSeasons } from '@game/logic/exploreSearch'
import { pressable } from '../a11y'

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
  return (
    <span
      className={on ? 'star on' : 'star'}
      title={t(on ? 'onShortlist' : 'addShortlist')}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? t(on ? 'removeShortlist' : 'addShortlist') : undefined}
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
  const ensureLeagues = useStore((s) => s.ensureLeagues)
  // His whole career: the leagues not loaded yet load behind the card, and it fills in when they arrive
  useEffect(() => {
    if (playerId && u) void ensureLeagues(u.available.map((l) => l.id))
  }, [playerId, u, ensureLeagues])
  const seasons = useMemo(() => (u && playerId ? careerSeasons(u, playerId) : []), [u, playerId])
  if (!u || !playerId || !seasons.length) return null
  const best = [...seasons].sort((a, b) => b.overall - a.overall)[0]
  const latest = seasons[seasons.length - 1]
  return <PlayerCardModal title={latest.name} onClose={onClose} p={best} seasons={seasons} attrCaption={t('atPeak', { club: clubName(u, best.clubId), season: seasonLabel(best.season) })} />
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
  const [onePerPlayer, setOnePerPlayer] = useState(false)
  const [legendSeason, setLegendSeason] = useState<'all' | number>('all')
  const [searchPos, setSearchPos] = useState<'all' | Position>('all')
  // On a phone the squad sits under the whole table: bring it into view when a club is picked
  const squadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!clubId || typeof window === 'undefined' || !window.matchMedia?.('(max-width: 720px)').matches) return
    squadRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [clubId])
  // Every hook runs before the early return below
  const legends = useMemo(() => (u ? topPlayerSeasons(u, { leagueId, position: posFilter === 'all' ? undefined : posFilter, onePerPlayer, season: legendSeason === 'all' ? undefined : legendSeason }) : []), [u, posFilter, leagueId, onePerPlayer, legendSeason])
  const searching = query.trim().length >= 2
  // The search covers every league: the ones not loaded yet load on the first search
  useEffect(() => {
    if (view === 'search' && searching && u) void ensureLeagues(u.available.map((l) => l.id))
  }, [view, searching, u, ensureLeagues])
  const results = useMemo(() => (u && searching ? searchPlayers(u, query, { position: searchPos === 'all' ? undefined : searchPos }) : []), [u, query, searching, searchPos])
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
      <div className={`explore-bar ${view === 'search' ? 'all-leagues' : ''}`}>
        <div className="segmented" role="group" aria-label={t('league')}>
          {u.available.map((l) => (
            <button key={l.id} className={leagueId === l.id ? 'active' : ''} onClick={() => { setLeagueId(l.id); setClubId(''); void ensureLeagues([l.id]) }} disabled={loadingLeagues}>
              <LeagueFlag leagueId={l.id} /> {l.name}
            </button>
          ))}
        </div>
        {view === 'search' && <span className="chip info" data-testid="search-all-leagues">{t('searchAll')}</span>}
        {loadingLeagues && <span className="chip">{t('loadingLeague')}</span>}
        {!loadedLeagues.includes(leagueId) && !loadingLeagues && <span className="chip warn">{t('loading')}</span>}
      </div>
      <div className="segmented view-switch" role="group" aria-label={t('view')}>
        <button className={view === 'browse' ? 'active' : ''} onClick={() => setView('browse')}>
          <Trophy size={14} aria-hidden="true" /> {t('seasons')}
        </button>
        <button className={view === 'legends' ? 'active' : ''} onClick={() => setView('legends')}>
          <ListOrdered size={14} aria-hidden="true" /> {t('highestRated')}
        </button>
        <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}>
          <Search size={14} aria-hidden="true" /> {rich(t('search'), { long: (c) => <span className="view-long">{c}</span> })}
        </button>
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
            <h3>{t(onePerPlayer ? 'topPlayers' : 'topSeasons')}</h3>
            <PosFilter value={posFilter} onChange={setPosFilter} />
          </div>
          <div className="row wrap explore-filters" style={{ gap: 'var(--space-2)' }}>
            <Segmented value={onePerPlayer ? 'player' : 'season'} onChange={(v) => setOnePerPlayer(v === 'player')} options={[{ value: 'season', label: t('everySeason'), testId: 'legends-every' }, { value: 'player', label: t('bestEach'), hint: t('bestEachHint'), testId: 'legends-one' }]} />
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

      {view === 'search' && (
        <div className="panel">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input className="input" type="search" placeholder={t('searchPlaceholder')} aria-label={t('searchLabel')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          <div className="row wrap explore-filters" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <PosFilter value={searchPos} onChange={setSearchPos} />
            {searching && (
              <span className="small muted" data-testid="search-count" aria-live="polite">
                {loadingLeagues ? t('loadingAll') : results.length >= SEARCH_LIMIT ? t('firstN', { n: SEARCH_LIMIT }) : t('players', { n: results.length })}
              </span>
            )}
          </div>
          <div className="plist lined" style={{ marginTop: 'var(--space-3)' }} data-testid="search-results">
            {results.map((h) => (
              <PlayerRow
                key={h.playerId}
                p={h.name === h.best.name ? h.best : { ...h.best, name: h.name }}
                onClick={() => setCareerId(h.playerId)}
                extra={
                  <span className="search-career">
                    {h.from === h.to ? seasonLabel(h.from) : t('span', { from: seasonLabel(h.from), to: seasonLabel(h.to) })} · {t('seasonCount', { n: h.seasons })} · {h.clubs.slice(0, 3).map((c) => clubShort(u, c)).join(', ')}
                    {h.clubs.length > 3 ? t('moreClubs', { n: h.clubs.length - 3 }) : ''}
                  </span>
                }
                right={<Star on={shortlist.includes(h.best.id)} onClick={() => toggleShortlist(h.best.id)} />}
              />
            ))}
            {searching && !loadingLeagues && results.length === 0 && <div className="muted small">{t('noMatchAt', { pos: searchPos })}</div>}
          </div>
          {!searching && <p className="help">{t('searchHelp')}</p>}
        </div>
      )}
      </div>
      <CareerModal playerId={careerId} onClose={() => setCareerId(null)} />
    </div>
  )
}
