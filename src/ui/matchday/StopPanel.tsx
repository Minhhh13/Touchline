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
import { lineHelp, mentalityHelp, pressingHelp, shoutHint, shoutLabel, tempoHelp } from './tacticText'
import type { LiveMatch } from '@game/types'
import { Segmented, Tip } from '../components/bits'
import { DecisionSheet } from '../components/DecisionSheet'
import { draftChanges, stopSubCap, type StopDraft, type Sub } from './controls'
import { SubBoard } from './drawers/SubBoard'
import { boardRoom } from './subBoard'
import type { SideView } from './types'
import type { ManagerHand } from './useManagerHand'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'
import { B, rich } from '../i18n/rich'

const tx = translator(match)

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
  const stateLabel = tx(us > them ? 'stateAhead' : us < them ? 'stateBehind' : 'stateLevel', { score: `${us}-${them}` })
  const stopName = tx(atBreak ? 'stopHalfTime' : 'stop70')
  if (!open)
    return (
      <button className="btn primary decisions-pill" onClick={() => setOpen(true)} data-testid="decisions-pill">
        {tx('decisionsPill', { stop: stopName })}
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
        title={tx('subsAt', { stop: stopName })}
        subtitle={tx(atBreak ? 'boardSubBreak' : 'boardSubLate', { n: subs.length + queue.length, cap: subCap })}
        onMinimise={minimise}
        testId={atBreak ? 'half-time-panel' : 'late-panel'}
        actions={
          <>
            <button className="btn primary" onClick={confirm} disabled={queue.length === 0} data-testid="sub-confirm">
              {tx('makeChanges', { n: queue.length })}
            </button>
            <button
              className="btn"
              onClick={() => {
                sheetFocus.current = 'back'
                closeBoard()
              }}
              data-testid="stop-board-back"
            >
              {tx('back')}
            </button>
          </>
        }
      >
        <div className="md-stop-board">
          <SubBoard hand={hand} view={board.view} get={board.get} squad={board.squad} condition={board.condition} selected={null} queue={queue} setQueue={setQueue} room={room} disabled={!hand.editable} hideRatings={board.hideRatings} />
          {room <= 0 && queue.length === 0 && <p className="small muted">{tx('noMoreChangesDot')}</p>}
        </div>
      </DecisionSheet>
    )
  }
  return (
    <DecisionSheet
      open
      title={tx(atBreak ? 'titleHalfTime' : 'title70', { state: stateLabel })}
      subtitle={tx(atBreak ? 'subtitleHalfTime' : 'subtitle70')}
      onMinimise={minimise}
      testId={atBreak ? 'half-time-panel' : 'late-panel'}
      actions={
        <>
          <button className="btn primary" onClick={play} data-testid="play-on" data-autofocus title={tx('playOnTip')}>
            {tx(atBreak ? 'playOn70' : 'playToWhistle')}
          </button>
          <button
            className="btn"
            onClick={() => {
              setDraft({ ...draft, tactics: null, subs: [] })
              onPlay(atBreak ? { talk: 'none' } : {})
            }}
            data-testid="no-changes"
            title={tx(atBreak ? 'noChangesTipBreak' : 'noChangesTip')}
          >
            {tx('noChanges')}
          </button>
          <button className="btn" onClick={actions.onAssistant} data-testid="assistant-decide" title={tx('assistantTip')}>
            {tx('assistantDecide')}
          </button>
          <button className="btn" onClick={() => actions.onFinish(changes)} data-testid="finish-match" title={tx('finishTip')}>
            {tx('finishMatch')}
          </button>
          <button className="btn ghost" onClick={() => actions.onFullSim(changes)} data-testid="full-sim" title={tx('fullSimTip')}>
            {tx('fullSim')}
          </button>
        </>
      }
    >
      {atBreak && <Tip id="halftime-first">{tx('halftimeTip')}</Tip>}
      <div className="md-stop-grid">
        <div className="col">
          {atBreak ? (
            <div className="field">
              {tx('teamTalk')}
              <Segmented<TeamTalk>
                label={tx('teamTalk')}
                value={talk}
                onChange={setTalk}
                options={[
                  { value: 'calm', label: tx('talkCalm'), hint: tx('talkCalmHint') },
                  { value: 'encourage', label: tx('talkEncourage'), hint: tx('talkEncourageHint') },
                  { value: 'demand', label: tx('talkDemand'), hint: tx('talkDemandHint') },
                  { value: 'fire-up', label: tx('talkFireUp'), hint: tx('talkFireUpHint') },
                ]}
              />
            </div>
          ) : (
            <div className="field" data-testid="shout">
              {tx('touchlineShout')} <span className="help">{shoutHint(shout)}</span>
              <Segmented<Shout> label={tx('touchlineShout')} value={shout} onChange={setShout} options={(Object.keys(SHOUTS) as Shout[]).map((k) => ({ value: k, label: shoutLabel(k), hint: shoutHint(k) }))} />
            </div>
          )}
          <div className="field">
            {tx('mentality')} <span className="help">{mentalityHelp(t.mentality)}</span>
            <Segmented label={tx('mentality')} value={t.mentality} onChange={(v) => setTactics({ ...t, mentality: v })} options={[{ value: 'defensive', label: tx('defensive') }, { value: 'balanced', label: tx('balanced') }, { value: 'attacking', label: tx('attacking') }]} />
          </div>
        </div>
        <div className="col">
          <div className="field">
            {tx('pressing')} <span className="help">{pressingHelp(t.pressing)}</span>
            <Segmented label={tx('pressing')} value={t.pressing} onChange={(v) => setTactics({ ...t, pressing: v })} options={[{ value: 'low', label: tx('low') }, { value: 'mid', label: tx('mid') }, { value: 'high', label: tx('high') }]} />
          </div>
          <div className="field">
            {tx('defensiveLine')} <span className="help">{lineHelp(t.defensiveLine)}</span>
            <Segmented label={tx('defensiveLine')} value={t.defensiveLine} onChange={(v) => setTactics({ ...t, defensiveLine: v })} options={[{ value: 'deep', label: tx('deep') }, { value: 'standard', label: tx('standard') }, { value: 'high', label: tx('high') }]} />
          </div>
          <div className="field">
            {tx('tempo')} <span className="help">{tempoHelp(t.tempo)}</span>
            <Segmented label={tx('tempo')} value={t.tempo} onChange={(v) => setTactics({ ...t, tempo: v })} options={[{ value: 'slow', label: tx('slow') }, { value: 'standard', label: tx('standard') }, { value: 'fast', label: tx('fast') }]} />
          </div>
        </div>
        <div className="col md-stop-subs">
          <div className="row between">
            <span style={{ fontWeight: 600 }}>
              {/* How many more this stop takes: "0/2 left" read as none left */}
              {tx(atBreak ? 'subsCountBreak' : 'subsCountLeft', { n: subCap - subs.length })}
            </span>
          </div>
          <div className="plist">
            {subs.map((s) => (
              <div key={s.on} className="small" data-testid="stop-sub">
                {rich(tx('subOnFor', { on: get(s.on)?.name, off: get(s.off)?.name }), B)}{' '}
                <button className="btn sm ghost" onClick={() => setSubs(subs.filter((x) => x !== s))} data-testid="stop-sub-undo">
                  {tx('undo')}
                </button>
              </div>
            ))}
            {subs.length === 0 && <div className="small muted">{tx(atBreak ? 'noChangesYetBreak' : 'noChangesYet')}</div>}
          </div>
          <button className="btn sm primary" onClick={openBoard} disabled={subs.length >= subCap} data-testid="stop-make-change">
            {tx(subs.length >= subCap ? 'noMoreChanges' : 'makeChange')}
          </button>
        </div>
      </div>
    </DecisionSheet>
  )
}
