import { useMemo, useState } from 'react'
import { Bandage } from 'lucide-react'
import { useStore } from '@game/store'
import type { Game, QuickJanuary } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'
import { getFormation } from '@engine/formations'
import { ratingsHidden } from '@engine/draft'
import { ratingAt } from '@engine/positions'
import { playerLookup } from '@game/logic/players'
import { playbackResults, quickChangeProblem, quickSeasonGames, quickSquadAt } from '@game/logic/quick'
import { canPlayFor, QUICK_CHANGES, quickBenchRule } from '@game/logic/quickBench'
import type { QuickGameResult } from '@game/types'
import { Pitch } from '../components/Pitch'
import { foldResults, goalDifferenceLabel, paceLine, PLAYBACK_SPEEDS, shortName, type PlaybackSpeed } from '@game/logic/gameByGame'
import { gapLine, momentAt, positionSeries, rivalsOf, tableAfterGame, weeklyTables } from '@game/logic/liveTable'
import { chaseAt, chaseLine, perfectOverLabel } from '@game/logic/perfect'
import { USER_TEAM } from '@engine/season'
import { LiveTable, PositionChart } from '../components/LiveLeague'
import { QuickTeamLine } from '../components/QuickTeamLine'
import { GameByGame, SeasonTally, useSeasonPlayback } from '../components/GameByGame'
import { HighlightsModal } from '../components/Highlights'
import { canShowHighlights } from '@game/logic/highlights'
import { PlayerRow } from '../components/PlayerRow'
import { ManagerChip } from '../components/ManagerPick'
import { Pos, Segmented } from '../components/bits'
import { CaptainAndPenalties, TeamInstructions } from '../components/TacticsControls'
import { clubName, money, ordinal } from '../format'

/**
 * The quick season, game by game, after kick-off. In phase `january` it plays the first half and stops on the January
 * window; once the season is done it plays the rest and offers the summary. Only the reveal is paced: every result was
 * simulated before the first game is shown. On a desktop it fits one screen in boxed panels (the game list, the live
 * table, the position chart), each scrolling inside itself; on a phone the three are tabs under the tally.
 */
