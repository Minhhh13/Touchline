import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import type { Game, QuickCupRun } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { cupReachLabel, cupRoundLabel, cupScoreLabel, QUICK_CONTINENTAL_PLACES, quickCupStatus, type QuickCupComp } from '@game/logic/quickCups'
import { scorersLabel } from '@game/logic/gameByGame'
import { ClubBadge } from './bits'
import { clubName, ordinal } from '../format'

/** Milliseconds between two ties of a cup run as it is revealed. */
export const TIE_STEP_MS = 1100

const TITLE: Record<QuickCupComp, string> = { cup: 'The Cup', continental: 'Continental Cup' }
const ICON: Record<QuickCupComp, string> = { cup: '🏆', continental: '🌍' }

function useReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The post-season cups of a Quick Draft, under the league result: for each cup a card to play it or skip it, then the
 * run revealed tie by tie, newest at the top, ending on the trophy or the round it went out in. The store plays the
 * cups; this only paces the reveal. `onReveal` tells the summary when each cup's reveal starts and ends (both cups can
 * reveal at once), so its banner keeps each trophy back until that cup's last tie is shown.
 */
export function CupRuns({ game, u, onReveal }: { game: Game; u: LoadedUniverse; onReveal: (comp: QuickCupComp, revealing: boolean) => void }) {
  const cup = quickCupStatus(game, u, 'cup')
  const euro = quickCupStatus(game, u, 'continental')
  // An older season's in-league Continental Cup run has its own panel; a finish outside the places says what it needed
  const showEuro = euro.state !== 'none' || euro.reason.startsWith('A top-')
  if (cup.state === 'none' && !showEuro) return null
  return (
    <div className="panel col cup-nights" data-testid="cup-nights">
      <div className="sc-head">
        <span className="sc-kicker">After the league</span>
        <h2>Cup nights</h2>
      </div>
      <div className="cup-cards">
        <CupCard comp="cup" game={game} u={u} onReveal={onReveal} />
        {showEuro && <CupCard comp="continental" game={game} u={u} onReveal={onReveal} />}
      </div>
    </div>
  )
}

function CupCard({ comp, game, u, onReveal }: { comp: QuickCupComp; game: Game; u: LoadedUniverse; onReveal: (comp: QuickCupComp, revealing: boolean) => void }) {
  const { playCup, skipCup, loadingLeagues } = useStore()
  const status = quickCupStatus(game, u, comp)
  const reduced = useReducedMotion()
  // Ties shown of a run played on this screen; null shows the whole run (a run played before, or reduced motion)
  const [shown, setShown] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const run = status.state === 'played' ? status.run : null
  const total = run?.ties.length ?? 0
  const revealing = !!run && shown !== null && shown < total
  useEffect(() => {
    if (!revealing) return
    const t = setTimeout(() => setShown((n) => (n === null ? null : n + 1)), TIE_STEP_MS)
    return () => clearTimeout(t)
  }, [revealing, shown])
  useEffect(() => {
    if (run && shown !== null && shown >= total) onReveal(comp, false)
  }, [run, shown, total, onReveal, comp])
  const play = async () => {
    setBusy(true)
    // Nothing of the run shows until the reveal starts on the first tie
    setShown(0)
    onReveal(comp, true)
    const ok = await playCup(comp)
    setBusy(false)
    if (!ok || reduced) {
      setShown(null)
      onReveal(comp, false)
      return
    }
    setShown(1)
  }
  const skipReveal = () => setShown(total)
  const n = shown ?? total
  return (
    <div className={`cup-card ${comp}`} data-testid={`cup-${comp}`}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          {ICON[comp]} {TITLE[comp]}
        </h3>
        {run && !revealing && <span className={`chip ${run.reached === 'W' ? 'gold' : ''}`} data-testid={`cup-${comp}-reached`}>{run.reached === 'W' ? 'Winners' : `Out in the ${cupReachLabel(run.reached)}`}</span>}
        {revealing && (
          <button className="btn sm ghost" onClick={skipReveal} data-testid={`cup-${comp}-skip-reveal`}>
            Skip to the end
          </button>
        )}
      </div>
      {status.state === 'open' && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {comp === 'cup' ? 'Sixteen of the league’s clubs, one-off ties, extra time and penalties if level, a final at a neutral ground.' : `Your ${ordinal(game.quickResult?.position ?? 0)} place earns a place among the best sides of the other leagues that season: four knockout rounds to a final.`}
          </p>
          <div className="cup-choice">
            <button className="btn primary" onClick={() => void play()} disabled={busy || loadingLeagues} data-testid={`cup-${comp}-play`}>
              {busy ? 'Drawing the ties…' : comp === 'cup' ? 'Play the Cup' : 'Play the Continental Cup'}
            </button>
            <button className="btn ghost" onClick={() => skipCup(comp)} disabled={busy} data-testid={`cup-${comp}-pass`}>
              Skip it
            </button>
          </div>
        </>
      )}
      {status.state === 'skipped' && <p className="small muted" style={{ margin: 0 }}>Skipped: the league was enough this time.</p>}
      {status.state === 'none' && (
        <p className="small muted" style={{ margin: 0 }} data-testid={`cup-${comp}-none`}>
          {comp === 'continental' ? `Finish in the top ${QUICK_CONTINENTAL_PLACES} to play it.` : status.reason + '.'}
        </p>
      )}
      {run && <TieList comp={comp} run={run} shown={n} u={u} />}
      {run && !revealing && run.reached === 'W' && (
        <div className="cup-trophy" data-testid={`cup-${comp}-trophy`}>
          {ICON[comp]} {comp === 'cup' ? 'Cup winners' : 'Champions of the continent'}
        </div>
      )}
    </div>
  )
}

function TieList({ comp, run, shown, u }: { comp: QuickCupComp; run: QuickCupRun; shown: number; u: LoadedUniverse }) {
  const ties = run.ties.slice(0, shown).reverse()
  return (
    <ol className="gbg-list cup-ties" data-testid={`cup-${comp}-ties`}>
      {ties.map((t, i) => {
        const o = t.won ? 'W' : 'L'
        const scorers = scorersLabel(t.scorers)
        return (
          <li key={t.round} className={`gbg-game cup-tie ${o} ${i === 0 ? 'newest' : ''}`} data-testid="cup-tie" data-outcome={o}>
            <span className={`gbg-badge ${o}`} aria-label={t.won ? 'Through' : 'Out'}>
              {o}
            </span>
            <ClubBadge clubId={t.opponentId} size={22} />
            <span className="gbg-fix">
              {clubName(u, t.opponentId)} <span className="gbg-ha">{t.neutral ? 'N' : t.home ? 'H' : 'A'}</span>
            </span>
            <span className="gbg-score">
              {t.gf}-{t.ga}
            </span>
            <span className="gbg-mw">{cupRoundLabel(comp, t.round)}</span>
            {(t.et || t.pens) && <span className="cup-extra small">{cupScoreLabel(t).replace(/^\d+-\d+ /, '')}{t.et && !t.pens ? ` (${t.et.for}-${t.et.against} in extra time)` : ''}</span>}
            {scorers && <span className="gbg-scorers small">⚽ {scorers}</span>}
          </li>
        )
      })}
    </ol>
  )
}
