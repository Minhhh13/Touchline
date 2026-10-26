import { useMemo, useState } from 'react'
import { Check, ChevronDown, CircleCheck, Copy, Dices, Footprints, ImageDown, Lock, Repeat, RotateCcw, Swords, Trophy, Users, Wifi, type LucideIcon } from 'lucide-react'
import { useStore, type H2HGame } from '@game/store'
import { APP_NAME } from '../brand'
import { getFormation } from '@engine/formations'
import { randomSeed } from '@engine/rng'
import { poolClubSeasons } from '@engine/universe'
import { h2hComplete, h2hEligibleSlots, h2hUsable, type H2HDraft } from '@engine/h2h'
import { isComplete, picksMade, fillingXI, suggestSlot, type DraftState } from '@engine/draft'
import { H2H_IDS, type H2HManager, type H2HResult } from '@game/logic/h2h'
import { CaseReel, TierChip } from '../components/CaseReel'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Info, Segmented, Stat, TeamBadge } from '../components/bits'
import { FormationPicker } from '../components/FormationPicker'
import { LeagueFlag } from '../components/Flag'
import { clubName, ordinal, seasonLabel, tierName, formationName } from '../format'
import { TeamNameField } from '../components/SetupBits'
import { tierTable } from '@game/logic/rarity'
import { h2hReelPool, reelLeagues } from '@game/logic/reel'
import { h2hTierOdds } from '@game/logic/tierOdds'
import { SpinOdds } from '../components/SpinOdds'
import { renderShareCard, downloadDataUrl } from '../shareCard'
import { GameByGame } from '../components/GameByGame'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { onlineAvailable } from '../../online/api'
import { RoomSetup } from '../online/Rooms'

/** The head-to-head a Rematch came from: the setup opens with its managers, clubs, league and rules (on a new wheel). */
let rematchOf: H2HGame | null = null

