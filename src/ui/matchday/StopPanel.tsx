/**
 * The paused match at one of its two stops, as a pop-up centred over the
 * dashboard (phone included): at half time a talk, instructions and up to
 * three substitutions; at 70 a shout, instructions and the rest of the five.
 * Play on with the changes, No changes, the assistant's calls, Finish the
 * match (these changes, then the assistant takes any later stop) or Full sim
 * (these changes, then straight to the report). Minimised, it waits as a
 * "Decisions" pill; the match stays paused until a choice is made.
 *
 * "Make a change" turns the pop-up into the substitution board (the top bar's
 * own `SubBoard`): drag, tap or key a substitute onto a starter, then "Make
 * changes" sends the staged list through the hand's `submit` into the stop's
 * pending changes, exactly as the top bar's substitutions sheet does, and the
 * pop-up comes back with them listed (each with Undo).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@game/store'
import { currentScore, SHOUTS, type LiveChanges, type Shout, type TeamTalk } from '@engine/match'
import type { PlayerSeason, SquadPlayer, Tactics } from '@engine/types'
import { LINE_HELP, MENTALITY_HELP, PRESSING_HELP, TEMPO_HELP } from '@engine/tactics'
import type { LiveMatch } from '@game/types'
import { Segmented, Tip } from '../components/bits'
import { DecisionSheet } from '../components/DecisionSheet'
import { draftChanges, stopSubCap, type StopDraft, type Sub } from './controls'
import { SubBoard } from './drawers/SubBoard'
import { boardRoom } from './subBoard'
import type { SideView } from './types'
import type { ManagerHand } from './useManagerHand'

export interface StopActions {
  /** Play on to the next stop (or the whistle) with these changes. */
  onPlay: (changes: LiveChanges) => void
  /** The assistant's talk or shout and changes for this stop. */
  onAssistant: () => void
  /** These changes now; the assistant takes any later stop and the match plays to the whistle. */
  onFinish: (changes: LiveChanges) => void
  /** These changes now, then straight to full time and the report. */
  onFullSim: (changes: LiveChanges) => void
}

/** What the substitution board needs, the same as the top bar's substitutions sheet. */
export interface StopBoardProps {
  hand: ManagerHand
  view: SideView
  get: (id: string) => PlayerSeason | undefined
  squad: Record<string, SquadPlayer>
  condition: (psId: string) => number | null
  hideRatings: boolean
}

