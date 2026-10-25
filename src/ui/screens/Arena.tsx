import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '@game/store'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { clubIdOfKey } from '@engine/knockout'
import type { TeamTalk } from '@engine/match'
import type { Position } from '@engine/types'
import { arenaClubShortName, arenaStepInfo, isBigCup, nextArenaOpponent } from '@game/logic/arena'
import { cupRoundCount, cupRoundName } from '@engine/cup'
import { USER_TEAM } from '@engine/season'
import { TRAINING, TRAINING_LABEL, type TrainingFocus } from '@engine/training'
import { Bracket } from '../components/Bracket'
import { GAUNTLET_RUNGS, rungBandLabel, rungLabels } from '@engine/gauntlet'
import { GauntletLadder } from '../components/GauntletLadder'
import { arenaFormatLabel } from '@game/logic/modes'
import { ghostStepLine } from '@game/logic/arenaClaim'
import { playerLookup, squadPlayers } from '@game/logic/players'
import { lineupProblems, teamStrength } from '@game/logic/squad'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Info, Segmented, Stat, Tabs, TeamBadge } from '../components/bits'
import { OppositionReport } from './OppositionReport'
import { TacticsTab } from './Dugout'

type ArenaTab = 'team' | 'tactics' | 'draw'

const ORDER: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']

