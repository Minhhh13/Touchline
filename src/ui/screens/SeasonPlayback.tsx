import { useEffect, useMemo, useState } from 'react'
import { Bandage, Flame, Goal, Shield, ShieldCheck, Sparkles, Star } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { getFormation } from '@engine/formations'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { playerLookup } from '@game/logic/players'
import { playbackResults, quickChangeProblem, quickSeasonGames, quickSquadAt } from '@game/logic/quick'
import { canPlayFor, QUICK_CHANGES, quickBenchRule } from '@game/logic/quickBench'
import type { QuickGameResult } from '@game/types'
import { Pitch } from '../components/Pitch'
import { playbackDelay, PLAYBACK_SPEEDS, shortName, type PlaybackSpeed } from '@game/logic/gameByGame'
import { gapLine, momentAt, positionSeries, rivalsOf, tableAfterGame, weeklyTables } from '@game/logic/liveTable'
import { chaseAt, chaseLine, perfectOverLabel } from '@game/logic/perfect'
import { brokeMoment } from '../screenText'
import { flareAt, raceAt, raceDelay, type FlareKind } from '../seasonDrama'
import { USER_TEAM } from '@engine/season'
import { LiveTable, PositionChart } from '../components/LiveLeague'
import { QuickTeamLine } from '../components/QuickTeamLine'
import { GameByGame, SeasonTally, useSeasonPlayback } from '../components/GameByGame'
import { HighlightsModal } from '../components/Highlights'
import { canShowHighlights } from '@game/logic/highlights'
import { PlayerRow } from '../components/PlayerRow'
import { ManagerChip } from '../components/ManagerPick'
import { Segmented } from '../components/bits'
import { JanuaryWindow } from '../components/JanuaryWindow'
import { clubName, clubShort } from '../format'
import { sideNamer } from '@game/logic/superLeague'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { useMediaQuery } from '../components/LivePitch'
import { PLAYBACK } from '../boxSets'
import { clinchMatchweeks } from '@engine/story'
import { roundsFixtures } from '@game/logic/story'
import { usePlaybackSounds } from '../sound/usePlaybackSounds'
import { SeasonBeatCard, usePlaybackBeat } from '../components/SeasonBeat'
import { onTabListKey } from '../a11y'
import { translator } from '../i18n'
import { B, rich } from '../i18n/rich'
import { season } from '../i18n/en/season'

const t = translator(season)

/**
 * The quick season, game by game, after kick-off. In phase `january` it plays the first half and stops on the January
 * window; once the season is done it plays the rest and offers the summary. Only the reveal is paced: every result was
 * simulated before the first game is shown. On a desktop it fits one screen in boxed panels (the game list, the live
 * table, the position chart), each scrolling inside itself; on a phone the three are tabs under the tally.
 */
/** How long a live-table row takes to slide to its new place; faster playback than this jumps instead, so rows never overlap. */
const SLIDE_MS = 400
/** The step from which the playback is calm enough for its heavier motion (1x is 1500 ms, a race's stretched step counts). */
const CALM_STEP_MS = 1000