export function H2HSetup() {
  const { universe: u, startH2H, go, ensureLeagues, loadingLeagues, loadedLeagues } = useStore()
  const [last] = useState(() => rematchOf)
  const [leagueId, setLeagueId] = useState(last?.leagueId ?? 'england')
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>((last?.wheelLeagues.length ?? 1) > 1 ? 'europe' : 'league')
  const [names, setNames] = useState(last ? last.managers.map((m) => m.name) : ['Manager 1', 'Manager 2'])
  const [formations, setFormations] = useState(last ? last.managers.map((m) => m.formationId) : ['4-3-3', '4-4-2'])
  const [leagueSeason, setLeagueSeason] = useState(() => last?.leagueSeason ?? (u ? Math.max(...u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season)) : 2025))
  const [hosts, setHosts] = useState(last ? last.managers.map((m) => m.hostClubId) : ['', ''])
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>(last?.difficulty ?? 'calibrated')
  const [hardMode, setHardMode] = useState(last?.hardMode ?? false)
  const [seed, setSeed] = useState(() => randomSeed())
  // Two devices instead of one: only in a build with the online layer (an offline build shows exactly the hot-seat setup)
  const [where, setWhere] = useState<'device' | 'online'>('device')
  if (!u) return null
  const online = onlineAvailable()
  const back = (
    <button className="btn ghost" onClick={() => go('home')}>
      ← Back
    </button>
  )
  const switcher = online ? <Segmented value={where} onChange={setWhere} options={[{ value: 'device', label: <><Users size={14} aria-hidden="true" /> This device</>, testId: 'h2h-where-device' }, { value: 'online', label: <><Wifi size={14} aria-hidden="true" /> Play online</>, testId: 'h2h-where-online' }]} /> : null
  if (online && where === 'online')
    return (
      <div className="page">
        <div className="screen-head">
          <div className="screen-title">
            <h1>Head-to-head</h1>
            <div className="screen-meta">
              <span>Two managers, two devices, one wheel</span>
            </div>
          </div>
          <div className="toolbar">
            {switcher}
            {back}
          </div>
        </div>
        <RoomSetup />
      </div>
    )
  const seasons = [...new Set(poolClubSeasons(u, false).filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort()
  const effectiveSeason = seasons.includes(leagueSeason) ? leagueSeason : seasons[seasons.length - 1]
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === effectiveSeason).map((cs) => cs.clubId).sort()
  const wheelLeagues = wheelScope === 'europe' ? u.available.map((l) => l.id) : [leagueId]
  const ready = wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(leagueId)
  const host0 = clubs.includes(hosts[0]) ? hosts[0] : clubs[Math.floor(clubs.length / 3)]
  const host1 = clubs.includes(hosts[1]) && hosts[1] !== host0 ? hosts[1] : clubs.find((c) => c !== host0) ?? clubs[0]
  const short = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'MGR'
  const nameOf = (i: number) => names[i].trim() || `Manager ${i + 1}`
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Head-to-head</h1>
          <div className="screen-meta">
            <span>Two managers, one device, one wheel</span>
          </div>
        </div>
        {switcher ? (
          <div className="toolbar">
            {switcher}
            {back}
          </div>
        ) : (
          back
        )}
      </div>
      <div className="screen-body scroll-whole fill">
      <ol className="steps" aria-label="How a head-to-head works">
        {H2H_STEPS.map(({ Icon, title, line }) => (
          <li key={title}>
            <span className="step-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span>
              <b>{title}</b>
              <span className="small muted">{line}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="grid two">
        {[0, 1].map((i) => {
          // No club until the league's pack has loaded (a league just picked, or offline): no badge until then
          const host: string | undefined = i === 0 ? host0 : host1
          return (
            <div key={i} className="panel col">
              <div className="club-head">
                {host ? <ClubBadge clubId={host} size={36} /> : null}
                <h3 style={{ margin: 0 }}>Manager {i + 1}</h3>
              </div>
              <TeamNameField label="Name" value={names[i]} onChange={(v) => setNames(names.map((n, j) => (j === i ? v : n)))} fallback={`Manager ${i + 1}`} maxLength={24} testId={`h2h-name-${i}`} taken={[names[1 - i]]} />
              <div className="field formation-field">
                Formation
                <FormationPicker value={formations[i]} onChange={(id) => setFormations(formations.map((f, j) => (j === i ? id : f)))} label={`Manager ${i + 1} formation`} testId={`h2h-formation-${i}`} />
                <span className="help">{getFormation(formations[i]).blurb}</span>
              </div>
              <label className="field">
                Club whose place you take
                <select className="input" value={host ?? ''} onChange={(e) => setHosts(hosts.map((h, j) => (j === i ? e.target.value : h)))}>
                  {clubs.filter((c) => (i === 0 ? c !== host1 : c !== host0)).map((c) => (
                    <option key={c} value={c}>
                      {clubName(u, c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        })}
        <div className="panel col h2h-league">
          <h3 style={{ margin: 0 }}>The league</h3>
          <div className="grid two">
          <div className="col">
          <div className="field">
            League
            <Segmented value={leagueId} onChange={(id) => { setLeagueId(id); setHosts(['', '']); void ensureLeagues(wheelScope === 'europe' ? u.available.map((l) => l.id) : [id]) }} options={u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</> }))} />
          </div>
          <div className="field">
            Draft from
            <Segmented value={wheelScope} onChange={(sc) => { setWheelScope(sc); void ensureLeagues(sc === 'europe' ? u.available.map((l) => l.id) : [leagueId]) }} options={[{ value: 'league', label: <><LeagueFlag leagueId={leagueId} /> This league</> }, { value: 'europe', label: <><LeagueFlag leagueId="europe" /> All {u.available.length} leagues</> }]} />
          </div>
          </div>
          <div className="col">
          <label className="field">
            Season
            <select className="input" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))}>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>
              Difficulty <Info label="About difficulty">Calibrated scales the real clubs so an average draft finishes mid-table; Realistic plays them as they were.</Info>
            </span>
            <Segmented value={difficulty} onChange={setDifficulty} options={[{ value: 'calibrated', label: 'Calibrated' }, { value: 'realistic', label: 'Realistic' }]} />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
            Hard mode <Info label="About hard mode">Ratings stay hidden while you both draft.</Info>
          </label>
          <div className="field">
            <span>
              Seed <Info label="About seeds">The same seed gives the same spins, so a rematch on it replays the wheel.</Info>
            </span>
            <div className="row">
              <input className="input mono" aria-label="Seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
              <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                New
              </button>
            </div>
          </div>
          </div>
          </div>
        </div>
        <div className="h2h-start">
          <button className="btn primary big block" data-testid="h2h-start" disabled={!ready || loadingLeagues || !host0 || !host1} onClick={() => startH2H([{ name: nameOf(0), shortName: short(nameOf(0)), formationId: formations[0], hostClubId: host0 }, { name: nameOf(1), shortName: short(nameOf(1)), formationId: formations[1], hostClubId: host1 }], leagueId, wheelLeagues, effectiveSeason, difficulty, hardMode, seed.trim() || randomSeed())}>
            {ready ? 'Start the head-to-head' : 'Loading league data…'}
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}

export function H2HScreen() {
  const { universe: u, h2h, h2hSpin, h2hPick, h2hAuto, h2hFinish, abandonH2H, go, showToast } = useStore()
  // As in the Draft: the spin whose reel has landed, and a selection that belongs to its spin
  const [settled, setSettled] = useState<H2HDraft['current']>(null)
  const [picked, setPicked] = useState<{ id: string; spin: number } | null>(null)
  const d = h2h?.draft
  const spinning = !!d?.current && settled !== d.current
  const revealed = !!d?.current && settled === d.current
  const selectedPlayer = picked && picked.spin === d?.spins ? picked.id : null
  const setSelectedPlayer = (id: string | null) => setPicked(id && d ? { id, spin: d.spins } : null)
  const pool = useMemo(
    () => (u && h2h ? h2hReelPool(u, h2h.draft) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, h2h?.draft.spins, h2h?.draft.log.length],
  )
  // The leagues the wheel draws from are the draft rules' (an older save may lack `wheelLeagues`)
  const rules = h2h?.draft.drafts[0].rules
  const leagues = useMemo(() => (u && rules ? reelLeagues(u, rules) : []), [u, rules])
  // The exact tier odds of the next spin, shown between spins
  const odds = useMemo(() => (u && h2h && !h2h.draft.current && !h2hComplete(h2h.draft) ? h2hTierOdds(u, h2h.draft, leagues) : []), [u, h2h, leagues])
  if (!u || !h2h || !d) return <H2HSetup />
  if (h2h.result) return <H2HSummary />
  const current = d.current ? u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] : null
  const tier = current ? tierTable(u, leagues)[`${current.clubId}@${current.season}`] : undefined
  const complete = h2hComplete(d)
  const picking = d.picking
  const manager = picking !== null ? h2h.managers[picking] : null
  const usable = h2hUsable(u, d)
  const usableIds = new Set(usable.map((p) => p.id))
  const selected = selectedPlayer ? u.index[selectedPlayer] : undefined
  const eligible = selected ? h2hEligibleSlots(d, selected).map((s) => s.id) : []
  // Hard mode hides the players on offer; each manager's own picks show
  const hide = ratingHidden(d.drafts[0].rules, 'offer')
  const onPick = (pid: string) => {
    if (picking === null) return
    const p = u.index[pid]
    const slots = h2hEligibleSlots(d, p)
    const myDraft = d.drafts[picking]
    if (fillingXI(myDraft)) {
      if (slots.length === 1) h2hPick(pid, slots[0].id)
      else setSelectedPlayer(pid)
    } else h2hPick(pid, 'bench')
  }
  const onSlot = (idx: 0 | 1, slotId: string) => {
    if (!selected || picking !== idx) return
    if (!eligible.includes(slotId)) {
      showToast(`${selected.name} cannot play there`)
      return
    }
    h2hPick(selected.id, slotId)
    setSelectedPlayer(null)
  }
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Head-to-head draft</h1>
          <div className="screen-meta">
            <span>
              {h2h.managers[0].name} v {h2h.managers[1].name}
            </span>
            <span>
              <LeagueFlag leagueId={h2h.leagueId} /> {u.leagues.find((l) => l.id === h2h.leagueId)?.name ?? 'League'} {seasonLabel(h2h.leagueSeason)}
            </span>
            {h2h.hardMode && <span className="chip">Hard mode</span>}
            <span className="mono">seed {h2h.seed}</span>
          </div>
        </div>
        <div className="toolbar">
          {manager && !spinning && <span className="chip info">{manager.name} to pick</span>}
          <button className="btn ghost sm" onClick={() => go('home')}>
            Home
          </button>
          <button className="btn ghost sm danger" onClick={() => confirm('Abandon this head-to-head?') && abandonH2H()}>
            Abandon
          </button>
        </div>
      </div>
      <div className="grid draft fill">
        <div className="col">
          <div className="panel col">
            <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} onSettled={() => setSettled(d.current)} />
            {!d.current && !complete && <SpinOdds odds={odds} label="Next spin" />}
            {!complete && (
              <button className="btn primary spin-btn display" disabled={!!d.current || spinning} onClick={() => h2hSpin()}>
                {d.current ? (spinning ? 'Spinning…' : `${manager?.name ?? ''} picks`) : `Spin (${h2h.managers[d.first].name} first)`}
              </button>
            )}
            {complete && (
              <button className="btn primary spin-btn display" onClick={() => h2hFinish()}>
                Play the season
              </button>
            )}
            {picking !== null && revealed && (
              <button className="btn sm ghost" onClick={() => h2hAuto()}>
                Let the assistant pick for {manager?.name}
              </button>
            )}
          </div>
          {d.log.length > 0 && (
            <div className="panel tight">
              <div className="eyebrow">Draft log</div>
              <ol className="h2h-log">
                {[...d.log].reverse().slice(0, 30).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className="panel col">
          {!current && (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                {complete ? <CircleCheck size={26} /> : <Dices size={26} />}
              </span>
              <h3>{complete ? 'Both squads complete' : `Spin: ${h2h.managers[d.first].name} picks first`}</h3>
              {!complete && <p className="muted small">One spin, one club-season, a pick each.</p>}
            </div>
          )}
          {current && spinning && !revealed && (
            <div className="club-head">
              <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
              <div>
                <h2>Opening…</h2>
                <div className="muted small">Landing on a club and a season</div>
              </div>
            </div>
          )}
          {current && (!spinning || revealed) && (
            <>
              <div className="club-head">
                <ClubBadge clubId={current.clubId} size={44} />
                <div>
                  <h2>{clubName(u, current.clubId)}</h2>
                  <div className="club-sub">
                    <span>{seasonLabel(current.season)}</span>
                    {!current.complete ? (
                      <span>season in progress</span>
                    ) : current.champions ? (
                      <span className="chip gold icon-chip">
                        <Trophy size={12} aria-hidden="true" /> Champions
                      </span>
                    ) : current.position > 0 ? (
                      <span>{ordinal(current.position)}</span>
                    ) : (
                      <span>no table on record</span>
                    )}
                    {tier && <TierChip tier={tier} />}
                  </div>
                </div>
              </div>
              {revealed && manager && <div className="notice">{manager.name}, pick a player{selected ? ` and a slot for ${selected.name} on your pitch` : ''}.</div>}
              {revealed && (
                <div className="plist lined draft-list">
                  {[...current.squad]
                    .sort((a, b) => b.overall - a.overall)
                    .map((p) => {
                      const takenBy = d.drafts.findIndex((x) => x.takenPlayers.includes(p.playerId) && (Object.values(x.lineup).includes(p.id) || x.bench.includes(p.id)))
                      return (
                        <PlayerRow key={p.id} p={p} hideRatings={hide} hideChampion={current.champions} dim={!usableIds.has(p.id)} selected={selectedPlayer === p.id} onClick={() => onPick(p.id)} extra={takenBy >= 0 ? <span className="chip info">{h2h.managers[takenBy].shortName}</span> : null} right={usableIds.has(p.id) ? <span className={`btn sm ${selectedPlayer === p.id ? 'primary' : ''}`}>Draft</span> : null} />
                      )
                    })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="col draft-pitch">
          {([0, 1] as const).map((i) => (
            <div key={i} className={`panel ${picking === i ? 'emphasis' : ''}`}>
              <div className="panel-head">
                <span className="club-head">
                  <ClubBadge clubId={h2h.managers[i].hostClubId} size={24} />
                  <h3>
                    {h2h.managers[i].name} · {formationName(h2h.managers[i].formationId)}
                  </h3>
                </span>
                <span className={`chip icon-chip ${isComplete(d.drafts[i]) ? 'good' : ''}`}>
                  {isComplete(d.drafts[i]) && <CircleCheck size={12} aria-hidden="true" />}
                  {picksMade(d.drafts[i])}/{d.drafts[i].rules.squadSize}
                </span>
              </div>
              <div className="h2h-pitch-box">
                <Pitch formation={d.drafts[i].formation} lineup={d.drafts[i].lineup} getPlayer={(id) => u.index[id]} onSlotClick={(s) => onSlot(i, s)} eligibleSlots={picking === i ? eligible : []} hideRatings={ratingHidden(d.drafts[i].rules, 'squad')} />
              </div>
              {selected && picking === i && suggestSlot(d.drafts[i], selected) && suggestSlot(d.drafts[i], selected) !== 'bench' && (
                <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(i, suggestSlot(d.drafts[i], selected) as string)}>
                  Put {selected.name} at {d.drafts[i].formation.slots.find((s) => s.id === suggestSlot(d.drafts[i], selected))?.position}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function H2HSummary() {
  const { h2h, abandonH2H, go } = useStore()
  if (!h2h?.result) return null
  return <H2HResultView managers={h2h.managers} result={h2h.result} drafts={h2h.draft.drafts} leagueId={h2h.leagueId} leagueSeason={h2h.leagueSeason} seed={h2h.seed} onRematch={() => { rematchOf = h2h; abandonH2H(); go('h2h') }} onHome={() => abandonH2H()} />
}

export interface H2HResultViewProps {
  managers: [H2HManager, H2HManager]
  result: H2HResult
  drafts: [DraftState, DraftState]
  leagueId: string
  leagueSeason: number
  seed: string
  onRematch: () => void
  onHome: () => void
  /** The banner's mode line: "Head-to-head" (hot-seat) or "Online head-to-head". */
  label?: string
  rematchLabel?: string
  testId?: string
}

/** A head-to-head's result, hot-seat or online: the banner with both sides, the derbies, the XIs and the table. */
export function H2HResultView({ managers: m, result: r, drafts, leagueId, leagueSeason, seed, onRematch, onHome, label = 'Head-to-head', rematchLabel = 'Rematch', testId }: H2HResultViewProps) {
  const { universe: u, showToast } = useStore()
  const [copied, setCopied] = useState(false)
  if (!u) return null
  const text = [
    `${APP_NAME} · ${label} · ${seasonLabel(leagueSeason)}`,
    ...([0, 1] as const).map((i) => `${m[i].name}: ${tierName(r.tiers[i], r.positions[i])} · ${r.rows[i].won}-${r.rows[i].drawn}-${r.rows[i].lost} · ${r.rows[i].points} pts · ${ordinal(r.positions[i])}`),
    `Derbies: ${r.derbies.map((dby) => `${m[dby.homeIdx].shortName} ${dby.homeGoals}-${dby.awayGoals} ${m[dby.homeIdx === 0 ? 1 : 0].shortName}`).join(', ')}`,
    r.winner === null ? 'Dead heat.' : `${m[r.winner].name} wins.`,
    `Seed ${seed}`,
  ].join('\n')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast('Could not copy.')
    }
  }
  const card = async (i: 0 | 1) => {
    try {
      const url = await renderShareCard({
        title: m[i].name,
        subtitle: `Head-to-head v ${m[i === 0 ? 1 : 0].name} · ${u.leagues.find((l) => l.id === leagueId)?.name ?? ''} ${seasonLabel(leagueSeason)}`,
        tier: r.tiers[i],
        row: r.rows[i],
        position: r.positions[i],
        formation: getFormation(m[i].formationId),
        lineup: drafts[i].lineup,
        getPlayer: (id) => u.index[id],
        footer: `${r.winner === null ? 'Dead heat' : r.winner === i ? 'Winner' : 'Runner-up'} · Seed ${seed}`,
        hideRatings: ratingHidden(drafts[i].rules, 'squad'),
      })
      downloadDataUrl(url, `touchline-h2h-${m[i].name.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast('Could not render the card.')
    }
  }
  return (
    <div className="page summary" data-testid={testId}>
      <div className="tier-banner">
        <div className="banner-meta">
          <span className="bm-team">
            <Swords size={16} aria-hidden="true" /> {label}
          </span>
          <span className="bm-rest">
            <LeagueFlag leagueId={leagueId} label={u.leagues.find((l) => l.id === leagueId)?.name} /> {seasonLabel(leagueSeason)}
          </span>
        </div>
        <div className={`tier ${r.winner === null ? '' : 'CHAMPIONS'}`}>{r.winner === null ? 'Dead heat' : `${m[r.winner].name} wins`}</div>
        <div className="h2h-sides">
          {([0, 1] as const).map((i) => (
            <div key={i} className={`h2h-side ${r.winner === i ? 'won' : ''}`}>
              <div className="club-head">
                <TeamBadge code={m[i].shortName} size={36} />
                <div style={{ textAlign: 'left' }}>
                  <h3 style={{ margin: 0 }}>{m[i].name}</h3>
                </div>
                {r.winner === i && <Trophy size={20} className="h2h-cup" role="img" aria-label="Winner" />}
              </div>
              <span className={`chip ${r.tiers[i] === 'CHAMPIONS' || r.tiers[i] === 'INVINCIBLE' || r.tiers[i] === 'PERFECT' ? 'gold' : ''}`}>{tierName(r.tiers[i], r.positions[i])}</span>
              <div className="record">
                <span className="w">{r.rows[i].won}W</span>
                <span className="d">{r.rows[i].drawn}D</span>
                <span className="l">{r.rows[i].lost}L</span>
              </div>
              <div className="banner-stats">
                <Stat label="Points" value={r.rows[i].points} />
                <Stat label="Finished" value={ordinal(r.positions[i])} />
                <Stat label="Rating" value={r.strengths[i].toFixed(1)} />
              </div>
            </div>
          ))}
        </div>
        <div className="banner-actions">
          <button className="btn primary" onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copied' : 'Copy result'}
          </button>
          {([0, 1] as const).map((i) => (
            <button key={i} className="btn" onClick={() => void card(i)}>
              <ImageDown size={16} aria-hidden="true" /> Card · {m[i].shortName}
            </button>
          ))}
          <button className="btn" onClick={onRematch} data-testid="h2h-rematch">
            <RotateCcw size={16} aria-hidden="true" /> {rematchLabel}
          </button>
          <button className="btn ghost" onClick={onHome}>
            Home
          </button>
        </div>
      </div>
      <div className="screen-body fill">
      <div className="grid two">
        <div className="col">
          <div className="panel">
            <h3>Derbies</h3>
            <div className="fixture-list h2h-derbies">
              {r.derbies.map((dby, i) => (
                <div key={i} className="fixture me">
                  <span className="mw">MW {dby.matchweek}</span>
                  <span className="h">{m[dby.homeIdx].name}</span>
                  <span className="sc">
                    {dby.homeGoals} - {dby.awayGoals}
                  </span>
                  <span>{m[dby.homeIdx === 0 ? 1 : 0].name}</span>
                </div>
              ))}
            </div>
          </div>
          {([0, 1] as const).map((i) => (
            <div key={i} className="panel">
              <div className="panel-head">
                <h3>{m[i].name}'s XI</h3>
                {r.topScorers[i] && u.index[r.topScorers[i]!.playerSeasonId] && (
                  <span className="chip good icon-chip" title="Top scorer">
                    <Footprints size={12} aria-hidden="true" /> {u.index[r.topScorers[i]!.playerSeasonId].name} · {r.topScorers[i]!.goals}
                  </span>
                )}
              </div>
              <Pitch formation={drafts[i].formation} lineup={drafts[i].lineup} getPlayer={(id) => u.index[id]} />
            </div>
          ))}
          {r.results?.map((games, i) => (
            <GameByGame key={i} results={games} title={`${m[i].name}, game by game`} compact opponent={(id) => (id === H2H_IDS[0] ? { clubId: m[0].hostClubId, name: m[0].name } : id === H2H_IDS[1] ? { clubId: m[1].hostClubId, name: m[1].name } : { clubId: id, name: clubName(u, id) })} />
          ))}
        </div>
        <div className="col">
          <div className="panel">
            <h3>Final table</h3>
            <div className="tbl-wrap">
              <table className="tbl h2h-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Club</th>
                    <th className="num">W</th>
                    <th className="num">D</th>
                    <th className="num">L</th>
                    <th className="num">GD</th>
                    <th className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {r.table.map((row, i) => {
                    const idx: 0 | 1 | null = row.teamId === H2H_IDS[0] ? 0 : row.teamId === H2H_IDS[1] ? 1 : null
                    return (
                      <tr key={row.teamId} className={idx !== null ? 'me' : ''}>
                        <td>{i + 1}</td>
                        {/* The club cell takes the width left and ends a long name in an ellipsis, so GD and Pts stay in view */}
                        <td className="h2h-club" title={idx !== null ? m[idx].name : clubName(u, row.teamId)}>
                          <span className="row" style={{ gap: 8 }}>
                            {idx !== null ? <TeamBadge code={m[idx].shortName} size={22} /> : <ClubBadge clubId={row.teamId} size={22} />}
                            <span className="h2h-club-name">{idx !== null ? m[idx].name : clubName(u, row.teamId)}</span>
                          </span>
                        </td>
                        <td className="num">{row.won}</td>
                        <td className="num">{row.drawn}</td>
                        <td className="num">{row.lost}</td>
                        <td className="num">{row.goalsFor - row.goalsAgainst > 0 ? '+' : ''}{row.goalsFor - row.goalsAgainst}</td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {row.points}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <details className="panel fold">
            <summary className="panel-head">
              <h3>Share text</h3>
              <ChevronDown size={16} className="fold-chevron" aria-hidden="true" />
            </summary>
            <pre className="mono small share-text">{text}</pre>
          </details>
        </div>
      </div>
      </div>
    </div>
  )
}

/** The four rules of a head-to-head, as pictures with a line each. */
const H2H_STEPS: Array<{ Icon: LucideIcon; title: string; line: string }> = [
  { Icon: Dices, title: 'One spin, two picks', line: 'Each spin lands on one club-season for both of you.' },
  { Icon: Repeat, title: 'Snake order', line: 'Whoever picked second picks first on the next spin.' },
  { Icon: Lock, title: 'One player, one manager', line: 'Nobody fits your open slots? You miss that spin.' },
  { Icon: Swords, title: 'Same season', line: 'Two derbies against each other; the higher finish wins.' },
]
