import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Award, CalendarDays, ChevronsUp, Crown, Download, Flame, Gem, Lock, Shield, ShieldCheck, Target, Timer, Trophy, Trash2, Upload } from 'lucide-react'
import { useStore, exportSaveJson, readSaveFile, storeImportedSave, wipeSave } from '@game/store'
import { persistLine, usePersistState } from '../persistStorage'
import { saveBlob } from '../saveFile'
import { ACHIEVEMENTS } from '@engine/awards'
import { badgeStates, topBadges } from '@engine/badges'
import { TrophyShelf, type ShelfTrophy } from '../components/TrophyShelf'
import { trophyIcon } from '../trophyIcons'
import { useTrophyReveal } from '../trophyReveal'
import { ChaseBlock } from '../components/BadgeUnlocks'
import { trophyItems } from '@game/logic/trophyChase'
import { BadgeCheck } from 'lucide-react'
import { milestonesEarned, milestoneStates } from '@game/logic/milestoneBadges'
import { fetchClubLeagues } from '@engine/universe'
import type { ArenaRunEntry, LeaderboardEntry } from '@game/types'
import { MODE_TITLE, isQuickLike } from '@game/logic/modes'
import { arenaClubName, groupRunsByLadder } from '@game/logic/arena'
import { arenaTierLabel } from '@engine/knockout'
import { capTotal } from '@game/logic/cap'
import { BOARD_FILTERS, filterBoard, honourDetail, honourLabel, leaguesWon, normaliseCabinet, type BoardFilter } from '@game/logic/cabinet'
import { downloadDataUrl, renderManagerCard } from '../shareCard'
import { RunInsTable } from '../components/RunInsTable'
import { ClubBadge, Flag, Info, Segmented, Stat, TeamBadge } from '../components/bits'
import { shortNameFor } from '@game/logic/setup'
import { LeagueFlag, SuperLeagueMark } from '../components/Flag'
import { SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { POWER_UPS, POWER_UP_INFO } from '@engine/powerups'
import { lockerCount } from '@game/logic/endCase'
import { AchievementIcon, PowerUpIcon } from '../components/icons'
import { clubName, fixed, ordinal, seasonLabel, tierName } from '../format'
import { achievementText, achievementTitle, badgeCount, badgeTitle, milestoneCount, milestoneTitle, progressText } from '../i18n/trophyText'
import { TIP_IDS, tipsSeenCount } from '@game/logic/tips'
import { AccountLink } from '../online/AccountPanel'
import { errorReportsChanged, onlineAvailable } from '../../online/api'
import { errorReportsOn, setErrorReportsOn } from '../../online/core/errorPref'
import { emptyBests, recordLabel } from '@game/logic/perfect'
import { careerOverview, orderAchievements, type AchievementView } from '@game/logic/careerOverview'
import { useDraftSoundOn, useMatchSoundOn, useSoundOn, useSoundVolume, useUiSoundOn } from '../sound/prefs'
import { playSound } from '../sound/synth'
import { useBadgeSound } from '../sound/useBadgeSound'
import { quickSpinPref, usePref } from '../viewerPrefs'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { PROFILE } from '../boxSets'
import { askConfirm } from '../confirm'
import { translator } from '../i18n'
import { profile as profileText } from '../i18n/en/profile'
import { arenaFormatText, modeTitle } from '../i18n/modeText'
import { languageOptions, LOCALE_NAMES, setLanguage, useLanguage } from '../i18n/language'

const t = translator(profileText)

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

function exportSave(): void {
  // The game in memory, as plain JSON: it exports even when the browser's storage is full
  // Downloaded; shared where a download goes nowhere (an iOS home-screen app or web view: saveFile.ts)
  void saveBlob(new Blob([exportSaveJson()], { type: 'application/json' }), `touchline-save-${new Date().toISOString().slice(0, 10)}.json`)
}

export function ProfileScreen() {
  const { profile, universe: u, go, setManagerName, setTheme, showToast, resetTips } = useStore()
  const [soundOn, setSoundOn] = useSoundOn()
  const [matchSound, setMatchSound] = useMatchSoundOn()
  const [draftSound, setDraftSound] = useDraftSoundOn()
  const [uiSound, setUiSound] = useUiSoundOn()
  const [volume, setVolume] = useSoundVolume()
  const [quickSpin, setQuickSpin] = usePref(quickSpinPref)
  const language = useLanguage()
  const [reportsOn, setReportsOn] = useState(errorReportsOn)
  const setReports = (on: boolean) => {
    setErrorReportsOn(on)
    setReportsOn(on)
    void errorReportsChanged(on)
  }
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
  const persist = usePersistState()
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
  const milestones = milestoneStates({ cabinet, profile })
  // A badge or tier earned since this viewer last looked: the medal's ring, once
  useBadgeSound([...badges, ...milestones].flatMap((b) => (b.tier ? [`${b.badge.id}:${b.tier}`] : [])))
  // Unlocks this viewer has not seen: marked New while the page is open, then filed as seen
  const trophyList = trophyItems(badges, milestones)
  const reveal = useTrophyReveal(trophyList)
  const [newIds] = useState(() => new Set(reveal.fresh.map((i) => i.id)))
  const markTrophiesSeen = reveal.markSeen
  useEffect(() => {
    markTrophiesSeen()
  }, [markTrophiesSeen])
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
          {/* An arena side's own badge, as on its hub: the colours' club is never shown as ours */}
          <TeamBadge code={shortNameFor(e.teamName)} size={20} /> <b>{e.teamName}</b>
          {e.challenge && (
            <span className={`chip ${e.score > e.challenge.score ? 'good' : e.score < e.challenge.score ? 'bad' : ''}`} data-testid="run-vs">
              {t('vsScore', { name: e.challenge.name, score: e.challenge.score })}
            </span>
          )}
        </span>
        <div className="small muted">
          {t('seedLine', { what: e.last && u ? t(e.fellTo ? 'lostTo' : 'beat', { club: arenaClubName(u, e.last) }) : e.date, seed: e.seed })}
        </div>
      </td>
      <td style={{ whiteSpace: 'normal' }}>{arenaFormatText(e)}</td>
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
      if (!(await askConfirm(t('importConfirm'), { ok: t('replaceOk'), danger: true }))) return
      storeImportedSave(save)
      location.reload()
    } catch (e) {
      showToast(t('importFailed', { why: e instanceof Error ? e.message : String(e) }))
    }
  }
  const wipe = async () => {
    if (!(await askConfirm(t('wipeConfirm'), { ok: t('wipeOk'), danger: true }))) return
    wipeSave()
    location.reload()
  }
  // The cabinet's season shelf, then the arena's and the run-in's own (never counted as league titles or cups)
  // The four big ones stand drawn on the shelf; every other count is a plaque beneath it
  const shelf: ShelfTrophy[] = [
    { kind: 'league', label: 'League titles', n: cabinet.league },
    { kind: 'cup', label: 'Cups', n: cabinet.cup },
    { kind: 'continental', label: 'Continental Cups', n: cabinet.continental },
    { kind: 'treble', label: 'Trebles', n: cabinet.trebles },
  ]
  const trophies: Array<[ReactNode, string, number]> = [
    [<><Trophy size={22} /><Trophy size={22} /></>, t('doubles'), cabinet.doubles],
    [<Gem size={26} />, t('perfect'), cabinet.perfect],
    [<Shield size={26} />, t('invincibles'), cabinet.invincible],
    [<Target size={26} />, t('centurions'), cabinet.centurions],
    [<Award size={26} />, t('arenaCups'), cabinet.cups.won],
    [<ChevronsUp size={26} />, t('bestGauntlet'), cabinet.gauntlet.best],
    [<Timer size={26} />, t('runInBriefs'), cabinet.runIns.met],
  ]
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{t('title')}</h1>
          <div className="screen-meta">
            <span>{profile.managerName ? t('managerOf', { name: profile.managerName }) : t('subtitle')}</span>
          </div>
        </div>
        <div className="head-actions">
          <BoxesMenu groups={[boxes]} />
          <button className="btn ghost" onClick={() => go('home')}>
            {t('home')}
          </button>
        </div>
      </div>
      <div className="screen-body fill">
      <div className={`grid two ${grid.className}`} style={grid.style}>
        {left && (
        <div className="col">
          {on('manager') && (
          <div className="panel col">
            <h3 style={{ margin: 0 }}>{t('manager')}</h3>
            <label className="field">
              {t('name')}
              <input className="input" value={profile.managerName} onChange={(e) => setManagerName(e.target.value)} placeholder={t('namePlaceholder')} />
            </label>
            <div className="stat-strip profile-stats">
              <Stat label={t('games')} value={profile.gamesPlayed} />
              <Stat label={t('seasons')} value={profile.seasonsSimulated} />
              <Stat
                label={t('dailyStreak')}
                value={
                  <span className="icon-title">
                    <Flame size={20} className={profile.dailyStreak ? 'streak-on' : ''} aria-hidden="true" />
                    {profile.dailyStreak}
                  </span>
                }
              />
              <Stat label={t('achievements')} value={t('outOf', { n: unlocked, total: ACHIEVEMENTS.length })} />
              <Stat label={t('h2h')} value={cabinet.h2h.played} />
              {(cabinet.h2hOnline?.played ?? 0) > 0 && <Stat label={t('h2hOnline')} value={cabinet.h2hOnline?.played ?? 0} sub={t('won', { n: cabinet.h2hOnline?.won ?? 0 })} />}
            </div>
            <div className="career-overview" data-testid="career-overview">
              <h4 className="career-head">{t('career')}</h4>
              {career.results === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>{t('careerEmpty')}</p>
              ) : (
                <>
                  {career.record.games > 0 && (
                    <div className="stat-strip profile-stats career-stats">
                      <Stat label={t('winRate')} value={t('percent', { n: career.winRate })} sub={<span className="mono">{career.record.won}-{career.record.drawn}-{career.record.lost}</span>} />
                      <Stat label={t('pointsAGame')} value={career.pointsPerGame === undefined || career.pointsPerGame === null ? undefined : fixed(career.pointsPerGame, 1)} />
                      <Stat label={t('titleRate')} value={career.titleRate === null ? '—' : t('percent', { n: career.titleRate })} sub={t('titles', { n: cabinet.league })} />
                      <Stat label={t('finishedFirst')} value={career.firstPlaces} sub={t('ofKept', { n: career.kept })} />
                    </div>
                  )}
                  {career.record.games > 0 && <p className="small muted" style={{ margin: 0 }}>{t('across', { n: career.kept })}</p>}
                  <div className="row wrap career-modes" role="list" aria-label={t('byMode')}>
                    {career.byMode.map((m) => (
                      <span key={m.mode} className="chip" role="listitem" data-testid="career-mode">
                        {m.label} <b>{m.count}</b>
                      </span>
                    ))}
                  </div>
                  {career.regulars.length > 0 && u && (
                    <div className="career-regulars small" data-testid="career-regulars">
                      <span className="muted">{t('regulars')}</span>
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
                {t('locker')} <Info label={t('lockerAbout')}>{t('lockerInfo')}</Info>
              </span>
              <span className="small">
                {POWER_UPS.some((k) => lockerCount(profile, k) > 0)
                  ? POWER_UPS.filter((k) => lockerCount(profile, k) > 0).map((k, i) => (
                      <span key={k} className="case-odds-item">
                        {i > 0 && ' · '}
                        <PowerUpIcon kind={k} size={13} /> {POWER_UP_INFO[k].title} ×{lockerCount(profile, k)}
                      </span>
                    ))
                  : t('lockerEmpty')}
              </span>
            </div>
          </div>
          )}
          {on('cabinet') && (
          <div className="panel" data-testid="trophy-cabinet">
            <h3>{t('cabinet')}</h3>
            <TrophyShelf items={shelf} />
            <div className="cabinet plaques">
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
                <Crown size={16} aria-hidden="true" /> {t('honoursBoard')}
              </h4>
              {honours.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>{t('honoursEmpty')}</p>
              ) : (
                <ol className="honours-list">
                  {(allHonours ? honours : honours.slice(0, HONOURS_SHOWN)).map((h) => (
                    <li key={h.id} className={`honour-row ${h.kind}`} data-testid="honour-row" data-kind={h.kind}>
                      <span className={`honour-icon ${h.kind}`}>{h.kind === 'treble' ? <Crown size={18} aria-hidden="true" /> : <Trophy size={16} aria-hidden="true" />}</span>
                      <span className="honour-main">
                        <b>{honourLabel(h.kind, h.cups)}</b> <span className="small muted">{honourDetail(h.cups)}</span>
                        <span className="honour-meta small muted">
                          {h.teamName} · {h.superLeague ? <><SuperLeagueMark /> {SUPER_LEAGUE_NAME}</> : <><LeagueFlag leagueId={h.leagueId} label={u?.available.find((l) => l.id === h.leagueId)?.name} /> {seasonLabel(h.leagueSeason)}</>} · {modeTitle(h.mode) ?? h.mode}
                          {h.date && <> · <span className="nowrap">{h.date}</span></>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {honours.length > HONOURS_SHOWN && (
                <button type="button" className="btn sm ghost" data-testid="honours-more" aria-expanded={allHonours} onClick={() => setAllHonours((v) => !v)}>
                  {allHonours ? t('latestOnly') : t('showAll', { n: honours.length })}
                </button>
              )}
            </div>
          </div>
          )}
          {on('room') && (
          <div className="panel col" data-testid="trophy-room">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <span className="head-title">
                <h3>{t('trophyRoom')}</h3>
                <Info label={t('roomAbout')}>{t('roomInfo')}{cabinet.rebuilt ? t('roomRebuilt') : ''}</Info>
              </span>
              <button className="btn sm" data-testid="manager-card" onClick={downloadCard}>
                <Download size={16} aria-hidden="true" /> {t('managerCard')}
              </button>
            </div>
            <ChaseBlock items={trophyList} n={3} />
            <div className="badges">
              {badges.map((b) => {
                const Icon = trophyIcon('badge', b.badge.id)
                const isNew = newIds.has(b.badge.id)
                return (
                  <div key={b.badge.id} className={`badge-tile ${b.value ? '' : 'locked'}${isNew ? ' fresh' : ''}`} data-testid="badge" data-tier={b.tier ?? 'none'} title={`${badgeTitle(b.badge)}: ${badgeCount(b.badge, b.value)}`}>
                    <span className={`badge-ring ${b.tier ?? ''}${isNew ? ' unlock-medal' : ''}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span>
                      <div className="title">{badgeTitle(b.badge)}{isNew && <span className="chip info new-chip">{t('newChip')}</span>}</div>
                      <div className="desc">
                        {badgeCount(b.badge, b.value)}
                      </div>
                      <div className="small muted">{b.tier ? t('tierProgress', { tier: t(`tier_${b.tier}`), progress: progressText(b.badge.tiers, b.value) }) : progressText(b.badge.tiers, b.value)}</div>
                    </span>
                  </div>
                )
              })}
            </div>
            {/* Milestones: more badges read from the same cabinet and records, with a bar to the next tier */}
            <h4 className="milestones-head" data-testid="milestones-head">
              <BadgeCheck size={16} aria-hidden="true" /> {t('milestones')} <span className="small muted">{t('earnedOf', { n: milestonesEarned(milestones), total: milestones.length })}</span>
            </h4>
            <div className="badges milestones">
              {milestones.map((m) => {
                const Icon = trophyIcon('milestone', m.badge.id)
                const label = milestoneCount(m.badge, m.value)
                const progress = progressText(m.badge.tiers, m.value, m.stamp)
                const isNew = newIds.has(m.badge.id)
                return (
                  <div key={m.badge.id} className={`badge-tile ${m.tier ? '' : 'locked'}${isNew ? ' fresh' : ''}`} data-testid="milestone" data-tier={m.tier ?? 'none'} title={`${milestoneTitle(m.badge)}: ${label}${m.badge.fromBoard ? t('fromBoard') : ''}`}>
                    <span className={`badge-ring ${m.tier ?? ''}${isNew ? ' unlock-medal' : ''}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="milestone-text">
                      <div className="title">{milestoneTitle(m.badge)}{isNew && <span className="chip info new-chip">{t('newChip')}</span>}</div>
                      <div className="desc">{label}</div>
                      <div className="small muted">{m.tier && !m.stamp ? t('tierProgress', { tier: t(`tier_${m.tier}`), progress }) : m.stamp ? (m.tier ? t('earned') : progress) : progress}</div>
                      {!m.stamp && m.tier !== 'gold' && (
                        <span className="milestone-meter" role="img" aria-label={progress}>
                          <span style={{ width: `${Math.round(m.toward * 100)}%` }} />
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            {won.leagues.length > 0 && <div className="small muted" data-testid="leagues-won">{t('leaguesWon', { leagues: won.leagues.map((id) => u?.available.find((l) => l.id === id)?.name ?? id).join(', ') })}</div>}
            {cabinet.rebuilt && <div className="small muted" data-testid="cabinet-rebuilt">{t('rebuilt')}</div>}
          </div>
          )}
          {on('chase') && (
          <div className="panel" data-testid="quick-bests">
            <h3>{t('chase')}</h3>
            <dl className="kv">
              <dt>{t('bestRecord')}</dt>
              <dd data-testid="best-record">{bests.bestRecord ? t('recordPoints', { record: recordLabel(bests.bestRecord.won, bests.bestRecord.drawn, bests.bestRecord.lost), n: bests.bestRecord.points }) : '—'}</dd>
              <dt>{t('longestRun')}</dt>
              <dd data-testid="best-run">{bests.longestPerfectRun ? `${bests.longestPerfectRun}-0` : '—'}</dd>
              <dt>{t('perfectSeasons')}</dt>
              <dd data-testid="perfect-seasons">{bests.perfectSeasons ?? 0}</dd>
            </dl>
            <p className="help" style={{ margin: '8px 0 0' }}>{t('chaseHelp')}</p>
          </div>
          )}
          {on('achievements') && (
          <div className="panel">
            <div className="panel-head">
              <h3>{t('achievements')}</h3>
              <span className="small muted">
                {t('outOf', { n: unlocked, total: ACHIEVEMENTS.length })}
              </span>
            </div>
            {unlocked > 0 && unlocked < ACHIEVEMENTS.length && (
              <div style={{ marginBottom: 'var(--space-3)' }} data-testid="achievement-view">
                <Segmented value={achView} onChange={setAchView} options={[{ value: 'all', label: t('all') }, { value: 'unlocked', label: t('unlocked', { n: unlocked }) }, { value: 'locked', label: t('locked', { n: ACHIEVEMENTS.length - unlocked }) }]} />
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
                      <div className="title">{achievementTitle(a)}</div>
                      <div className="desc">{achievementText(a)}</div>
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
                <h3>{t('saveData')}</h3>
                <Info label={t('saveAbout')}>{t('saveInfo')}</Info>
              </span>
            </div>
            <div className="toolbar">
              <button className="btn" onClick={exportSave}>
                <Download size={16} aria-hidden="true" /> {t('exportSave')}
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Upload size={16} aria-hidden="true" /> {t('importSave')}
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); e.target.value = '' }} />
              <button className="btn ghost danger" onClick={wipe}>
                <Trash2 size={16} aria-hidden="true" /> {t('deleteAll')}
              </button>
            </div>
            {persist.state && (
              <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
                <span className={`small ${persist.state === 'persisted' ? 'muted' : ''}`} data-testid="persist-line">
                  {persistLine(persist.state)}
                </span>
                {persist.state === 'best-effort' && (
                  <button className="btn sm" onClick={persist.ask} data-testid="persist-ask">
                    <ShieldCheck size={14} aria-hidden="true" /> {t('protect')}
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          {on('settings') && (
          <div className="panel col" data-testid="profile-settings">
            <h3 style={{ margin: 0 }}>{t('settings')}</h3>
            <div className="settings-grid">
            <div className="field">
              <span>
                {t('theme')} <Info label={t('themeAbout')}>{t('themeInfo')}</Info>
              </span>
              <Segmented value={profile.theme} onChange={setTheme} options={[{ value: 'auto', label: t('auto'), hint: t('themeHint') }, { value: 'light', label: t('light') }, { value: 'dark', label: t('dark') }]} />
            </div>
            <div className="field">
              <span>
                <label htmlFor="language-select">{t('language')}</label> <Info label={t('languageAbout')}>{t('languageInfo')}</Info>
              </span>
              <select id="language-select" className="input" value={language.pref} onChange={(e) => setLanguage(e.target.value)} data-testid="language-select">
                <option value="auto">{t('languageAuto', { name: LOCALE_NAMES[language.locale] ?? language.locale })}</option>
                {languageOptions(language.pref).map((o) => (
                  <option key={o.id} value={o.id} lang={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>
                {t('sound')} <Info label={t('soundAbout')}>{t('soundInfo')}</Info>
              </span>
              <Segmented value={soundOn ? 'on' : 'off'} onChange={(v) => setSoundOn(v === 'on')} options={[{ value: 'on', label: t('on'), testId: 'sound-on' }, { value: 'off', label: t('off'), testId: 'sound-off' }]} />
            </div>
            {soundOn && (
              <>
                <label className="field">
                  <span>
                    {t('volume')} <span className="muted small" data-testid="sound-volume-value">{volume}%</span>
                  </span>
                  <input type="range" className="volume-range" min={0} max={100} step={5} value={volume} onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={() => playSound({ id: 'pick' })} onKeyUp={() => playSound({ id: 'pick' })} aria-label={t('volume')} aria-valuetext={`${volume}%`} data-testid="sound-volume" />
                </label>
                <div className="field">
                  <span>
                    {t('matchSounds')} <Info label={t('matchAbout')}>{t('matchInfo')}</Info>
                  </span>
                  <Segmented value={matchSound ? 'on' : 'off'} onChange={(v) => setMatchSound(v === 'on')} options={[{ value: 'on', label: t('on'), testId: 'match-sound-on' }, { value: 'off', label: t('off'), testId: 'match-sound-off' }]} />
                </div>
                <div className="field">
                  <span>
                    {t('draftSounds')} <Info label={t('draftAbout')}>{t('draftInfo')}</Info>
                  </span>
                  <Segmented value={draftSound ? 'on' : 'off'} onChange={(v) => setDraftSound(v === 'on')} options={[{ value: 'on', label: t('on'), testId: 'draft-sound-on' }, { value: 'off', label: t('off'), testId: 'draft-sound-off' }]} />
                </div>
                <div className="field">
                  <span>
                    {t('uiSounds')} <Info label={t('uiAbout')}>{t('uiInfo')}</Info>
                  </span>
                  <Segmented value={uiSound ? 'on' : 'off'} onChange={(v) => setUiSound(v === 'on')} options={[{ value: 'on', label: t('on'), testId: 'ui-sound-on' }, { value: 'off', label: t('off'), testId: 'ui-sound-off' }]} />
                </div>
              </>
            )}
            <div className="field">
              <span>
                {t('reelSpeed')} <Info label={t('reelAbout')}>{t('reelInfo')}</Info>
              </span>
              <Segmented value={quickSpin ? 'quick' : 'full'} onChange={(v) => setQuickSpin(v === 'quick')} options={[{ value: 'full', label: t('full'), testId: 'reel-full' }, { value: 'quick', label: t('quick'), testId: 'reel-quick' }]} />
            </div>
            {onlineAvailable() && (
              <div className="field">
                <span>
                  {t('errorReports')} <Info label={t('errorReportsAbout')}>{t('errorReportsInfo')}</Info>
                </span>
                <Segmented value={reportsOn ? 'on' : 'off'} onChange={(v) => setReports(v === 'on')} options={[{ value: 'on', label: t('on'), testId: 'error-reports-on' }, { value: 'off', label: t('off'), testId: 'error-reports-off' }]} />
              </div>
            )}
            </div>
            <div className="toolbar">
              <button
                className="btn sm"
                data-testid="reset-tips"
                disabled={tipsSeen === 0}
                onClick={() => {
                  resetTips()
                  showToast(t('tipsToast'))
                }}
              >
                {t('showTips')}
              </button>
              <span className="small muted">
                {tipsSeen === 0 ? t('tipsAll', { n: TIP_IDS.length }) : t('tipsDismissed', { n: tipsSeen, total: TIP_IDS.length })}
              </span>
            </div>
          </div>
          )}
          {on('seasons') && (
          <div className="panel">
            <div className="panel-head">
              <h3>{t('bestSeasons')}</h3>
              {profile.leaderboard.length > 0 && (
                <span data-testid="board-filter">
                  <Segmented value={filter} onChange={setFilter} options={[...BOARD_FILTERS]} />
                </span>
              )}
            </div>
            {profile.leaderboard.length > 0 && board.length === 0 && <div className="muted small">{BOARD_FILTERS.find((f) => f.value === filter)?.empty ?? t('noneOfFilter', { filter: BOARD_FILTERS.find((f) => f.value === filter)?.label })}</div>}
            {profile.leaderboard.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <Trophy size={26} />
                </span>
                <h3>{t('nothingYet')}</h3>
                <p className="muted small">{t('nothingYetLine')}</p>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl best-tbl">
                  <thead>
                    <tr>
                      <th>{t('team')}</th>
                      <th className="num">{t('pts')}</th>
                      <th className="num">{t('wdl')}</th>
                      <th>{t('result')}</th>
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
                                <span className="chip case-icon-chip" data-tier="icons" title={t('caseIconTip')}>
                                  {t('caseIcon')}
                                </span>
                              )}
                            </span>
                            <div className="small muted">
                              {e.superLeague ? <><SuperLeagueMark /> {SUPER_LEAGUE_NAME}</> : <>{u ? clubName(u, e.hostClubId) : e.hostClubId} · {u?.clubById[e.hostClubId] && <LeagueFlag leagueId={u.clubById[e.hostClubId].leagueId} label={u.leagues.find((l) => l.id === u.clubById[e.hostClubId].leagueId)?.name} />} {seasonLabel(e.leagueSeason)}</>} · {modeTitle(e.mode) ?? e.mode}
                            </div>
                            {e.moment && <div className="small muted" data-testid="entry-moment">{e.moment}</div>}
                            {(runs.length > 1 || e.challenge || e.budget !== undefined) && (
                              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                                {runs.length > 1 && (rank === 1 ? <span className="chip gold" data-testid="best-on-wheel">{t('bestOnWheel', { n: runs.length })}</span> : <span className="chip">{t('rankOnWheel', { rank, n: runs.length })}</span>)}
                                {e.budget !== undefined && <span className="chip" data-testid="entry-cap" title={t('capTip', { cap: capTotal(e.budget) })}>{t('capSpent', { spent: capTotal(e.spent ?? 0), cap: capTotal(e.budget) })}</span>}
                                {e.challenge && <span className={`chip ${e.points > e.challenge.points ? 'good' : e.points < e.challenge.points ? 'bad' : ''}`}>{t('vsScore', { name: e.challenge.name, score: e.challenge.points })}</span>}
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
              <h3>{t('bestRuns')}</h3>
              {!!profile.arenaRuns?.length && (
                <Segmented
                  value={runsView}
                  onChange={setRunsView}
                  options={[
                    { value: 'best', label: t('bestFirst') },
                    { value: 'ladder', label: t('bestOnLadder'), hint: t('ladderHint') },
                  ]}
                />
              )}
            </div>
            {!profile.arenaRuns?.length && (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <Award size={26} />
                </span>
                <h3>{t('noRuns')}</h3>
                <p className="muted small">{t('noRunsLine')}</p>
              </div>
            )}
            {!!profile.arenaRuns?.length && (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('team')}</th>
                      <th>{t('format')}</th>
                      <th>{t('result')}</th>
                      <th className="num">{t('gfga')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsView === 'best'
                      ? profile.arenaRuns.map(runRow)
                      : ladders.flatMap((g) => [
                          <tr key={`h-${g.key}`} data-testid="ladder-group">
                            <td colSpan={4} className="small muted" style={{ whiteSpace: 'normal' }}>
                              <b>{t('ladderSeed', { seed: g.seed })}</b> · {t('ladderLine', { format: arenaFormatText(g), n: g.runs.length, tier: arenaTierLabel(g.runs[0].tier, g.runs[0].score).toLowerCase() })}
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
