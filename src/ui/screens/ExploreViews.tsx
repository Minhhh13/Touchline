import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, Columns3, Crown, Medal, Plus, Search, Shield, Star as StarIcon, Trophy, X } from 'lucide-react'
import type { Position } from '@engine/types'
import { useStore } from '@game/store'
import { useStorePick } from '../useStorePick'
import { isEstimated } from '@game/logic/era'
import { careerSeasons, positionMap, seasonSeries } from '@game/logic/playerCard'
import { searchPlayers, topPlayerSeasons } from '@game/logic/exploreSearch'
import { bestXIEver, careerLine, clubHistory, clubSummary, compareRows, COMPARE_MAX, leagueChampions, leagueClubs, leagueRecordBook, oneIn, shareLabel, titleCounts, topRatedBySeason, wheelChanceOf, type WheelChance } from '@game/logic/exploreDb'
import { BLANK_SEARCH, filterActive, filterPlayers, FILTER_LIMIT, formFilter, nationCounts, type FilterSort, type SearchForm } from '@game/logic/exploreFilter'
import { ClubBadge, EstimatedChip, Info, Pos, Rating, Segmented } from '../components/bits'
import { NationFlag } from '../components/Flag'
import { PlayerRow } from '../components/PlayerRow'
import { PositionMap, SeasonChart } from '../components/PlayerCharts'
import { clubName, clubShort, fixed, formatLocale, money, nationName, seasonLabel } from '../format'
import { pressable } from '../a11y'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'

const tx = translator(explore)

/**
 * Explore's deeper views (display only: everything shown comes from the pure helpers in `exploreDb.ts` and
 * `exploreFilter.ts`): a club's page, a league's page, the filtered search and the compare view. Each is a grid of
 * boxes that scroll inside themselves on the desktop shell.
 */

const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']

/** "On the wheel" for one club-season: the first spin's chance and its share of its season. */
export function WheelLine({ chance, leagueName }: { chance: WheelChance | null; leagueName: string }) {
  if (!chance) return <span className="small muted" data-testid="wheel-line">{tx('wheelNever')}</span>
  return (
    <span className="small muted" data-testid="wheel-line" title={tx('wheelTip', { league: leagueName, pct: (chance.p * 100).toFixed(3), n: chance.seasons })}>
      {tx('wheelLine', { oneIn: oneIn(chance.p), share: shareLabel(chance.seasonShare) })}
    </span>
  )
}

/**
 * A toggle inside a player row. The row is itself a button, and a button may not hold another, so this is a focusable
 * `role="button"` that takes Enter and Space and keeps its press from reaching the row.
 */
function RowToggle({ on, onClick, className, title, label, testId, children }: { on: boolean; onClick: () => void; className: string; title: string; label: string; testId?: string; children: ReactNode }) {
  return (
    <span
      className={className}
      title={title}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={on}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </span>
  )
}

/** Add a player to Compare or take him off, from inside a player row. */
export function CompareButton({ on, onClick, full }: { on: boolean; onClick: () => void; full?: boolean }) {
  return (
    <RowToggle on={on} onClick={onClick} className={`btn sm ghost compare-btn ${on ? 'on' : ''}`} title={on ? tx('removeCompare') : full ? tx('compareFull', { n: COMPARE_MAX }) : tx('addCompare')} label={tx(on ? 'removeCompare' : 'addCompare')} testId="compare-toggle">
      <Columns3 size={15} aria-hidden="true" />
    </RowToggle>
  )
}

/** The shortlist star: a toggle inside a player row, or with no `onClick` only the mark (inside a button of its own). */
export function ShortlistStar({ on, onClick }: { on: boolean; onClick?: () => void }) {
  const icon = <StarIcon size={18} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
  if (!onClick) return <span className={on ? 'star on' : 'star'}>{icon}</span>
  return (
    <RowToggle on={on} onClick={onClick} className={on ? 'star on' : 'star'} title={tx(on ? 'onShortlist' : 'addShortlist')} label={tx(on ? 'removeShortlist' : 'addShortlist')}>
      {icon}
    </RowToggle>
  )
}

