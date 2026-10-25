/**
 * The paused match at one of its two stops, in place of the widget row: at
 * half time a talk, instructions and up to three substitutions; at 70 a shout,
 * instructions and the rest of the five. Moved from the old match screen with
 * its texts and test ids.
 */
import { useState } from 'react'
import { useStore } from '@game/store'
import { playerLookup, isAvailable } from '@game/logic/players'
import { currentScore, onPitch, SHOUTS, type LiveChanges, type Shout, type TeamTalk } from '@engine/match'
import type { Tactics } from '@engine/types'
import { LINE_HELP, MENTALITY_HELP, PRESSING_HELP, TEMPO_HELP } from '@engine/tactics'
import type { LiveMatch } from '@game/types'
import { Pos, Rating, Segmented } from '../components/bits'
import { draftChanges, type StopDraft } from './controls'
import { BallIcon, CardIcon } from './icons'

export function StopPanel({ live, onPlay, draft, setDraft }: { live: LiveMatch; onPlay: (changes: LiveChanges) => void; draft: StopDraft; setDraft: (d: StopDraft) => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [subbingOff, setSubbingOff] = useState<string | null>(null)
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
  const get = playerLookup(game, u)
  const side: 'home' | 'away' = live.userIsHome ? 'home' : 'away'
  const scoreNow = currentScore(mp)
  const us = live.userIsHome ? scoreNow.home : scoreNow.away
  const them = live.userIsHome ? scoreNow.away : scoreNow.home
  const t = tactics ?? game.tactics
  const pitch = onPitch(mp, side)
  /** Everyone who has been on the pitch for us, including the men already taken off: none can come back on. */
  const appeared = live.userIsHome ? mp.hLive : mp.aLive
  const made = (live.userIsHome ? mp.hSubs : mp.aSubs).length
  // Three changes at the break; whatever is left of the five at 70
  const subCap = atBreak ? Math.min(3, 5 - made) : 5 - made
  const subbedOn = new Set(subs.map((s) => s.on))
  const subbedOff = new Set(subs.map((s) => s.off))
  const benchOptions = game.bench.filter((id) => !appeared.some((p) => p.psId === id) && !subbedOn.has(id) && isAvailable(game.squad[id]))
  const play = () => onPlay(draftChanges(draft, atBreak ? 45 : 70))
  const stateLabel = us > them ? `ahead ${us}-${them}` : us < them ? `behind ${us}-${them}` : `level ${us}-${them}`
  return (
    <div className="panel md-stop" data-testid={atBreak ? 'half-time-panel' : 'late-panel'}>
      <div className="panel-head">
        <h2>
          {atBreak ? 'Half time' : '70 minutes'}: {stateLabel}
        </h2>
        <span className="small muted">{atBreak ? 'Make your changes, then play on to the 70th minute.' : 'Twenty minutes left. A shout, a change or two, then play to the whistle.'}</span>
        <div className="md-stop-actions">
          <button className="btn primary big" onClick={play} data-testid="play-on">
            {atBreak ? 'Play on to 70 minutes' : 'Play to the whistle'}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setDraft({ ...draft, tactics: null, subs: [] })
              onPlay(atBreak ? { talk: 'none' } : {})
            }}
            data-testid="no-changes"
          >
            No changes
          </button>
        </div>
      </div>
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
        <div className="col">
          <div className="row between">
            <span style={{ fontWeight: 600 }}>
              Substitutions ({subs.length}/{subCap}
              {atBreak ? ' at the break' : ' left'})
            </span>
            {subbingOff && (
              <button className="btn sm" onClick={() => setSubbingOff(null)}>
                Cancel
              </button>
            )}
          </div>
          {subbingOff ? (
            <div className="plist">
              <div className="small muted">Bring on for {get(subbingOff)?.name}:</div>
              {benchOptions.map((id) => {
                const p = get(id)
                if (!p) return null
                return (
                  <button
                    key={id}
                    className="prow"
                    onClick={() => {
                      setSubs([...subs, { off: subbingOff, on: id }])
                      setSubbingOff(null)
                    }}
                  >
                    <Rating value={p.overall} />
                    <span className="name">
                      {p.name}{' '}
                      {p.positions.map((x) => (
                        <Pos key={x} p={x} />
                      ))}
                      <span className="muted small">condition {game.squad[id]?.condition}</span>
                    </span>
                    <span className="btn sm primary">On</span>
                  </button>
                )
              })}
              {benchOptions.length === 0 && <div className="muted small">Nobody available on the bench.</div>}
            </div>
          ) : (
            <div className="plist">
              {pitch
                .filter((p) => !subbedOff.has(p.psId))
                .map((p) => {
                  const ps = get(p.psId)
                  const sub = subs.find((s) => s.on === p.psId)
                  return (
                    <div key={p.psId} className="prow" style={{ cursor: 'default' }}>
                      {ps ? <Rating value={ps.overall} /> : <span />}
                      <span className="name">
                        <Pos p={p.position} /> {ps?.name}
                        {p.yellow && <CardIcon />}
                        {p.goals > 0 && (
                          <span className="md-goals">
                            <BallIcon />
                            {p.goals > 1 ? p.goals : ''}
                          </span>
                        )}
                        {p.onAt > 0 && !sub && <span className="chip">on {p.onAt}'</span>}
                        {sub && <span className="chip good">on at {clock}'</span>}
                        <span className="muted small">cond {game.squad[p.psId]?.condition ?? '–'}</span>
                      </span>
                      {subs.length < subCap && !sub && (
                        <button className="btn sm" onClick={() => setSubbingOff(p.psId)}>
                          Off
                        </button>
                      )}
                    </div>
                  )
                })}
              {subs.map((s) => (
                <div key={s.on} className="small muted">
                  {get(s.on)?.name} replaces {get(s.off)?.name}{' '}
                  <button className="btn sm ghost" onClick={() => setSubs(subs.filter((x) => x !== s))}>
                    undo
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
