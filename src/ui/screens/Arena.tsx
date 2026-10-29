import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { lifelineChanges } from '@game/logic/lifeline'
import { getFormation } from '@engine/formations'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { clubIdOfKey } from '@engine/knockout'
import type { TeamTalk } from '@engine/match'
import type { Position } from '@engine/types'
import { arenaClubShortName, arenaStepInfo, isBigCup, nextArenaOpponent } from '@game/logic/arena'
import { cupRoundCount, cupRoundName } from '@engine/cup'
import { USER_TEAM } from '@engine/season'
import { TRAINING, type TrainingFocus } from '@engine/training'
import { Bracket } from '../components/Bracket'
import { arenaBracketView } from '@game/logic/bracket'
import { GAUNTLET_RUNGS, rungLabels } from '@engine/gauntlet'
import { GauntletLadder } from '../components/GauntletLadder'
import { arenaFormatText } from '../i18n/modeText'
import { ghostStepLine } from '@game/logic/arenaClaim'
import { playerLookup, squadPlayers } from '@game/logic/players'
import { lineupProblems, teamStrength } from '@game/logic/squad'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Info, Segmented, Stat, Tabs, TeamBadge } from '../components/bits'
import { OppositionReport } from './OppositionReport'
import { distinctLabels } from '../screenText'
import { gauntletBandText } from '../arenaText'
import { SeasonName } from '../components/SeasonName'
import { TacticsTab } from './Dugout'
import { askConfirm } from '../confirm'
import { useAfterPaint } from '../afterPaint'
import { useStorePick } from '../useStorePick'
import { slotTapMove } from '../slotTap'
import { fixed } from '../format'
import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'
import { trainingBlurb, trainingLabel } from '../i18n/engineText'
import { logicLine } from '../i18n/logicText'

const t = translator(arena)

type ArenaTab = 'team' | 'tactics'

const ORDER: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']
/** The match screen's ball path and samples built between playing a step and showing it (presentation only). */
const prepareStep = (next: Game): Promise<void> => {
  const u = useStore.getState().universe
  return u ? import('../match/prepare').then((m) => m.prepareMatchScreen(next, u)) : Promise.resolve()
}

/**
 * The arena hub (phase `week` with `game.arena`): the next opponent, the
 * opposition report, the team sheet and tactics (and the Cup's draw), then
 * "Manage this one" (live, the two stops) or the assistant plays it: "Sim this
 * tie" in the Cup, "Sim this rung" on the Gauntlet, "Sim the final".
 */
