import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Globe, Medal, Network, type LucideIcon } from 'lucide-react'
import { useStore } from '@game/store'
import type { Game, QuickCupRun } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { cupReachLabel, cupRoundLabel, cupScoreLabel, quickGroupLine, QUICK_CONTINENTAL_PLACES, QUICK_CUP_ENTRANTS, quickCupStatus, type QuickCupComp } from '@game/logic/quickCups'
import { ClubBadge } from './bits'
import { CupNight } from './CupNight'
import { ordinal } from '../format'
import { scorersText } from '../scorers'
import { isSuperLeague, sideNamer } from '@game/logic/superLeague'
import { summaryMainCall } from '@game/logic/summaryCall'

function CupIcon({ comp, size }: { comp: QuickCupComp; size: number }) {
  const Icon = ICON[comp]
  return <Icon size={size} aria-hidden="true" />
}

const TITLE: Record<QuickCupComp, string> = { cup: 'The Cup', continental: 'Continental Cup' }
/** The cups' pictures, Lucide's meanings (DESIGN_SYSTEM.md section 7): Medal the cup, Globe the Continental Cup. */
const ICON: Record<QuickCupComp, LucideIcon> = { cup: Medal, continental: Globe }

/**
 * The post-season cups of a Quick Draft, under the league result: for each cup a card to play it or skip it. Played,
 * the cup night opens on its bracket and reveals the ties round by round (`CupNight`), ending on the trophy or the
 * round it went out in; the card then lists the user's ties, newest at the top, with the bracket a click away. The
 * store plays the cups; this only paces the reveal. `onReveal` tells the summary when each cup's reveal starts and
 * ends, so its banner keeps each trophy back until that cup's last tie is shown.
 */
export function CupRuns({ game, u, onReveal }: { game: Game; u: LoadedUniverse; onReveal: (comp: QuickCupComp, revealing: boolean) => void }) {
  const cup = quickCupStatus(game, u, 'cup')
  const euro = quickCupStatus(game, u, 'continental')
  // An older season's in-league Continental Cup run has its own panel; a finish outside the places says what it needed
  const showEuro = euro.state !== 'none' || euro.reason.startsWith('A top-')
  if ((cup.state === 'none' || isSuperLeague(game.settings)) && !showEuro) return null
  // One bright call on the summary: the first cup still to play (`summaryMainCall`), the other one secondary
  const call = summaryMainCall(game, u)
  return (
    <div className="panel col cup-nights" data-testid="cup-nights">
      <div className="sc-head">
        <span className="sc-kicker">After the league</span>
        <h2>Cup nights</h2>
      </div>
      <div className="cup-cards">
        {/* The Super League has no domestic cup: only its Continental Cup follows the league */}
        {!isSuperLeague(game.settings) && <CupCard comp="cup" game={game} u={u} onReveal={onReveal} main={call === 'cup'} />}
        {showEuro && <CupCard comp="continental" game={game} u={u} onReveal={onReveal} main={call === 'continental'} />}
      </div>
    </div>
  )
}