// ---------------------------------------------------------------- Club page

export function ClubView({ leagueId, clubId, onClub, onPlayer }: { leagueId: string; clubId: string; onClub: (id: string) => void; onPlayer: (playerId: string) => void }) {
  const u = useStore((s) => s.universe)
  const clubs = useMemo(() => (u ? leagueClubs(u, leagueId) : []), [u, leagueId])
  const shown = clubs.some((c) => c.clubId === clubId) ? clubId : (clubs[0]?.clubId ?? '')
  const lines = useMemo(() => (u && shown ? clubHistory(u, shown) : []), [u, shown])
  const summary = useMemo(() => clubSummary(lines), [lines])
  const xi = useMemo(() => (u && shown ? bestXIEver(u, shown) : []), [u, shown])
  const [season, setSeason] = useState<number | null>(null)
  const [side, setSide] = useState<'squad' | 'xi'>('squad')
  useEffect(() => setSeason(null), [shown])
  if (!u) return null
  const line = lines.find((l) => l.cs.season === season) ?? lines[0]
  const leagueName = u.available.find((l) => l.id === leagueId)?.name ?? leagueId
  return (
    <div className="grid three fill explore-club" data-testid="explore-club">
      <div className="panel">
        <div className="panel-head">
          <h3 className="icon-title">
            <Shield size={16} aria-hidden="true" /> {tx('xClubs')}
          </h3>
          <span className="small muted">{tx('xClubCount', { n: clubs.length })}</span>
        </div>
        <div className="plist lined">
          {clubs.map((c) => (
            <button key={c.clubId} type="button" className={`prow club-pick ${c.clubId === shown ? 'selected' : ''}`} onClick={() => onClub(c.clubId)} aria-current={c.clubId === shown ? 'true' : undefined} data-testid="club-pick">
              <ClubBadge clubId={c.clubId} size={24} />
              <span className="col" style={{ gap: 2 }}>
                <span className="name">{c.name}</span>
                <span className="meta">
                  <span>{tx('xSeasonCount', { n: c.seasons })}</span>
                  {c.bestFinish > 0 && <span>{tx('xBest', { pos: c.bestFinish })}</span>}
                </span>
              </span>
              {c.titles > 0 && (
                <span className="chip gold icon-chip" title={tx('xTitlesInData', { n: c.titles })}>
                  <Trophy size={12} aria-hidden="true" /> {c.titles}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="panel" data-testid="club-history">
        {shown && (
          <div className="club-head" style={{ marginBottom: 'var(--space-2)' }}>
            <ClubBadge clubId={shown} size={40} />
            <div>
              <h2>{clubName(u, shown)}</h2>
              <div className="club-sub">
                <span>{tx('xSeasonCount', { n: summary.seasons })}</span>
                {summary.titles > 0 && (
                  <span className="chip gold icon-chip">
                    <Trophy size={12} aria-hidden="true" /> {summary.titles}
                  </span>
                )}
                {summary.withTable > 0 && <span>{tx('xTopFour', { n: summary.topFour })}</span>}
                {summary.avgFinish !== null && <span>{tx('xAvgFinish', { n: fixed(summary.avgFinish, 1) })}</span>}
              </div>
            </div>
          </div>
        )}
        {lines.some((l) => !l.table) && <p className="help" style={{ marginTop: 0 }}>{tx('xDashNote')}</p>}
        <div className="tbl-wrap">
          <table className="tbl sticky-head club-hist">
            <thead>
              <tr>
                <th>{tx('colSeason')}</th>
                <th className="num">{tx('colPos')}</th>
                <th className="num">{tx('colPts')}</th>
                <th className="num hide-phone">{tx('xColWdl')}</th>
                <th className="num">{tx('xColXiAvg')}</th>
                <th className="num" title={tx('xColWheelTip')}>{tx('xColWheel')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const w = wheelChanceOf(u, l.cs)
                const on = l === line
                return (
                  <tr key={`${l.cs.leagueId}@${l.cs.season}`} className={`clickable ${on ? 'me' : ''}`} onClick={() => setSeason(l.cs.season)} {...pressable(() => setSeason(l.cs.season))} aria-current={on ? 'true' : undefined}>
                    <td>
                      {seasonLabel(l.cs.season)}
                      {l.cs.estimated && <> <EstimatedChip compact /></>}
                    </td>
                    <td className="num">
                      {l.cs.champions ? <Trophy size={13} className="gold-ic" role="img" aria-label={tx('champions')} /> : l.table && l.cs.position > 0 ? (l.cs.complete ? l.cs.position : `${l.cs.position}*`) : '–'}
                    </td>
                    <td className="num">{l.table && l.cs.position > 0 ? l.cs.points : '–'}</td>
                    <td className="num mono hide-phone">{l.table && l.cs.position > 0 ? `${l.cs.won}-${l.cs.drawn}-${l.cs.lost}` : '–'}</td>
                    <td className="num">{fixed(l.xiAvg, 1)}</td>
                    <td className="num small">{w ? oneIn(w.p).replace('1 in ', '1/') : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {lines.some((l) => !l.cs.complete) && <p className="help">{tx('xStillPlayed')}</p>}
      </div>

      <div className="panel" data-testid="club-side">
        <div className="panel-head">
          <Segmented value={side} onChange={setSide} options={[{ value: 'squad', label: line ? tx('xSquadOf', { season: seasonLabel(line.cs.season) }) : tx('xSquad'), testId: 'club-side-squad' }, { value: 'xi', label: tx('xBestXi'), testId: 'club-side-xi', hint: tx('xBestXiHint') }]} />
        </div>
        {side === 'squad' && line && (
          <>
            <div className="row wrap" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <WheelLine chance={wheelChanceOf(u, line.cs)} leagueName={leagueName} />
              {line.cs.estimated && <EstimatedChip />}
            </div>
            <div className="plist lined">
              {line.cs.squad.map((p) => (
                <PlayerRow key={p.id} p={p} hideChampion={line.cs.champions} onClick={() => onPlayer(p.playerId)} />
              ))}
            </div>
          </>
        )}
        {side === 'xi' && (
          <div className="plist lined" data-testid="best-xi">
            {xi.map((x) => (
              <button key={x.slotId} type="button" className="prow ever-row" onClick={() => onPlayer(x.p.playerId)}>
                <Pos p={x.position} />
                <Rating value={x.rating} label={tx('xRatingAt', { pos: x.position })} />
                <span className="col" style={{ gap: 2 }}>
                  <span className="name">
                    <NationFlag nation={x.p.nationality} /> {x.p.name}
                  </span>
                  <span className="meta">
                    <span>{seasonLabel(x.p.season)}</span>
                    <span>{tx('ageShort', { n: x.p.age })}</span>
                    {isEstimated(u, x.p) && <EstimatedChip compact />}
                  </span>
                </span>
              </button>
            ))}
            {!xi.length && <p className="small muted">{tx('xNoPlayers')}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- League page

export function LeagueView({ leagueId, onClub, onPlayer }: { leagueId: string; onClub: (id: string) => void; onPlayer: (playerId: string) => void }) {
  const u = useStore((s) => s.universe)
  const champions = useMemo(() => (u ? leagueChampions(u, leagueId) : []), [u, leagueId])
  const top = useMemo(() => (u ? topRatedBySeason(u, leagueId, 3) : []), [u, leagueId])
  const book = useMemo(() => (u ? leagueRecordBook(u, leagueId) : null), [u, leagueId])
  const titles = useMemo(() => (u ? titleCounts(u, leagueId).slice(0, 5) : []), [u, leagueId])
  const greats = useMemo(() => (u ? topPlayerSeasons(u, { leagueId, onePerPlayer: true, limit: 5 }) : []), [u, leagueId])
  if (!u) return null
  const anyTable = champions.some((c) => c.table)
  const holder = (clubId: string, season: number) => (
    <button key={`${clubId}@${season}`} type="button" className="link-btn holder" onClick={() => onClub(clubId)}>
      <ClubBadge clubId={clubId} size={16} /> {clubShort(u, clubId)} {seasonLabel(season)}
    </button>
  )
  return (
    <div className="grid three fill explore-league" data-testid="explore-league">
      <div className="panel" data-testid="league-champions">
        <div className="panel-head">
          <h3 className="icon-title">
            <Trophy size={16} aria-hidden="true" /> {tx('champions')}
          </h3>
        </div>
        {!anyTable && <p className="help" style={{ marginTop: 0 }}>{tx('xNoChampions')}</p>}
        <div className="tbl-wrap">
          <table className="tbl sticky-head">
            <thead>
              <tr>
                <th>{tx('colSeason')}</th>
                <th>{anyTable ? tx('champions') : tx('xClubs')}</th>
                <th className="num">{tx('colPts')}</th>
                <th className="num hide-phone" title={tx('xGapTip')}>{tx('xGap')}</th>
              </tr>
            </thead>
            <tbody>
              {champions.map((c) => (
                <tr key={c.season}>
                  <td>
                    {seasonLabel(c.season)}
                    {c.estimated && <> <EstimatedChip compact /></>}
                  </td>
                  <td className="club-cell">
                    {c.first ? (
                      <button type="button" className="link-btn row" style={{ gap: 6 }} onClick={() => onClub(c.first!.clubId)} title={c.second ? tx('xRunnerUp', { club: clubName(u, c.second.clubId) }) : undefined}>
                        <ClubBadge clubId={c.first.clubId} size={18} /> <span className="ellipsis">{clubName(u, c.first.clubId)}</span>
                        {!c.complete && <span className="chip">{tx('xLeading')}</span>}
                      </button>
                    ) : (
                      <span className="muted small">{tx('xNoTable')}</span>
                    )}
                  </td>
                  <td className="num">{c.first?.points ?? '–'}</td>
                  <td className="num hide-phone">{c.gap === null ? '–' : `+${c.gap}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" data-testid="league-top-rated">
        <div className="panel-head">
          <h3 className="icon-title">
            <StarIcon size={16} aria-hidden="true" /> {tx('xTopRated')}
          </h3>
        </div>
        <div className="season-tops">
          {top.map((s) => (
            <div key={s.season} className="season-top">
              <div className="eyebrow">
                {seasonLabel(s.season)}
                {s.players.some((p) => isEstimated(u, p)) && <> <EstimatedChip compact /></>}
              </div>
              {s.players.map((p) => (
                <button key={p.id} type="button" className="top-line" onClick={() => onPlayer(p.playerId)}>
                  <Rating value={p.overall} />
                  <NationFlag nation={p.nationality} />
                  <span className="ellipsis top-name">{p.name}</span>
                  <span className="small muted ellipsis">{clubShort(u, p.clubId)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="panel" data-testid="league-records">
        <div className="panel-head">
          <h3 className="icon-title">
            <BookOpen size={16} aria-hidden="true" /> {tx('xRecordHolders')}
          </h3>
          {book && (
            <Info label={tx('xAboutBook')}>
              {tx(book.otherSeasons ? 'xBookInfoOther' : 'xBookInfo', { games: book.played, n: book.seasons, other: book.otherSeasons })}
            </Info>
          )}
        </div>
        {!book ? (
          <p className="small muted">{tx('xNoBook')}</p>
        ) : (
          <dl className="kv records-kv">
            {book.records.map((r) => (
              <div key={r.key} className="record-line">
                <dt>{r.label}</dt>
                <dd>
                  <strong>{r.key === 'bestGoalDiff' && r.value > 0 ? `+${r.value}` : r.value}</strong> <span className="holders">{r.holders.slice(0, 3).map((h) => holder(h.clubId, h.season))}{r.holders.length > 3 && <span className="small muted"> +{r.holders.length - 3}</span>}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {titles.length > 0 && (
          <>
            <h4 className="icon-title sub-head">
              <Crown size={14} aria-hidden="true" /> {tx('xMostTitles')}
            </h4>
            <ol className="rank-list">
              {titles.map((c) => (
                <li key={c.clubId}>
                  <button type="button" className="link-btn row" style={{ gap: 6 }} onClick={() => onClub(c.clubId)}>
                    <ClubBadge clubId={c.clubId} size={16} /> {clubName(u, c.clubId)}
                  </button>
                  <span className="small muted">{c.titles}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        <h4 className="icon-title sub-head">
          <Medal size={14} aria-hidden="true" /> {tx('xHighestEver')}
        </h4>
        <ol className="rank-list">
          {greats.map((p) => (
            <li key={p.id}>
              <button type="button" className="link-btn row" style={{ gap: 6 }} onClick={() => onPlayer(p.playerId)}>
                <Rating value={p.overall} /> {p.name}
              </button>
              <span className="small muted">
                {clubShort(u, p.clubId)} {seasonLabel(p.season)}
                {isEstimated(u, p) && <> <EstimatedChip compact /></>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Filtered search

/** The search's orders, worded when the view renders. */
const sorts = (): Array<{ value: FilterSort; label: string }> => [
  { value: 'relevance', label: tx('xSortRelevance') },
  { value: 'rating', label: tx('xSortRating') },
  { value: 'age', label: tx('xSortAge') },
  { value: 'value', label: tx('xSortValue') },
  { value: 'season', label: tx('colSeason') },
  { value: 'name', label: tx('xSortName') },
]

export function SearchView({ form, setForm, onPlayer, compare, toggleCompare }: { form: SearchForm; setForm: (f: SearchForm) => void; onPlayer: (playerId: string) => void; compare: string[]; toggleCompare: (playerId: string) => void }) {
  const { universe: u, loadingLeagues, shortlist, toggleShortlist, ensureLeagues } = useStorePick('universe', 'loadingLeagues', 'shortlist', 'toggleShortlist', 'ensureLeagues')
  const filter = useMemo(() => formFilter(form), [form])
  const active = filterActive(filter)
  // The search covers every league: the ones not loaded yet load on the first search
  useEffect(() => {
    if (active && u) void ensureLeagues(u.available.map((l) => l.id))
  }, [active, u, ensureLeagues])
  const result = useMemo(() => (u && active ? filterPlayers(u, filter) : { rows: [], total: 0 }), [u, filter, active])
  const nations = useMemo(() => (u ? nationCounts(u) : []), [u])
  if (!u) return null
  const set = <K extends keyof SearchForm>(k: K, v: SearchForm[K]) => setForm({ ...form, [k]: v })
  const changed = (Object.keys(BLANK_SEARCH) as Array<keyof SearchForm>).some((k) => form[k] !== BLANK_SEARCH[k])
  return (
    <div className="grid two fill explore-search" data-testid="explore-search">
      <div className="panel search-filters">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input className="input" type="search" placeholder={tx('xSearchPlaceholder')} aria-label={tx('xSearchLabel')} value={form.query} onChange={(e) => set('query', e.target.value)} autoFocus />
        </label>
        <div className="filter-grid">
          <label className="filter-field">
            <span className="eyebrow">{tx('xNation')}</span>
            <span className="row" style={{ gap: 6 }}>
              {form.nation && <NationFlag nation={form.nation} named />}
              <select className="input" aria-label={tx('xNation')} value={form.nation} onChange={(e) => set('nation', e.target.value)} data-testid="filter-nation">
                <option value="">{tx('xEveryNation')}</option>
                {nations.map((n) => (
                  <option key={n.nation} value={n.nation}>
                    {nationName(u, n.nation)} ({n.players})
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="filter-field">
            <span className="eyebrow">{tx('league')}</span>
            <select className="input" aria-label={tx('league')} value={form.leagueId} onChange={(e) => set('leagueId', e.target.value)} data-testid="filter-league">
              <option value="">{tx('xEveryLeague')}</option>
              {u.available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span className="eyebrow">{tx('position')}</span>
            <select className="input" aria-label={tx('position')} value={form.position} onChange={(e) => set('position', e.target.value as SearchForm['position'])} data-testid="filter-position">
              <option value="">{tx('xAny')}</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="check-line filter-check">
            <input type="checkbox" checked={form.anyPosition} onChange={(e) => set('anyPosition', e.target.checked)} disabled={!form.position} /> {tx('xAnyPosition')}
          </label>
          <div className="filter-field" role="group" aria-label={tx('xAge')}>
            <span className="eyebrow">{tx('xAge')}</span>
            <span className="row range-pair">
              <input className="input" type="number" inputMode="numeric" min={15} max={45} placeholder={tx('xFrom')} aria-label={tx('xYoungest')} value={form.minAge} onChange={(e) => set('minAge', e.target.value)} data-testid="filter-min-age" />
              <span className="muted">to</span>
              <input className="input" type="number" inputMode="numeric" min={15} max={45} placeholder={tx('xTo')} aria-label={tx('xOldest')} value={form.maxAge} onChange={(e) => set('maxAge', e.target.value)} />
            </span>
          </div>
          <div className="filter-field" role="group" aria-label={tx('xSortRating')}>
            <span className="eyebrow">{tx('xSortRating')}</span>
            <span className="row range-pair">
              <input className="input" type="number" inputMode="numeric" min={1} max={99} placeholder={tx('xFrom')} aria-label={tx('xLowest')} value={form.minRating} onChange={(e) => set('minRating', e.target.value)} data-testid="filter-min-rating" />
              <span className="muted">to</span>
              <input className="input" type="number" inputMode="numeric" min={1} max={99} placeholder={tx('xTo')} aria-label={tx('xHighest')} value={form.maxRating} onChange={(e) => set('maxRating', e.target.value)} />
            </span>
          </div>
        </div>
        <div className="eyebrow" style={{ marginTop: 'var(--space-3)' }}>
          {tx('xQuickNations')}
        </div>
        <div className="row wrap nation-chips" style={{ gap: 6 }}>
          {nations.filter((n) => nationName(u, n.nation) !== 'Unknown').slice(0, 10).map((n) => (
            <button key={n.nation} type="button" className={`chip-btn ${form.nation === n.nation ? 'active' : ''}`} aria-pressed={form.nation === n.nation} onClick={() => set('nation', form.nation === n.nation ? '' : n.nation)}>
              <NationFlag nation={n.nation} named /> {nationName(u, n.nation)}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <Segmented value={form.every ? 'season' : 'player'} onChange={(v) => set('every', v === 'season')} options={[{ value: 'player', label: tx('xBestSeasonEach'), testId: 'filter-one' }, { value: 'season', label: tx('everySeason'), testId: 'filter-every' }]} />
          {changed && (
            <button type="button" className="btn sm ghost" onClick={() => setForm(BLANK_SEARCH)} data-testid="filter-clear">
              <X size={14} aria-hidden="true" /> {tx('xClear')}
            </button>
          )}
        </div>
        {!active && <p className="help">{tx('xSearchHelp')}</p>}
      </div>

      <div className="panel search-out">
        <div className="panel-head">
          <span className="small muted" data-testid="search-count" aria-live="polite">
            {!active ? tx('xNoSearch') : loadingLeagues ? tx('xLoadingEvery') : result.total > result.rows.length ? tx('xFirstOf', { n: result.rows.length, total: result.total.toLocaleString(formatLocale()) }) : form.every ? tx('xSeasonCount', { n: result.total }) : tx('players', { n: result.total })}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <select className="input" style={{ width: 'auto' }} aria-label={tx('xSortBy')} value={form.sort} onChange={(e) => set('sort', e.target.value as FilterSort)} data-testid="filter-sort">
              {sorts().map((s) => (
                <option key={s.value} value={s.value} disabled={s.value === 'relevance' && form.query.trim().length < 2}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm ghost" onClick={() => set('reverse', !form.reverse)} aria-pressed={form.reverse} title={tx('xReverse')} data-testid="filter-reverse">
              {form.reverse ? '↑' : '↓'}
            </button>
          </span>
        </div>
        <div className="plist lined" data-testid="search-results">
          {result.rows.map((h) => (
            <PlayerRow
              key={h.p.id}
              p={h.name === h.p.name || form.every ? h.p : { ...h.p, name: h.name }}
              showClub
              onClick={() => onPlayer(h.p.playerId)}
              extra={
                <span className="search-career">
                  {h.from === h.to ? seasonLabel(h.from) : tx('xSeasonRange', { from: seasonLabel(h.from), to: seasonLabel(h.to) })} · {tx('xSeasonCount', { n: h.seasons })} · {money(h.p.value)}
                </span>
              }
              right={
                <span className="row" style={{ gap: 2 }}>
                  <CompareButton on={compare.includes(h.p.playerId)} full={compare.length >= COMPARE_MAX} onClick={() => toggleCompare(h.p.playerId)} />
                  <ShortlistStar on={shortlist.includes(h.p.id)} onClick={() => toggleShortlist(h.p.id)} />
                </span>
              }
            />
          ))}
          {active && !loadingLeagues && result.total === 0 && <div className="muted small">{tx('xNoPlayersMatch')}</div>}
        </div>
        {result.total > FILTER_LIMIT && <p className="help">{tx('xShowingFirst', { n: FILTER_LIMIT })}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Compare

export function CompareView({ ids, setIds, onPlayer }: { ids: string[]; setIds: (ids: string[]) => void; onPlayer: (playerId: string) => void }) {
  const { universe: u, ensureLeagues } = useStorePick('universe', 'ensureLeagues')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  // A compared player's whole career: the leagues not loaded yet load behind the view
  useEffect(() => {
    if (ids.length && u) void ensureLeagues(u.available.map((l) => l.id))
  }, [ids.length, u, ensureLeagues])
  const careers = useMemo(() => (u ? ids.map((id) => careerSeasons(u, id)).filter((s) => s.length > 0) : []), [u, ids])
  const shown = useMemo(() => careers.map((seasons) => seasons.find((s) => s.id === picked[seasons[0].playerId]) ?? seasons.reduce((m, s) => (s.overall > m.overall ? s : m), seasons[0])), [careers, picked])
  const rows = useMemo(() => compareRows(shown), [shown])
  const hits = useMemo(() => (u && query.trim().length >= 2 ? searchPlayers(u, query, { limit: 6 }) : []), [u, query])
  if (!u) return null
  const add = (playerId: string) => {
    if (!ids.includes(playerId)) setIds([...ids, playerId].slice(-COMPARE_MAX))
    setQuery('')
  }
  return (
    <div className="grid two fill explore-compare" data-testid="explore-compare">
      <div className="panel compare-players">
        <div className="panel-head">
          <h3 className="icon-title">
            <Columns3 size={16} aria-hidden="true" /> {tx('viewCompare')}
          </h3>
          <span className="small muted">{ids.length ? tx('xNOfMax', { n: ids.length, max: COMPARE_MAX }) : tx('xUpTo', { max: COMPARE_MAX })}</span>
        </div>
        {ids.length < COMPARE_MAX && (
          <div className="compare-add">
            <label className="search-field">
              <Plus size={16} aria-hidden="true" />
              <input className="input" type="search" placeholder={tx('xAddPlaceholder')} aria-label={tx('xAddLabel')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="compare-search" />
            </label>
            {hits.length > 0 && (
              <div className="plist lined compare-hits">
                {hits.map((h) => (
                  <PlayerRow key={h.playerId} p={{ ...h.best, name: h.name }} showClub onClick={() => add(h.playerId)} right={<Plus size={16} aria-hidden="true" />} />
                ))}
              </div>
            )}
          </div>
        )}
        {!careers.length ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <Columns3 size={26} />
            </span>
            <h3>{tx('xPickTwo')}</h3>
            <p className="muted small">{tx('xPickTwoHelp')}</p>
          </div>
        ) : (
          <div className="compare-cols" style={{ gridTemplateColumns: `repeat(${careers.length}, minmax(0, 1fr))` }}>
            {careers.map((seasons, i) => {
              const p = shown[i]
              const line = careerLine(seasons)
              const points = seasonSeries(u, seasons)
              return (
                <section key={p.playerId} className="compare-col" aria-label={p.name} data-testid="compare-col">
                  <div className="compare-head">
                    <Rating value={p.overall} size="lg" />
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      <button type="button" className="link-btn ellipsis" onClick={() => onPlayer(p.playerId)} title={tx('career')}>
                        {p.name}
                      </button>
                      <span className="small muted row" style={{ gap: 4 }}>
                        <NationFlag nation={p.nationality} /> {p.positions.join(' ')} · {tx('ageShort', { n: p.age })}
                      </span>
                    </span>
                    <button type="button" className="btn sm ghost icon-only" onClick={() => setIds(ids.filter((x) => x !== p.playerId))} aria-label={tx('xRemoveName', { name: p.name })} title={tx('xRemove')}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <select className="input" aria-label={tx('xSeasonOf', { name: p.name })} value={p.id} onChange={(e) => setPicked({ ...picked, [p.playerId]: e.target.value })} data-testid="compare-season">
                    {[...seasons].reverse().map((s) => (
                      <option key={s.id} value={s.id}>
                        {tx('xSeasonOption', { season: seasonLabel(s.season), club: clubShort(u, s.clubId), overall: s.overall, est: isEstimated(u, s) ? 'yes' : 'no' })}
                      </option>
                    ))}
                  </select>
                  {isEstimated(u, p) && <EstimatedChip />}
                  {line && (
                    <div className="small muted">
                      {tx('xCareerLine', { peak: line.peak, seasons: line.seasons, clubs: line.clubs, titles: line.titles })}
                    </div>
                  )}
                  <h4 className="pc-title">{tx('ratingBySeason')}</h4>
                  <SeasonChart points={points} u={u} />
                  <h4 className="pc-title">{tx('positions')}</h4>
                  <PositionMap spots={positionMap(p)} />
                </section>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel compare-table" data-testid="compare-table">
        <div className="panel-head">
          <h3>{tx('xSideBySide')}</h3>
          {shown.length > 1 && <span className="small muted">{tx('xLeaderBold')}</span>}
        </div>
        {!shown.length ? (
          <p className="small muted">{tx('xAttributesHere')}</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl sticky-head compare-tbl">
              <thead>
                <tr>
                  <th />
                  {shown.map((p) => (
                    <th key={p.id} className="num" title={`${p.name} · ${clubName(u, p.clubId)} ${seasonLabel(p.season)}`}>
                      <span className="ellipsis compare-th">{p.name.split(' ').slice(-1)[0]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className={i > 0 && rows[i - 1].group !== r.group ? 'group-start' : ''}>
                    <th scope="row" className="compare-label">
                      {r.label}
                      {(i === 0 || rows[i - 1].group !== r.group) && <span className="compare-group"> · {r.group}</span>}
                    </th>
                    {r.values.map((v, j) => (
                      <td key={j} className={`num ${r.leaders.includes(j) ? 'lead' : ''}`}>
                        {r.key === 'value' ? money(v) : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
