import { useCallback, useEffect, useMemo, useState } from 'react'
import { Briefcase, Check, ChevronDown, Copy, Crown, Dices, Globe, ImageDown, Landmark, Medal, Minus, Plus, RotateCcw, ScrollText, Send, ShieldCheck, ShieldQuestion, TrendingDown, TrendingUp, Trophy, type LucideIcon } from 'lucide-react'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { SUMMARY } from '../boxSets'
import { useStore } from '@game/store'
import { continentalRun } from '@game/logic/week'
import { USER_TEAM, seasonTable, tierBlurb } from '@engine/season'
import { isSharedPuzzle, modeLabel, shareCardFooter } from '@game/logic/modes'
import { realityLine, storyForGame } from '@game/logic/story'
import { SeasonStoryPanel } from '../components/SeasonStory'
import { capLine } from '@game/logic/cap'
import { inRecordBooks } from '@game/logic/records'
import { chainCodes, chainLine } from '@game/logic/chain'
import { shareText } from '@engine/awards'
import { powerUpsShareLine } from '@game/logic/powerups'
import { getFormation } from '@engine/formations'
import { benchmarkSeason, hasRecordBook, realChampion, recordShareLine, type RecordMetric } from '@engine/records'
import { Pitch } from '../components/Pitch'
import { TWIST_INFO } from '../components/TwistCard'
import { QUICK_RULES, SEASON_RULES, rulesTags, type Twist } from '@engine/draft'
import { activeModeCards, modesLine } from '@engine/modes'
import { TableView } from '../components/TableView'
import { ClubBadge, CountUp, Info, Rating, Stat, TeamBadge } from '../components/bits'
import { AWARD_ICON } from '../components/icons'
import { LeagueAwards } from '../components/LeagueAwards'
import { versusReal } from '../screenText'
import { Celebrate } from '../components/Celebrate'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, money, nationName, ordinal, seasonLabel, tierName } from '../format'
import { LeagueFlag, NationFlag, QuickLeagueFlag } from '../components/Flag'
import { isSuperLeague, quickLeagueName, sideNamer, superTierBlurb } from '@game/logic/superLeague'
import { playerLookup, squadPlayers } from '@game/logic/players'
import type { TableRow } from '@engine/types'
import { downloadDataUrl, renderShareCard } from '../shareCard'
import { APP_NAME } from '../brand'
import { challengeFromGame, claimCupsLine, claimOf, verdictLine } from '@game/logic/challenge'
import { cleanName } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { randomSeed } from '@engine/rng'
import { GameByGame, RunningStrip, useSeasonReplay } from '../components/GameByGame'
import { HighlightsModal } from '../components/Highlights'
import { canShowHighlights } from '@game/logic/highlights'
import { europeLine, europeRoundLabel, januaryLine, shortName } from '@game/logic/gameByGame'
import { januaryGambleLine } from '@game/logic/januaryGamble'
import { tierName as rarityName } from '@game/logic/rarity'
import { changesLine, coveredGames, QUICK_CHANGES, quickBenchRule } from '@game/logic/quickBench'
import { shareLink } from '../../online/api'
import { RankedStatus } from '../online/RankedStatus'
import { ChaseStatus } from '../online/ChaseStatus'
import { cupLine, wonCup, type QuickCupComp } from '@game/logic/quickCups'
import { honourDetail, honourLabel, honourLine, honourOf, isTitle } from '@game/logic/cabinet'
import { CupRuns } from '../components/CupRuns'
import { ManagerChip } from '../components/ManagerPick'
import { caseIconIn, caseLine } from '@game/logic/endCase'
import { managerLine } from '@game/logic/managers'
import { chaseAt, emptyBests, perfectTarget, recordLabel, runsLine, versusPerfectLine } from '@game/logic/perfect'
import { estimatedNote } from '@game/logic/era'
import { ResultArt, resultArtKind } from '../components/Art'