function CupCard({ comp, game, u, onReveal, main }: { comp: QuickCupComp; game: Game; u: LoadedUniverse; onReveal: (comp: QuickCupComp, revealing: boolean) => void; main: boolean }) {
  const { playCup, skipCup, loadingLeagues } = useStore()
  const status = quickCupStatus(game, u, comp)
  const [busy, setBusy] = useState(false)
  // The cup night's modal: 'reveal' as the cup is played, 'view' to look at the finished bracket again
  const [night, setNight] = useState<'reveal' | 'view' | null>(null)
  const [revealing, setRevealing] = useState(false)
  const run = status.state === 'played' ? status.run : null
  // Whether this card holds the summary's trophy back, and the latest way to let go: a card that goes while it holds
  // (the summary's season replay hides the cups mid-draw) lets go, or the summary kept the trophy and its share line hidden
  const held = useRef(false)
  const release = useRef(onReveal)
  useLayoutEffect(() => {
    release.current = onReveal
  })
  useEffect(
    () => () => {
      if (held.current) release.current(comp, false)
      held.current = false
    },
    [comp],
  )
  const endReveal = useCallback(() => {
    held.current = false
    setRevealing(false)
    onReveal(comp, false)
  }, [onReveal, comp])
  const play = async () => {
    setBusy(true)
    // Nothing of the run shows until its bracket opens on the draw
    held.current = true
    setRevealing(true)
    onReveal(comp, true)
    const ok = await playCup(comp)
    setBusy(false)
    if (!ok) {
      endReveal()
      return
    }
    setNight('reveal')
  }
  const close = () => {
    setNight(null)
    if (revealing) endReveal()
  }
  return (
    <div className={`cup-card ${comp}`} data-testid={`cup-${comp}`}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h3 className="cup-title" style={{ margin: 0 }}>
          <CupIcon comp={comp} size={18} /> {TITLE[comp]}
        </h3>
        {run && !revealing && <span className={`chip ${run.reached === 'W' ? 'gold' : ''}`} data-testid={`cup-${comp}-reached`}>{run.reached === 'W' ? 'Winners' : `Out in the ${cupReachLabel(run.reached, comp)}`}</span>}
      </div>
      {status.state === 'open' && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {comp === 'cup' ? 'Sixteen of the league’s clubs, one-off ties, extra time and penalties if level, a final at a neutral ground.' : isSuperLeague(game.settings) ? `Your ${ordinal(game.quickResult?.position ?? 0)} place earns a place against the next ${QUICK_CUP_ENTRANTS - 1} greatest sides in the data: four groups of four, then two-legged quarter- and semi-finals and a one-off final.` : `Your ${ordinal(game.quickResult?.position ?? 0)} place earns a place among the best sides of the other leagues that season: four groups of four, then two-legged quarter- and semi-finals and a one-off final.`}
          </p>
          <div className="cup-choice">
            <button className={`btn ${main ? 'primary' : ''}`} onClick={() => void play()} disabled={busy || loadingLeagues} data-testid={`cup-${comp}-play`}>
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
      {run && revealing && <p className="small muted" style={{ margin: 0 }}>The ties are being played…</p>}
      {run && !revealing && run.groups && (
        <p className="small muted" style={{ margin: 0 }} data-testid={`cup-${comp}-group`}>
          {quickGroupLine(run)}
        </p>
      )}
      {run && !revealing && <TieList comp={comp} run={run} shown={run.ties.length} nameOf={sideNamer(game, u)} />}
      {run && !revealing && (
        <div className="cup-foot">
          {run.reached === 'W' && (
            <span className="cup-trophy" data-testid={`cup-${comp}-trophy`}>
              <CupIcon comp={comp} size={16} /> {comp === 'cup' ? 'Cup winners' : 'Champions of the continent'}
            </span>
          )}
          <button className="btn sm" onClick={() => setNight('view')} data-testid={`cup-${comp}-bracket-open`}>
            <Network size={14} aria-hidden="true" /> {run.groups ? 'See the groups and bracket' : 'See the bracket'}
          </button>
        </div>
      )}
      {run && night && <CupNight game={game} u={u} comp={comp} run={run} reveal={night === 'reveal'} onClose={close} onRevealEnd={revealing ? endReveal : undefined} />}
    </div>
  )
}

function TieList({ comp, run, shown, nameOf }: { comp: QuickCupComp; run: QuickCupRun; shown: number; nameOf: (clubId: string) => string }) {
  const ties = run.ties.slice(0, shown).reverse()
  return (
    <ol className="gbg-list cup-ties" data-testid={`cup-${comp}-ties`}>
      {ties.map((t, i) => {
        const o = t.won ? 'W' : 'L'
        const scorers = scorersText(t.scorers)
        return (
          <li key={t.round} className={`gbg-game cup-tie ${o} ${i === 0 ? 'newest' : ''}`} data-testid="cup-tie" data-outcome={o}>
            <span className={`gbg-badge ${o}`} role="img" aria-label={t.won ? 'Through' : 'Out'}>
              {o}
            </span>
            <ClubBadge clubId={t.opponentId} size={22} />
            <span className="gbg-fix">
              <span className="gbg-name">{nameOf(t.opponentId)}</span> {!t.legs && <span className="gbg-ha">{t.neutral ? 'N' : t.home ? 'H' : 'A'}</span>}
            </span>
            <span className="gbg-score">
              {t.gf}-{t.ga}
            </span>
            <span className="gbg-mw">{cupRoundLabel(comp, t.round)}</span>
            {t.legs && <span className="cup-extra small" data-testid="cup-tie-legs">{t.legs.map((l) => `${l.gf}-${l.ga} ${l.home ? 'H' : 'A'}`).join(', ')} (agg)</span>}
            {(t.et || t.pens) && <span className="cup-extra small">{cupScoreLabel(t).replace(/^\d+-\d+ /, '')}{t.et && !t.pens ? ` (${t.et.for}-${t.et.against} in extra time)` : ''}</span>}
            {scorers && <span className="gbg-scorers small">⚽ {scorers}</span>}
          </li>
        )
      })}
    </ol>
  )
}
