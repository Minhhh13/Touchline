import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { seasonTable } from '@engine/season'
import { RUN_IN_TEMPLATE_LABEL, runInShare, runInVerdict } from '@game/logic/runin'
import { gameLabel, storyForGame } from '@game/logic/story'
import { TableView } from '../components/TableView'
import { ClubBadge } from '../components/bits'
import { clubName, ordinal, seasonLabel } from '../format'

/** The end of a run-in: the brief's chip, the verdict against the real club, the ten games, the final table and the share text. */
export function RunInSummary() {
  const { universe: u, game, go, showToast } = useStore()
  const [copied, setCopied] = useState(false)
  const table = useMemo(() => (game?.season ? seasonTable(game.season) : []), [game?.season])
  const story = useMemo(() => (game && u ? storyForGame(game, u) : null), [game, u])
  // "Copied" reverts after a moment; the timer goes with the screen
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  if (!u || !game || !game.season) return null
  const v = runInVerdict(game, u)
  const text = runInShare(game, u)
  if (!v || !text) return null
  const host = game.settings.hostClubId
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      showToast('Could not copy. Select the text manually.')
    }
  }
  return (
    <div className="page">
      <div className="tier-banner" data-testid="runin-verdict" style={{ marginBottom: 12 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Run-in · {RUN_IN_TEMPLATE_LABEL[v.template]} · {clubName(u, host)} {seasonLabel(game.settings.leagueSeason)}
        </div>
        <div className={`tier ${v.met ? 'CHAMPIONS' : 'RELEGATED'}`} data-testid="runin-chip">
          {v.icon} {v.chip}
        </div>
        <div style={{ fontWeight: 700, marginTop: 10 }} data-testid="runin-line">
          {v.line}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          Took over after MW {v.from.matchweek}: {ordinal(v.from.position)} on {v.from.points} (projected) · finished {ordinal(v.position)} on {v.points}
        </div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => go('setup', 'runin')} data-testid="runin-again">
          Another run-in
        </button>
        <button className="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy the result'}
        </button>
        <button className="btn ghost" onClick={() => go('home')}>
          Home
        </button>
      </div>
      <div className="grid two">
        <div className="col">
          <div className="panel" data-testid="runin-games">
            <h3>The run-in</h3>
            {story && story.strip.length > 0 && (
              <div className="mono" style={{ marginBottom: 8 }}>
                {story.strip.map((o) => (o === 'W' ? '🟩' : o === 'D' ? '🟨' : '🟥')).join('')}
              </div>
            )}
            <div className="col" style={{ gap: 4 }}>
              {(story?.results ?? []).map((r) => (
                <div key={r.matchweek} className="row between small">
                  <span className="row" style={{ gap: 6 }}>
                    <ClubBadge clubId={r.opponentId} size={18} />
                    {gameLabel(r, (id) => clubName(u, id))}
                  </span>
                  <span className="muted">{ordinal(r.position)}</span>
                </div>
              ))}
            </div>
            {game.season.sacked && <div className="notice danger" style={{ marginTop: 8 }}>The board sacked you before the end.</div>}
          </div>
          <div className="panel">
            <h3>Share</h3>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }} data-testid="runin-share-text">
              {text}
            </pre>
          </div>
        </div>
        <div className="panel">
          <h3>Final table</h3>
          <TableView rows={table} teamName={game.settings.teamName} compact highlightTop />
          <p className="help">The first {v.from.matchweek} matchweeks are projected from the real final table; the last {game.season.matchweeks - v.from.matchweek} were played.</p>
        </div>
      </div>
    </div>
  )
}
