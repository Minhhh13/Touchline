import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '@game/store'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { clubIdOfKey } from '@engine/knockout'
import type { TeamTalk } from '@engine/match'
import type { Position } from '@engine/types'
import { arenaStepInfo, nextArenaOpponent } from '@game/logic/arena'
import { rungBandLabel, rungLabels } from '@engine/gauntlet'
import { GauntletLadder } from '../components/GauntletLadder'
import { arenaFormatLabel } from '@game/logic/modes'
import { playerLookup, squadPlayers } from '@game/logic/players'
import { lineupProblems, teamStrength } from '@game/logic/squad'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Segmented, Stat, Tabs } from '../components/bits'
import { clubName } from '../format'
import { OppositionReport } from './OppositionReport'
import { TacticsTab } from './Dugout'

type ArenaTab = 'team' | 'tactics'

const ORDER: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']

/**
 * The arena hub (phase `week` with `game.arena`): the next opponent, the
 * opposition report, the team sheet and tactics, then "Manage this one"
 * (live, the two stops) or "Assistant plays it".
 */
export function Arena() {
  const store = useStore()
  const { universe: u, game } = store
  const [tab, setTab] = useState<ArenaTab>('team')
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  // On a phone the action bar is fixed over the page, so the page's bottom padding follows the bar's measured height
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [game?.id])
  if (!u || !game?.arena) return null
  const a = game.arena
  const info = arenaStepInfo(a)
  const opp = nextArenaOpponent(game, u)
  const gauntlet = a.format === 'gauntlet'
  const rung = a.step + 1
  const billing = gauntlet && opp ? rungLabels(rung, opp.real).billing : undefined
  const changeDraw = () => {
    if (opp && confirm(`Change the draw? ${opp.club.name} makes way for another side from the same band. Once a run.`)) store.changeTheDraw()
  }
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const strength = teamStrength(game, u)
  const problems = lineupProblems(game, u)
  const inXI = new Set(Object.values(game.lineup))
  const squad = squadPlayers(game, u).sort((x, y) => (inXI.has(x.p.id) ? 0 : 1) - (inXI.has(y.p.id) ? 0 : 1) || ORDER.indexOf(x.p.positions[0]) - ORDER.indexOf(y.p.positions[0]) || y.p.overall - x.p.overall)
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)

  const onSlotClick = (slotId: string) => {
    if (selectedSlot === slotId) return setSelectedSlot(null)
    if (selectedSlot) {
      const x = game.lineup[selectedSlot]
      const y = game.lineup[slotId]
      if (x) store.assign(x, slotId)
      if (y && x) store.assign(y, selectedSlot)
      return setSelectedSlot(null)
    }
    setSelectedSlot(slotId)
  }
  const onPlayerClick = (id: string) => {
    if (!selectedSlot) return
    store.assign(id, selectedSlot)
    setSelectedSlot(null)
  }

  return (
    <div className="page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="panel row between wrap" style={{ marginBottom: 12 }}>
        <div className="row">
          <ClubBadge clubId={game.settings.hostClubId} size={46} />
          <div>
            <h2 style={{ fontSize: 26 }}>{game.settings.teamName}</h2>
            <div className="small muted" data-testid="arena-head">
              {arenaFormatLabel(game.settings.arena)} · {info.label} · in {clubName(u, game.settings.hostClubId)} colours
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 20 }}>
          <Stat label="Team rating" value={strength.overall.toFixed(1)} sub={`balance ${Math.round(strength.balance * 100)}%`} />
          <Stat label="Squad" value={squad.length} sub={game.settings.difficulty} />
        </div>
      </div>

      {gauntlet && (
        <div className="panel col" style={{ marginBottom: 12, gap: 8 }}>
          <div className="row between wrap">
            <h3>The ladder · {a.step} of 15 climbed</h3>
            <span className="small muted">{a.lifelineUsed ? `Lifeline used at rung ${a.lifelineUsed}` : 'Lifeline unused'}</span>
          </div>
          <GauntletLadder u={u} a={a} />
        </div>
      )}
      {opp && (
        <div className="panel row between wrap" style={{ marginBottom: 12, background: 'linear-gradient(135deg, var(--panel), var(--bg-3))' }} data-testid="arena-opponent">
          <div className="row">
            <ClubBadge clubId={clubIdOfKey(opp.key)} size={44} />
            <div>
              <div className="small muted">
                {gauntlet ? `Rung ${rung} · ${rungBandLabel(rung)}` : info.label}
                {info.neutral ? ' · neutral ground' : info.home ? ' · home' : ' · away'}
                {billing ? ` · ${billing}` : ''}
              </div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{opp.club.name}</div>
              <div className="small muted" data-testid="arena-rating">
                {opp.offset > 0 ? `Plays at ${(opp.real - opp.offset).toFixed(1)} (real ${opp.real.toFixed(1)})` : `Plays at full strength, ${opp.real.toFixed(1)}`} · you {strength.overall.toFixed(1)}
              </div>
            </div>
          </div>
          {gauntlet && (
            <button className="btn sm" onClick={changeDraw} disabled={a.lifelineUsed !== undefined} data-testid="arena-lifeline" title="Once a run: swap this rung's club for another from the same band">
              {a.lifelineUsed !== undefined ? 'Lifeline used' : 'Change the draw'}
            </button>
          )}
        </div>
      )}
      {opp && <OppositionReport clubId={opp.club.clubId} home={info.home} club={opp.club} aiOffset={opp.offset} neutral={info.neutral} />}

      <Tabs<ArenaTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'team', label: 'Team sheet' },
          { id: 'tactics', label: 'Tactics' },
        ]}
      />

      {tab === 'team' && (
        <div className="grid dugout">
          <div className="panel">
            <div className="panel-head">
              <h3>Squad · {squad.length}</h3>
              <div className="row">
                <span className="small muted">{selectedSlot ? `Pick a player for ${formation.slots.find((s) => s.id === selectedSlot)?.position}` : 'Click a slot on the pitch, then a player.'}</span>
                <button className="btn sm" onClick={() => store.autoPick()} data-testid="arena-autopick">
                  Auto-pick
                </button>
              </div>
            </div>
            <div className="plist">
              {squad.map(({ p, s }) => {
                const slot = formation.slots.find((sl) => game.lineup[sl.id] === p.id)
                return (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    state={s}
                    showClub
                    onClick={() => onPlayerClick(p.id)}
                    extra={game.captainId === p.id ? <span className="chip gold">©</span> : undefined}
                    right={slot ? <span className="chip good">{slot.position}</span> : <span className="chip">Bench</span>}
                  />
                )
              })}
            </div>
          </div>
          <div className="col">
            <div className="panel">
              <div className="panel-head">
                <h3>{formation.name}</h3>
                <span className="small muted">
                  GK {strength.goalkeeping.toFixed(0)} · DEF {strength.defence.toFixed(0)} · MID {strength.midfield.toFixed(0)} · ATT {strength.attack.toFixed(0)}
                </span>
              </div>
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} getState={(id) => game.squad[id]} onSlotClick={onSlotClick} selectedSlot={selectedSlot} showRoles={Object.fromEntries(formation.slots.map((s) => [s.id, getRole(game.tactics.roles[s.id] ?? DEFAULT_ROLE[s.position]).name]))} />
            </div>
            <div className="panel col">
              <h3>Team talk</h3>
              <Segmented<TeamTalk>
                value={game.teamTalk}
                onChange={store.setTeamTalk}
                options={[
                  { value: 'calm', label: 'Calm', hint: 'Settles nerves when the odds are against you' },
                  { value: 'encourage', label: 'Encourage', hint: 'Safe, small lift' },
                  { value: 'demand', label: 'Demand', hint: 'Keeps favourites honest, pressures underdogs' },
                  { value: 'fire-up', label: 'Fire up', hint: 'High variance' },
                ]}
              />
              <label className="field">
                Captain
                <select className="input" value={game.captainId ?? ''} onChange={(e) => store.setCaptain(e.target.value)} data-testid="arena-captain">
                  <option value="" disabled>
                    Choose a captain
                  </option>
                  {xi.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (composure {p.attributes.mentality})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}
      {tab === 'tactics' && <TacticsTab />}

      <div className="bottom-bar" ref={barRef} style={{ marginTop: 12 }}>
        {problems.length > 0 && <div className="small" style={{ color: 'var(--gold)', marginBottom: 6 }}>{problems[0]}: the assistant fills the gap at kick-off.</div>}
        <div className="small muted" style={{ marginBottom: 8 }}>
          {opp ? `${info.label} v ${opp.club.name}. Manage it through half time, the 70th minute and any shoot-out, or let the assistant pick the side and play it.` : 'No opponent drawn.'}
        </div>
        <div className="row wrap">
          <button className="btn primary big" onClick={() => store.playArenaStep(true)} disabled={!opp} data-testid="arena-live">
            Manage this one
          </button>
          <button className="btn" onClick={() => store.playArenaStep(false)} disabled={!opp} data-testid="arena-sim" title="The assistant picks the side and plays the match, penalties included">
            Assistant plays it
          </button>
          {gauntlet && (
            <button className="btn ghost" onClick={() => store.simArenaToEnd()} disabled={!opp} data-testid="arena-sim-end" title="The assistant plays every rung left and drafts the bonus spins">
              Sim to the end
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