/**
 * The arena hub (phase `week` with `game.arena`): the next opponent, the
 * opposition report, the team sheet and tactics (and the Cup's draw), then
 * "Manage this one" (live, the two stops) or "Assistant plays it" ("Sim this
 * tie" in the Cup).
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
  const cup = isBigCup(a)
  const size = a.size ?? 2
  const seeded = cup && opp && a.bracket?.seeds.includes(opp.key)
  const rung = a.step + 1
  const billing = gauntlet && opp ? rungLabels(rung, opp.real).billing : undefined
  // A challenge's ghost: the challenger's result on this step, and on every rung or round
  const ghost = game.settings.challenge?.arena ? game.settings.challenge : undefined
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
    // One screen on a desktop (DESIGN_SYSTEM.md section 13): the head, then three boxes side by side that scroll inside
    // themselves: the opponent (and the ladder or the draw), the team sheet or tactics, the pitch with the calls and Play
    <div className="page fit arena-hub has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="fit-head">
        <div className="row" style={{ gap: 10 }}>
          <TeamBadge code={game.settings.shortName} size={40} />
          <div>
            <h1 style={{ fontSize: 26 }}>{game.settings.teamName}</h1>
            <div className="screen-meta" data-testid="arena-head">
              <span className="chip info">{arenaFormatLabel(game.settings.arena)}</span>
              <span className="chip">{info.label}</span>
              {gauntlet && <span className="chip">{a.step} of {GAUNTLET_RUNGS} climbed</span>}
            </div>
          </div>
        </div>
        <div className="stat-strip arena-stats">
          <Stat label="Team rating" value={strength.overall.toFixed(1)} sub={`balance ${Math.round(strength.balance * 100)}%`} />
          <Stat label="Squad" value={squad.length} sub={game.settings.difficulty} />
        </div>
      </div>

      <div className="fit-grid c3 arena-grid">
        <div className="fit-cell fit-col">
          {opp && (
            <div className="panel col" style={{ gap: 6 }} data-testid="arena-opponent">
              <div className="eyebrow">
                {gauntlet ? `Rung ${rung} · ${rungBandLabel(rung)}` : cup ? `${info.label} · round ${a.step + 1} of ${cupRoundCount(size)}${seeded ? ' · a seed' : ''}` : info.label}
                {info.neutral ? ' · neutral ground' : info.home ? ' · home' : ' · away'}
                {billing ? ` · ${billing}` : ''}
              </div>
              <div className="row between" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <ClubBadge clubId={clubIdOfKey(opp.key)} size={40} />
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{opp.club.name}</div>
                </div>
                {gauntlet && (
                  <button className="btn sm" onClick={changeDraw} disabled={a.lifelineUsed !== undefined} data-testid="arena-lifeline" title="Once a run: swap this rung's club for another from the same band">
                    {a.lifelineUsed !== undefined ? 'Lifeline used' : 'Change the draw'}
                  </button>
                )}
              </div>
              <div className="small muted" data-testid="arena-rating">
                {opp.offset > 0 ? `Plays at ${(opp.real - opp.offset).toFixed(1)} (real ${opp.real.toFixed(1)})` : `Plays at full strength, ${opp.real.toFixed(1)}`} · you {strength.overall.toFixed(1)}
              </div>
              {ghost && (
                <div className="small" style={{ color: 'var(--accent)' }} data-testid="ghost-here">
                  👻 {ghostStepLine(ghost, a.step)}
                </div>
              )}
            </div>
          )}
          {gauntlet && (
            <div className="panel col" style={{ gap: 8 }}>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <h3>The ladder</h3>
                <span className="small muted">{a.lifelineUsed ? `Lifeline used at rung ${a.lifelineUsed}` : 'Lifeline unused'}</span>
              </div>
              <GauntletLadder u={u} a={a} ghost={ghost} />
            </div>
          )}
          {opp && <OppositionReport clubId={opp.club.clubId} home={info.home} club={opp.club} aiOffset={opp.offset} neutral={info.neutral} />}
          {cup && a.bracket && (
            <div className="panel col" style={{ gap: 8 }} data-testid="arena-draw">
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <span className="head-title">
                  <h3>The draw · {size} clubs</h3>
                  <Info label="About the draw">Seeds kept apart in round one, four days between ties, the final on neutral ground.</Info>
                </span>
              </div>
              {ghost?.arena && (
                <div className="row wrap" style={{ gap: 6 }} data-testid="ghost-trail">
                  {Array.from({ length: cupRoundCount(size) }, (_, r) => (
                    <span key={r} className="chip" title={`${cupRoundName(size, r).name}: ${ghostStepLine(ghost, r)}`}>
                      {cupRoundName(size, r).code} 👻 {ghostStepLine(ghost, r)?.replace(`${ghost.name} `, '')}
                    </span>
                  ))}
                </div>
              )}
              <Bracket
                rounds={Array.from({ length: cupRoundCount(size) }, (_, r) => cupRoundName(size, r).name)}
                ties={a.bracket.rounds}
                nameOf={(k) => (k === USER_TEAM ? game.settings.teamName : arenaClubShortName(u, k))}
                badgeOf={(k) => (k === USER_TEAM ? game.settings.hostClubId : clubIdOfKey(k))}
                userId={USER_TEAM}
                seeds={a.bracket.seeds}
              />
            </div>
          )}
        </div>

        <div className="fit-cell fit-col">
          <Tabs<ArenaTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'team', label: 'Team sheet' },
              { id: 'tactics', label: 'Tactics' },
            ]}
          />
          {tab === 'team' && (
            <div className="panel">
              <div className="panel-head">
                <h3>Squad · {squad.length}</h3>
                <div className="row">
                  <span className="small muted">{selectedSlot ? `Pick a player for ${formation.slots.find((s) => s.id === selectedSlot)?.position}` : 'A slot on the pitch, then a player.'}</span>
                  <button className="btn sm" onClick={() => store.autoPick()} data-testid="arena-autopick">
                    Auto-pick
                  </button>
                </div>
              </div>
              <div className="plist lined">
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
                      right={slot ? <span className="chip info">{slot.position}</span> : <span className="chip">Bench</span>}
                    />
                  )
                })}
              </div>
            </div>
          )}
          {tab === 'tactics' && <TacticsTab />}
        </div>

        <div className="fit-cell fit-col">
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
            <div className="field">
              Team talk
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
            </div>
            {(gauntlet || cup) && (
              <label className="field" data-testid="arena-training">
                <span>
                  Training focus <Info label="About the training focus">{TRAINING[game.training].blurb} It shapes this match and the recovery before the next.</Info>
                </span>
                <select className="input" value={game.training} onChange={(e) => store.setTraining(e.target.value as TrainingFocus)} data-testid="arena-training-select">
                  {(Object.keys(TRAINING) as TrainingFocus[]).map((k) => (
                    <option key={k} value={k}>
                      {TRAINING_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
          <div className="panel col bottom-bar arena-actions" ref={barRef} data-testid="arena-actions">
            {problems.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{problems[0]}: the assistant fills the gap at kick-off.</div>}
            <div className="small muted">{opp ? `${info.label} v ${opp.club.name}.` : 'No opponent drawn.'}</div>
            <button className="btn primary big block" onClick={() => store.playArenaStep(true)} disabled={!opp} data-testid="arena-live" title="Manage it through half time, the 70th minute and any shoot-out">
              Manage this one
            </button>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn" onClick={() => store.playArenaStep(false)} disabled={!opp} data-testid="arena-sim" title="The assistant picks the side and plays the match, penalties included">
                {cup ? 'Sim this tie' : 'Assistant plays it'}
              </button>
              {(gauntlet || cup) && (
                <button className="btn ghost" onClick={() => store.simArenaToEnd()} disabled={!opp} data-testid="arena-sim-end" title={cup ? 'The assistant plays every tie left' : 'The assistant plays every rung left and drafts the bonus spins'}>
                  Sim to the end
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
