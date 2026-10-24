import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { FORMATIONS, getFormation } from '@engine/formations'
import { randomSeed } from '@engine/rng'
import { h2hComplete, h2hEligibleSlots, h2hUsable } from '@engine/h2h'
import { isComplete, picksMade, fillingXI, suggestSlot } from '@engine/draft'
import { TIER_LABEL } from '@engine/season'
import { H2H_IDS } from '@game/logic/h2h'
import { Wheel } from '../components/Wheel'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Segmented, Stat } from '../components/bits'
import { clubName, ordinal, seasonLabel } from '../format'
import { leagueSegments } from '../components/leagueSegments'
import { renderShareCard, downloadDataUrl } from '../shareCard'

export function H2HSetup() {
  const { universe: u, startH2H, go, ensureLeagues, loadingLeagues, loadedLeagues } = useStore()
  const [leagueId, setLeagueId] = useState('england')
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>('league')
  const [names, setNames] = useState(['Manager 1', 'Manager 2'])
  const [formations, setFormations] = useState(['4-3-3', '4-4-2'])
  const [leagueSeason, setLeagueSeason] = useState(() => (u ? Math.max(...u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season)) : 2025))
  const [hosts, setHosts] = useState(['', ''])
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>('calibrated')
  const [hardMode, setHardMode] = useState(false)
  const [seed, setSeed] = useState(() => randomSeed())
  if (!u) return null
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort()
  const effectiveSeason = seasons.includes(leagueSeason) ? leagueSeason : seasons[seasons.length - 1]
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === effectiveSeason).map((cs) => cs.clubId).sort()
  const wheelLeagues = wheelScope === 'europe' ? u.available.map((l) => l.id) : [leagueId]
  const ready = wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(leagueId)
  const host0 = clubs.includes(hosts[0]) ? hosts[0] : clubs[Math.floor(clubs.length / 3)]
  const host1 = clubs.includes(hosts[1]) && hosts[1] !== host0 ? hosts[1] : clubs.find((c) => c !== host0) ?? clubs[0]
  const short = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'MGR'
  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <div>
          <h1>Head-to-head</h1>
          <div className="muted small">Two managers, one device, one wheel. Alternate picks from the same squads, then both sides play the same season.</div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Back
        </button>
      </div>
      <div className="grid two">
        {[0, 1].map((i) => (
          <div key={i} className="panel col">
            <h3>Manager {i + 1}</h3>
            <label className="field">
              Name
              <input className="input" value={names[i]} maxLength={24} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
            </label>
            <label className="field">
              Formation
              <select className="input" value={formations[i]} onChange={(e) => setFormations(formations.map((f, j) => (j === i ? e.target.value : f)))}>
                {FORMATIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}: {f.blurb}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Club whose place you take
              <select className="input" value={i === 0 ? host0 : host1} onChange={(e) => setHosts(hosts.map((h, j) => (j === i ? e.target.value : h)))}>
                {clubs.filter((c) => (i === 0 ? c !== host1 : c !== host0)).map((c) => (
                  <option key={c} value={c}>
                    {clubName(u, c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        <div className="panel col">
          <h3>The league</h3>
          <div className="field">
            League
            <Segmented value={leagueId} onChange={(id) => { setLeagueId(id); setHosts(['', '']); void ensureLeagues(wheelScope === 'europe' ? u.available.map((l) => l.id) : [id]) }} options={u.available.map((l) => ({ value: l.id, label: l.name }))} />
          </div>
          <div className="field">
            Draft from
            <Segmented value={wheelScope} onChange={(sc) => { setWheelScope(sc); void ensureLeagues(sc === 'europe' ? u.available.map((l) => l.id) : [leagueId]) }} options={[{ value: 'league', label: 'This league' }, { value: 'europe', label: 'All five leagues' }]} />
          </div>
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
            Difficulty
            <Segmented value={difficulty} onChange={setDifficulty} options={[{ value: 'calibrated', label: 'Calibrated' }, { value: 'realistic', label: 'Realistic' }]} />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
            Hard mode: ratings hidden
          </label>
          <label className="field">
            Seed
            <div className="row">
              <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
              <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                New
              </button>
            </div>
          </label>
        </div>
        <div className="col">
          <div className="panel">
            <h3>How it works</h3>
            <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Each spin lands on one club-season for both of you. The first picker takes a player, then the other picks from what is left.</li>
              <li>Pick order snakes: whoever went second picks first on the next spin.</li>
              <li>A player can only be drafted by one manager. If nobody in the squad fits your open slots, you miss that spin.</li>
              <li>Both XIs then play the full season in the same league, including two derbies against each other. Higher finish wins.</li>
            </ul>
          </div>
          <button className="btn primary big block" disabled={!ready || loadingLeagues} onClick={() => startH2H([{ name: names[0] || 'Manager 1', shortName: short(names[0] || 'Manager 1'), formationId: formations[0], hostClubId: host0 }, { name: names[1] || 'Manager 2', shortName: short(names[1] || 'Manager 2'), formationId: formations[1], hostClubId: host1 }], leagueId, wheelLeagues, effectiveSeason, difficulty, hardMode, seed.trim() || randomSeed())}>
            {ready ? 'Start the head-to-head' : 'Loading league data…'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function H2HScreen() {
  const { universe: u, h2h, h2hSpin, h2hPick, h2hAuto, h2hFinish, abandonH2H, go, showToast } = useStore()
  const [spinning, setSpinning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const segments = useMemo(() => {
    if (!u || !h2h) return []
    if (h2h.wheelLeagues.length > 1) return leagueSegments(u, h2h.wheelLeagues)
    return [...u.clubs].filter((c) => h2h.wheelLeagues.includes(c.leagueId)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, label: c.code, colour: c.colours.primary, secondary: c.colours.secondary }))
  }, [u, h2h?.wheelLeagues])
  const wheelTarget = useMemo(() => {
    if (!u || !h2h?.draft.current) return null
    const cs = u.clubSeasonByKey[`${h2h.draft.current.clubId}@${h2h.draft.current.season}`]
    return h2h.wheelLeagues.length > 1 ? `league:${cs?.leagueId ?? ''}` : h2h.draft.current.clubId
  }, [u, h2h?.draft.current, h2h?.wheelLeagues])
  const d = h2h?.draft
  useEffect(() => {
    if (d?.current) {
      setSpinning(true)
      setRevealed(false)
      setSelectedPlayer(null)
    }
  }, [d?.spins])
  if (!u || !h2h || !d) return <H2HSetup />
  if (h2h.result) return <H2HSummary />
  const current = d.current ? u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] : null
  const complete = h2hComplete(d)
  const picking = d.picking
  const manager = picking !== null ? h2h.managers[picking] : null
  const usable = h2hUsable(u, d)
  const usableIds = new Set(usable.map((p) => p.id))
  const selected = selectedPlayer ? u.index[selectedPlayer] : undefined
  const eligible = selected ? h2hEligibleSlots(d, selected).map((s) => s.id) : []
  const hide = h2h.hardMode
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
    <div className={`page ${hide ? 'hidden-ratings' : ''}`}>
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div>
          <h1>Head-to-head draft</h1>
          <div className="muted small">
            {h2h.managers[0].name} v {h2h.managers[1].name} · {seasonLabel(h2h.leagueSeason)} league · seed {h2h.seed}
          </div>
        </div>
        <div className="row">
          {manager && !spinning && <span className="chip good">{manager.name} to pick</span>}
          <button className="btn ghost sm" onClick={() => confirm('Abandon this head-to-head?') && abandonH2H()}>
            Abandon
          </button>
        </div>
      </div>
      <div className="grid draft">
        <div className="col">
          <div className="panel col">
            <Wheel segments={segments} targetId={wheelTarget} year={d.current?.season ?? null} spinning={spinning} onSettled={() => { setSpinning(false); setRevealed(true) }} />
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
          <div className="panel tight">
            <div className="small muted">Draft log</div>
            <div className="col small" style={{ gap: 2, maxHeight: 200, overflow: 'auto' }}>
              {[...d.log].reverse().slice(0, 30).map((l, i) => (
                <div key={i} className="muted">
                  {l}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel col">
          {!current && (
            <div className="col" style={{ alignItems: 'center', padding: '40px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>🎡</div>
              <h3>{complete ? 'Both squads complete' : `Spin: ${h2h.managers[d.first].name} picks first`}</h3>
            </div>
          )}
          {current && (
            <>
              <div className="row">
                <ClubBadge clubId={current.clubId} size={44} />
                <div>
                  <h2 style={{ fontSize: 26 }}>{clubName(u, current.clubId)}</h2>
                  <div className="muted small">
                    {seasonLabel(current.season)} · {current.complete ? (current.champions ? '🏆 Champions' : ordinal(current.position)) : 'in progress'}
                  </div>
                </div>
              </div>
              {revealed && manager && <div className="notice">{manager.name}, pick a player{selected ? ` and a slot for ${selected.name} on your pitch` : ''}.</div>}
              {revealed && (
                <div className="plist" style={{ maxHeight: 560, overflow: 'auto' }}>
                  {[...current.squad]
                    .sort((a, b) => b.overall - a.overall)
                    .map((p) => {
                      const takenBy = d.drafts.findIndex((x) => x.takenPlayers.includes(p.playerId) && (Object.values(x.lineup).includes(p.id) || x.bench.includes(p.id)))
                      return (
                        <PlayerRow key={p.id} p={p} hideRatings={hide} dim={!usableIds.has(p.id)} selected={selectedPlayer === p.id} onClick={() => onPick(p.id)} extra={takenBy >= 0 ? <span className="chip">{h2h.managers[takenBy].shortName}</span> : null} right={usableIds.has(p.id) ? <span className="btn sm primary">Draft</span> : null} />
                      )
                    })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="col draft-pitch">
          {([0, 1] as const).map((i) => (
            <div key={i} className="panel" style={{ borderColor: picking === i ? 'var(--accent)' : undefined }}>
              <div className="panel-head">
                <h3>
                  {h2h.managers[i].name} · {h2h.managers[i].formationId}
                </h3>
                <span className="small muted">
                  {picksMade(d.drafts[i])}/{d.drafts[i].rules.squadSize}
                  {isComplete(d.drafts[i]) ? ' ✓' : ''}
                </span>
              </div>
              <Pitch formation={d.drafts[i].formation} lineup={d.drafts[i].lineup} getPlayer={(id) => u.index[id]} onSlotClick={(s) => onSlot(i, s)} eligibleSlots={picking === i ? eligible : []} hideRatings={hide} />
              {selected && picking === i && suggestSlot(d.drafts[i], selected) && suggestSlot(d.drafts[i], selected) !== 'bench' && (
                <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(i, suggestSlot(d.drafts[i], selected) as string)}>
                  Put {selected.name} at {d.drafts[i].formation.slots.find((s) => s.id === suggestSlot(d.drafts[i], selected))?.position}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn ghost sm" onClick={() => go('home')}>
          Home
        </button>
      </div>
    </div>
  )
}

function H2HSummary() {
  const { universe: u, h2h, abandonH2H, go, showToast } = useStore()
  const [copied, setCopied] = useState(false)
  if (!u || !h2h?.result) return null
  const r = h2h.result
  const m = h2h.managers
  const text = [
    `Touchline · Head-to-head · ${seasonLabel(h2h.leagueSeason)}`,
    ...([0, 1] as const).map((i) => `${m[i].name}: ${TIER_LABEL[r.tiers[i]]} · ${r.rows[i].won}W ${r.rows[i].drawn}D ${r.rows[i].lost}L · ${r.rows[i].points} pts · ${ordinal(r.positions[i])}`),
    `Derbies: ${r.derbies.map((dby) => `${m[dby.homeIdx].shortName} ${dby.homeGoals}-${dby.awayGoals} ${m[dby.homeIdx === 0 ? 1 : 0].shortName}`).join(', ')}`,
    r.winner === null ? 'Dead heat.' : `${m[r.winner].name} wins.`,
    `Seed ${h2h.seed}`,
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
  return (
    <div className="page">
      <div className="tier-banner">
        <div className="muted small">Head-to-head · {seasonLabel(h2h.leagueSeason)}</div>
        <div className="tier CHAMPIONS">{r.winner === null ? 'Dead heat' : `${m[r.winner].name} wins`}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 30, marginTop: 10, flexWrap: 'wrap' }}>
          {([0, 1] as const).map((i) => (
            <div key={i} className="col" style={{ alignItems: 'center' }}>
              <h3 style={{ color: 'var(--text)' }}>{m[i].name}</h3>
              <div className="small muted">
                as {clubName(u, m[i].hostClubId)} · {TIER_LABEL[r.tiers[i]]}
              </div>
              <div className="record" style={{ fontSize: 26 }}>
                <span className="w">{r.rows[i].won}W</span>
                <span className="d">{r.rows[i].drawn}D</span>
                <span className="l">{r.rows[i].lost}L</span>
              </div>
              <div className="row" style={{ gap: 18 }}>
                <Stat label="Points" value={r.rows[i].points} />
                <Stat label="Finished" value={ordinal(r.positions[i])} />
                <Stat label="Rating" value={r.strengths[i].toFixed(1)} />
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={copy}>
            {copied ? 'Copied!' : 'Copy result'}
          </button>
          {([0, 1] as const).map((i) => (
            <button
              key={i}
              className="btn"
              onClick={() => {
                try {
                  const url = renderShareCard({
                    title: m[i].name,
                    subtitle: `as ${clubName(u, m[i].hostClubId)} · head-to-head v ${m[i === 0 ? 1 : 0].name} · ${seasonLabel(h2h.leagueSeason)}`,
                    tier: r.tiers[i],
                    row: r.rows[i],
                    position: r.positions[i],
                    formation: getFormation(m[i].formationId),
                    lineup: h2h.draft.drafts[i].lineup,
                    getPlayer: (id) => u.index[id],
                    footer: `${r.winner === null ? 'Dead heat' : r.winner === i ? 'Winner' : 'Runner-up'} · Seed ${h2h.seed}`,
                    hideRatings: h2h.hardMode,
                  })
                  downloadDataUrl(url, `touchline-h2h-${m[i].name.replace(/\s+/g, '-').toLowerCase()}.png`)
                } catch {
                  showToast('Could not render the card.')
                }
              }}
            >
              Card: {m[i].shortName}
            </button>
          ))}
          <button className="btn" onClick={() => { abandonH2H(); go('h2h') }}>
            Rematch
          </button>
          <button className="btn ghost" onClick={() => abandonH2H()}>
            Home
          </button>
        </div>
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="col">
          <div className="panel">
            <h3>Derbies</h3>
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
          {([0, 1] as const).map((i) => (
            <div key={i} className="panel">
              <h3>{m[i].name}'s XI</h3>
              <Pitch formation={h2h.draft.drafts[i].formation} lineup={h2h.draft.drafts[i].lineup} getPlayer={(id) => u.index[id]} />
              {r.topScorers[i] && u.index[r.topScorers[i]!.playerSeasonId] && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  Top scorer: {u.index[r.topScorers[i]!.playerSeasonId].name}, {r.topScorers[i]!.goals} goals
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="col">
          <div className="panel">
            <h3>Final table</h3>
            <table className="tbl">
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
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          {idx !== null ? <ClubBadge clubId={m[idx].hostClubId} size={22} /> : <ClubBadge clubId={row.teamId} size={22} />}
                          {idx !== null ? m[idx].name : clubName(u, row.teamId)}
                        </span>
                      </td>
                      <td className="num">{row.won}</td>
                      <td className="num">{row.drawn}</td>
                      <td className="num">{row.lost}</td>
                      <td className="num">{row.goalsFor - row.goalsAgainst}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {row.points}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h3>Share text</h3>
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-2)' }}>
              {text}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
