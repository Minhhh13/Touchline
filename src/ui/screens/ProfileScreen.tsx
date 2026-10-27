import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Award, Axe, CalendarDays, CalendarRange, ChevronsUp, Compass, Crown, Download, Flag as FlagIcon, Flame, Gem, Globe, Landmark, LifeBuoy, Lock, Medal, Shield, Target, Timer, Trophy, Trash2, Upload, type LucideIcon } from 'lucide-react'
import { useStore, exportSaveJson, readSaveFile, storeImportedSave, wipeSave } from '@game/store'
import { ACHIEVEMENTS } from '@engine/awards'
import { badgeStates, topBadges } from '@engine/badges'
import { fetchClubLeagues } from '@engine/universe'
import type { ArenaRunEntry, LeaderboardEntry } from '@game/types'
import { MODE_TITLE, arenaFormatLabel, isQuickLike } from '@game/logic/modes'
import { arenaClubName, groupRunsByLadder } from '@game/logic/arena'
import { arenaTierLabel } from '@engine/knockout'
import { capTotal } from '@game/logic/cap'
import { BOARD_FILTERS, filterBoard, honourDetail, honourLabel, leaguesWon, normaliseCabinet, type BoardFilter } from '@game/logic/cabinet'
import { downloadDataUrl, renderManagerCard } from '../shareCard'
import { RunInsTable } from '../components/RunInsTable'
import { ClubBadge, Flag, Info, Segmented, Stat } from '../components/bits'
import { LeagueFlag, SuperLeagueMark } from '../components/Flag'
import { SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { POWER_UPS, POWER_UP_INFO } from '@engine/powerups'
import { lockerCount } from '@game/logic/endCase'
import { AchievementIcon, PowerUpIcon } from '../components/icons'
import { clubName, ordinal, seasonLabel, tierName } from '../format'
import { countPhrase } from '../screenText'
import { TIP_IDS, tipsSeenCount } from '@game/logic/tips'
import { AccountLink } from '../online/AccountPanel'
import { emptyBests, recordLabel } from '@game/logic/perfect'
import { careerOverview, orderAchievements, type AchievementView } from '@game/logic/careerOverview'
import { useMatchSoundOn, useSoundOn } from '../sound/prefs'
import { quickSpinPref, usePref } from '../viewerPrefs'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { PROFILE } from '../boxSets'

const FILTER_KEY = 'touchline-record-filter'
const RUNS_VIEW_KEY = 'touchline-runs-view'

function readRunsView(): 'best' | 'ladder' {
  try {
    return localStorage.getItem(RUNS_VIEW_KEY) === 'ladder' ? 'ladder' : 'best'
  } catch {
    return 'best'
  }
}

function readFilter(): BoardFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY)
    return BOARD_FILTERS.some((f) => f.value === v) ? (v as BoardFilter) : 'all'
  } catch {
    return 'all'
  }
}

/** The Trophy Room's badges drawn as Lucide icons (the badge's emoji stays as data, for the manager card). */
const BADGE_ICON: Record<string, LucideIcon> = {
  'serial-winner': Trophy,
  centurion: Target,
  perfectionist: Gem,
  'cup-collector': Medal,
  globetrotter: Compass,
  international: FlagIcon,
  'grounds-tour': Landmark,
  regular: CalendarDays,
  'sunday-league': CalendarRange,
  ironman: ChevronsUp,
  'giant-killer': Axe,
  'survival-artist': LifeBuoy,
}