export function Arena() {
  const store = useStorePick('universe', 'game', 'assign', 'autoPick', 'changeTheDraw', 'playArenaStepSoon', 'playingWeek', 'setCaptain', 'setTeamTalk', 'setTraining', 'simArenaToEnd')
  const { universe: u, game } = store
  const [tab, setTab] = useState<ArenaTab>('team')
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  // Sim to the end plays every step left in one pass: the button says so in the frame it is tapped, then the steps play
  const [simming, afterPaint] = useAfterPaint()
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
  const changeDraw = async () => {
    if (opp && (await askConfirm(t('changeDrawConfirm', { club: opp.club.name }), { ok: t('changeDrawOk') }))) store.changeTheDraw()
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
      // One assign: it swaps the displaced man into the first slot (an empty first slot takes the man tapped second)
      const move = slotTapMove(game.lineup, selectedSlot, slotId)
      if (move) store.assign(move.id, move.slot)
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
            <h1>{game.settings.teamName}</h1>
            <div className="screen-meta" data-testid="arena-head">
              {/* The format and the match, once each: a Final's "Cup Final" and "Cup final" read as one chip */}
              {distinctLabels([arenaFormatText(game.settings.arena), logicLine(info.label)]).map((l, i) => (
                <span key={l} className={`chip${i === 0 ? ' info' : ''}`}>
                  {l}
                </span>
              ))}
              {gauntlet && <span className="chip">{t('climbed', { n: a.step, total: GAUNTLET_RUNGS })}</span>}
            </div>
          </div>
        </div>
        <div className="stat-strip arena-stats">
          <Stat label={t('teamRating')} value={fixed(strength.overall, 1)} sub={t('balance', { n: Math.round(strength.balance * 100) })} />
          <Stat label={t('squad')} value={squad.length} sub={t(game.settings.difficulty === 'realistic' ? 'realistic' : 'calibrated')} />
        </div>
      </div>

      <div className="fit-grid c3 arena-grid">
        <div className="fit-cell fit-col">
          {opp && (
            <div className="panel col" style={{ gap: 6 }} data-testid="arena-opponent">
              <div className="eyebrow">
                {gauntlet ? t('rungLine', { rung, band: gauntletBandText(rung) }) : cup ? t('roundLine', { label: logicLine(info.label), round: a.step + 1, total: cupRoundCount(size), seed: seeded ? 'yes' : 'no' }) : info.label}
                {t(info.neutral ? 'neutralGround' : info.home ? 'home' : 'away')}
                {billing ? ` · ${billing}` : ''}
              </div>
              <div className="row between arena-opp-row" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <ClubBadge clubId={clubIdOfKey(opp.key)} size={40} />
                  {/* The season stays on one line: a narrow box broke "2023-24" at its hyphen */}
                  <div className="arena-opp-name">{opp && <SeasonName name={opp.club.name} />}</div>
                </div>
                {gauntlet && (
                  <button className="btn sm arena-lifeline" onClick={changeDraw} disabled={a.lifelineUsed !== undefined || !lifelineChanges(a)} data-testid="arena-lifeline" title={t(a.lifelineUsed === undefined && !lifelineChanges(a) ? 'lifelineSame' : 'lifelineTip')}>
                    {t(a.lifelineUsed !== undefined ? 'lifelineUsed' : 'changeDraw')}
                  </button>
                )}
              </div>
              <div className="small muted" data-testid="arena-rating" title={t(opp.offset > 0 ? 'ratingTipCalibrated' : 'ratingTipFull')}>
                {opp.offset > 0 ? t('playsAt', { at: fixed(opp.real - opp.offset, 1), real: fixed(opp.real, 1) }) : t('playsFull', { real: fixed(opp.real, 1) })}{t('you', { n: fixed(strength.overall, 1) })}
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
                <h3>{t('theLadder')}</h3>
                <span className="small muted">{a.lifelineUsed ? t('lifelineUsedAt', { n: a.lifelineUsed }) : t('lifelineUnused')}</span>
              </div>
              <GauntletLadder u={u} a={a} ghost={ghost} />
            </div>
          )}
          {opp && <OppositionReport clubId={opp.club.clubId} home={info.home} club={opp.club} aiOffset={opp.offset} neutral={info.neutral} />}
          {cup && a.bracket && (
            <div className="panel col" style={{ gap: 8 }} data-testid="arena-draw">
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <span className="head-title">
                  <h3>{t('theDraw', { n: size })}</h3>
                  <Info label={t('aboutDraw')}>{t('drawInfo')}</Info>
                </span>
              </div>
              {ghost?.arena && (
                <div className="row wrap" style={{ gap: 6 }} data-testid="ghost-trail">
                  {Array.from({ length: cupRoundCount(size) }, (_, r) => (
                    <span key={r} className="chip" title={`${logicLine(cupRoundName(size, r).name)}: ${ghostStepLine(ghost, r)}`}>
                      {cupRoundName(size, r).code} 👻 {ghostStepLine(ghost, r)?.replace(`${ghost.name} `, '')}
                    </span>
                  ))}
                </div>
              )}
              <Bracket
                view={arenaBracketView(size, a.bracket.rounds)}
                nameOf={(k) => (k === USER_TEAM ? game.settings.teamName : arenaClubShortName(u, k))}
                badge={(k) => (k === USER_TEAM ? <TeamBadge code={game.settings.shortName} size={18} /> : <ClubBadge clubId={clubIdOfKey(k)} size={18} />)}
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
              { id: 'team', label: t('teamSheet') },
              { id: 'tactics', label: t('tactics') },
            ]}
          />
          {tab === 'team' && (
            <div className="panel">
              <div className="panel-head">
                <h3>{t('squadN', { n: squad.length })}</h3>
                <div className="row">
                  <span className="small muted">{selectedSlot ? t('pickFor', { pos: formation.slots.find((s) => s.id === selectedSlot)?.position }) : t('slotThenPlayer')}</span>
                  <button className="btn sm" onClick={() => store.autoPick()} data-testid="arena-autopick">
                    {t('autoPick')}
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
                      right={slot ? <span className="chip info">{slot.position}</span> : <span className="chip">{t('bench')}</span>}
                    />
                  )
                })}
              </div>
            </div>
          )}
          {tab === 'tactics' && <TacticsTab />}
        </div>

        {/* On a desktop this box never scrolls: the pitch takes the height the team talk, captain and calls leave (a size
            container, so it shows whole), and the calls stay at the foot */}
        <div className="fit-cell fit-col arena-side" data-testid="arena-side">
          <div className="panel arena-pitch-panel">
            <div className="panel-head">
              <h3>{formation.name}</h3>
              <span className="small muted">
                {t('unitLine', { gk: fixed(strength.goalkeeping, 0), def: fixed(strength.defence, 0), mid: fixed(strength.midfield, 0), att: fixed(strength.attack, 0) })}
              </span>
            </div>
            <div className="arena-pitch-box">
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} getState={(id) => game.squad[id]} onSlotClick={onSlotClick} selectedSlot={selectedSlot} showRoles={Object.fromEntries(formation.slots.map((s) => [s.id, getRole(game.tactics.roles[s.id] ?? DEFAULT_ROLE[s.position]).name]))} />
            </div>
          </div>
          <div className="panel col arena-prep">
            <div className="field">
              {t('teamTalk')}
              <Segmented<TeamTalk>
                label={t('teamTalk')}
                value={game.teamTalk}
                onChange={store.setTeamTalk}
                options={[
                  { value: 'calm', label: t('calm'), hint: t('calmHint') },
                  { value: 'encourage', label: t('encourage'), hint: t('encourageHint') },
                  { value: 'demand', label: t('demand'), hint: t('demandHint') },
                  { value: 'fire-up', label: t('fireUp'), hint: t('fireUpHint') },
                ]}
              />
            </div>
            {(gauntlet || cup) && (
              <label className="field" data-testid="arena-training">
                <span>
                  {t('trainingFocus')} <Info label={t('aboutTraining')}>{t('trainingInfo', { blurb: trainingBlurb(game.training) })}</Info>
                </span>
                <select className="input" value={game.training} onChange={(e) => store.setTraining(e.target.value as TrainingFocus)} data-testid="arena-training-select">
                  {(Object.keys(TRAINING) as TrainingFocus[]).map((k) => (
                    <option key={k} value={k}>
                      {trainingLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              {t('captain')}
              <select className="input" value={game.captainId ?? ''} onChange={(e) => store.setCaptain(e.target.value)} data-testid="arena-captain">
                <option value="" disabled>
                  {t('chooseCaptain')}
                </option>
                {xi.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t('captainOption', { name: p.name, n: p.attributes.mentality })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="panel col bottom-bar arena-actions" ref={barRef} data-testid="arena-actions">
            {problems.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{t('assistantFills', { problem: problems[0] })}</div>}
            <div className="small muted arena-vs">{opp ? t('versus', { label: logicLine(info.label), club: opp.club.name }) : t('noOpponent')}</div>
            <button className="btn primary big block" onClick={() => void store.playArenaStepSoon(true, prepareStep)} disabled={!opp || store.playingWeek} aria-busy={store.playingWeek || undefined} data-testid="arena-live" title={t('manageTip')}>
              {t('manage')}
            </button>
            <div className="row wrap arena-more-calls" style={{ gap: 8 }}>
              <button className="btn" onClick={() => void store.playArenaStepSoon(false, prepareStep)} disabled={!opp || store.playingWeek} aria-busy={store.playingWeek || undefined} data-testid="arena-sim" title={t('simTip')}>
                {t(cup ? 'simTie' : gauntlet ? 'simRung' : 'simFinal')}
              </button>
              {(gauntlet || cup) && (
                <button className="btn ghost" onClick={() => void askConfirm(t(cup ? 'simEndCupConfirm' : 'simEndConfirm'), { ok: t('simEnd') }).then((ok) => { if (ok) afterPaint(() => store.simArenaToEnd()) })} disabled={!opp || store.playingWeek || simming} aria-busy={simming || undefined} data-testid="arena-sim-end" title={t(cup ? 'simEndCupTip' : 'simEndTip')}>
                  {t(simming ? 'simming' : 'simEnd')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