export function SeasonPlayback() {
  const { universe: u, game, playback, endPlayback } = useStore()
  const j = game?.phase === 'january' ? game.quickJanuary ?? null : null
  const results = game ? playbackResults(game) : []
  // A reload during the first half lands on the window; after the season the playback carries on where the window left it
  const from = playback?.from ?? results.length
  const pb = useSeasonPlayback(results.length, from)
  const [hlWeek, setHlWeek] = useState<number | null>(null)
  // The phone's tab: the January window opens on the box that holds it, until another tab is chosen there
  const [tabState, setTabState] = useState<{ at: string; tab: 'list' | 'table' | 'chart' }>({ at: 'play', tab: 'list' })
  const rounds = j ? j.firstHalfRounds : game?.quickResult?.rounds
  const tables = useMemo(() => (rounds ? weeklyTables(rounds) : []), [rounds])
  if (!u || !game) return null
  // Watching a game's highlights pauses the playback on the game shown
  const watch = canShowHighlights(game)
    ? (r: QuickGameResult) => {
        pb.pause()
        setHlWeek(r.matchweek)
      }
    : undefined
  const s = game.settings
  const opponent = (id: string) => ({ clubId: id, name: clubName(u, id) })
  const total = game.quickResult?.results?.length ?? quickSeasonGames(u, s)
  const chase = chaseAt(results, pb.revealed)
  const line = chaseLine(chase, total)
  const table = tableAfterGame(tables, results, pb.revealed)
  const before = tableAfterGame(tables, results, pb.revealed - 1)
  const gap = gapLine(table, USER_TEAM)
  const moment = momentAt(tables, results, pb.revealed, USER_TEAM)
  const teams = table.length || total / 2 + 1
  const series = tables.length ? positionSeries(tables, results, USER_TEAM, pb.revealed) : results.slice(0, pb.revealed).map((r) => r.position)
  const rivals = tables.length && pb.revealed ? rivalsOf(table, USER_TEAM, 3).map((id) => ({ teamId: id, name: shortName(clubName(u, id)), series: positionSeries(tables, results, id, pb.revealed) })) : []
  const janOpen = !!j && pb.done
  const at = janOpen ? 'jan' : 'play'
  const tab = tabState.at === at ? tabState.tab : janOpen ? 'chart' : tabState.tab
  const setTab = (t: 'list' | 'table' | 'chart') => setTabState({ at, tab: t })
  const benchOn = quickBenchRule(game) && !!game.draft && game.draft.bench.length > 0
  return (
    <div className="page fit" data-testid="season-playback">
      <div className="fit-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>{j && pb.done ? 'January' : 'The season'}</h1>
          <QuickTeamLine game={game} u={u} />
        </div>
        <div className={`chase ${line.tone} ${line.justBroke ? 'broke' : ''}`} key={line.justBroke ? `b${pb.revealed}` : line.tone} data-testid="chase" data-tone={line.tone}>
          <b data-testid="chase-headline">{line.headline}</b>
          {line.detail && <span className="small" data-testid="chase-detail">{line.detail}</span>}
        </div>
        <div className="col fit-head-side" style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {game.manager && <ManagerChip manager={game.manager} />}
            <span className="playback-mw" data-testid="playback-matchweek">
              Matchweek <b>{pb.revealed}</b> / {total}
            </span>
          </div>
          {!pb.done && (
            <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={pb.toggle} data-testid="playback-pause">
                {pb.playing ? 'Pause' : 'Play'}
              </button>
              <Segmented<string> value={String(pb.speed)} onChange={(v) => pb.setSpeed(Number(v) as PlaybackSpeed)} options={PLAYBACK_SPEEDS.map((x) => ({ value: String(x), label: `${x}x` }))} />
              <button className="btn sm ghost" onClick={pb.skip} data-testid="playback-skip">
                {j ? 'Skip to January' : 'Skip to the end'}
              </button>
            </div>
          )}
          {!j && pb.done && (
            <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end', alignItems: 'center' }} data-testid="playback-end">
              <span className="small">
                Full time: {ordinal(game.quickResult?.position ?? 0)}, {game.quickResult?.points ?? 0} points.
              </span>
              <button className="btn primary" onClick={endPlayback} data-testid="playback-summary">
                See the summary
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="pb-tally-row">
        <SeasonTally results={results} upTo={pb.revealed} />
        {gap && (
          <span className="chip info pb-gap" data-testid="playback-gap">
            {gap}
          </span>
        )}
        {moment && pb.revealed > 0 && (
          <span key={`m${pb.revealed}`} className={`moment ${moment}`} data-testid="playback-moment" data-moment={moment} role="status">
            {moment === 'top' ? 'Top of the league!' : moment === 'top4' ? 'Into the top four' : moment === 'perfect' ? `${chase.won}-0 and counting` : perfectOverLabel(chase.perfectRun)}
          </span>
        )}
      </div>
      <div className="pb-tabs segmented" role="tablist" aria-label="Season views">
        {(['list', 'table', 'chart'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} data-testid={`pb-tab-${t}`}>
            {t === 'list' ? 'Games' : t === 'table' ? 'Table' : janOpen ? 'January' : 'Chart'}
          </button>
        ))}
      </div>
      <div className="fit-grid c3 pb-grid" data-tab={tab}>
        <div className="fit-cell" data-pane="list">
          <GameByGame results={results} opponent={opponent} replay={pb} compact strip={false} order="newest" total={total} title="Game by game" onHighlights={watch} />
        </div>
        <div className="panel fit-cell" data-pane="table">
          <div className="panel-head">
            <h3>Live table</h3>
            <span className="small muted">{pb.revealed ? `After game ${pb.revealed}` : 'Before kick-off'}</span>
          </div>
          {table.length ? <LiveTable table={table} before={before} userId={USER_TEAM} teamName={s.teamName} nameOf={(id) => clubName(u, id)} /> : <p className="small muted">This season was saved before the live table: the game list has every result.</p>}
        </div>
        <div className="fit-cell fit-col" data-pane="chart">
          {j && pb.done && <JanuaryWindow key={j.listings.map((l) => l.playerSeasonId).join()} game={game} u={u} j={j} />}
          <PositionChart series={series} rivals={rivals} teams={teams} games={total} />
          {benchOn && <BenchPanel game={game} u={u} results={results} revealed={pb.revealed} onChoose={pb.pause} />}
        </div>
      </div>
      {hlWeek !== null && <HighlightsModal game={game} u={u} matchweek={hlWeek} onClose={() => setHlWeek(null)} />}
    </div>
  )
}

/**
 * The bench during the playback: the XI for the next game on the pitch (injured starters shown with their cover), the
 * bench with who is out, and the changes left. Choosing a bench player pauses the playback; tapping the starter he
 * replaces makes the change from the next game on. The store decides whether a change is allowed.
 */
function BenchPanel({ game, u, results, revealed, onChoose }: { game: Game; u: LoadedUniverse; results: QuickGameResult[]; revealed: number; onChoose: () => void }) {
  const { benchChange } = useStore()
  const [inId, setInId] = useState<string | null>(null)
  const get = playerLookup(game, u)
  const hide = ratingsHidden(game.settings.rules)
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
  return (
    <div className="panel col" data-testid="bench-panel">
      <div className="panel-head">
        <h3>{view.next === null ? 'The XI and the bench' : `For matchweek ${view.next}`}</h3>
        <span className={`chip ${view.changesLeft ? '' : 'warn'}`} data-testid="changes-left">
          {view.changesLeft} of {QUICK_CHANGES} changes left
        </span>
      </div>
      <div className="grid two bench-grid">
        <div className={choosing ? '' : 'pitch-mini'} {...(choosing ? {} : { inert: true })}>
          <Pitch formation={formation} lineup={fielded} getPlayer={get} hideRatings={hide} eligibleSlots={targets} onSlotClick={choosing ? (slotId) => { benchChange(revealed, slotId, inId!); setInId(null) } : undefined} />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <b className="small">Bench</b>
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
                  extra={out ? <span className="chip bad">injured</span> : covering ? <span className="chip warn">covers {nameOf(covering.outId)}</span> : null}
                  right={!problem && !out ? <span className="btn sm" data-testid="bench-bring-on">{inId === id ? 'Choose' : 'Bring on'}</span> : null}
                />
              )
            })}
          </div>
          {view.out.filter((id) => !view.bench.includes(id)).map((id) => {
            const c = view.covers.find((x) => x.outId === id)
            return (
              <div key={id} className="small row" style={{ gap: 6 }} data-testid="bench-injury">
                <Bandage size={14} aria-hidden="true" /> {nameOf(id)} is out{c ? `: ${nameOf(c.inId)} covers` : ', nobody on the bench to cover'}
              </div>
            )
          })}
          <span className="help" data-testid="bench-help">
            {choosing ? (targets.length ? `Tap the starter ${nameOf(inId!)} replaces, from matchweek ${view.next} on.` : `${nameOf(inId!)} cannot play any slot in this shape.`) : problem ? (view.next === null ? `${used} change${used === 1 ? '' : 's'} made.` : problem + '.') : 'Bring a bench player on between games: the change sticks until you change it again. Injured starters are covered from the bench without using a change.'}
          </span>
          {(game.quickChanges ?? []).filter((c) => view.next === null || c.from <= view.next).map((c, i) => (
            <span key={i} className="small muted">
              Change {i + 1}: {nameOf(c.inId)} on from matchweek {c.from}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The January window at the halfway mark, as 38-0 stops the season: first a "Halfway there" panel (won-drawn-lost,
 * points and goal difference, one line on the pace) with "Enter the transfer market" and "Stick with your XI"; the
 * market then shows the budget and three to five deals, one of which can be done, or the XI kept after all. The
 * second-half tactics fold sits under both. The store decides the deal.
 */
function JanuaryWindow({ game, u, j }: { game: Game; u: LoadedUniverse; j: QuickJanuary }) {
  const { closeJanuary, setTactics, setCaptain } = useStore()
  const [market, setMarket] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [tactics, setShowTactics] = useState(false)
  const get = playerLookup(game, u)
  const hide = ratingsHidden(game.settings.rules)
  const formation = getFormation(game.tactics.formationId)
  const slotOf = (slotId: string) => formation.slots.find((x) => x.id === slotId)
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  const pick = chosen === null ? null : j.listings[chosen]
  const totalGames = quickSeasonGames(u, game.settings)
  const t = foldResults(j.firstHalf)
  const teams = totalGames / 2 + 1
  const boxes: Array<{ key: string; label: string; value: string }> = [
    { key: 'wdl', label: 'W-D-L', value: `${t.won}-${t.drawn}-${t.lost}` },
    { key: 'pts', label: 'Points', value: String(t.points) },
    { key: 'gd', label: 'GD', value: goalDifferenceLabel(t.goalsFor, t.goalsAgainst) },
  ]
  return (
    <div className="panel col january-panel" data-testid="january-window">
      <div className="sc-head">
        <span className="sc-kicker">January transfer window</span>
        <h2>{market ? 'The transfer market' : 'Halfway there'}</h2>
      </div>
      {!market ? (
        <>
          <div className="jw-boxes" data-testid="january-halfway">
            {boxes.map((b) => (
              <div key={b.key} className={`tally-box ${b.key}`} data-testid={`january-${b.key}`}>
                <span className="tally-num">{b.value}</span>
                <span className="tally-label">{b.label}</span>
              </div>
            ))}
          </div>
          <p className="jw-pace" data-testid="january-pace">
            {paceLine(t, totalGames, teams)}
          </p>
          <div className="jw-choice">
            <button className="btn primary big" onClick={() => setMarket(true)} data-testid="january-enter">
              Enter the transfer market
            </button>
            <button className="btn big" onClick={() => closeJanuary(null)} data-testid="january-stick">
              Stick with your XI
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row between wrap" style={{ gap: 8 }}>
            <p className="help" style={{ margin: 0 }}>
              {ordinal(j.position)} after {j.firstHalf.length} games. The board backs one deal: sign a player with the budget or swap one of your XI for him. It can help or hurt, and there is no undo.
            </p>
            <span className="chip">Budget {money(j.budget)}</span>
          </div>
          {j.listings.length === 0 && <div className="notice">Nobody fits this wheel's rules this January.</div>}
          <div className="col" style={{ gap: 6 }}>
            {j.listings.map((l, i) => {
              const incoming = get(l.playerSeasonId)
              const out = get(l.outId)
              const slot = slotOf(l.slotId)
              if (!incoming || !out || !slot) return null
              const gain = Math.round(ratingAt(incoming, slot.position) - ratingAt(out, slot.position))
              return (
                <div key={`${l.playerSeasonId}-${l.slotId}`} className={`jw-deal ${chosen === i ? 'selected' : ''}`} data-testid="january-listing">
                  <PlayerRow p={incoming} showClub hideRatings={hide} selected={chosen === i} onClick={() => setChosen(chosen === i ? null : i)} right={<span className={`chip ${l.kind === 'sign' ? '' : 'gold'}`}>{l.kind === 'sign' ? money(l.fee) : 'Swap'}</span>} />
                  <div className="small muted jw-out">
                    <Pos p={slot.position} /> {l.kind === 'sign' ? 'Replaces' : 'In exchange for'} {out.name}
                    {!hide && ` · ${gain >= 0 ? '+' : ''}${gain} in that slot`}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn primary" disabled={!pick} onClick={() => chosen !== null && closeJanuary(chosen)} data-testid="january-deal">
              {pick ? (pick.kind === 'sign' ? `Sign ${get(pick.playerSeasonId)?.name ?? ''} and play on` : `Do the swap and play on`) : 'Choose a deal'}
            </button>
            <button className="btn" onClick={() => closeJanuary(null)} data-testid="january-pass">
              Stick with your XI
            </button>
            <button className="btn ghost" onClick={() => setMarket(false)} data-testid="january-back">
              Back
            </button>
          </div>
        </>
      )}
      <button type="button" className="fold-head" onClick={() => setShowTactics(!tactics)} aria-expanded={tactics} data-testid="january-tactics-toggle">
        <b>Second-half tactics</b>
        <span className="small muted">{tactics ? 'Hide ▴' : 'Change ▾'}</span>
      </button>
      {tactics && (
        <div className="col">
          <TeamInstructions t={game.tactics} onChange={setTactics} />
          <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={game.tactics.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...game.tactics.setPieces, penalties: id } })} hideRatings={hide} />
        </div>
      )}
    </div>
  )
}