function exportSave(): void {
  // The game in memory, as plain JSON: it exports even when the browser's storage is full
  const blob = new Blob([exportSaveJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `touchline-save-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ProfileScreen() {
  const { profile, universe: u, go, setManagerName, setTheme, showToast, resetTips } = useStore()
  const [soundOn, setSoundOn] = useSoundOn()
  const [matchSound, setMatchSound] = useMatchSoundOn()
  const [quickSpin, setQuickSpin] = usePref(quickSpinPref)
  // The Boxes control: an unticked box is left out and the column under it closes up (the account link always stays)
  const boxes = useBoxes(PROFILE)
  const on = boxes.on
  const left = ['manager', 'cabinet', 'room', 'chase', 'achievements'].some(on)
  const grid = boxes.grid([{ track: '1fr', ids: ['manager', 'cabinet', 'room', 'chase', 'achievements'] }, { track: '1fr', ids: [] }])
  const tipsSeen = tipsSeenCount(profile)
  const bests = profile.quickBests ?? emptyBests()
  const unlocked = Object.keys(profile.achievements).length
  // Quick and Daily runs on the same wheel (seed) sit together: the table is already best-first, so a seed's first row
  // is its best. Season and Dynasty entries share one seed across their years, which is not the same wheel twice.
  const runsBySeed = new Map<string, LeaderboardEntry[]>()
  for (const e of profile.leaderboard) if (isQuickLike(e.mode)) runsBySeed.set(e.seed, [...(runsBySeed.get(e.seed) ?? []), e])
  const fileRef = useRef<HTMLInputElement>(null)
  // Trophy Room: leagues won in come from the titled hosts' leagues, the loaded clubs first, then the packs' club lists
  const cabinet = normaliseCabinet(profile.cabinet ?? {})
  const [clubLeagues, setClubLeagues] = useState<Record<string, { leagueId: string; name: string }> | null>(null)
  const won = leaguesWon(cabinet, profile.leaderboard, (id) => u?.clubById[id]?.leagueId ?? clubLeagues?.[id]?.leagueId)
  const needsClubLeagues = won.unresolved.length > 0 && !clubLeagues
  useEffect(() => {
    if (!needsClubLeagues) return
    let live = true
    fetchClubLeagues()
      .then((m) => live && setClubLeagues(m))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [needsClubLeagues])
  const badges = badgeStates(cabinet, { leaguesWon: won.leagues.length })
  const career = careerOverview(profile, cabinet)
  const [achView, setAchView] = useState<AchievementView>('all')
  const achievements = orderAchievements(ACHIEVEMENTS, profile.achievements, achView)
  // The honours board shows the latest few; the rest open on a tap
  const [allHonours, setAllHonours] = useState(false)
  const honours = cabinet.honours ?? []
  const HONOURS_SHOWN = 5
  const [filter, setFilterState] = useState<BoardFilter>(readFilter)
  const setFilter = (f: BoardFilter) => {
    setFilterState(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      // A per-viewer convenience: without storage the filter just resets next visit
    }
  }
  const board = filterBoard(profile.leaderboard, filter)
  // Best runs: best first, or Best on this ladder (grouped by seed); remembered per viewer
  const [runsView, setRunsViewState] = useState<'best' | 'ladder'>(readRunsView)
  const setRunsView = (v: 'best' | 'ladder') => {
    setRunsViewState(v)
    try {
      localStorage.setItem(RUNS_VIEW_KEY, v)
    } catch {
      // Without storage the view just resets next visit
    }
  }
  const ladders = groupRunsByLadder(profile.arenaRuns ?? [])
  const runRow = (e: ArenaRunEntry) => (
    <tr key={e.id}>
      {/* The team cell wraps, so on a phone the format, result and score stay in view */}
      <td style={{ whiteSpace: 'normal' }}>
        <span className="row wrap" style={{ gap: 6 }}>
          {e.hostClubId && <ClubBadge clubId={e.hostClubId} size={20} />} <b>{e.teamName}</b>
          {e.challenge && (
            <span className={`chip ${e.score > e.challenge.score ? 'good' : e.score < e.challenge.score ? 'bad' : ''}`} data-testid="run-vs">
              vs {e.challenge.name} {e.challenge.score}
            </span>
          )}
        </span>
        <div className="small muted">
          {e.last && u ? `${e.fellTo ? 'Lost to' : 'Beat'} ${arenaClubName(u, e.last)}` : e.date} · seed {e.seed}
        </div>
      </td>
      <td style={{ whiteSpace: 'normal' }}>{arenaFormatLabel(e)}</td>
      <td style={{ whiteSpace: 'normal' }}>{arenaTierLabel(e.tier, e.score)}</td>
      <td className="num">
        {e.goalsFor}-{e.goalsAgainst}
      </td>
    </tr>
  )
  const downloadCard = () => {
    const best = profile.leaderboard.slice(0, 3).map((e) => ({
      title: `${e.teamName} · ${e.points} pts · ${ordinal(e.position)}`,
      detail: `${tierName(e.tier, e.position, e.superLeague)} · ${u?.clubById[e.hostClubId] ? clubName(u, e.hostClubId) : (clubLeagues?.[e.hostClubId]?.name ?? e.hostClubId)} ${seasonLabel(e.leagueSeason)} · ${MODE_TITLE[e.mode] ?? e.mode}`,
    }))
    const url = renderManagerCard({ name: profile.managerName.trim() || 'The Gaffer', seasons: profile.seasonsSimulated, cabinet, badges: topBadges(badges), best, dataStamp: u ? `Data ${u.generatedAt}` : 'Trophy Room' })
    downloadDataUrl(url, 'touchline-manager-card.png')
  }
  const importSave = async (file: File) => {
    try {
      // Plain JSON from any build, or a compressed save; a file that is neither, or does not fit, leaves this save alone
      const save = readSaveFile(await file.text())
      if (!confirm('Replace everything in this browser with the imported save? This cannot be undone.')) return
      storeImportedSave(save)
      location.reload()
    } catch (e) {
      showToast(`Could not import: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const wipe = () => {
    if (!confirm('Delete every saved game, your record and achievements from this browser?')) return
    wipeSave()
    location.reload()
  }
  // The cabinet's season shelf, then the arena's and the run-in's own (never counted as league titles or cups)
  const trophies: Array<[ReactNode, string, number]> = [
    [<Trophy size={26} />, 'League titles', cabinet.league],
    [<Medal size={26} />, 'Cups', cabinet.cup],
    [<Globe size={26} />, 'Continental Cups', cabinet.continental],
    [<><Trophy size={22} /><Trophy size={22} /></>, 'Doubles', cabinet.doubles],
    [<Crown size={26} />, 'Trebles', cabinet.trebles],
    [<Gem size={26} />, '38-0s', cabinet.perfect],
    [<Shield size={26} />, 'Invincibles', cabinet.invincible],
    [<Target size={26} />, 'Centurions', cabinet.centurions],
    [<Award size={26} />, 'Arena cups', cabinet.cups.won],
    [<ChevronsUp size={26} />, 'Best Gauntlet', cabinet.gauntlet.best],
    [<Timer size={26} />, 'Run-in briefs', cabinet.runIns.met],
  ]
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Profile</h1>
          <div className="screen-meta">
            <span>{profile.managerName ? `${profile.managerName}, manager` : 'Your record, trophies and settings'}</span>
          </div>
        </div>
        <div className="head-actions">
          <BoxesMenu groups={[boxes]} />
          <button className="btn ghost" onClick={() => go('home')}>
            ← Home
          </button>
        </div>
      </div>
      <div className="screen-body fill">
      <div className={`grid two ${grid.className}`} style={grid.style}>
        {left && (
        <div className="col">
          {on('manager') && (
          <div className="panel col">
            <h3 style={{ margin: 0 }}>Manager</h3>
            <label className="field">
              Name
              <input className="input" value={profile.managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="The Gaffer" />
            </label>
            <div className="stat-strip profile-stats">
              <Stat label="Games" value={profile.gamesPlayed} />
              <Stat label="Seasons" value={profile.seasonsSimulated} />
              <Stat
                label="Daily streak"
                value={
                  <span className="icon-title">
                    <Flame size={20} className={profile.dailyStreak ? 'streak-on' : ''} aria-hidden="true" />
                    {profile.dailyStreak}
                  </span>
                }
              />
              <Stat label="Achievements" value={`${unlocked}/${ACHIEVEMENTS.length}`} />
              <Stat label="Head-to-head" value={cabinet.h2h.played} />
              {(cabinet.h2hOnline?.played ?? 0) > 0 && <Stat label="Online head-to-head" value={cabinet.h2hOnline?.played ?? 0} sub={`${cabinet.h2hOnline?.won ?? 0} won`} />}
            </div>
            <div className="career-overview" data-testid="career-overview">
              <h4 className="career-head">Career</h4>
              {career.results === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>Your record starts with your first finished game: a season, a run or a run-in.</p>
              ) : (
                <>
                  {career.record.games > 0 && (
                    <div className="stat-strip profile-stats career-stats">
                      <Stat label="Win rate" value={`${career.winRate}%`} sub={<span className="mono">{career.record.won}-{career.record.drawn}-{career.record.lost}</span>} />
                      <Stat label="Points a game" value={career.pointsPerGame?.toFixed(1)} />
                      <Stat label="Title rate" value={career.titleRate === null ? '—' : `${career.titleRate}%`} sub={countPhrase(cabinet.league, 'titles')} />
                      <Stat label="Finished first" value={career.firstPlaces} sub={`of ${career.kept}`} />
                    </div>
                  )}
                  {career.record.games > 0 && <p className="small muted" style={{ margin: 0 }}>{career.kept === 1 ? 'Across your one league season on Best seasons.' : `Across the ${career.kept} league seasons on Best seasons.`}</p>}
                  <div className="row wrap career-modes" role="list" aria-label="Results by mode">
                    {career.byMode.map((m) => (
                      <span key={m.mode} className="chip" role="listitem" data-testid="career-mode">
                        {m.label} <b>{m.count}</b>
                      </span>
                    ))}
                  </div>
                  {career.regulars.length > 0 && u && (
                    <div className="career-regulars small" data-testid="career-regulars">
                      <span className="muted">Most often in charge of</span>
                      {career.regulars.map((r) => (
                        <span key={r.clubId} className="row" style={{ gap: 6 }}>
                          <ClubBadge clubId={r.clubId} size={18} /> {u.clubById[r.clubId] ? clubName(u, r.clubId) : (clubLeagues?.[r.clubId]?.name ?? r.clubId)} <span className="muted">×{r.seasons}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="field" data-testid="profile-locker">
              <span>
                Locker <Info label="About the locker">Power-ups from end-of-draft cases. Unpack one in a Quick Draft played without the power-up tray; each works once, as the tray's does.</Info>
              </span>
              <span className="small">
                {POWER_UPS.some((k) => lockerCount(profile, k) > 0)
                  ? POWER_UPS.filter((k) => lockerCount(profile, k) > 0).map((k, i) => (
                      <span key={k} className="case-odds-item">
                        {i > 0 && ' · '}
                        <PowerUpIcon kind={k} size={13} /> {POWER_UP_INFO[k].title} ×{lockerCount(profile, k)}
                      </span>
                    ))
                  : 'Empty: open a case at the end of a Quick Draft'}
              </span>
            </div>
          </div>
          )}
          {on('cabinet') && (
          <div className="panel" data-testid="trophy-cabinet">
            <h3>Trophy cabinet</h3>
            <div className="cabinet">
              {trophies.map(([icon, label, n]) => (
                <div key={label} className={`cabinet-slot ${n ? '' : 'empty'}`}>
                  <span className="cabinet-icon">{icon}</span>
                  <span className="cabinet-n">{n}</span>
                  <span className="small muted">{label}</span>
                </div>
              ))}
            </div>
            {/* The honours board: every Treble and Double season, newest first */}
            <div className="honours" data-testid="honours-board">
              <h4 className="honours-head">
                <Crown size={16} aria-hidden="true" /> Honours board
              </h4>
              {honours.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>Win the league and a cup in the same season for a Double; add the Continental Cup for the Treble.</p>
              ) : (
                <ol className="honours-list">
                  {(allHonours ? honours : honours.slice(0, HONOURS_SHOWN)).map((h) => (
                    <li key={h.id} className={`honour-row ${h.kind}`} data-testid="honour-row" data-kind={h.kind}>
                      <span className={`honour-icon ${h.kind}`}>{h.kind === 'treble' ? <Crown size={18} aria-hidden="true" /> : <Trophy size={16} aria-hidden="true" />}</span>
                      <span className="honour-main">
                        <b>{honourLabel(h.kind, h.cups)}</b> <span className="small muted">{honourDetail(h.cups)}</span>
                        <span className="honour-meta small muted">
                          {h.teamName} · {h.superLeague ? <><SuperLeagueMark /> {SUPER_LEAGUE_NAME}</> : <><LeagueFlag leagueId={h.leagueId} label={u?.available.find((l) => l.id === h.leagueId)?.name} /> {seasonLabel(h.leagueSeason)}</>} · {MODE_TITLE[h.mode] ?? h.mode}
                          {h.date && <> · <span className="nowrap">{h.date}</span></>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {honours.length > HONOURS_SHOWN && (
                <button type="button" className="btn sm ghost" data-testid="honours-more" aria-expanded={allHonours} onClick={() => setAllHonours((v) => !v)}>
                  {allHonours ? 'Show the latest only' : `Show all ${honours.length}`}
                </button>
              )}
            </div>
          </div>
          )}
          {on('room') && (
          <div className="panel col" data-testid="trophy-room">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <span className="head-title">
                <h3>Trophy Room</h3>
                <Info label="About the Trophy Room">Badges count every mode: bronze, silver and gold at their thresholds. {cabinet.rebuilt ? 'Badges beyond the five trophy counts are counted from your 50 best seasons before the Trophy Room.' : ''}</Info>
              </span>
              <button className="btn sm" data-testid="manager-card" onClick={downloadCard}>
                <Download size={16} aria-hidden="true" /> Manager card
              </button>
            </div>
            <div className="badges">
              {badges.map((b) => {
                const Icon = BADGE_ICON[b.badge.id] ?? Award
                return (
                  <div key={b.badge.id} className={`badge-tile ${b.value ? '' : 'locked'}`} data-testid="badge" data-tier={b.tier ?? 'none'} title={`${b.badge.title}: ${countPhrase(b.value, b.badge.counts)}`}>
                    <span className={`badge-ring ${b.tier ?? ''}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span>
                      <div className="title">{b.badge.title}</div>
                      <div className="desc">
                        {countPhrase(b.value, b.badge.counts)}
                      </div>
                      <div className="small muted">{b.tier ? `${b.tier[0].toUpperCase()}${b.tier.slice(1)} · ${b.progress}` : b.progress}</div>
                    </span>
                  </div>
                )
              })}
            </div>
            {won.leagues.length > 0 && <div className="small muted" data-testid="leagues-won">Leagues won in: {won.leagues.map((id) => u?.available.find((l) => l.id === id)?.name ?? id).join(', ')}</div>}
            {cabinet.rebuilt && <div className="small muted" data-testid="cabinet-rebuilt">Counted from your 50 best seasons before the Trophy Room.</div>}
          </div>
          )}
          {on('chase') && (
          <div className="panel" data-testid="quick-bests">
            <h3>The 38-0 chase</h3>
            <dl className="kv">
              <dt>Best record</dt>
              <dd data-testid="best-record">{bests.bestRecord ? `${recordLabel(bests.bestRecord.won, bests.bestRecord.drawn, bests.bestRecord.lost)} · ${bests.bestRecord.points} pts` : '—'}</dd>
              <dt>Longest perfect run</dt>
              <dd data-testid="best-run">{bests.longestPerfectRun ? `${bests.longestPerfectRun}-0` : '—'}</dd>
              <dt>Perfect seasons</dt>
              <dd data-testid="perfect-seasons">{bests.perfectSeasons ?? 0}</dd>
            </dl>
            <p className="help" style={{ margin: '8px 0 0' }}>Quick Draft and Daily seasons in this browser. The goal: win every game.</p>
          </div>
          )}
          {on('achievements') && (
          <div className="panel">
            <div className="panel-head">
              <h3>Achievements</h3>
              <span className="small muted">
                {unlocked}/{ACHIEVEMENTS.length}
              </span>
            </div>
            {unlocked > 0 && unlocked < ACHIEVEMENTS.length && (
              <div style={{ marginBottom: 'var(--space-3)' }} data-testid="achievement-view">
                <Segmented value={achView} onChange={setAchView} options={[{ value: 'all', label: 'All' }, { value: 'unlocked', label: `Unlocked ${unlocked}` }, { value: 'locked', label: `Locked ${ACHIEVEMENTS.length - unlocked}` }]} />
              </div>
            )}
            <div className="achievements">
              {achievements.map((a) => {
                const date = profile.achievements[a.id]
                return (
                  <div key={a.id} className={`ach ${date ? '' : 'locked'}`}>
                    <span className="icon" aria-hidden="true">
                      <AchievementIcon id={a.id} />
                      {!date && (
                        <span className="ach-lock">
                          <Lock size={11} />
                        </span>
                      )}
                    </span>
                    <span>
                      <div className="title">{a.title}</div>
                      <div className="desc">{a.description}</div>
                      {date && (
                        <div className="ach-date">
                          <CalendarDays size={11} aria-hidden="true" /> {date}
                        </div>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          )}
        </div>
        )}
        <div className="col">
          <AccountLink />
          {on('save') && (
          <div className="panel col">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <span className="head-title">
                <h3>Save data</h3>
                <Info label="About save data">Everything lives in this browser. Export a file to back it up or move it to another device; import one to restore it.</Info>
              </span>
            </div>
            <div className="toolbar">
              <button className="btn" onClick={exportSave}>
                <Download size={16} aria-hidden="true" /> Export save file
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Upload size={16} aria-hidden="true" /> Import save file
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); e.target.value = '' }} />
              <button className="btn ghost danger" onClick={wipe}>
                <Trash2 size={16} aria-hidden="true" /> Delete all data
              </button>
            </div>
          </div>
          )}
          {on('settings') && (
          <div className="panel col" data-testid="profile-settings">
            <h3 style={{ margin: 0 }}>Settings</h3>
            <div className="settings-grid">
            <div className="field">
              <span>
                Theme <Info label="About the theme">Auto follows your device's light or dark setting. The sun and moon in the top bar flips it too.</Info>
              </span>
              <Segmented value={profile.theme} onChange={setTheme} options={[{ value: 'auto', label: 'Auto', hint: "Follows your device's light or dark setting" }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </div>
            <div className="field">
              <span>
                Sound <Info label="About the sound">Every sound in the game: the case reel, the draft, the match and the trophies, all made in the browser. Kept on this device only; the speaker beside the reel flips it too.</Info>
              </span>
              <Segmented value={soundOn ? 'on' : 'off'} onChange={(v) => setSoundOn(v === 'on')} options={[{ value: 'on', label: 'On', testId: 'sound-on' }, { value: 'off', label: 'Off', testId: 'sound-off' }]} />
            </div>
            {soundOn && (
              <div className="field">
                <span>
                  Match sounds <Info label="About the match sounds">The referee's whistle, the crowd, the net, cards and substitutions on match day. Off keeps the rest of the sound. Kept on this device only.</Info>
                </span>
                <Segmented value={matchSound ? 'on' : 'off'} onChange={(v) => setMatchSound(v === 'on')} options={[{ value: 'on', label: 'On', testId: 'match-sound-on' }, { value: 'off', label: 'Off', testId: 'match-sound-off' }]} />
              </div>
            )}
            <div className="field">
              <span>
                Reel speed <Info label="About the reel speed">Full runs the case opening at its own pace, about seven seconds; Quick takes under three. Re-spins always run quick, and a tap on the reel skips to the landing. Kept on this device only.</Info>
              </span>
              <Segmented value={quickSpin ? 'quick' : 'full'} onChange={(v) => setQuickSpin(v === 'quick')} options={[{ value: 'full', label: 'Full', testId: 'reel-full' }, { value: 'quick', label: 'Quick', testId: 'reel-quick' }]} />
            </div>
            </div>
            <div className="toolbar">
              <button
                className="btn sm"
                data-testid="reset-tips"
                disabled={tipsSeen === 0}
                onClick={() => {
                  resetTips()
                  showToast('The coach marks will show again where they first appeared.')
                }}
              >
                Show tips again
              </button>
              <span className="small muted">
                {tipsSeen === 0 ? `All ${TIP_IDS.length} tips are showing` : `${tipsSeen} of ${TIP_IDS.length} tips dismissed`}
              </span>
            </div>
          </div>
          )}
          {on('seasons') && (
          <div className="panel">
            <div className="panel-head">
              <h3>Best seasons</h3>
              {profile.leaderboard.length > 0 && (
                <span data-testid="board-filter">
                  <Segmented value={filter} onChange={setFilter} options={[...BOARD_FILTERS]} />
                </span>
              )}
            </div>
            {profile.leaderboard.length > 0 && board.length === 0 && <div className="muted small">{BOARD_FILTERS.find((f) => f.value === filter)?.empty ?? `No ${BOARD_FILTERS.find((f) => f.value === filter)?.label} seasons yet.`}</div>}
            {profile.leaderboard.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <Trophy size={26} />
                </span>
                <h3>Nothing yet</h3>
                <p className="muted small">Spin the wheel; your best seasons land here.</p>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl best-tbl">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th className="num">Pts</th>
                      <th className="num">W-D-L</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.map((e) => {
                      const runs = runsBySeed.get(e.seed) ?? [e]
                      const rank = runs.indexOf(e) + 1
                      return (
                        <tr key={e.id}>
                          <td>
                            <span className="row wrap" style={{ gap: 6 }}>
                              <ClubBadge clubId={e.hostClubId} size={20} /> <b>{e.teamName}</b>
                              {e.nation && <Flag nation={e.nation} />}
                              {e.caseIcon && (
                                <span className="chip case-icon-chip" data-tier="icons" title="An Icon from the end-of-draft case played: non-standard">
                                  ★ Case Icon
                                </span>
                              )}
                            </span>
                            <div className="small muted">
                              {e.superLeague ? <><SuperLeagueMark /> {SUPER_LEAGUE_NAME}</> : <>{u ? clubName(u, e.hostClubId) : e.hostClubId} · {u?.clubById[e.hostClubId] && <LeagueFlag leagueId={u.clubById[e.hostClubId].leagueId} label={u.leagues.find((l) => l.id === u.clubById[e.hostClubId].leagueId)?.name} />} {seasonLabel(e.leagueSeason)}</>} · {MODE_TITLE[e.mode] ?? e.mode}
                            </div>
                            {e.moment && <div className="small muted" data-testid="entry-moment">{e.moment}</div>}
                            {(runs.length > 1 || e.challenge || e.budget !== undefined) && (
                              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                                {runs.length > 1 && (rank === 1 ? <span className="chip gold" data-testid="best-on-wheel">Best on this wheel · {runs.length} runs</span> : <span className="chip">{ordinal(rank)} of {runs.length} on this wheel</span>)}
                                {e.budget !== undefined && <span className="chip" data-testid="entry-cap" title={`Drafted under a ${capTotal(e.budget)} salary cap`}>£ {capTotal(e.spent ?? 0)} of {capTotal(e.budget)}</span>}
                                {e.challenge && <span className={`chip ${e.points > e.challenge.points ? 'good' : e.points < e.challenge.points ? 'bad' : ''}`}>vs {e.challenge.name} {e.challenge.points}</span>}
                              </div>
                            )}
                          </td>
                          <td className="num" style={{ fontWeight: 700 }}>
                            {e.points}
                          </td>
                          <td className="num">
                            {e.won}-{e.drawn}-{e.lost}
                          </td>
                          <td>
                            {tierName(e.tier, e.position, e.superLeague)}
                            <div className="small muted">{ordinal(e.position)}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
          {on('runs') && (
          <div className="panel" data-testid="best-runs">
            <div className="panel-head">
              <h3>Best runs</h3>
              {!!profile.arenaRuns?.length && (
                <Segmented
                  value={runsView}
                  onChange={setRunsView}
                  options={[
                    { value: 'best', label: 'Best first' },
                    { value: 'ladder', label: 'Best on this ladder', hint: 'Runs on the same seed, format and field together, best first' },
                  ]}
                />
              )}
            </div>
            {!profile.arenaRuns?.length && (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <Award size={26} />
                </span>
                <p className="muted small">No arena runs yet: try the Cup or the Gauntlet from Home.</p>
              </div>
            )}
            {!!profile.arenaRuns?.length && (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Format</th>
                      <th>Result</th>
                      <th className="num">GF-GA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsView === 'best'
                      ? profile.arenaRuns.map(runRow)
                      : ladders.flatMap((g) => [
                          <tr key={`h-${g.key}`} data-testid="ladder-group">
                            <td colSpan={4} className="small muted" style={{ whiteSpace: 'normal' }}>
                              <b>Seed {g.seed}</b> · {arenaFormatLabel(g)} · {g.runs.length} run{g.runs.length === 1 ? '' : 's'} · best {arenaTierLabel(g.runs[0].tier, g.runs[0].score).toLowerCase()}
                            </td>
                          </tr>,
                          ...g.runs.map(runRow),
                        ])}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
          {on('runins') && <RunInsTable />}
        </div>
      </div>
      </div>
    </div>
  )
}
