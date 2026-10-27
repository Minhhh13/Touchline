import { useEffect, useRef, type ReactNode } from 'react'
import { bracketLegs, inTie, type BracketTie, type BracketView } from '@game/logic/bracket'
import { TrophyArt, type TrophyKind } from './TrophyArt'

/** What a reveal has shown so far: ties whose step is below `shown` are played; the tie at `shown` is the one in play. */
export interface BracketReveal {
  /** `steps[round][tie]`, from `revealSteps`. */
  steps: number[][]
  shown: number
  /** The user's tie is in play (its moment before the score lands). */
  live?: boolean
}

/**
 * A knockout drawn as a bracket (the view from `src/game/logic/bracket.ts`): the rounds side by side, the ties of each
 * round in tree order with lines joining the two that meet next, your route outlined in the primary colour, the
 * winner of each tie in bold, the score with extra time and penalties, and the winner beside the final. A round not
 * drawn yet shows empty slots. Below 560 px of its own width it stacks the rounds. With `reveal` the ties fill in one
 * after another (the store has already played them; this only shows them). The box scrolls inside itself.
 */
export function Bracket({ view, nameOf, badge, userId, seeds = [], reveal, trophy, testId = 'bracket', tieTestId = `${testId}-tie`, meTestId = `${testId}-me` }: { view: BracketView; nameOf: (id: string) => string; badge: (id: string) => ReactNode; userId: string; seeds?: string[]; reveal?: BracketReveal; trophy?: TrophyKind; testId?: string; tieTestId?: string; meTestId?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const seeded = new Set(seeds)
  const tree = !view.pathOnly
  const at = reveal ? reveal.shown : Number.MAX_SAFE_INTEGER
  const played = (r: number, i: number) => !reveal || (reveal.steps[r]?.[i] ?? 0) < at
  const inPlay = (r: number, i: number) => !!reveal && reveal.steps[r]?.[i] === at
  // A round's sides show once the reveal reaches it (the draw), every tie of it at once
  const drawn = (r: number) => !reveal || !view.rounds[r].ties.length || Math.min(...reveal.steps[r]) <= at
  const champion = view.champion && (!reveal || at >= Math.max(0, ...reveal.steps.flat()) + 1) ? view.champion : undefined
  // Keep the tie in play in sight, on a phone and in a long bracket
  useEffect(() => {
    if (!reveal) return
    const el = box.current?.querySelector<HTMLElement>('[data-in-play="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [reveal?.shown, reveal])

  // A two-legged tie between its legs (a Season's bracket): the first leg's score shows, nobody through yet
  const midway = (t: BracketTie) => !reveal && !!t.legs?.length && t.winner === undefined
  const side = (t: BracketTie, which: 'home' | 'away', show: boolean, done: boolean) => {
    const id = t[which]
    const goals = which === 'home' ? t.hg : t.ag
    const pens = t.pens?.[which]
    const won = done && t.winner === id
    const lost = done && t.winner !== undefined && t.winner !== id
    return (
      <div className={`br-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${id === userId ? 'you' : ''}`}>
        {show ? badge(id) : <span className="br-blank-badge" aria-hidden="true" />}
        <span className="br-name" title={show ? nameOf(id) : undefined}>
          {show ? nameOf(id) : '?'}
          {show && seeded.has(id) && <span className="muted small" title="Seeded"> (s)</span>}
        </span>
        <span className="br-goals">{(done || midway(t)) && goals !== undefined ? goals : ''}</span>
        {done && pens !== undefined && <span className="br-pens" title="Penalties">{pens}</span>}
      </div>
    )
  }

  const tieCard = (t: BracketTie | undefined, r: number, i: number) => {
    if (!t) return <div className="br-tie empty" aria-hidden="true" />
    const show = drawn(r)
    // Your route shows only as far as the reveal has drawn it
    const me = show && inTie(t, userId)
    const done = played(r, i) && t.winner !== undefined
    const live = inPlay(r, i) && me && !!reveal?.live
    const extra = done ? (t.pens ? 'pens' : t.et ? 'aet' : t.legs ? 'agg' : '') : ''
    // A two-legged tie's legs under its aggregate (engine 7's Continental Cup); a first leg alone as it stands
    const legs = played(r, i) ? bracketLegs(t) : null
    return (
      <div className={`br-tie ${me ? 'me' : ''} ${done ? 'done' : 'open'} ${reveal && done ? 'landed' : ''} ${live ? 'live' : ''}`} data-testid={me ? meTestId : tieTestId} data-me={me ? 'true' : undefined} data-played={done ? 'true' : 'false'} data-in-play={inPlay(r, i) ? 'true' : undefined}>
        {side(t, 'home', show, done)}
        {side(t, 'away', show, done)}
        {legs && (
          <span className="br-legs" data-testid="bracket-legs" title="Each leg, home side of the tie first">
            Legs {legs}
          </span>
        )}
        {extra && <span className="br-extra">{extra}</span>}
        {live && <span className="br-live small">In play</span>}
      </div>
    )
  }

  return (
    <div className={`bracket ${tree ? 'tree' : 'path'}`} ref={box} data-testid={testId} data-rounds={view.rounds.length}>
      <div className="br-grid" style={{ ['--br-rows' as string]: String(view.rounds[0]?.slots ?? 1) }}>
        {view.rounds.map((round, r) => {
          const slots = tree ? round.slots : Math.max(1, round.ties.length)
          const route = drawn(r) ? round.ties.findIndex((t) => inTie(t, userId)) : -1
          const routeWon = route >= 0 && played(r, route) && round.ties[route].winner === userId
          const pairs: number[][] = []
          for (let i = 0; i < slots; i += 2) pairs.push(i + 1 < slots ? [i, i + 1] : [i])
          return (
            <div key={round.name} className={`br-col ${r === 0 ? 'first' : ''} ${r === view.rounds.length - 1 && !tree ? 'last' : ''}`} data-testid={`${testId}-round-${r}`} style={{ gridColumn: r + 1 }}>
              <div className="br-head">
                <span className="br-round">{round.name}</span>
                {!round.ties.length && round.pending && <span className="br-pending small muted">{round.pending}</span>}
              </div>
              <div className="br-body">
                {pairs.map((pair) => {
                  const through = pair.findIndex((i) => i === route)
                  return (
                    <div key={pair[0]} className={`br-pair ${pair.length === 2 ? 'two' : ''}`} data-path={through >= 0 && routeWon ? through : undefined}>
                      {pair.map((i) => (
                        <div key={i} className={`br-slot ${i === route ? 'path' : ''} ${i === route && routeWon ? 'through' : ''}`}>
                          {tieCard(round.ties[i], r, i)}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {tree && (
          <div className="br-col last champ" style={{ gridColumn: view.rounds.length + 1 }} data-testid={`${testId}-winner`}>
            <div className="br-head">
              <span className="br-round">Winner</span>
            </div>
            <div className="br-body">
              <div className="br-pair">
                <div className={`br-slot ${champion === userId ? 'path through' : ''}`}>
                  <div className={`br-champ ${champion ? 'crowned' : ''} ${champion === userId ? 'me' : ''}`} data-champion={champion ?? ''}>
                    {trophy && <TrophyArt kind={trophy} size={champion ? 52 : 40} muted={!champion} />}
                    {champion ? (
                      <span className="br-champ-name">
                        {badge(champion)} {nameOf(champion)}
                      </span>
                    ) : (
                      <span className="small muted">To be decided</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
