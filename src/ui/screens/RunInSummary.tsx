import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { seasonTable } from '@engine/season'
import { RUN_IN_TEMPLATE_LABEL, runInShare, runInVerdict } from '@game/logic/runin'
import { gameLabel, storyForGame } from '@game/logic/story'
import { TableView } from '../components/TableView'
import { ClubBadge, Info, Stat } from '../components/bits'
import { Check, Copy, House, RotateCcw } from 'lucide-react'
import { clubName, ordinal, outcomeClass, outcomeOf, seasonLabel } from '../format'

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
    // Main's summary layout: the verdict box on the left, the games, the table and the share text in a box beside it
    <div className="page summary runin-summary" data-testid="summary">
      <div className="tier-banner result-banner" data-testid="runin-verdict">
        <div className="banner-meta">
          <span className="bm-team">
            <ClubBadge clubId={host} size={22} />
            {clubName(u, host)} {seasonLabel(game.settings.leagueSeason)}
          </span>
          <span className="bm-rest">Run-in · {RUN_IN_TEMPLATE_LABEL[v.template]}</span>
        </div>
        <div className="tier-wrap">
          <div className={`tier ${v.met ? 'CHAMPIONS' : 'RELEGATED'}`} data-testid="runin-chip">
            {v.chip}
          </div>
        </div>
        <p className="tier-blurb" data-testid="runin-line">
          {v.line}
        </p>
        <div className="banner-stats">
          <Stat label="Took over" value={ordinal(v.from.position)} sub={`MW ${v.from.matchweek}, ${v.from.points} pts (projected)`} />
          <Stat label="Finished" value={ordinal(v.position)} sub={`${v.points} pts`} />
        </div>
        {story && story.strip.length > 0 && (
          <div className="blocks" aria-hidden="true">
            {story.strip.map((o, i) => (
              <span key={i} style={{ background: o === 'W' ? 'var(--good)' : o === 'D' ? 'var(--draw)' : 'var(--bad)' }} />
            ))}
          </div>
        )}
        {game.season.sacked && <div className="notice danger">The board sacked you before the end.</div>}
        <div className="banner-actions">
          <button className="btn primary" onClick={() => go('setup', 'runin')} data-testid="runin-again">
            <RotateCcw size={16} aria-hidden="true" /> Another run-in
          </button>
          <button className="btn" onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copied' : 'Copy result'}
          </button>
          <button className="btn ghost" onClick={() => go('home')}>
            <House size={16} aria-hidden="true" /> Home
          </button>
        </div>
      </div>
      <div className="summary-body fill" data-testid="summary-body">
        <div className="grid two">
          <div className="panel" data-testid="runin-games">
            <h3>The run-in</h3>
            <div className="plist lined">
              {(story?.results ?? []).map((r) => (
                <div key={r.matchweek} className="row between small" style={{ padding: '4px 0' }}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`chip ${outcomeClass(outcomeOf(r.gf, r.ga))}`}>{outcomeOf(r.gf, r.ga)}</span>
                    <ClubBadge clubId={r.opponentId} size={18} />
                    {gameLabel(r, (id) => clubName(u, id))}
                  </span>
                  <span className="muted">{ordinal(r.position)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <span className="head-title">
                <h3>Final table</h3>
                <Info label="About the table">
                  The first {v.from.matchweek} matchweeks are projected from the real final table; the last {game.season.matchweeks - v.from.matchweek} were played.
                </Info>
              </span>
            </div>
            <TableView rows={table} teamName={game.settings.teamName} compact highlightTop />
          </div>
        </div>
        <details className="panel fold">
          <summary className="fold-head">
            <h3>Share text</h3>
          </summary>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }} data-testid="runin-share-text">
            {text}
          </pre>
        </details>
      </div>
    </div>
  )
}
