import { useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { computeTable, positionOf, roundsFor, USER_TEAM, type Competition } from '@engine/season'
import { getFormation, FORMATIONS } from '@engine/formations'
import { rolesFor, getRole, DEFAULT_ROLE } from '@engine/roles'
import { LINE_HELP, MENTALITY_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP, STYLE_LABEL } from '@engine/tactics'
import { TRAINING, TRAINING_LABEL, type TrainingFocus } from '@engine/training'
import { nextOpponent, upcomingCupTie } from '@game/logic/week'
import { isAvailable, playerLookup, squadPlayers } from '@game/logic/players'
import { canCover, ratingAt } from '@engine/positions'
import { teamStrength, lineupProblems } from '@game/logic/squad'
import { SQUAD_CAP } from '@game/logic/marketOps'
import { TALK_LABEL, type TalkKind } from '@game/logic/talks'
import { STAFF, STAFF_ROLES, staffTier, staffWages, traitTags } from '@engine/staff'
import { evaluateObjective, OBJECTIVE_REWARD } from '@engine/objectives'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { TableView } from '../components/TableView'
import { Bar, ClubBadge, Modal, Rating, Segmented, Stat, Tabs, Pos } from '../components/bits'
import { clubName, clubShort, conditionColour, money, moraleWord, ordinal, seasonLabel, wage } from '../format'
import type { Position, TableRow } from '@engine/types'
import type { TeamTalk } from '@engine/match'
import { StatsTab } from './StatsTab'
import { OppositionReport } from './OppositionReport'

type Tab = 'squad' | 'tactics' | 'fixtures' | 'table' | 'cup' | 'europe' | 'stats' | 'market' | 'inbox' | 'club'

export function Dugout() {
  const store = useStore()
  const { universe: u, game } = store
  const [tab, setTab] = useState<Tab>('squad')
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [playerModal, setPlayerModal] = useState<string | null>(null)
  if (!u || !game || !game.season) return null
  const season = game.season
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const table = useMemo(() => computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)]), [season.fixtures, season.ai])
  const pos = positionOf(table, USER_TEAM)
  const row = table.find((r) => r.teamId === USER_TEAM)!
  const next = nextOpponent(game)
  const cupTie = upcomingCupTie(game)
  const strength = teamStrength(game, u)
  const problems = lineupProblems(game, u)
  const squad = squadPlayers(game, u)
  const preseason = game.phase === 'preseason'
  const done = season.matchweek >= season.matchweeks || season.sacked
  const openOffers = game.window?.offers.filter((o) => o.status === 'open').length ?? 0

  const onSlotClick = (slotId: string) => {
    if (selectedSlot === slotId) {
      setSelectedSlot(null)
      return
    }
    if (selectedSlot) {
      // swap two slots
      const a = game.lineup[selectedSlot]
      const b = game.lineup[slotId]
      if (a) store.assign(a, slotId)
      if (b && a) store.assign(b, selectedSlot)
      setSelectedSlot(null)
      return
    }
    setSelectedSlot(slotId)
  }
  const onPlayerClick = (id: string) => {
    if (selectedSlot) {
      store.assign(id, selectedSlot)
      setSelectedSlot(null)
    } else setPlayerModal(id)
  }

  const inXI = new Set(Object.values(game.lineup))
  const sortedSquad = [...squad].sort((a, b) => {
    const ai = inXI.has(a.p.id) ? 0 : 1
    const bi = inXI.has(b.p.id) ? 0 : 1
    if (ai !== bi) return ai - bi
    const order: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']
    return order.indexOf(a.p.positions[0]) - order.indexOf(b.p.positions[0]) || b.p.overall - a.p.overall
  })

  return (
    <div className="page">
      {/* Header */}
      <div className="panel row between wrap" style={{ marginBottom: 12 }}>
        <div className="row">
          <ClubBadge clubId={season.hostClubId} size={46} />
          <div>
            <h2 style={{ fontSize: 26 }}>{game.settings.teamName}</h2>
            <div className="small muted">
              as {clubName(u, season.hostClubId)} · {seasonLabel(season.leagueSeason)} · {game.settings.mode === 'dynasty' ? `Year ${game.year} · ` : ''}
              {preseason ? 'Pre-season' : `Matchweek ${season.matchweek} of ${season.matchweeks}`}
            </div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 20 }}>
          <Stat label="Position" value={season.matchweek ? ordinal(pos) : '–'} sub={`${row.points} pts · ${row.won}-${row.drawn}-${row.lost}`} />
          <Stat label="Team rating" value={strength.overall.toFixed(1)} sub={`balance ${Math.round(strength.balance * 100)}%`} />
          <Stat label="Budget" value={money(game.finances.budget)} sub={`wages ${wage(squad.reduce((s, x) => s + x.p.wage, 0))}`} />
          <div className="stat" style={{ minWidth: 150 }}>
            <span className="label">Board confidence</span>
            <div className="conf">
              <Bar value={season.confidence} colour={season.confidence > 60 ? 'var(--accent)' : season.confidence > 30 ? 'var(--gold)' : 'var(--danger)'} thick />
              <span className="small">{Math.round(season.confidence)}</span>
            </div>
            <span className="small muted">target {ordinal(season.boardTarget)}</span>
          </div>
        </div>
      </div>

      {/* Next match CTA */}
      {!done && (
        <div className="panel row between wrap sticky-cta" style={{ marginBottom: 12, background: 'linear-gradient(135deg, var(--panel), var(--bg-3))' }}>
          <div className="row wrap">
            {preseason ? (
              <div>
                <div style={{ fontWeight: 700 }}>Pre-season · {game.friendliesPlayed}/3 friendlies played</div>
                <div className="small muted">Friendlies build sharpness and tactical familiarity, with a small injury risk. Then kick off the league.</div>
              </div>
            ) : next ? (
              <div className="row">
                <ClubBadge clubId={next.clubId} size={40} />
                <div>
                  <div style={{ fontWeight: 700 }}>
                    Matchweek {season.matchweek + 1}: {next.home ? 'v' : 'at'} {clubName(u, next.clubId)} ({next.home ? 'H' : 'A'})
                  </div>
                  <div className="small muted">
                    {STYLE_LABEL[u.clubById[next.clubId]?.style ?? 'balanced']} side · {ordinal(positionOf(table, next.clubId))} · {u.clubById[season.hostClubId]?.rivals.includes(next.clubId) ? '🔥 Derby · ' : ''}
                    {cupTie ? `then ${cupTie.label} ${cupTie.tie.homeTeamId === USER_TEAM ? 'v' : 'at'} ${clubShort(u, cupTie.tie.homeTeamId === USER_TEAM ? cupTie.tie.awayTeamId : cupTie.tie.homeTeamId)} midweek` : ''}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 700 }}>Matchweek {season.matchweek + 1}: free weekend</div>
                <div className="small muted">
                  An odd number of clubs means everyone sits one round out.{cupTie ? ` Then ${cupTie.label} ${cupTie.tie.homeTeamId === USER_TEAM ? 'v' : 'at'} ${clubShort(u, cupTie.tie.homeTeamId === USER_TEAM ? cupTie.tie.awayTeamId : cupTie.tie.homeTeamId)} midweek.` : ''}
                </div>
              </div>
            )}
            {problems.length > 0 && <span className="chip warn" title={problems.join(', ')}>⚠ {problems.length} lineup issue{problems.length > 1 ? 's' : ''} (auto-fixed at kick-off)</span>}
            {game.pendingEvent && (
              <button className="chip warn" onClick={() => setTab('inbox')} style={{ cursor: 'pointer' }}>
                ✉ Decision needed
              </button>
            )}
            {game.window && (
              <button className="chip good" onClick={() => setTab('market')} style={{ cursor: 'pointer' }}>
                🛒 Window open · day {game.window.day}/{game.window.days}
              </button>
            )}
          </div>
          <div className="row wrap">
            {preseason && game.friendliesPlayed < 3 && (
              <button className="btn" onClick={() => store.playFriendly()}>
                Play friendly
              </button>
            )}
            <button className="btn primary big" onClick={() => store.playWeek()} disabled={!!game.pendingEvent}>
              {preseason ? 'Kick off the season' : next ? `Play matchweek ${season.matchweek + 1}` : `Sit out matchweek ${season.matchweek + 1}`}
            </button>
            <button className="btn" onClick={() => store.simWeeks(5)} disabled={!!game.pendingEvent} title="Assistant picks the team and resolves decisions">
              Sim 5
            </button>
            <button className="btn ghost" onClick={() => confirm('Simulate the rest of the season with the assistant managing?') && store.simToEnd()} disabled={!!game.pendingEvent}>
              Sim to end
            </button>
          </div>
        </div>
      )}
      {game.pendingEvent && <EventCard />}
      {!done && !preseason && next && tab === 'squad' && <OppositionReport clubId={next.clubId} home={next.home} />}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'squad', label: 'Squad' },
          { id: 'tactics', label: 'Tactics' },
          { id: 'fixtures', label: 'Fixtures' },
          { id: 'table', label: 'Table' },
          { id: 'cup', label: 'Cup' },
          ...(season.continental ? [{ id: 'europe' as const, label: 'Europe' }] : []),
          { id: 'stats', label: 'Stats' },
          { id: 'market', label: 'Market', alert: !!game.window && (openOffers > 0 || game.window.day === 0) },
          { id: 'inbox', label: 'Inbox', alert: !!game.pendingEvent },
          { id: 'club', label: 'Club' },
        ]}
      />

      {tab === 'squad' && game.youthIntake && game.youthIntake.chosen === undefined && preseason && (
        <div className="panel" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
          <div className="panel-head">
            <h3>🎓 Youth intake</h3>
            <span className="small muted">Real academy prospects. Sign one for nothing on a three-year deal, or pass.</span>
          </div>
          <div className="col" style={{ gap: 4 }}>
            {game.youthIntake.candidates.map((id) => {
              const p = u.index[id]
              if (!p) return null
              return <PlayerRow key={id} p={p} showClub onClick={() => store.showToast(store.signYouth(id).message)} right={<span className="btn sm primary">Sign</span>} extra={p.clubId === game.settings.hostClubId ? <span className="chip gold">Homegrown</span> : undefined} />
            })}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn ghost sm" onClick={() => store.showToast(store.signYouth(null).message)}>
              Pass this year
            </button>
          </div>
        </div>
      )}
      {tab === 'squad' && (
        <div className="grid dugout">
          <div className="panel">
            <div className="panel-head">
              <h3>Squad · {squad.length}/{SQUAD_CAP}</h3>
              <div className="row">
                <span className="small muted">{selectedSlot ? `Pick a player for ${formation.slots.find((s) => s.id === selectedSlot)?.position}` : 'Click a slot, then a player. Click a player for details.'}</span>
                <button className="btn sm" onClick={() => store.autoPick()}>
                  Auto-pick
                </button>
              </div>
            </div>
            <div className="plist">
              {sortedSquad.map(({ p, s }) => {
                const starting = inXI.has(p.id)
                const slot = formation.slots.find((sl) => game.lineup[sl.id] === p.id)
                const avg = s.seasonStats.apps ? (s.seasonStats.ratingSum / s.seasonStats.apps).toFixed(2) : '–'
                return (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    state={s}
                    onClick={() => onPlayerClick(p.id)}
                    selected={!!selectedSlot && starting && slot?.id === selectedSlot}
                    showClub
                    extra={
                      <>
                        {game.captainId === p.id && <span className="chip gold">©</span>}
                        <span className="muted">
                          {s.seasonStats.apps} apps · {s.seasonStats.goals}g {s.seasonStats.assists}a · {avg}
                        </span>
                      </>
                    }
                    right={starting ? <span className="chip good">{slot?.position}</span> : game.bench.includes(p.id) ? <span className="chip">Bench</span> : <span className="chip muted">Out</span>}
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
              {strength.chemistryBreakdown.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Chemistry {strength.chemistry >= 0 ? '+' : ''}{strength.chemistry}: {strength.chemistryBreakdown.join(', ')}</div>}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h3>Depth chart</h3>
                <span className="small muted">Who can cover each position, rated there</span>
              </div>
              <div className="depth">
                {[...new Set(formation.slots.map((sl) => sl.position))].map((pos) => {
                  const cover = squad
                    .filter((x) => canCover(x.p, pos, 'accomplished'))
                    .map((x) => ({ ...x, r: Math.round(ratingAt(x.p, pos)) }))
                    .sort((a, b) => b.r - a.r)
                    .slice(0, 4)
                  return (
                    <div key={pos} className="depth-row">
                      <Pos p={pos} />
                      <span className="depth-names">
                        {cover.length === 0 && <span className="chip bad">Nobody</span>}
                        {cover.map((x) => (
                          <button key={x.p.id} type="button" className={`chip ${inXI.has(x.p.id) ? 'good' : ''} ${!isAvailable(x.s) ? 'dim' : ''}`} onClick={() => onPlayerClick(x.p.id)} title={!isAvailable(x.s) ? 'Unavailable' : inXI.has(x.p.id) ? 'Starting' : 'Available'}>
                            {x.p.name.split(' ').slice(-1)[0]} {x.r}
                          </button>
                        ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="panel">
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
            </div>
          </div>
        </div>
      )}

      {tab === 'tactics' && <TacticsTab />}

      {tab === 'fixtures' && (
        <div className="panel">
          <h3>Fixtures and results</h3>
          <div className="col" style={{ gap: 4 }}>
            {season.fixtures
              .filter((f) => f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)
              .sort((a, b) => a.matchweek - b.matchweek)
              .map((f) => {
                const home = f.homeTeamId === USER_TEAM
                const opp = home ? f.awayTeamId : f.homeTeamId
                const r = f.result
                const gf = r ? (home ? r.homeGoals : r.awayGoals) : null
                const ga = r ? (home ? r.awayGoals : r.homeGoals) : null
                const cls = gf === null ? '' : gf > ga! ? 'good' : gf === ga ? '' : 'bad'
                return (
                  <div key={f.matchweek} className="fixture me">
                    <span className="mw">MW {f.matchweek}</span>
                    <span className="h row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {home ? game.settings.teamName : clubName(u, opp)} {home ? null : <ClubBadge clubId={opp} size={18} />}
                    </span>
                    <span className={`sc chip ${cls}`} style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
                      {r ? `${r.homeGoals} - ${r.awayGoals}` : 'v'}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {home ? <ClubBadge clubId={opp} size={18} /> : null} {home ? clubName(u, opp) : game.settings.teamName}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {tab === 'table' && (
        <div className="panel">
          <h3>League table · {seasonLabel(season.leagueSeason)}</h3>
          <TableView rows={table} teamName={game.settings.teamName} />
          <p className="help">The other nineteen clubs field their real squads from that season, with their own injuries and form.</p>
        </div>
      )}

      {tab === 'cup' && <CupTab comp="cup" />}
      {tab === 'europe' && <CupTab comp="continental" />}
      {tab === 'stats' && <StatsTab />}
      {tab === 'market' && <MarketTab />}
      {tab === 'inbox' && (
        <div className="panel">
          <h3>Inbox</h3>
          <div className="news">
            {season.news.map((n, i) => (
              <div key={i} className="item">
                <span>{{ result: '⚽', injury: '🩹', suspension: '🟥', board: '🏛', transfer: '💷', award: '🏆', event: '💬', cup: '🏟', training: '🏃', info: 'ℹ️' }[n.kind]}</span>
                <span>
                  <div className="t">{n.title}</div>
                  <div className="b">{n.body}</div>
                </span>
                <span className="small muted">{n.matchweek ? `MW ${n.matchweek}` : 'Pre'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'club' && <ClubTab table={table} />}

      <PlayerModal id={playerModal} onClose={() => setPlayerModal(null)} />
    </div>
  )
}

function TacticsTab() {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const t = game.tactics
  const strength = teamStrength(game, u)
  return (
    <div className="grid dugout">
      <div className="col">
        <div className="panel">
          <h3>Formation</h3>
          <div className="formations">
            {FORMATIONS.map((f) => (
              <button key={f.id} className={f.id === t.formationId ? 'active' : ''} onClick={() => store.setFormation(f.id)}>
                <div className="fname">{f.name}</div>
                <div className="fblurb">{f.blurb}</div>
              </button>
            ))}
          </div>
          <p className="help">Changing shape mid-season knocks tactical familiarity back a little.</p>
        </div>
        <div className="panel col">
          <h3>Team instructions</h3>
          <Instruction label="Mentality" help={MENTALITY_HELP[t.mentality]}>
            <Segmented value={t.mentality} onChange={(v) => store.setTactics({ mentality: v })} options={[{ value: 'defensive', label: 'Defensive' }, { value: 'balanced', label: 'Balanced' }, { value: 'attacking', label: 'Attacking' }]} />
          </Instruction>
          <Instruction label="Pressing" help={PRESSING_HELP[t.pressing]}>
            <Segmented value={t.pressing} onChange={(v) => store.setTactics({ pressing: v })} options={[{ value: 'low', label: 'Low block' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High press' }]} />
          </Instruction>
          <Instruction label="Tempo" help={TEMPO_HELP[t.tempo]}>
            <Segmented value={t.tempo} onChange={(v) => store.setTactics({ tempo: v })} options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }]} />
          </Instruction>
          <Instruction label="Width" help={WIDTH_HELP[t.width]}>
            <Segmented value={t.width} onChange={(v) => store.setTactics({ width: v })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]} />
          </Instruction>
          <Instruction label="Defensive line" help={LINE_HELP[t.defensiveLine]}>
            <Segmented value={t.defensiveLine} onChange={(v) => store.setTactics({ defensiveLine: v })} options={[{ value: 'deep', label: 'Deep' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
          </Instruction>
          <Instruction label="Passing" help={PASSING_HELP[t.passing]}>
            <Segmented value={t.passing} onChange={(v) => store.setTactics({ passing: v })} options={[{ value: 'short', label: 'Short' }, { value: 'mixed', label: 'Mixed' }, { value: 'direct', label: 'Direct' }]} />
          </Instruction>
        </div>
        <div className="panel col">
          <h3>Training this week</h3>
          <Segmented<TrainingFocus> value={game.training} onChange={store.setTraining} options={(Object.keys(TRAINING) as TrainingFocus[]).map((k) => ({ value: k, label: TRAINING_LABEL[k] }))} />
          <p className="help">{TRAINING[game.training].blurb}</p>
        </div>
        <div className="panel col">
          <h3>Set pieces</h3>
          {(
            [
              { key: 'penalties', label: 'Penalties', attr: (p: { attributes: { shooting: number; mentality: number } }) => Math.round((p.attributes.shooting + p.attributes.mentality) / 2), hint: 'Takes every penalty while he is on the pitch.' },
              { key: 'freeKicks', label: 'Free kicks', attr: (p: { attributes: { shooting: number } }) => p.attributes.shooting, hint: 'A specialist adds chances from dead balls.' },
              { key: 'corners', label: 'Corners', attr: (p: { attributes: { passing: number } }) => p.attributes.passing, hint: 'A good delivery adds chances; a poor one costs them.' },
            ] as const
          ).map((sp) => {
            const xi = Object.values(game.lineup)
              .map((id) => get(id))
              .filter((p): p is NonNullable<typeof p> => !!p && p.positions[0] !== 'GK')
              .sort((a, b) => sp.attr(b) - sp.attr(a))
            const current = t.setPieces?.[sp.key] ?? ''
            return (
              <Instruction key={sp.key} label={sp.label} help={sp.hint}>
                <select className="input" value={current} onChange={(e) => store.setTactics({ setPieces: { ...t.setPieces, [sp.key]: e.target.value || undefined } })}>
                  <option value="">Auto: best on the pitch</option>
                  {xi.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({sp.attr(p)})
                    </option>
                  ))}
                </select>
              </Instruction>
            )
          })}
        </div>
      </div>
      <div className="col">
        <div className="panel">
          <div className="panel-head">
            <h3>Roles</h3>
            <span className="small muted">Team {strength.overall.toFixed(1)}</span>
          </div>
          <div className="col" style={{ gap: 8 }}>
            {formation.slots.map((slot) => {
              const id = game.lineup[slot.id]
              const p = id ? get(id) : undefined
              const roleId = t.roles[slot.id] ?? DEFAULT_ROLE[slot.position]
              const role = getRole(roleId)
              const ev = strength.slots.find((s) => s.slotId === slot.id)
              return (
                <div key={slot.id} className="card">
                  <div className="row between wrap">
                    <span className="row" style={{ gap: 8 }}>
                      <Pos p={slot.position} />
                      <span style={{ fontWeight: 600 }}>{p ? p.name : <span className="muted">empty</span>}</span>
                      {ev && <span className="small muted">rating in role {ev.effective.toFixed(0)}</span>}
                    </span>
                    <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={roleId} onChange={(e) => store.setRole(slot.id, e.target.value)}>
                      {rolesFor(slot.position).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="help">{role.blurb}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Instruction({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between wrap">
        <span style={{ fontWeight: 600 }}>{label}</span>
        {children}
      </div>
      <div className="help">{help}</div>
    </div>
  )
}

function CupTab({ comp }: { comp: Competition }) {
  const { universe: u, game } = useStore()
  if (!u || !game?.season) return null
  const season = game.season
  const rounds = roundsFor(comp, season.matchweeks)
  const allTies = comp === 'cup' ? season.cup : season.continental?.ties ?? []
  const eliminated = comp === 'cup' ? season.cupEliminated : !!season.continental?.eliminated
  const won = comp === 'cup' ? season.cupWon : !!season.continental?.won
  const field = comp === 'continental' ? Object.values(season.continental?.clubs ?? {}) : []
  return (
    <div className="panel">
      <h3>{comp === 'cup' ? 'The Cup' : 'Continental Cup'}</h3>
      <p className="help">
        {comp === 'cup' ? 'Sixteen clubs, four rounds' : 'You and the fifteen strongest clubs from the other leagues that season, four rounds'} played midweek after matchweeks {rounds.map((r) => r.afterMatchweek).join(', ')}. Drawn ties go to penalties. The final is at a neutral venue.
        {comp === 'continental' ? ' Finish in the top four to qualify again next season.' : ''}
      </p>
      {field.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {field.map((c) => (
            <span key={c.id} className="chip row" style={{ gap: 4 }} title={u.leagues.find((l) => l.id === u.clubById[c.id]?.leagueId)?.name}>
              <ClubBadge clubId={c.id} size={16} /> {c.shortName}
            </span>
          ))}
        </div>
      )}
      {rounds.map((r) => {
        const ties = allTies.filter((t) => t.round === r.round)
        if (!ties.length) return null
        return (
          <div key={r.round} style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 16 }}>
              {r.label} · after MW {r.afterMatchweek}
            </h3>
            <div className="col" style={{ gap: 4 }}>
              {ties.map((t, i) => {
                const me = t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM
                const name = (id: string) => (id === USER_TEAM ? game.settings.teamName : clubName(u, id))
                return (
                  <div key={i} className={`fixture ${me ? 'me' : ''}`}>
                    <span className="mw">{t.result ? '' : 'v'}</span>
                    <span className="h" style={{ fontWeight: t.winnerId === t.homeTeamId ? 700 : 400 }}>
                      {name(t.homeTeamId)}
                    </span>
                    <span className="sc">{t.result ? `${t.result.homeGoals}-${t.result.awayGoals}${t.result.penalties ? ` (${t.result.penalties.home}-${t.result.penalties.away}p)` : ''}` : '–'}</span>
                    <span style={{ fontWeight: t.winnerId === t.awayTeamId ? 700 : 400 }}>{name(t.awayTeamId)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {eliminated && <div className="notice warn">Knocked out. The remaining rounds are free midweeks for recovery.</div>}
      {won && <div className="notice">{comp === 'cup' ? '🏆 Cup winners!' : '🌍 Champions of the continent!'}</div>}
    </div>
  )
}

function MarketTab() {
  const store = useStore()
  const { universe: u, game } = store
  const [bids, setBids] = useState<Record<string, number>>({})
  const [years, setYears] = useState<Record<string, number>>({})
  const [exchange, setExchange] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'all' | Position>('all')
  const [msg, setMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    if (!u || !game) return []
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const owned = new Set(Object.keys(game.squad).map((id) => (game.customPlayers[id] ?? u.index[id])?.playerId))
    const { fromSeason, toSeason } = game.settings.rules
    return Object.values(u.index)
      .filter((p) => p.name.toLowerCase().includes(q) && !owned.has(p.playerId) && game.settings.wheelLeagues.includes(u.clubById[p.clubId]?.leagueId ?? '') && (fromSeason === undefined || p.season >= fromSeason) && (toSeason === undefined || p.season <= toSeason))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, 14)
  }, [u, game, query])
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const w = game.window
  const squad = squadPlayers(game, u)
  const scout = staffTier(game.staff, 'scout')
  const shortlisted = store.shortlist.map((id) => u.index[id]).filter((p): p is NonNullable<typeof p> => !!p)
  const shortlistPanel = shortlisted.length > 0 && (
    <div className="panel">
      <h3>Shortlist</h3>
      <p className="small muted">Players you starred in Explore.{w ? ' Click one to approach his club.' : ' Approach them when a window opens.'}</p>
      <div className="col" style={{ gap: 4, maxHeight: 280, overflow: 'auto' }}>
        {shortlisted.map((p) => {
          const listed = w?.listings.find((l) => l.playerSeasonId === p.id)
          return (
            <PlayerRow
              key={p.id}
              p={p}
              showClub
              onClick={
                w
                  ? () => {
                      const out = store.enquire(p.id)
                      setMsg(out.message)
                    }
                  : () => store.toggleShortlist(p.id)
              }
              right={<span className="btn sm">{w ? (listed ? (listed.status === 'signed' ? 'Signed' : listed.status === 'gone' ? 'Gone' : money(listed.asking)) : 'Enquire') : '★ Remove'}</span>}
            />
          )
        })}
      </div>
    </div>
  )
  if (!w) {
    return (
      <div className="panel">
        <h3>Transfer market</h3>
        <p className="muted">The window is closed. The January window opens at the halfway point of the season and runs for seven market days, three per matchweek. In Dynasty mode a longer summer window opens between seasons.</p>
        {shortlistPanel}
        <h3 style={{ marginTop: 12 }}>Squad values</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Value</th>
              <th className="num">Wage</th>
              <th className="num">Contract</th>
            </tr>
          </thead>
          <tbody>
            {squad
              .sort((a, b) => b.p.value - a.p.value)
              .map((x) => (
                <tr key={x.p.id}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <Rating value={x.p.overall} /> {x.p.name}
                    </span>
                  </td>
                  <td className="num">{money(x.p.value)}</td>
                  <td className="num">{wage(x.p.wage)}</td>
                  <td className="num">{game.contracts[x.p.id]?.loan ? 'Loan' : `${game.contracts[x.p.id]?.years ?? 1}y`}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    )
  }
  const listings = w.listings.filter((l) => l.status === 'available' || l.status === 'bidding').filter((l) => filter === 'all' || get(l.playerSeasonId)?.positions.includes(filter)).sort((a, b) => (get(b.playerSeasonId)?.overall ?? 0) - (get(a.playerSeasonId)?.overall ?? 0))
  const offers = w.offers.map((o, i) => ({ o, i })).filter(({ o }) => o.status === 'open')
  return (
    <div className="grid dugout">
      <div className="panel">
        <div className="panel-head">
          <h3>
            {w.kind === 'summer' ? 'Summer' : 'January'} window · day {w.day}/{w.days}
            {w.day >= w.days - 1 ? ' · deadline day' : ''}
          </h3>
          <div className="row wrap">
            <span className="chip good">Budget {money(game.finances.budget)}</span>
            <span className="chip">Wage room {wage(Math.max(0, game.finances.wageCap - squad.reduce((s, x) => s + x.p.wage, 0) - staffWages(game.staff)))}</span>
            <button className="btn sm" onClick={() => store.advanceDay()}>
              Next market day →
            </button>
          </div>
        </div>
        {msg && <div className="notice" style={{ marginBottom: 8 }}>{msg}</div>}
        <div className="segmented" style={{ marginBottom: 8 }}>
          {(['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => (
            <button key={p} className={filter === p ? 'active' : ''} onClick={() => setFilter(p)}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
        <div className="col" style={{ gap: 6, maxHeight: 640, overflow: 'auto' }}>
          {listings.map((l) => {
            const p = get(l.playerSeasonId)
            if (!p) return null
            const bid = bids[l.playerSeasonId] ?? l.asking
            return (
              <div key={l.playerSeasonId} className="listing">
                <div>
                  <PlayerRow p={p} showClub right={<span className="small muted">{wage(p.wage)}</span>} />
                  <div className="tags">
                    {l.tags.map((t) => (
                      <span key={t} className={`chip ${t === 'Bidding war' || t === 'Annoyed' || t === 'Unsolicited approach' ? 'warn' : t === 'Deadline discount' || t === 'Loan available' || t === 'Scouted' ? 'good' : ''}`}>
                        {t}
                      </span>
                    ))}
                    {scout > 0 &&
                      traitTags(p.traits).map((t) => (
                        <span key={t} className="chip" style={{ borderStyle: 'dashed' }} title="Scouting report">
                          {t}
                        </span>
                      ))}
                    {l.suitors > 0 && <span className="chip">{l.suitors} rival{l.suitors > 1 ? 's' : ''} interested</span>}
                    {l.response && <span className="chip">{l.response}</span>}
                  </div>
                  <div className="bidrow">
                    <input className="input" type="number" min={0.1} step={0.5} value={bid} onChange={(e) => setBids({ ...bids, [l.playerSeasonId]: Number(e.target.value) })} />
                    <span className="small muted">£M</span>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        const out = store.bid(l.playerSeasonId, bid, { years: years[l.playerSeasonId], exchangeId: exchange[l.playerSeasonId] || undefined })
                        setMsg(out.message)
                      }}
                    >
                      Bid
                    </button>
                    <button className="btn sm" onClick={() => setBids({ ...bids, [l.playerSeasonId]: Math.round(l.asking * 0.9 * 10) / 10 })}>
                      −10%
                    </button>
                    <select className="input" value={years[l.playerSeasonId] ?? (p.age >= 32 ? 1 : 3)} onChange={(e) => setYears({ ...years, [l.playerSeasonId]: Number(e.target.value) })} title="Contract length">
                      {[1, 2, 3, 4].filter((y) => y <= (p.age >= 33 ? 2 : 4)).map((y) => (
                        <option key={y} value={y}>
                          {y}-year deal
                        </option>
                      ))}
                    </select>
                    <select className="input" value={exchange[l.playerSeasonId] ?? ''} onChange={(e) => setExchange({ ...exchange, [l.playerSeasonId]: e.target.value })} title="Offer a player in part-exchange">
                      <option value="">Cash only</option>
                      {squad
                        .filter((x) => !game.contracts[x.p.id]?.loan)
                        .sort((a, b) => b.p.overall - a.p.overall)
                        .map((x) => (
                          <option key={x.p.id} value={x.p.id}>
                            + {x.p.name} ({x.p.overall})
                          </option>
                        ))}
                    </select>
                    {l.loanFee !== undefined && (
                      <button className="btn sm" onClick={() => setMsg(store.loan(l.playerSeasonId).message)} title="Season-long loan: small fee, full wages, back to his club in the summer">
                        Loan for {money(l.loanFee)}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="price">{money(l.asking)}</div>
                  <div className="small muted" style={{ textAlign: 'right' }}>
                    asking{l.asking !== l.opening ? ` (was ${money(l.opening)})` : ''}
                  </div>
                </div>
              </div>
            )
          })}
          {listings.length === 0 && <div className="muted">Nothing listed for that position right now. Advance a day for new listings.</div>}
        </div>
      </div>
      <div className="col">
        <div className="panel">
          <h3>Approach any player</h3>
          <p className="small muted">Not on the market? Ask anyway. Clubs quote a premium for players they wanted to keep and refuse outright for their stars.</p>
          <input className="input" placeholder="Search every player in the database…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {results.length > 0 && (
            <div className="col" style={{ gap: 4, maxHeight: 280, overflow: 'auto', marginTop: 6 }}>
              {results.map((p) => (
                <PlayerRow
                  key={p.id}
                  p={p}
                  showClub
                  onClick={() => {
                    const out = store.enquire(p.id)
                    setMsg(out.message)
                    if (out.ok) setQuery('')
                  }}
                  right={<span className="btn sm">Enquire</span>}
                />
              ))}
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && <div className="small muted" style={{ marginTop: 6 }}>No one by that name in the leagues and eras this game draws from.</div>}
        </div>
        {shortlistPanel}
        <div className="panel">
          <h3>Offers for your players</h3>
          {offers.length === 0 && <div className="muted small">No offers on the table.</div>}
          <div className="col" style={{ gap: 6 }}>
            {offers.map(({ o, i }) => {
              const p = get(o.playerSeasonId)
              if (!p) return null
              return (
                <div key={i} className="card">
                  <div className="row between wrap">
                    <span>
                      <b>{clubName(u, o.fromClubId)}</b> offer <b>{money(o.amount)}</b> for {p.name} <Rating value={p.overall} />
                    </span>
                    <span className="row">
                      <button className="btn sm primary" onClick={() => store.acceptOffer(i)}>
                        Accept
                      </button>
                      <button className="btn sm" onClick={() => store.rejectOffer(i)}>
                        Reject
                      </button>
                    </span>
                  </div>
                  <div className="small muted">Value {money(p.value)} · day {o.day}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="panel">
          <h3>Market log</h3>
          <div className="col small" style={{ gap: 4, maxHeight: 300, overflow: 'auto' }}>
            {w.log.map((l, i) => (
              <div key={i} className="muted">
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ClubTab({ table }: { table: TableRow[] }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game?.season) return null
  const season = game.season
  const squad = squadPlayers(game, u)
  const playerWages = squad.reduce((s, x) => s + x.p.wage, 0)
  const wages = playerWages + staffWages(game.staff)
  const host = u.clubById[season.hostClubId]
  return (
    <div className="grid two">
      <div className="panel">
        <h3>Board</h3>
        <div className="kv">
          <dt>Expectation</dt>
          <dd>Finish {ordinal(season.boardTarget)} or better</dd>
          <dt>Current</dt>
          <dd>{season.matchweek ? ordinal(positionOf(table, USER_TEAM)) : 'Pre-season'}</dd>
          <dt>Confidence</dt>
          <dd>{Math.round(season.confidence)} / 100</dd>
          <dt>Job security</dt>
          <dd>{game.settings.jobSecurity ? 'On: below 12 after matchweek 10 and you are gone' : 'Off'}</dd>
          <dt>League</dt>
          <dd>{u.leagues.find((l) => l.id === season.leagueId)?.name ?? season.leagueId} · {season.matchweeks} matchweeks</dd>
          <dt>Rivals</dt>
          <dd>{host?.rivals.map((r) => clubName(u, r)).join(', ') || 'None'}</dd>
          <dt>Difficulty</dt>
          <dd>{season.aiOffset > 0 ? `Calibrated: rivals play ${season.aiOffset} rating points below their real strength` : 'Realistic: real squads at full strength'}</dd>
        </div>
        {season.objectives && season.objectives.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Board objectives</h3>
            <div className="col" style={{ gap: 6 }}>
              {season.objectives.map((o) => {
                const ev = evaluateObjective(o, { season, squad, rivals: host?.rivals ?? [] })
                const decided = o.met !== undefined
                const ok = decided ? o.met : ev.met
                return (
                  <div key={o.id} className="row between wrap">
                    <span>
                      <span className={`chip ${ok ? 'good' : decided ? 'bad' : ''}`}>{decided ? (ok ? '✓ Met' : '✗ Missed') : ok ? 'On track' : 'Not yet'}</span> {o.label}
                    </span>
                    <span className="small muted">{ev.progress}</span>
                  </div>
                )
              })}
              <p className="help">Each objective met adds £{OBJECTIVE_REWARD.budget}M to the budget and lifts board confidence; each one missed costs confidence.</p>
            </div>
          </>
        )}
      </div>
      <div className="panel">
        <h3>Finances</h3>
        <div className="kv">
          <dt>Transfer budget</dt>
          <dd>{money(game.finances.budget)}</dd>
          <dt>Wage bill</dt>
          <dd>
            {wage(wages)} of {wage(game.finances.wageCap)} cap{staffWages(game.staff) ? ` (staff ${wage(staffWages(game.staff))})` : ''}
          </dd>
          <dt>Income this season</dt>
          <dd>{money(game.finances.income)}</dd>
          <dt>Spent on fees</dt>
          <dd>{money(game.finances.spent)}</dd>
          <dt>Wages paid</dt>
          <dd>{money(game.finances.wagesPaid)}</dd>
        </div>
        <p className="help">Match-day and broadcast income covers the wage cap: spend under it and the surplus drips into the budget each week, go over and it drains. Prize money lands at the end of the season: about £100M for the title, scaling down the table, plus a cup bonus.</p>
      </div>
      <div className="panel">
        <h3>Backroom staff</h3>
        <p className="help">Staff wages count against the wage cap. Hire and release at any time.</p>
        <div className="col" style={{ gap: 10 }}>
          {STAFF_ROLES.map((role) => {
            const info = STAFF[role]
            const tier = staffTier(game.staff, role)
            return (
              <div key={role} className="card">
                <div className="row between wrap">
                  <b>{info.label}</b>
                  <span className="small muted">{info.tiers[tier].title}{info.tiers[tier].wage ? ` · ${wage(info.tiers[tier].wage)}` : ''}</span>
                </div>
                <div className="segmented" style={{ marginTop: 6 }}>
                  {info.tiers.map((t) => (
                    <button key={t.tier} className={t.tier === tier ? 'active' : ''} onClick={() => store.hireStaff(role, t.tier)} title={t.blurb}>
                      {t.tier === 0 ? 'None' : t.tier === 1 ? `Good · ${wage(t.wage)}` : `Elite · ${wage(t.wage)}`}
                    </button>
                  ))}
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>{info.tiers[tier].blurb}</div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="panel">
        <h3>Contracts</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Age</th>
              <th className="num">Years</th>
              <th className="num">Morale</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {squad.map((x) => (
              <tr key={x.p.id}>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <Rating value={x.p.overall} /> {x.p.name}
                  </span>
                </td>
                <td className="num">{x.p.age}</td>
                <td className="num">{game.contracts[x.p.id]?.years ?? 1}</td>
                <td className="num">{moraleWord(x.s.morale)}</td>
                <td>
                  <button className="btn sm ghost danger" onClick={() => confirm(`Release ${x.p.name}? No fee is received.`) && store.release(x.p.id)}>
                    Release
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {game.careerStats && Object.keys(game.careerStats).length > 0 && (
        <div className="panel">
          <h3>Club legends</h3>
          <p className="help">All-time records for {game.settings.teamName}, across every season of this game.</p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Seasons</th>
                <th className="num">Apps</th>
                <th className="num">Goals</th>
                <th className="num">Assists</th>
                <th className="num">MOTM</th>
                <th className="num">Titles</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(game.careerStats)
                .sort((a, b) => b.apps - a.apps || b.goals - a.goals)
                .slice(0, 12)
                .map((r) => (
                  <tr key={r.name + r.lastYear}>
                    <td>{r.name}</td>
                    <td className="num">{r.seasons}</td>
                    <td className="num">{r.apps}</td>
                    <td className="num">{r.goals}</td>
                    <td className="num">{r.assists}</td>
                    <td className="num">{r.motm}</td>
                    <td className="num">{r.titles}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel">
        <h3>Achievements this game</h3>
        {game.unlocked.filter((x) => x !== 'survivor-pending').length === 0 && <div className="muted small">Nothing yet. Win something.</div>}
        <div className="pill-list">
          {game.unlocked
            .filter((x) => x !== 'survivor-pending')
            .map((a) => (
              <span key={a} className="chip gold">
                {a}
              </span>
            ))}
        </div>
      </div>
    </div>
  )
}

function EventCard() {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game?.pendingEvent) return null
  const ev = game.pendingEvent
  const get = playerLookup(game, u)
  const p = ev.playerSeasonId ? get(ev.playerSeasonId) : undefined
  return (
    <div className="panel" data-testid="event-card" style={{ marginBottom: 12, borderColor: 'var(--warn)' }}>
      <div className="row between wrap">
        <div>
          <h3 style={{ color: 'var(--warn)' }}>✉ {ev.title}</h3>
          <p style={{ marginBottom: 6 }}>{ev.body}</p>
          {p && (
            <div className="small muted">
              {p.name} · {p.positions.join('/')} · morale {moraleWord(game.squad[p.id]?.morale ?? 70).toLowerCase()}
            </div>
          )}
        </div>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        {ev.choices.map((c) => (
          <button key={c.id} className="btn" title={c.hint} onClick={() => store.resolveEvent(c.id)}>
            <span className="col" style={{ gap: 0, alignItems: 'flex-start' }}>
              <span>{c.label}</span>
              <span className="small muted" style={{ fontWeight: 400 }}>
                {c.hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PlayerModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [talkMsg, setTalkMsg] = useState<string | null>(null)
  if (!u || !game || !id) return null
  const get = playerLookup(game, u)
  const p = get(id)
  const s = game.squad[id]
  if (!p) return null
  const formation = getFormation(game.tactics.formationId)
  const attrs = p.attributes
  return (
    <Modal open onClose={onClose} title={p.name}>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <Rating value={p.overall} size="lg" />
        <span>
          {p.positions.map((x) => (
            <Pos key={x} p={x} />
          ))}
        </span>
        <span className="chip">{p.age} years</span>
        <span className="chip">
          {clubName(u, p.clubId)} {seasonLabel(p.season)}
        </span>
        <span className="chip">{money(p.value)}</span>
        <span className="chip">{wage(p.wage)}</span>
        {p.accolades.includes('Champion') && <span className="chip gold">🏆 Title winner</span>}
        {game.development?.[p.id] && game.development[p.id].base !== p.overall && (
          <span className={`chip ${p.overall > game.development[p.id].base ? 'good' : 'warn'}`} title="Rating change since the start of the season">
            {p.overall > game.development[p.id].base ? '▲' : '▼'} {Math.abs(p.overall - game.development[p.id].base)} since the start of the season
          </span>
        )}
      </div>
      <div className="grid two">
        <div className="col" style={{ gap: 6 }}>
          {(['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'mentality', 'goalkeeping'] as const).map((k) => (
            <div key={k} className="row" style={{ gap: 8 }}>
              <span style={{ width: 90, textTransform: 'capitalize' }} className="small">
                {k}
              </span>
              <Bar value={attrs[k]} colour={attrs[k] >= 80 ? 'var(--accent)' : attrs[k] >= 65 ? 'var(--gold)' : 'var(--text-3)'} />
              <span className="mono small" style={{ width: 24, textAlign: 'right' }}>
                {attrs[k]}
              </span>
            </div>
          ))}
        </div>
        {s && (
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ width: 90 }} className="small">
                Condition
              </span>
              <Bar value={s.condition} colour={conditionColour(s.condition)} />
              <span className="mono small">{s.condition}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ width: 90 }} className="small">
                Morale
              </span>
              <Bar value={s.morale} colour="var(--info)" />
              <span className="mono small">{s.morale}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ width: 90 }} className="small">
                Sharpness
              </span>
              <Bar value={s.sharpness} colour="#c9a0ff" />
              <span className="mono small">{s.sharpness}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ width: 90 }} className="small">
                Familiarity
              </span>
              <Bar value={s.familiarity} colour="var(--gold)" />
              <span className="mono small">{s.familiarity}</span>
            </div>
            <div className="kv" style={{ marginTop: 6 }}>
              <dt>Season</dt>
              <dd>
                {s.seasonStats.apps} apps ({s.seasonStats.starts} starts) · {s.seasonStats.goals} goals · {s.seasonStats.assists} assists
              </dd>
              <dt>Average rating</dt>
              <dd>{s.seasonStats.apps ? (s.seasonStats.ratingSum / s.seasonStats.apps).toFixed(2) : '–'}</dd>
              <dt>Form</dt>
              <dd>{s.recentRatings.length ? s.recentRatings.map((r) => r.toFixed(1)).join(' · ') : '–'}</dd>
              <dt>Discipline</dt>
              <dd>
                {s.yellowCards} yellow{s.yellowCards === 1 ? '' : 's'}
                {s.suspension ? ` · suspended ${s.suspension}` : ''}
              </dd>
              {s.injury && (
                <>
                  <dt>Injury</dt>
                  <dd>
                    {s.injury.description}, {s.injury.weeksOut} wk
                  </dd>
                </>
              )}
              <dt>Contract</dt>
              <dd>{game.contracts[p.id]?.loan ? 'On loan until the summer' : `${game.contracts[p.id]?.years ?? 1} season(s)`}</dd>
            </div>
          </div>
        )}
      </div>
      {s && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          {formation.slots
            .filter((sl) => p.positions.some((pp) => pp === sl.position))
            .map((sl) => (
              <button key={sl.id} className="btn sm" onClick={() => { store.assign(p.id, sl.id); onClose() }}>
                Start at {sl.position}
              </button>
            ))}
          <button className="btn sm" onClick={() => { store.assign(p.id, 'bench'); onClose() }}>
            To bench
          </button>
          <button className="btn sm" onClick={() => { store.setCaptain(p.id); onClose() }}>
            Make captain
          </button>
        </div>
      )}
      {s && game.season && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row between wrap">
            <b>Have a word</b>
            <span className="small muted">Morale {moraleWord(s.morale)} · one conversation a week</span>
          </div>
          {game.talks?.[p.id] === game.season.matchweek ? (
            <div className="small muted" style={{ marginTop: 6 }}>You spoke to him this week. Leave it there.</div>
          ) : (
            <div className="row wrap" style={{ marginTop: 8 }}>
              {(Object.keys(TALK_LABEL) as TalkKind[]).map((k) => (
                <button key={k} className="btn sm" title={TALK_LABEL[k].hint} onClick={() => setTalkMsg(store.talk(p.id, k).message)}>
                  {TALK_LABEL[k].label}
                </button>
              ))}
            </div>
          )}
          {talkMsg && <div className="notice" style={{ marginTop: 8 }}>{talkMsg}</div>}
        </div>
      )}
    </Modal>
  )
}