export function StopPanel({ live, actions, draft, setDraft, board }: { live: LiveMatch; actions: StopActions; draft: StopDraft; setDraft: (d: StopDraft) => void; board: StopBoardProps }) {
  const store = useStore()
  const { universe: u, game } = store
  const [open, setOpen] = useState(true)
  // The board in the pop-up, and what it has staged (sent to the stop's pending changes on "Make changes")
  const [boarding, setBoarding] = useState(false)
  const [queue, setQueue] = useState<Sub[]>([])
  const boardingRef = useRef(false)
  boardingRef.current = boarding
  const closeBoard = useCallback(() => {
    setBoarding(false)
    setQueue([])
  }, [])
  // Escape or the close button: back from the board to the pop-up first, then minimise (one stable callback, so the sheet keeps its focus)
  const minimise = useCallback(() => (boardingRef.current ? closeBoard() : setOpen(false)), [closeBoard])
  const sheetFocus = useRef<'board' | 'back' | null>(null)
  useEffect(() => {
    const want = sheetFocus.current
    if (!want) return
    sheetFocus.current = null
    const el = want === 'board' ? document.querySelector<HTMLElement>('[data-testid="sub-board"] .sub-bench-card:not([disabled])') : document.querySelector<HTMLElement>('[data-testid="stop-make-change"]:not([disabled])') ?? document.querySelector<HTMLElement>('[data-testid="play-on"]')
    el?.focus({ preventScroll: true })
  }, [boarding])
  const { onPlay } = actions
  // The pending changes live in the dashboard, so the top bar's drawers edit the same ones
  const { talk, shout, tactics, subs } = draft
  const setTalk = (v: TeamTalk) => setDraft({ ...draft, talk: v })
  const setShout = (v: Shout) => setDraft({ ...draft, shout: v })
  const setTactics = (v: Tactics | null) => setDraft({ ...draft, tactics: v })
  const setSubs = (v: Array<{ off: string; on: string }>) => setDraft({ ...draft, subs: v })
  if (!u || !game) return null
  const mp = live.mp
  const clock = mp.clock ?? 45
  const atBreak = clock === 45
  const get = board.get
  const scoreNow = currentScore(mp)
  const us = live.userIsHome ? scoreNow.home : scoreNow.away
  const them = live.userIsHome ? scoreNow.away : scoreNow.home
  const t = tactics ?? game.tactics
  const made = (live.userIsHome ? mp.hSubs : mp.aSubs).length
  // Three changes at the break; whatever is left of the five at 70
  const subCap = stopSubCap(atBreak ? 45 : 70, made)
  const openBoard = () => {
    sheetFocus.current = 'board'
    setQueue([])
    setBoarding(true)
  }
  const changes = draftChanges(draft, atBreak ? 45 : 70)
  const play = () => onPlay(changes)
  const stateLabel = us > them ? `ahead ${us}-${them}` : us < them ? `behind ${us}-${them}` : `level ${us}-${them}`
  const stopName = atBreak ? 'half time' : '70 minutes'
  if (!open)
    return (
      <button className="btn primary decisions-pill" onClick={() => setOpen(true)} data-testid="decisions-pill">
        Decisions · {stopName}
      </button>
    )
  if (boarding) {
    const { hand } = board
    // The stop's room less what is already pending (the hand counts it), as the top bar's sheet does
    const room = boardRoom({ subCap: hand.subCap, landing: hand.landing.kind, windowsLeft: hand.windowsLeft, windowOpen: hand.windowOpen })
    const confirm = () => {
      if (!queue.length) return
      sheetFocus.current = 'back'
      if (hand.submit({ substitutions: queue })) closeBoard()
    }
    return (
      <DecisionSheet
        open
        title={`Substitutions at ${atBreak ? 'half time' : '70 minutes'}`}
        subtitle={`${subs.length + queue.length}/${subCap} changes · ${atBreak ? 'changes at the break spend no stoppage' : 'made together when you play on'}`}
        onMinimise={minimise}
        testId={atBreak ? 'half-time-panel' : 'late-panel'}
        actions={
          <>
            <button className="btn primary" onClick={confirm} disabled={queue.length === 0} data-testid="sub-confirm">
              {queue.length > 1 ? `Make ${queue.length} changes` : 'Make changes'}
            </button>
            <button
              className="btn"
              onClick={() => {
                sheetFocus.current = 'back'
                closeBoard()
              }}
              data-testid="stop-board-back"
            >
              Back
            </button>
          </>
        }
      >
        <div className="md-stop-board">
          <SubBoard hand={hand} view={board.view} get={board.get} squad={board.squad} condition={board.condition} selected={null} queue={queue} setQueue={setQueue} room={room} disabled={!hand.editable} hideRatings={board.hideRatings} />
          {room <= 0 && queue.length === 0 && <p className="small muted">No more changes at this stop.</p>}
        </div>
      </DecisionSheet>
    )
  }
  return (
    <DecisionSheet
      open
      title={`${atBreak ? 'Half time' : '70 minutes'}: ${stateLabel}`}
      subtitle={atBreak ? 'Make your changes, then play on to the 70th minute.' : 'Twenty minutes left. A shout, a change or two, then play to the whistle.'}
      onMinimise={minimise}
      testId={atBreak ? 'half-time-panel' : 'late-panel'}
      actions={
        <>
          <button className="btn primary" onClick={play} data-testid="play-on" data-autofocus title="Play on with the talk and changes chosen above">
            {atBreak ? 'Play on to 70 minutes' : 'Play to the whistle'}
          </button>
          <button
            className="btn"
            onClick={() => {
              setDraft({ ...draft, tactics: null, subs: [] })
              onPlay(atBreak ? { talk: 'none' } : {})
            }}
            data-testid="no-changes"
            title={atBreak ? 'Play on as you are: no team talk, no changes' : 'Play on as you are: no changes'}
          >
            No changes
          </button>
          <button className="btn" onClick={actions.onAssistant} data-testid="assistant-decide" title="The assistant's talk or shout and changes for this stop">
            Let the assistant decide
          </button>
          <button className="btn" onClick={() => actions.onFinish(changes)} data-testid="finish-match" title="Your changes now; the assistant takes any later call and the match plays to the whistle">
            Finish the match
          </button>
          <button className="btn ghost" onClick={() => actions.onFullSim(changes)} data-testid="full-sim" title="Your changes now, then straight to full time and the report">
            Full sim
          </button>
        </>
      }
    >
      {atBreak && <Tip id="halftime-first">A talk, four instructions and up to three substitutions; No changes plays on.</Tip>}
      <div className="md-stop-grid">
        <div className="col">
          {atBreak ? (
            <div className="field">
              Team talk
              <Segmented<TeamTalk>
                value={talk}
                onChange={setTalk}
                options={[
                  { value: 'calm', label: 'Calm', hint: 'Protects a lead' },
                  { value: 'encourage', label: 'Encourage', hint: 'Safe lift' },
                  { value: 'demand', label: 'Demand', hint: 'Sharpens a level game, risky when behind' },
                  { value: 'fire-up', label: 'Fire up', hint: 'Best when behind, risky when ahead' },
                ]}
              />
            </div>
          ) : (
            <div className="field" data-testid="shout">
              Touchline shout <span className="help">{SHOUTS[shout].hint}</span>
              <Segmented<Shout> value={shout} onChange={setShout} options={(Object.keys(SHOUTS) as Shout[]).map((k) => ({ value: k, label: SHOUTS[k].label, hint: SHOUTS[k].hint }))} />
            </div>
          )}
          <div className="field">
            Mentality <span className="help">{MENTALITY_HELP[t.mentality]}</span>
            <Segmented value={t.mentality} onChange={(v) => setTactics({ ...t, mentality: v })} options={[{ value: 'defensive', label: 'Defensive' }, { value: 'balanced', label: 'Balanced' }, { value: 'attacking', label: 'Attacking' }]} />
          </div>
        </div>
        <div className="col">
          <div className="field">
            Pressing <span className="help">{PRESSING_HELP[t.pressing]}</span>
            <Segmented value={t.pressing} onChange={(v) => setTactics({ ...t, pressing: v })} options={[{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }]} />
          </div>
          <div className="field">
            Defensive line <span className="help">{LINE_HELP[t.defensiveLine]}</span>
            <Segmented value={t.defensiveLine} onChange={(v) => setTactics({ ...t, defensiveLine: v })} options={[{ value: 'deep', label: 'Deep' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
          </div>
          <div className="field">
            Tempo <span className="help">{TEMPO_HELP[t.tempo]}</span>
            <Segmented value={t.tempo} onChange={(v) => setTactics({ ...t, tempo: v })} options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }]} />
          </div>
        </div>
        <div className="col md-stop-subs">
          <div className="row between">
            <span style={{ fontWeight: 600 }}>
              {/* How many more this stop takes: "0/2 left" read as none left */}
              Substitutions · {subCap - subs.length} left{atBreak ? ' at the break' : ''}
            </span>
          </div>
          <div className="plist">
            {subs.map((s) => (
              <div key={s.on} className="small" data-testid="stop-sub">
                <b>{get(s.on)?.name}</b> on for {get(s.off)?.name}{' '}
                <button className="btn sm ghost" onClick={() => setSubs(subs.filter((x) => x !== s))} data-testid="stop-sub-undo">
                  Undo
                </button>
              </div>
            ))}
            {subs.length === 0 && <div className="small muted">{atBreak ? 'No changes yet. Changes at the break spend no stoppage.' : 'No changes yet.'}</div>}
          </div>
          <button className="btn sm primary" onClick={openBoard} disabled={subs.length >= subCap} data-testid="stop-make-change">
            {subs.length >= subCap ? 'No more changes at this stop' : 'Make a change'}
          </button>
        </div>
      </div>
    </DecisionSheet>
  )
}