export function Summary() {
  const { universe: u, game, go, startGame, nextSeason, abandonGame, showToast, acceptJob, loadingLeagues, profile } = useStore()
  const [copied, setCopied] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [cardUrl, setCardUrl] = useState<string | null>(null)
  // The game whose highlights are open, by matchweek
  const [hlWeek, setHlWeek] = useState<number | null>(null)
  // The long #c= link, offered beside a short one: it works offline and without the server
  const [longLink, setLongLink] = useState<string | null>(null)
  const [shortCode, setShortCode] = useState<string | null>(null)
  // The post-season cups being revealed tie by tie (both can be at once): the banner keeps each trophy back until its run is shown
  const [revealingCups, setRevealingCups] = useState<QuickCupComp[]>([])
  const onCupReveal = useCallback((comp: QuickCupComp, on: boolean) => setRevealingCups((list) => (on ? (list.includes(comp) ? list : [...list, comp]) : list.filter((c) => c !== comp))), [])
  // A challenge link made before a cup was played would leave the cup out: make it again on the next click
  const cupClaim = `${game?.quickResult?.cup?.reached ?? ''}|${game?.quickResult?.continentalCup?.reached ?? ''}`
  useEffect(() => setLink(null), [cupClaim])
  // Every hook runs before the early return below
  const q = game?.quickResult
  const season = game?.season
  const last = game?.history.at(-1)
  const record = q ? { won: q.won, drawn: q.drawn, lost: q.lost, points: q.points, position: q.position, goalsFor: q.goalsFor, goalsAgainst: q.goalsAgainst } : last ? { won: last.won, drawn: last.drawn, lost: last.lost, points: last.points, position: last.position, goalsFor: last.goalsFor, goalsAgainst: last.goalsAgainst } : null
  const table: TableRow[] = useMemo(() => {
    if (q) return q.table.map((r) => ({ ...r, played: (q.table.length - 1) * 2, form: [] }))
    if (season) return seasonTable(season)
    return []
  }, [q, season])
  // Every game of a quick season, game by game; the replay is UI state only
  const results = q?.results ?? []
  const replay = useSeasonReplay(results.length)
  // The 38-0 chase: the record against a perfect season of this league's length, and the runs from the first game
  const games = results.length || (q ? Math.max(0, (q.table.length - 1) * 2) : 38)
  const chase = chaseAt(results)
  const bests = profile.quickBests ?? emptyBests()
  const leagueId = game?.settings.leagueId ?? ''
  // The Super League has no real seasons to measure against, no real side replaced and no real champion
  const superOn = !!game && isSuperLeague(game.settings)
  // Where this season sits against every complete real season of the league with the same number of matches
  // A run-in's ten games (or a sacked season) are no full season to put in the record books
  const bench = useMemo(() => (!u || !record || !game || !inRecordBooks(game) || superOn ? null : benchmarkSeason(u, leagueId, record)), [u, leagueId, superOn, record?.won, record?.drawn, record?.lost, record?.points, record?.goalsFor, record?.goalsAgainst, season?.sacked, season?.carryIn])
  const challenge = game?.settings.challenge
  const ghostLineup = useMemo(() => Object.fromEntries((challenge?.picks ?? []).flatMap((p) => (p.id && p.slotId ? [[p.slotId, p.id] as [string, string]] : []))), [challenge])
  // How the club you replaced actually did that season, when a complete real table exists
  const hostClubId = game?.settings.hostClubId ?? ''
  const leagueSeason = game?.settings.leagueSeason ?? 0
  const realRow = useMemo(() => {
    if (!u || superOn) return null
    const cs = u.clubSeasonByKey[`${hostClubId}@${leagueSeason}`]
    if (!cs?.complete) return null
    return u.tables[leagueId]?.[leagueSeason]?.find((r) => r.clubId === hostClubId) ?? null
  }, [u, hostClubId, leagueSeason, leagueId, superOn])
  // Season Story: when the season was decided, its runs and the one line that tells it
  const story = useMemo(() => (u && game ? storyForGame(game, u) : null), [game, u])
  const allBoxes = useBoxes(SUMMARY)
  if (!u || !game || !record) return null
  const get = playerLookup(game, u)
  const tier = game.tier ?? 'MID_TABLE'
  const formation = getFormation(game.tactics.formationId)
  const row: TableRow = { teamId: USER_TEAM, played: record.won + record.drawn + record.lost, won: record.won, drawn: record.drawn, lost: record.lost, goalsFor: record.goalsFor, goalsAgainst: record.goalsAgainst, points: record.points, form: [] }
  const leagueName = quickLeagueName(u, game.settings)
  // A Super League side is named with its season: "Barcelona 2010-11"
  const sideName = sideNamer(game, u)
  const inBooks = bench !== null && hasRecordBook(bench)
  const champion = superOn ? undefined : realChampion(u, game.settings.leagueId, game.settings.leagueSeason)
  const extraLines: string[] = []
  // The 38-0 options that differ from the mode's defaults: difficulty, blind, draft mode, ratings
  // The Quick Draft modes on one line ("🌀 Crazy · 💀 Hard"); Hard then leaves the tag line so it is not said twice
  const modeLine = activeModeCards(game.settings.rules).some((c) => c !== 'hard') ? modesLine(game.settings.rules) : ''
  const tags = rulesTags(game.settings.rules, game.settings.mode === 'season' || game.settings.mode === 'dynasty' ? SEASON_RULES : QUICK_RULES).filter((t) => !(modeLine && t === 'Hard'))
  if (modeLine) extraLines.push(modeLine)
  if (tags.length) extraLines.push(tags.join(' · '))
  const powerLine = powerUpsShareLine(game.draft)
  if (powerLine) extraLines.push(powerLine)
  if (game.settings.rules.onlyNation) extraLines.push(`One nation: ${nationName(u, game.settings.rules.onlyNation)}`)
  if (game.settings.rules.twists) {
    // The twists the picks actually went through, when the draft is still on the game (quick and daily keep it)
    const landed = (game.draft?.history ?? []).flatMap((h): Twist[] => (h.pickedId && h.twist ? [h.twist] : [])).map((t) => TWIST_INFO[t].icon)
    extraLines.push(landed.length ? `Twists ${landed.join(' ')}` : 'Twists 🎲')
  }
  // The Quick Draft's manager, by name and style
  const mgrLine = managerLine(game.manager)
  if (mgrLine) extraLines.push(mgrLine)
  // The end-of-draft case: what it dropped, and whether its Icon played
  const boxLine = caseLine(game, (id) => get(id)?.name ?? id)
  if (boxLine) extraLines.push(boxLine)
  // The 38-0 chase in the share text: how long the perfect run lasted, for a season short of perfect
  const runs = q && results.length ? runsLine(chase, games) : null
  if (runs) extraLines.push(runs)
  const recordLine = bench && inBooks ? recordShareLine(bench, leagueName) : null
  if (recordLine) extraLines.push(recordLine)
  // The Moneyball wheel brags in money: what the cap bought, and the points each £M of it earned
  const capText = capLine(game, record.points)
  if (capText) extraLines.push(capText)
  // The Teammate Chain: how many links held, or how often it broke
  const chainText = chainLine(game)
  if (chainText) extraLines.push(chainText)
  // Season Story's moment (its fallback is the best win), then, for a managed season, how the real club did
  if (story) extraLines.push(story.moment)
  const managed = game.settings.mode === 'season' || game.settings.mode === 'dynasty' || game.settings.mode === 'runin'
  if (managed && realRow) extraLines.push(realityLine(realRow, clubName(u, game.settings.hostClubId), record))
  // January business and the European run of a quick season, when there were any
  const janLine = januaryLine(q?.january)
  if (janLine) extraLines.push(janLine)
  const gambleLine = januaryGambleLine(q?.januaryGamble)
  if (gambleLine) extraLines.push(gambleLine)
  const benchLine = changesLine(q?.changes, (id) => shortName(get(id)?.name ?? id))
  if (benchLine) extraLines.push(benchLine)
  const euroLine = europeLine(q?.europe)
  if (euroLine) extraLines.push(euroLine)
  // The post-season cups, once played and revealed
  const cupsShown = (comp: QuickCupComp) => !revealingCups.includes(comp)
  for (const [line, comp] of [[cupLine(q?.cup, 'cup'), 'cup'], [cupLine(q?.continentalCup, 'continental'), 'continental']] as Array<[string | null, QuickCupComp]>) if (line && cupsShown(comp)) extraLines.push(line)
  const quickCupWon = cupsShown('cup') && wonCup(q, 'cup')
  const quickEuroWon = (cupsShown('continental') && q?.continentalCup?.reached === 'W') || q?.europe?.reached === 'W'
  // The Treble (league, Cup and Continental Cup) or a Double (the league and one cup), once its cups are shown
  const cupsWon = { cup: season?.cupWon ?? quickCupWon, continental: season?.continental?.won ?? quickEuroWon }
  const honour = honourOf(isTitle(record.position, tier), cupsWon.cup, cupsWon.continental)
  const honourCups = (['cup', 'continental'] as const).filter((c) => cupsWon[c])
  if (honour && !replay.playing) extraLines.push(honourLine(honour, honourCups))
  // A classic pick or a classic league season: the numbers are TouchLine's estimate, and the share says so
  // The player-seasons themselves, so a dynasty's aged copy still counts by the club-season it was drafted from
  const estimated = estimatedNote(u, Object.values(game.lineup).map((id) => get(id) ?? id), game.settings.leagueId, game.settings.leagueSeason)
  if (estimated) extraLines.push(estimated)
  // Head-to-head against the ghost this game was played against
  const mine = claimOf(game)
  if (challenge && mine) extraLines.push(verdictLine(challenge, mine))
  const text = shareText({
    teamName: game.settings.teamName,
    tier,
    row,
    position: record.position,
    cupWon: season?.cupWon ?? quickCupWon,
    continentalWon: season?.continental?.won ?? quickEuroWon,
    leagueSeason: game.settings.leagueSeason,
    ...(superOn ? { where: leagueName, tierText: tierName(tier, record.position, true) } : {}),
    // A quick season's XI is the user's team, never "as" the club whose place it takes
    hostClubName: managed ? clubName(u, game.settings.hostClubId) : '',
    mode: modeLabel(game, 'share'),
    seed: isSharedPuzzle(game.settings.mode) ? undefined : game.settings.seed,
    potsName: q ? get(q.pots?.playerSeasonId ?? '')?.name : game.awards?.playerOfTheSeason?.name,
    bootName: q ? get(q.topScorer?.playerSeasonId ?? '')?.name : game.awards?.goldenBoot?.name,
    bootGoals: q ? q.topScorer?.goals : game.awards?.goldenBoot ? Number(game.awards.goldenBoot.value.split(' ')[0]) : undefined,
    extraLines: extraLines.length ? extraLines : undefined,
  }, APP_NAME)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast('Could not copy. Select the text manually.')
    }
  }
  const squad = squadPlayers(game, u)
  const isManage = game.settings.mode === 'season' || game.settings.mode === 'dynasty'
  // Quick mode keeps the draft after the season, so this run can be packed into a link or replayed against itself
  const canChallenge = !isManage && !!game.draft && !!q
  const challengeName = cleanName(profile.managerName) || cleanName(game.settings.teamName) || 'A friend'
  const makeChallenge = async () => {
    const c = challengeFromGame(game, u, challengeName)
    if (!c) {
      showToast('This result cannot be packed into a challenge.')
      return
    }
    // A short #s= link when signed in and online; the long #c= link otherwise (it always works)
    const share = await shareLink(c)
    const url = share.url
    setLink(url)
    setShortCode(share.code)
    setLongLink(share.code ? share.longUrl : null)
    try {
      await navigator.clipboard.writeText(url)
      showToast(share.code ? `Short link ${share.code} copied. Send it to a friend.` : `Challenge link copied (${url.length} characters). Send it to a friend.`)
    } catch {
      showToast('Could not copy. The link is below.')
    }
  }
  const runItBack = () => {
    const d = game.draft
    if (!d || !mine) return
    startGame({
      ...game.settings,
      mode: 'quick',
      challenge: {
        name: 'your ghost',
        picks: d.history.map((h) => ({ id: h.pickedId, slotId: h.pickedId ? h.slotId : null, clubId: h.clubId, season: h.season })),
        claim: mine,
        verified: 'yes',
        data: u.generatedAt,
        engine: ENGINE_VERSION,
      },
    })
  }
  const makeCard = async () => {
    const codes = chainCodes(u, game)
    try {
      const url = await renderShareCard({
        title: game.settings.teamName,
        subtitle: `${q ? `${recordLabel(record.won, record.drawn, record.lost)} · ` : ''}${superOn ? leagueName : `${u.leagues.find((l) => l.id === game.settings.leagueId)?.name ?? ''} ${seasonLabel(game.settings.leagueSeason)}`}`,
        tier,
        row,
        position: record.position,
        formation,
        lineup: game.lineup,
        getPlayer: get,
        footer: `${shareCardFooter(game)}${estimated ? ' · estimated ratings' : ''}`,
        // The Treble or a Double in gold under the record
        ...(honour ? { honour: `${honourLabel(honour, honourCups)} · ${honourDetail(honourCups)}` } : {}),
        strip: story?.strip,
        moment: story?.moment,
        // A chained draft prints its chain of club codes under the record
        ...(codes ? { lines: [`${record.won}W ${record.drawn}D ${record.lost}L · ${record.points} points · finished ${ordinal(record.position)}`, ...codes] } : {}),
      })
      setCardUrl(url)
      downloadDataUrl(url, `touchline-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast('Could not render the share card.')
    }
  }

  const modeName = modeLabel(game, 'heading')
  const vsReal = realRow ? versusReal(record.position, realRow.position) : null
  const objectivesMet = season?.objectives?.filter((o) => o.met).length ?? 0
  const continuing = game.settings.mode === 'dynasty' && !season?.sacked
  // An award: its name and value as a small label over the player's row, so a long value never squeezes the row
  // The Boxes control: the boxes this summary has (the result, job offers and the challenge boxes always stay)
  const hasGames = (!!q && results.length > 0) || (!q && !!story)
  const boxes = allBoxes.only([
    ...(hasGames ? ['games'] : []),
    ...(story && !replay.playing ? ['story'] : []),
    ...(q?.january || q?.januaryGamble ? ['january'] : []),
    ...(q && quickBenchRule(game) && (game.draft?.bench.length ?? 0) > 0 ? ['bench'] : []),
    ...(q?.europe ? ['europe'] : []),
    ...(bench && inBooks ? ['records'] : []),
    'xi',
    'awards',
    ...(isManage ? ['squad-stats'] : []),
    'table',
    ...(isManage ? ['finances'] : []),
    ...(game.history.length > 1 ? ['history'] : []),
    'share',
  ])
  const on = boxes.on
  const lowerLeft = on('xi') || on('awards') || (isManage && on('squad-stats'))
  const lowerRight = on('table') || (isManage && on('finances')) || (game.history.length > 1 && on('history')) || on('share')
  const lower = boxes.grid([{ track: '1fr', ids: ['xi', 'awards', 'squad-stats'] }, { track: '1fr', ids: ['table', 'finances', 'history', 'share'] }])
  const awardRow = (psId: string | undefined, Icon: LucideIcon, label: string, tone: '' | 'gold' | 'good' = '') => {
    const p = psId ? get(psId) : undefined
    return p ? (
      <div key={label} className="award-item">
        <span className={`award-label ${tone}`}>
          <Icon size={13} aria-hidden="true" /> {label}
        </span>
        <PlayerRow p={p} showClub />
      </div>
    ) : null
  }
  const iconChip = (Icon: LucideIcon, text: string, tone: '' | 'gold' | 'good' = '') => (
    <span className={`chip icon-chip ${tone}`}>
      <Icon size={12} aria-hidden="true" /> {text}
    </span>
  )

  return (
    <div className="page summary" data-testid="summary">
      <div className="tier-banner result-banner">
        {!replay.playing && <ResultArt kind={resultArtKind(tier)} />}
        <div className="banner-meta">
          <span className="bm-team">
            <TeamBadge code={game.settings.shortName} size={22} />
            {game.settings.teamName}
          </span>
          <span className="bm-rest">
            {game.settings.mode === 'quick' ? <><QuickLeagueFlag settings={game.settings} label={leagueName} />{superOn && ` ${leagueName}`}</> : <><LeagueFlag leagueId={game.settings.leagueId} label={leagueName} /> {seasonLabel(game.settings.leagueSeason)} · {modeName}</>}
            {modeLine && <span data-testid="summary-modes">{` · ${modeLine}`}</span>}
          </span>
          <BoxesMenu groups={[boxes]} className="bm-boxes" iconOnly />
        </div>
        {q && !replay.playing && (
          <div className={`versus-perfect ${record.won >= games && games > 0 ? 'perfect' : record.lost === 0 ? 'unbeaten' : ''}`} data-testid="versus-perfect">
            {/* The record in its three colours; the text still reads as recordLabel ("20-8-10") */}
            <span className="vp-record" data-testid="versus-perfect-record">
              <span className={`vp-w ${record.won ? '' : 'zero'}`}>{record.won}</span>
              <span className="vp-dash">-</span>
              <span className={`vp-d ${record.drawn ? '' : 'zero'}`}>{record.drawn}</span>
              <span className="vp-dash">-</span>
              <span className={`vp-l ${record.lost ? '' : 'zero'}`}>{record.lost}</span>
            </span>
            <span className="vp-line">
              <b className="vp-against">against {perfectTarget(games)}</b>
              <span className="vp-sep" aria-hidden="true">·</span>
              <span className="vp-short">{versusPerfectLine(record.won, record.lost, games)}</span>
            </span>
            {(runs || bests.longestPerfectRun) ? (
              <span className="vp-runs small muted" data-testid="versus-perfect-runs">
                {[runs, bests.longestPerfectRun ? `${runs ? 'your' : 'Your'} best run ${bests.longestPerfectRun}-0` : null].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </div>
        )}
        {replay.playing ? (
          <div className="tier" style={{ color: 'var(--text-3)' }} data-testid="tier-pending">
            Season in play…
          </div>
        ) : (
          <div className="tier-wrap">
            <Celebrate tier={tier} resultKey={`${game.id}:${game.year}`} replayed={replay.used} />
            <div className={`tier ${tier} ${replay.used ? 'pop' : ''}`} data-testid="tier">
              {tierName(tier, record.position, superOn)}
            </div>
          </div>
        )}
        {!replay.playing && (
          <p className="tier-blurb" data-testid="tier-blurb">
            {superOn ? superTierBlurb(tier, record.position, table.length || 20) : tierBlurb(tier, record.position, table.length || 20, !!season?.sacked)}
          </p>
        )}
        {!replay.playing && story && (
          <p className="tier-blurb" data-testid="moment">
            {story.moment}
          </p>
        )}
        {replay.playing && <RunningStrip results={results} upTo={replay.revealed} />}
        {!q && !replay.playing && (
          <div className="record">
            <span className="w">
              <CountUp value={record.won} />W
            </span>
            <span className="d">
              <CountUp value={record.drawn} />D
            </span>
            <span className="l">
              <CountUp value={record.lost} />L
            </span>
          </div>
        )}
        {!replay.playing && (
          <div className="banner-stats">
            <Stat label="Points" value={<CountUp value={record.points} />} />
            <Stat label="Finished" value={ordinal(record.position)} />
            <Stat label="Goals" value={`${record.goalsFor}-${record.goalsAgainst}`} />
            {q && <Stat label="Team rating" value={q.strength.overall.toFixed(1)} />}
          </div>
        )}
        {!replay.playing && (
          <div className="blocks" aria-hidden="true">
            {Array.from({ length: record.won }, (_, i) => (
              <span key={`w${i}`} style={{ background: 'var(--good)' }} />
            ))}
            {Array.from({ length: record.drawn }, (_, i) => (
              <span key={`d${i}`} style={{ background: 'var(--meter-mid)' }} />
            ))}
            {Array.from({ length: record.lost }, (_, i) => (
              <span key={`l${i}`} style={{ background: 'var(--bad)' }} />
            ))}
          </div>
        )}
        <div className="banner-chips">
          {!replay.playing && honour === 'treble' && (
            <span className="chip gold icon-chip honour-chip treble" data-testid="banner-treble" title={honourDetail(honourCups)}>
              <Crown size={14} aria-hidden="true" /> Treble
            </span>
          )}
          {!replay.playing && honour === 'double' && (
            <span className="chip gold icon-chip honour-chip" data-testid="banner-double" title={honourDetail(honourCups)}>
              <Trophy size={12} aria-hidden="true" /> {honourLabel(honour, honourCups) === 'The Double' ? 'Double' : 'League and Continental double'}
            </span>
          )}
          {!replay.playing && (season?.cupWon || quickCupWon) && <span data-testid="banner-cup">{iconChip(Trophy, 'Cup winners', 'gold')}</span>}
          {(season?.continental?.won || (!replay.playing && quickEuroWon)) && <span data-testid="banner-continental">{iconChip(Globe, 'Continental champions', 'gold')}</span>}
          {game.manager && <ManagerChip manager={game.manager} />}
          {caseIconIn(game) && (
            <span className="chip case-icon-chip" data-tier="icons" data-testid="summary-case-icon" title="An Icon from the end-of-draft case played: a non-standard season, kept out of the record book">
              ★ Case Icon
            </span>
          )}
          {season?.continental && !season.continental.won && iconChip(Globe, `Continental Cup: ${{ R16: 'round of 16', QF: 'quarter-finals', SF: 'semi-finals', F: 'final', W: 'winners' }[continentalRun(season) ?? 'R16']}`)}
          {season?.sacked && <span className="chip bad">Sacked</span>}
          {tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
          {game.settings.rules.onlyNation && (
            <span className="chip">
              <NationFlag nation={game.settings.rules.onlyNation} named /> {nationName(u, game.settings.rules.onlyNation)} only
            </span>
          )}
          {season?.objectives?.length ? iconChip(objectivesMet === season.objectives.length ? Check : Landmark, `Objectives ${objectivesMet}/${season.objectives.length}`, objectivesMet === season.objectives.length ? 'good' : '') : null}
          {/* Against the real side whose place you took, without naming it: the replaced club stays off the result */}
          {!replay.playing && vsReal && (
            <span className={`chip icon-chip ${vsReal.delta > 0 ? 'good' : vsReal.delta < 0 ? 'bad' : ''}`} title={`Against the real side's ${ordinal(realRow?.position ?? 0)} that season`}>
              {vsReal.delta > 0 ? <TrendingUp size={12} aria-hidden="true" /> : vsReal.delta < 0 ? <TrendingDown size={12} aria-hidden="true" /> : <Minus size={12} aria-hidden="true" />}
              {vsReal.delta === 0 ? 'Same place as the real side' : `${vsReal.label} than the real side`}
            </span>
          )}
        </div>
        <div className="banner-actions">
          <button className={`btn ${continuing ? '' : 'primary'}`} onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copied' : 'Copy result'}
          </button>
          <button className="btn" onClick={makeCard}>
            <ImageDown size={16} aria-hidden="true" /> Download share card
          </button>
          {!isManage && !isSharedPuzzle(game.settings.mode) && (
            <button className="btn" onClick={() => startGame({ ...game.settings, challenge: undefined, seed: randomSeed() })}>
              <Dices size={16} aria-hidden="true" /> Draft again
            </button>
          )}
          {canChallenge && (
            <button className="btn" onClick={() => void makeChallenge()} data-testid="challenge-friend">
              <Send size={16} aria-hidden="true" /> Challenge a friend
            </button>
          )}
          {canChallenge && (
            <button className="btn" onClick={runItBack} data-testid="run-it-back" title="Draft this wheel again against your own result">
              <RotateCcw size={16} aria-hidden="true" /> Run it back
            </button>
          )}
          {continuing && (
            <button className="btn primary" onClick={() => nextSeason()} disabled={loadingLeagues}>
              {loadingLeagues ? 'Loading league data…' : game.pendingMove ? `Join ${clubName(u, game.pendingMove.clubId)} →` : `Continue with ${clubName(u, game.settings.hostClubId)} →`}
            </button>
          )}
          <button className="btn ghost" onClick={() => { abandonGame(); go('home') }}>
            <Plus size={16} aria-hidden="true" /> New game
          </button>
        </div>
      </div>

      {/* Everything under the result: on a desktop one panel that scrolls inside itself */}
      <div className="summary-body fill" data-testid="summary-body">
      {!replay.playing && <RankedStatus game={game} />}
      {!replay.playing && <ChaseStatus game={game} />}
      {q && !replay.playing && <CupRuns game={game} u={u} onReveal={onCupReveal} />}
      {q && results.length > 0 && on('games') && (
        <GameByGame
          results={results}
          opponent={(id) => ({ clubId: id, name: sideName(id) })}
          replay={replay}
          orderToggle
          strip={false}
          fold={8}
          onHighlights={
            canShowHighlights(game)
              ? (r) => {
                  // A running replay would keep revealing and scrolling the list under the reel: show it all first
                  if (replay.playing) replay.skip()
                  setHlWeek(r.matchweek)
                }
              : undefined
          }
        />
      )}
      {hlWeek !== null && <HighlightsModal game={game} u={u} matchweek={hlWeek} onClose={() => setHlWeek(null)} />}
      {story && !replay.playing && on('story') && <SeasonStoryPanel story={story} opponentName={(id) => sideName(id)} />}
      {!q && story && on('games') && <GameByGame results={story.results} opponent={(id) => ({ clubId: id, name: clubName(u, id) })} compact fold={8} />}

      {q?.january && on('january') && (
        <div className="panel" data-testid="january-summary">
          <div className="panel-head">
            <h3>January business</h3>
            <span className="small muted">After matchweek {game.quickJanuary?.afterMatchweek ?? Math.floor(results.length / 2)}</span>
          </div>
          <div className="small">
            {q.january.kind === 'sign' ? `Signed ${q.january.inName} for ${money(q.january.fee)}; ${q.january.outName} left.` : `Swapped ${q.january.outName} for ${q.january.inName}.`}
          </div>
        </div>
      )}

      {q?.januaryGamble && on('january') && (
        <div className="panel" data-testid="january-gamble-summary">
          <div className="panel-head">
            <h3>{q.januaryGamble.kind === 'spin' ? 'January spin' : 'January Upgrader'}</h3>
            <span className="small muted">After matchweek {game.quickJanuary?.afterMatchweek ?? Math.floor(results.length / 2)}</span>
          </div>
          <div className="small">
            {q.januaryGamble.kind === 'spin'
              ? q.januaryGamble.outName
                ? `The case landed on ${q.januaryGamble.inName} (${rarityName(q.januaryGamble.tier)}); he came in for ${q.januaryGamble.outName}.`
                : `The case landed on ${q.januaryGamble.inName} (${rarityName(q.januaryGamble.tier)}); you kept your XI.`
              : `${q.januaryGamble.name} at ${q.januaryGamble.chance}% for +${q.januaryGamble.boost}: ${q.januaryGamble.won ? `won, +${q.januaryGamble.delta}` : `lost, ${q.januaryGamble.delta}`} for the second half.`}
          </div>
        </div>
      )}

      {q && quickBenchRule(game) && (game.draft?.bench.length ?? 0) > 0 && on('bench') && (
        <div className="panel" data-testid="bench-summary">
          <div className="panel-head">
            <h3>The bench</h3>
            <span className="small muted">
              {q.changes?.length ?? 0} of {QUICK_CHANGES} changes · injury cover in {coveredGames(q.results)} game{coveredGames(q.results) === 1 ? '' : 's'}
            </span>
          </div>
          <div className="col small" style={{ gap: 4 }}>
            {(q.changes ?? []).map((c, i) => (
              <span key={i}>
                Matchweek {c.from}: {get(c.inId)?.name ?? c.inId} on for {get(c.outId)?.name ?? c.outId}
              </span>
            ))}
            {!q.changes?.length && <span className="muted">No changes: the XI you drafted saw it through, the bench covering injuries.</span>}
          </div>
        </div>
      )}

      {q?.europe && on('europe') && (
        <div className="panel" data-testid="europe-run">
          <div className="panel-head">
            <h3>Continental Cup run</h3>
            <span className={`chip ${q.europe.reached === 'W' ? 'gold' : ''}`}>{q.europe.reached === 'W' ? 'Winners' : `Out in the ${europeRoundLabel(q.europe.reached)}`}</span>
          </div>
          <ol className="gbg-list">
            {q.europe.ties.map((t) => (
              <li key={t.round} className={`gbg-game ${t.won ? 'W' : 'L'}`}>
                <span className="gbg-mw">{t.round}</span>
                <ClubBadge clubId={t.opponentId} size={22} />
                <span className="gbg-fix">{t.round === 'F' ? `v ${clubName(u, t.opponentId)} (final)` : t.home ? `v ${clubName(u, t.opponentId)} (H)` : `at ${clubName(u, t.opponentId)}`}</span>
                <span className="gbg-score">
                  {t.gf}-{t.ga}
                </span>
                <span className={t.won ? 'chip good' : 'chip bad'}>{t.won ? 'Through' : 'Out'}</span>
                <span className="gbg-pos small muted">{t.pens ? `${t.pens.for}-${t.pens.against}p` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {link && (
        <div className="panel" data-testid="challenge-link">
          <div className="panel-head">
            <span className="head-title">
              <h3>Challenge link</h3>
              <Info label="About challenge links">
                Whoever opens it drafts the same wheel as {challengeName}, sees your pick on every spin and plays the same season. Built on data {u.generatedAt}, engine {ENGINE_VERSION}.
              </Info>
            </span>
          </div>
          <input className="input mono small" readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} data-testid="challenge-link-url" />
          {shortCode && <div className="small muted" style={{ marginTop: 6 }}>Code {shortCode}: it opens on any device with a connection, signed in or not.</div>}
          {longLink && (
            <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => void navigator.clipboard?.writeText(longLink).then(() => showToast('Long link copied.'), () => setLink(longLink))}>
              Copy the long link (works offline)
            </button>
          )}
        </div>
      )}

      {challenge && mine && (
        <div className="panel" data-testid="head-to-head">
          <div className="panel-head">
            <span className="head-title">
              <h3>Head-to-head · vs {challenge.name}</h3>
              <Info label="About the challenge">
                Same seed, same wheel.{' '}
                {challenge.verified === 'yes' && `Verified: ${challenge.name}'s picks replay to ${challenge.claim.pts} points on this data.`}
                {challenge.verified === 'unverified' && `Unverified: ${challenge.reason ?? 'built on different data'}.`}
                {challenge.verified === 'no' && `Could not verify the claim: ${challenge.reason ?? 'the picks do not replay'}.`}
              </Info>
            </span>
            <span className={`chip icon-chip ${challenge.verified === 'yes' ? 'good' : challenge.verified === 'no' ? 'bad' : ''}`}>
              {challenge.verified === 'yes' ? <ShieldCheck size={12} aria-hidden="true" /> : <ShieldQuestion size={12} aria-hidden="true" />}
              {challenge.verified === 'yes' ? 'Verified' : challenge.verified === 'no' ? 'Not verified' : 'Unverified'}
            </span>
          </div>
          <div className="grid two">
            <div className="col">
              <div className="row between wrap">
                <b>{challenge.name}</b>
                <span className={`chip ${challenge.claim.pts > mine.pts ? 'good' : ''}`}>
                  {challenge.claim.pts} pts · {tierName(challenge.claim.t, undefined, superOn)} · {challenge.claim.w}-{challenge.claim.d}-{challenge.claim.l}
                </span>
              </div>
              {claimCupsLine(challenge.claim) && <div className="small muted">{claimCupsLine(challenge.claim)}</div>}
              {challenge.picks.length ? <Pitch formation={formation} lineup={ghostLineup} getPlayer={get} /> : <div className="muted small">{challenge.name}'s picks could not be resolved on this data.</div>}
            </div>
            <div className="col">
              <div className="row between wrap">
                <b>{game.settings.teamName}</b>
                <span className={`chip ${mine.pts > challenge.claim.pts ? 'good' : ''}`}>
                  {mine.pts} pts · {tierName(mine.t, undefined, superOn)} · {mine.w}-{mine.d}-{mine.l}
                </span>
              </div>
              {claimCupsLine(mine) && <div className="small muted">{claimCupsLine(mine)}</div>}
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} />
            </div>
          </div>
          <div className="notice" style={{ marginTop: 'var(--space-3)' }} data-testid="verdict">
            {verdictLine(challenge, mine)}
          </div>
        </div>
      )}

      {bench && inBooks && on('records') && (
        <div className="panel" data-testid="record-books">
          <div className="panel-head">
            <span className="head-title">
              <h3>In the record books</h3>
              <Info label="About the record books">
                Against {bench.seasons} complete <LeagueFlag leagueId={game.settings.leagueId} /> {leagueName} seasons of {bench.played} matches in the data{champion ? `; the real champions in ${seasonLabel(game.settings.leagueSeason)} were ${clubName(u, champion)}` : ''}.
              </Info>
            </span>
            <span className="small muted">
              vs {bench.seasons} real seasons
            </span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl records-tbl">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="num">Yours</th>
                  <th>All-time</th>
                </tr>
              </thead>
              <tbody>
                {([bench.points, bench.wins, bench.goalsFor, bench.goalsAgainst, bench.defeats] as RecordMetric[]).map((m) => {
                  const isRecord = bench.records.some((r) => r.key === m.key)
                  return (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td className="num">{m.value}</td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {isRecord ? (
                          iconChip(ScrollText, 'League record', 'gold')
                        ) : (
                          <span>
                            {m.rank === 1 ? 'Joint best' : `${ordinal(m.rank)} best`} <span className="muted small">of {m.of + 1}{m.equal > 0 && m.rank > 1 ? ` · level with ${m.equal}` : ''}</span>
                          </span>
                        )}
                        {m.better.length > 0 && <div className="ahead">Ahead: {m.better.map((b) => `${clubName(u, b.clubId)} ${b.value} (${seasonLabel(b.season)})`).join(', ')}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {game.settings.difficulty !== 'realistic' && (
            <div className="help row" style={{ gap: 'var(--space-1)' }}>
              Benchmarks, not records, on Calibrated
              <Info label="Why benchmarks">Calibrated difficulty handicaps the AI clubs. The Record Books achievement needs a points record on Realistic.</Info>
            </div>
          )}
        </div>
      )}

      {game.jobOffers.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--gold)' }}>
          <div className="panel-head">
            <span className="head-title">
              <h3 className="icon-title" style={{ color: 'var(--gold-text)' }}>
                <Briefcase size={18} aria-hidden="true" /> Job offers
              </h3>
              <Info>Your work has been noticed. Stay, or take your squad somewhere new next season.</Info>
            </span>
          </div>
          <div className="grid three">
            {game.jobOffers.map((o, i) => {
              const chosen = game.pendingMove?.clubId === o.clubId
              return (
                <div key={o.clubId} className="card" style={chosen ? { borderColor: 'var(--primary)' } : undefined}>
                  <div className="club-head">
                    <ClubBadge clubId={o.clubId} size={40} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{clubName(u, o.clubId)}</div>
                      <div className="club-sub">
                        <span>
                          <LeagueFlag leagueId={o.leagueId} /> {u.leagues.find((l) => l.id === o.leagueId)?.name ?? o.leagueId}
                        </span>
                        <span>+{money(o.budgetBonus)} budget</span>
                      </div>
                    </div>
                  </div>
                  <p className="small" style={{ margin: 'var(--space-2) 0' }}>{o.pitch}</p>
                  <button className={`btn sm ${chosen ? '' : 'primary'}`} onClick={() => acceptJob(chosen ? null : i)}>
                    {chosen ? 'Change your mind' : 'Accept'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {(lowerLeft || lowerRight) && (
      <div className={`grid two ${lower.className}`} style={lower.style}>
        {lowerLeft && (
        <div className="col">
          {on('xi') && (
          <div className="panel">
            <div className="panel-head">
              <h3>Your XI</h3>
              {q && (
                <span className="unit-strip" aria-label="Unit ratings">
                  {(
                    [
                      ['GK', q.strength.goalkeeping],
                      ['DEF', q.strength.defence],
                      ['MID', q.strength.midfield],
                      ['ATT', q.strength.attack],
                    ] as const
                  ).map(([k, v]) => (
                    <span key={k}>
                      <i>{k}</i> {v.toFixed(0)}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <Pitch formation={formation} lineup={game.lineup} getPlayer={get} showRoles={Object.fromEntries(formation.slots.map((s) => [s.id, s.position]))} />
            {q && (
              <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
                <span className="chip">Balance {Math.round(q.strength.balance * 100)}%</span>
                <span className={`chip ${q.strength.chemistry > 0 ? 'good' : q.strength.chemistry < 0 ? 'bad' : ''}`}>
                  Chemistry {q.strength.chemistry >= 0 ? '+' : ''}
                  {q.strength.chemistry}
                </span>
              </div>
            )}
          </div>
          )}
          {on('awards') && (
          <div className="panel">
            <h3>Awards</h3>
            {q && (
              <div className="plist lined award-list">
                {awardRow(q.pots?.playerSeasonId, AWARD_ICON.pots, `Player of the season · ${q.pots?.rating}`, 'gold')}
                {awardRow(q.topScorer?.playerSeasonId, AWARD_ICON.boot, `Top scorer · ${q.topScorer?.goals} goals`, 'good')}
              </div>
            )}
            {game.awards && (
              <div className="plist lined award-list">
                {awardRow(game.awards.playerOfTheSeason?.playerSeasonId, AWARD_ICON.pots, `Player of the season · ${game.awards.playerOfTheSeason?.value}`, 'gold')}
                {awardRow(game.awards.goldenBoot?.playerSeasonId, AWARD_ICON.boot, `Golden boot · ${game.awards.goldenBoot?.value}`, 'good')}
                {awardRow(game.awards.playmaker?.playerSeasonId, AWARD_ICON.playmaker, `Playmaker · ${game.awards.playmaker?.value}`)}
                {awardRow(game.awards.goldenGlove?.playerSeasonId, AWARD_ICON.glove, `Golden glove · ${game.awards.goldenGlove?.value}`)}
                {awardRow(game.awards.youngPlayer?.playerSeasonId, AWARD_ICON.young, `Young player · ${game.awards.youngPlayer?.value}`)}
              </div>
            )}
          </div>
          )}
          {on('awards') && <LeagueAwards />}
          {isManage && on('squad-stats') && (
            <div className="panel">
              <h3>Squad statistics</h3>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="num">Apps</th>
                      <th className="num">G</th>
                      <th className="num">A</th>
                      <th className="num">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {squad
                      .filter((x) => x.s.seasonStats.apps > 0)
                      .sort((a, b) => b.s.seasonStats.ratingSum / b.s.seasonStats.apps - a.s.seasonStats.ratingSum / a.s.seasonStats.apps)
                      .map((x) => (
                        <tr key={x.p.id}>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <Rating value={x.p.overall} /> {x.p.name}
                            </span>
                          </td>
                          <td className="num">{x.s.seasonStats.apps}</td>
                          <td className="num">{x.s.seasonStats.goals}</td>
                          <td className="num">{x.s.seasonStats.assists}</td>
                          <td className="num">{(x.s.seasonStats.ratingSum / x.s.seasonStats.apps).toFixed(2)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        )}
        {lowerRight && (
        <div className="col">
          {on('table') && (
          <div className="panel">
            <h3>
              <QuickLeagueFlag settings={game.settings} label={leagueName} /> Final table{game.settings.mode === 'quick' ? '' : ` · ${seasonLabel(game.settings.leagueSeason)}`}
            </h3>
            <div className="tbl-wrap">
              <TableView rows={table} teamName={game.settings.teamName} compact={!!q} highlightTop nameOf={sideName} />
            </div>
          </div>
          )}
          {isManage && on('finances') && (
            <div className="panel">
              <h3>Finances</h3>
              <div className="stat-strip">
                <Stat label="Budget now" value={money(game.finances.budget)} />
                <Stat label="Income" value={money(game.finances.income)} />
                <Stat label="Transfers" value={money(game.finances.spent)} />
                <Stat label="Wages paid" value={money(game.finances.wagesPaid)} />
              </div>
            </div>
          )}
          {game.history.length > 1 && on('history') && (
            <div className="panel">
              <h3>Dynasty history</h3>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Season</th>
                      <th>As</th>
                      <th className="num">Pos</th>
                      <th className="num">Pts</th>
                      <th>Result</th>
                      <th>Real champions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {game.history.map((h) => {
                      const real = realChampion(u, h.leagueId, h.leagueSeason)
                      return (
                        <tr key={h.year}>
                          <td>{h.year}</td>
                          <td>
                            <LeagueFlag leagueId={h.leagueId} label={u.leagues.find((l) => l.id === h.leagueId)?.name ?? h.leagueId} /> {seasonLabel(h.leagueSeason)}
                          </td>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <ClubBadge clubId={h.hostClubId} size={20} />
                              {clubName(u, h.hostClubId)}
                            </span>
                          </td>
                          <td className="num">{ordinal(h.position)}</td>
                          <td className="num">{h.points}</td>
                          <td>
                            <span className="row" style={{ gap: 4 }}>
                              {tierName(h.tier, h.position)}
                              {h.cupWon && (
                                <span className="chip gold icon-chip" title="Cup winners">
                                  <Medal size={12} aria-hidden="true" /> Cup
                                </span>
                              )}
                              {h.continentalWon && (
                                <span className="chip gold icon-chip" title="Continental champions">
                                  <Globe size={12} aria-hidden="true" /> Europe
                                </span>
                              )}
                            </span>
                          </td>
                          <td>
                            {real ? (
                              <span className="row" style={{ gap: 6 }}>
                                <ClubBadge clubId={real} size={20} />
                                {clubName(u, real)}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {cardUrl && on('share') && (
            <div className="panel">
              <h3>Share card</h3>
              <img src={cardUrl} alt="Share card" className="share-card-img" />
            </div>
          )}
          {on('share') && (
          <details className="panel fold">
            <summary className="panel-head">
              <h3>Share text</h3>
              <ChevronDown size={16} className="fold-chevron" aria-hidden="true" />
            </summary>
            <pre className="mono small share-text">{text}</pre>
          </details>
          )}
        </div>
        )}
      </div>
      )}
      </div>
    </div>
  )
}