export function SeasonPlayback() {
  const { universe: u, game, playback, endPlayback } = useStorePick('universe', 'game', 'playback', 'endPlayback')
  const j = game?.phase === 'january' ? game.quickJanuary ?? null : null
  const results = game ? playbackResults(game) : []
  // A reload during the first half lands on the window; after the season the playback carries on where the window left it
  const from = playback?.from ?? results.length
  const rounds = j ? j.firstHalfRounds : game?.quickResult?.rounds
  const tables = useMemo(() => (rounds ? weeklyTables(rounds) : []), [rounds])
  const fullSeason = game?.quickResult?.results?.length ?? (u && game ? quickSeasonGames(u, game.settings) : results.length)
  // The title race's last weeks slow down: the wait before each of the last games stretches while a race is on
  const pb = useSeasonPlayback(results.length, from, results.length, (k, base) => raceDelay(base, j ? null : raceAt(tableAfterGame(tables, results, k), USER_TEAM, k, fullSeason)))
  const [hlWeek, setHlWeek] = useState<number | null>(null)
  // The phone's tab: the January window opens on the box that holds it, until another tab is chosen there
  const [tabState, setTabState] = useState<{ at: string; tab: 'list' | 'table' | 'chart' }>({ at: 'play', tab: 'list' })
  const allBoxes = useBoxes(PLAYBACK)
  // A phone keeps the head's controls to two short rows: the manager joins the team line
  const phone = useMediaQuery('(max-width: 720px)')
  // The season's sounds as each result lands (seasonCues.ts): the clinch weeks come from the whole season's rounds, so none in the first half
  const q = game?.quickResult
  // The clinch weeks once, for the sounds and the beats alike (the beats land on the stingers they mirror)
  const clinch = useMemo(() => (j || !q ? null : q.clinchedAt !== undefined ? { clinchedAt: q.clinchedAt ?? null, doomedAt: q.doomedAt ?? null } : q.rounds ? clinchMatchweeks(roundsFixtures(q.rounds), q.rounds.ids, USER_TEAM) : null), [j, q])
  const cueInput = {
    results,
    tables,
    userId: USER_TEAM,
    total: fullSeason,
    stopAt: results.length,
    january: !!j,
    finalPosition: q?.position ?? results.at(-1)?.position ?? 0,
    teams: tables[0]?.length || fullSeason / 2 + 1,
  }
  usePlaybackSounds({ ...cueInput, revealed: pb.revealed, playing: pb.playing, done: pb.done, speed: pb.speed, clinch: () => clinch })
  // The big moments, January and the season's end as a short card over the playback (seasonBeats.ts)
  const { beat, length: beatLen } = usePlaybackBeat({ ...cueInput, clinch }, pb.revealed, pb.speed)
  if (!u || !game) return null
  // Watching a game's highlights pauses the playback on the game shown
  const watch = canShowHighlights(game)
    ? (r: QuickGameResult) => {
        pb.pause()
        setHlWeek(r.matchweek)
      }
    : undefined
  const s = game.settings
  // A Super League side carries its season: "Barcelona 2010-11"
  const sideName = sideNamer(game, u)
  // The club's short name for the narrow game list, where the side is the plain club (not a Super League "Barcelona 2018-19")
  const opponent = (id: string) => {
    const name = sideName(id)
    return { clubId: id, name, ...(name === clubName(u, id) ? { short: clubShort(u, id) } : {}) }
  }
  const total = game.quickResult?.results?.length ?? quickSeasonGames(u, s)
  const chase = chaseAt(results, pb.revealed)
  const line = chaseLine(chase, total)
  const table = tableAfterGame(tables, results, pb.revealed)
  const before = tableAfterGame(tables, results, pb.revealed - 1)
  const gap = gapLine(table, USER_TEAM)
  const moment = momentAt(tables, results, pb.revealed, USER_TEAM)
  const momentText = moment === 'top' ? t('momentTop') : moment === 'top4' ? t('momentTop4') : moment === 'perfect' ? t('momentPerfect', { n: chase.won }) : moment === 'broke' && results[pb.revealed - 1] ? brokeMoment(results[pb.revealed - 1].gf, results[pb.revealed - 1].ga, sideName(results[pb.revealed - 1].opponentId)) : perfectOverLabel(chase.perfectRun)
  const teams = table.length || total / 2 + 1
  const series = tables.length ? positionSeries(tables, results, USER_TEAM, pb.revealed) : results.slice(0, pb.revealed).map((r) => r.position)
  const rivals = tables.length && pb.revealed ? rivalsOf(table, USER_TEAM, 3).map((id) => ({ teamId: id, name: shortName(sideName(id)), series: positionSeries(tables, results, id, pb.revealed) })) : []
  // The drama of the step shown (seasonDrama.ts): a race in the last weeks, a streak or milestone flaring
  const race = !j && !pb.done ? raceAt(table, USER_TEAM, pb.revealed, total) : null
  const flare = pb.revealed > 0 && !moment ? flareAt(results, pb.revealed) : null
  const nextGame = race && pb.playing ? results[pb.revealed] : undefined
  const raceText = race ? t(race.kind === 'title' ? 'raceTitle' : 'raceDrop', { n: race.left }) : ''
  const upcoming = nextGame ? { matchweek: nextGame.matchweek, opponent: opponent(nextGame.opponentId), home: nextGame.home, label: race!.left === 1 ? t('raceFinalDay') : raceText } : null
  // The heavier motion (the cards' push, the goal flash) only at a calm pace: 1x, 0.5x, or a race's weeks slowed to it
  const calm = raceDelay(playbackDelay(pb.speed), race) >= CALM_STEP_MS
  const janOpen = !!j && pb.done
  const at = janOpen ? 'jan' : 'play'
  const benchOn = quickBenchRule(game) && !!game.draft && game.draft.bench.length > 0
  // The Boxes control: the panes left on show (the January window, a decision, keeps its pane)
  const boxes = allBoxes.only(['games', 'table', 'chart', ...(benchOn ? ['bench'] : [])])
  // The bench shares the third column with the chart: that column takes a little more width, so the pitch can sit beside the bench
  const benchShown = benchOn && boxes.on('bench')
  const panes = { list: boxes.on('games'), table: boxes.on('table'), chart: janOpen || boxes.on('chart') || (benchOn && boxes.on('bench')) }
  const paneIds = (['list', 'table', 'chart'] as const).filter((pane) => panes[pane])
  const wanted = tabState.at === at ? tabState.tab : janOpen ? 'chart' : tabState.tab
  const tab = panes[wanted] ? wanted : paneIds[0] ?? 'list'
  const setTab = (pane: 'list' | 'table' | 'chart') => setTabState({ at, tab: pane })
  const pbGrid = boxes.grid([
    { track: 'minmax(0, 1fr)', ids: ['games'] },
    { track: 'minmax(0, 1fr)', ids: ['table'] },
    { track: benchShown ? 'minmax(0, 1.25fr)' : 'minmax(0, 1fr)', ids: janOpen ? [] : ['chart', 'bench'] },
  ])
  return (
    <div className={`page fit pb-page ${race ? `racing ${race.kind}` : ''}`} data-testid="season-playback">
      <div className="fit-head screen-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>{t(j && pb.done ? 'january' : 'theSeason')}</h1>
          <QuickTeamLine game={game} u={u}>
            {phone && game.manager && <ManagerChip manager={game.manager} />}
          </QuickTeamLine>
        </div>
        <div className={`chase ${line.tone} ${line.justBroke ? 'broke' : ''}`} key={line.justBroke ? `b${pb.revealed}` : line.tone} data-testid="chase" data-tone={line.tone}>
          <b data-testid="chase-headline">{line.headline}</b>
          {line.detail && <span className="small" data-testid="chase-detail">{line.detail}</span>}
        </div>
        <div className="col fit-head-side" style={{ gap: 6 }}>
          <div className="row wrap pb-head-row pb-head-meta">
            {!phone && game.manager && <ManagerChip manager={game.manager} />}
            <BoxesMenu groups={[boxes]} />
            <span className="playback-mw" data-testid="playback-matchweek">
              {rich(t('matchweekOf', { n: pb.revealed, total }), B)}
            </span>
          </div>
          {!pb.done && (
            <div className="row wrap pb-head-row pb-head-controls">
              <button className="btn sm" onClick={pb.toggle} data-testid="playback-pause">
                {t(pb.playing ? 'pause' : 'play')}
              </button>
              <Segmented<string> label={t('playbackSpeed')} value={String(pb.speed)} onChange={(v) => pb.setSpeed(Number(v) as PlaybackSpeed)} options={PLAYBACK_SPEEDS.map((x) => ({ value: String(x), label: t('speed', { x }) }))} />
              <button className="btn sm ghost" onClick={pb.skip} data-testid="playback-skip">
                {t(j ? 'skipJanuary' : 'skipEnd')}
              </button>
            </div>
          )}
          {!j && pb.done && (
            <div className="row wrap pb-end" style={{ gap: 8, justifyContent: 'flex-end', alignItems: 'center' }} data-testid="playback-end">
              <span className="small">
                {t('fullTime', { pos: game.quickResult?.position ?? 0, pts: game.quickResult?.points ?? 0 })}
              </span>
              <button className="btn primary" onClick={endPlayback} data-testid="playback-summary">
                {t('seeSummary')}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="pb-tally-row">
        <SeasonTally results={results} upTo={pb.revealed} flare={flare?.box ? { box: flare.box, stamp: pb.revealed } : undefined} />
        {gap && (
          <span className="chip info pb-gap" data-testid="playback-gap">
            {gap}
          </span>
        )}
        {moment && pb.revealed > 0 && (
          <span key={`m${pb.revealed}`} className={`moment ${moment}`} data-testid="playback-moment" data-moment={moment}>
            {momentText}
          </span>
        )}
        {flare && (
          <span key={`f${pb.revealed}`} className={`pb-flare ${flare.kind}`} data-testid="playback-flare" data-flare={flare.kind}>
            <FlareIcon kind={flare.kind} />
            {t(`flare_${flare.kind}`, { n: flare.n })}
          </span>
        )}
        {race && (
          <span key={`r${race.kind}`} className={`pb-race ${race.kind} ${race.left === 1 ? 'final' : ''}`} data-testid="playback-race" data-race={race.kind} data-left={race.left} style={{ ['--race-k' as string]: String(race.left) }}>
            <span className="pb-race-dot" aria-hidden="true" />
            {race.left === 1 ? t('raceFinal', { kind: race.kind }) : raceText}
          </span>
        )}
        {/* One short line for a screen reader: the big moments and the end, never every game (the tally is not live) */}
        <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="playback-live">
          {pb.done ? (j ? t('halfPlayed') : t('fullTime', { pos: game.quickResult?.position ?? 0, pts: game.quickResult?.points ?? 0 })) : moment && pb.revealed > 0 ? t('liveMoment', { n: pb.revealed, moment: moment === 'broke' ? `${perfectOverLabel(chase.perfectRun)}, ${momentText}` : momentText }) : ''}
        </span>
      </div>
      <div className="pb-tabs segmented" role="tablist" aria-label={t('seasonViews')} onKeyDown={onTabListKey}>
        {paneIds.map((pane) => (
          <button key={pane} type="button" role="tab" aria-selected={tab === pane} tabIndex={tab === pane ? 0 : -1} className={tab === pane ? 'active' : ''} onClick={() => setTab(pane)} data-testid={`pb-tab-${pane}`}>
            {t(pane === 'list' ? 'tabGames' : pane === 'table' ? 'tabTable' : janOpen ? 'january' : 'tabChart')}
          </button>
        ))}
      </div>
      <div className={`fit-grid c3 pb-grid ${benchShown ? 'pb-bench' : ''} ${pbGrid.className}`} style={pbGrid.style} data-tab={tab}>
        {panes.list && (
        <div className="fit-cell" data-pane="list">
          <GameByGame results={results} opponent={opponent} replay={pb} compact strip={false} order="newest" total={total} title={t('gameByGame')} onHighlights={watch} upcoming={upcoming} race={!!race} calm={calm} />
        </div>
        )}
        {panes.table && (
        <div className="panel fit-cell" data-pane="table">
          <div className="panel-head">
            <h3>{t('liveTable')}</h3>
            <span className="small muted">{pb.revealed ? t('afterGame', { n: pb.revealed }) : t('beforeKickOff')}</span>
          </div>
          {table.length ? <LiveTable table={table} before={before} userId={USER_TEAM} teamName={s.teamName} nameOf={sideName} slide={!pb.playing || playbackDelay(pb.speed) > SLIDE_MS} stamp={pb.revealed} /> : <p className="small muted">{t('noLiveTable')}</p>}
        </div>
        )}
        {panes.chart && (
        <div className="fit-cell fit-col" data-pane="chart">
          {j && pb.done && <JanuaryWindow key={j.listings.map((l) => l.playerSeasonId).join()} game={game} u={u} j={j} />}
          {boxes.on('chart') && <PositionChart series={series} rivals={rivals} teams={teams} games={total} fill />}
          {benchShown && <BenchPanel game={game} u={u} results={results} revealed={pb.revealed} onChoose={pb.pause} />}
        </div>
        )}
      </div>
      {beat && <SeasonBeatCard beat={beat} length={beatLen} detail={beat.kind === 'season-end' ? t('fullTime', { pos: game.quickResult?.position ?? 0, pts: game.quickResult?.points ?? 0 }) : undefined} />}
      {hlWeek !== null && <HighlightsModal game={game} u={u} matchweek={hlWeek} onClose={() => setHlWeek(null)} />}
    </div>
  )
}

/** A flare's icon: a run of wins burns, an unbeaten run or clean sheets hold firm, a milestone shines. */
function FlareIcon({ kind }: { kind: FlareKind }) {
  const Icon = kind === 'wins' ? Flame : kind === 'unbeaten' ? Shield : kind === 'clean' ? ShieldCheck : kind === 'goals' ? Goal : kind === 'points' ? Star : Sparkles
  return <Icon size={14} aria-hidden="true" />
}

/**
 * The bench during the playback: the XI for the next game on the pitch (injured starters shown with their cover), the
 * bench with who is out, and the changes left. Choosing a bench player pauses the playback; tapping the starter he
 * replaces makes the change from the next game on. The store decides whether a change is allowed.
 */
function BenchPanel({ game, u, results, revealed, onChoose }: { game: Game; u: LoadedUniverse; results: QuickGameResult[]; revealed: number; onChoose: () => void }) {
  const { benchChangeSoon: benchChange, changingBench: busy, warmKickOff } = useStorePick('benchChangeSoon', 'changingBench', 'warmKickOff')
  const [inId, setInId] = useState<string | null>(null)
  const get = playerLookup(game, u)
  const hide = ratingHidden(game.settings.rules, 'squad')
  const formation = getFormation(game.tactics.formationId)
  const view = quickSquadAt(game, u, results, revealed)
  const problem = quickChangeProblem(game, u, results, revealed)
  const fielded = { ...view.lineup }
  for (const c of view.covers) fielded[c.slotId] = c.inId
  const choosing = !problem && inId !== null && view.bench.includes(inId)
  const used = QUICK_CHANGES - view.changesLeft
  const nameOf = (id: string) => get(id)?.name ?? id
  // The slots the chosen bench player may take: a starter there, and the draft's position rule
  const chosenP = inId ? get(inId) : undefined
  const canPlay = canPlayFor(game)
  const targets = choosing && chosenP ? formation.slots.filter((s) => view.lineup[s.id] && canPlay(chosenP, s.position)).map((s) => s.id) : []
  // A change plays the season again in the quick-season worker: keep it warm while one can still be made
  const canChange = view.changesLeft > 0 && view.next !== null
  useEffect(() => (canChange ? warmKickOff() : undefined), [canChange, warmKickOff])
  return (
    <div className="panel col bench-panel" data-testid="bench-panel" aria-busy={busy || undefined}>
      <div className="panel-head">
        <h3>{view.next === null ? t('xiAndBench') : t('forMatchweek', { n: view.next })}</h3>
        <span className={`chip ${view.changesLeft ? '' : 'warn'}`} data-testid="changes-left">
          {t('changesLeft', { n: view.changesLeft, total: QUICK_CHANGES })}
        </span>
      </div>
      <div className="grid two bench-grid">
        <div className={`bench-pitch ${choosing ? '' : 'pitch-mini'}`} {...(choosing ? {} : { inert: true })}>
          <Pitch formation={formation} lineup={fielded} getPlayer={get} hideRatings={hide} eligibleSlots={targets} onSlotClick={choosing && !busy ? (slotId) => { benchChange(revealed, slotId, inId!); setInId(null) } : undefined} />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <b className="small">{t('bench')}</b>
          <div className="plist">
            {view.bench.map((id) => {
              const p = get(id)
              if (!p) return null
              const out = view.out.includes(id)
              const covering = view.covers.find((c) => c.inId === id)
              return (
                <PlayerRow
                  key={id}
                  p={p}
                  hideRatings={hide}
                  showClub
                  dim={!!problem || out}
                  selected={inId === id}
                  onClick={() => {
                    onChoose()
                    setInId(inId === id ? null : id)
                  }}
                  extra={out ? <span className="chip bad">{t('injured')}</span> : covering ? <span className="chip warn">{t('covers', { name: nameOf(covering.outId) })}</span> : null}
                  right={!problem && !out ? <span className="btn sm" data-testid="bench-bring-on">{t(inId === id ? 'choose' : 'bringOn')}</span> : null}
                />
              )
            })}
          </div>
          {view.out.filter((id) => !view.bench.includes(id)).map((id) => {
            const c = view.covers.find((x) => x.outId === id)
            return (
              <div key={id} className="small row" style={{ gap: 6 }} data-testid="bench-injury">
                <Bandage size={14} aria-hidden="true" /> {c ? t('outCovered', { name: nameOf(id), cover: nameOf(c.inId) }) : t('outUncovered', { name: nameOf(id) })}
              </div>
            )
          })}
          <span className="help" data-testid="bench-help">
            {choosing ? (targets.length ? t('tapStarter', { name: nameOf(inId!), n: view.next }) : t('cannotPlay', { name: nameOf(inId!) })) : problem ? (view.next === null ? t('changesMade', { n: used }) : t('changeProblem', { problem })) : t('benchHowTo')}
          </span>
          {/* The starters he may replace, by name: on a small pitch the discs show ratings only */}
          {choosing && targets.length > 0 && (
            <div className="pill-list" role="group" aria-label={t('startersCanReplace', { name: nameOf(inId!) })} data-testid="bench-targets">
              {targets.map((slotId) => {
                const slot = formation.slots.find((s) => s.id === slotId)
                const outId = view.lineup[slotId]
                return (
                  <button
                    key={slotId}
                    type="button"
                    className="chip-btn"
                    disabled={busy}
                    onClick={() => {
                      benchChange(revealed, slotId, inId!)
                      setInId(null)
                    }}
                    data-testid="bench-target"
                  >
                    {t('targetLine', { pos: slot?.position ?? slotId, name: outId ? nameOf(outId) : t('emptySlot') })}
                  </button>
                )
              })}
            </div>
          )}
          {(game.quickChanges ?? []).filter((c) => view.next === null || c.from <= view.next).map((c, i) => (
            <span key={i} className="small muted">
              {t('changeLine', { i: i + 1, name: nameOf(c.inId), n: c.from })}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
