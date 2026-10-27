/**
 * The inbox's flavour, at display time only. The season loop stores a stock
 * body for a handful of routine items ("Three points.", a friendly, a free
 * weekend, the window shutting); the Inbox and the digest show one of several
 * lines for it instead, picked by a pure hash of the item itself (its
 * matchweek, kind and title) and fitted to the score where there is one. What
 * is stored never changes, and every other item reads exactly as stored.
 * Pure: no React, no store, no RNG.
 */
import type { NewsItem } from '@engine/season'
import { fillTemplate, pickVariant } from './flavour'

/** The stock bodies `week.ts` stores, which the display may vary. */
export const STOCK_BODIES = {
  win: 'Three points.',
  draw: 'A point apiece.',
  loss: 'A defeat to learn from.',
  friendly: 'Legs loosened, patterns rehearsed.',
  freeWeekend: 'An odd number of clubs in the league means everyone sits one round out. Legs rested.',
  windowShut: 'The January window has shut.',
} as const

/** Result lines by what the score says, `{score}` the winner's score first ("3-1"). The stock line is in every bank. */
export const RESULT_BODIES = {
  thrashing: ['Three points, and a statement.', 'A thrashing. Enjoy this one.', 'Ruthless from first whistle to last.', 'That is how you send a message.'],
  cleanWin: ['Three points and a clean sheet.', 'Job done, nothing conceded.', 'Solid at the back, and three points in the bag.', STOCK_BODIES.win],
  narrowWin: [STOCK_BODIES.win, 'Made hard work of it, but three points.', 'Edged it. They all count.', 'A {score} win, and a big three points.', 'Not pretty. Very welcome.'],
  wideWin: [STOCK_BODIES.win, 'A comfortable {score} win.', 'Never really in doubt.', 'Three points and a few goals to go with them.'],
  goallessDraw: [STOCK_BODIES.draw, 'A goalless point. Neither side could find a way through.', 'Stalemate. The clean sheet is something.', 'A point, and not a lot else.'],
  scoreDraw: [STOCK_BODIES.draw, 'A {score} draw: honours even.', 'Shared spoils after an entertaining game.', 'A point each, and plenty of goals.'],
  narrowLoss: [STOCK_BODIES.loss, 'So close. One goal the difference.', 'Beaten by the odd goal. Small margins.', 'A {score} defeat. Heads up for the next one.'],
  heavyLoss: [STOCK_BODIES.loss, 'A heavy defeat. That will sting.', 'One to forget, and quickly.', 'Back to the training ground after that.'],
} as const

export const ROUTINE_BODIES = {
  friendly: [STOCK_BODIES.friendly, 'A useful run-out before the real thing.', 'Minutes in the legs, and nobody hurt.', 'A workout more than a contest.'],
  freeWeekend: [STOCK_BODIES.freeWeekend, 'An odd number of clubs means a weekend off for everyone this round. Rest and recharge.', 'No game this round: the fixture list gives everyone a turn to sit out.'],
  windowShut: [STOCK_BODIES.windowShut, 'The January window has shut. What you have is what you have.', 'Deadline passed. The squad is set for the run-in.'],
} as const

/** "A 3-1" from a result item's title ("TST 3-1 ARS"), or null. */
export function scoreOfTitle(title: string): { a: number; b: number } | null {
  const m = /\s(\d+)-(\d+)\s/.exec(` ${title} `)
  return m ? { a: Number(m[1]), b: Number(m[2]) } : null
}

function itemKey(n: Pick<NewsItem, 'matchweek' | 'kind' | 'title'>): string {
  return `news|${n.matchweek}|${n.kind}|${n.title}`
}

/** The body to show for an inbox item: a variant of a stock body, or the body as stored. */
export function newsBody(n: Pick<NewsItem, 'matchweek' | 'kind' | 'title' | 'body'>): string {
  const key = itemKey(n)
  if (n.kind === 'result') {
    const score = scoreOfTitle(n.title)
    if (!score) return n.body
    const hi = Math.max(score.a, score.b)
    const lo = Math.min(score.a, score.b)
    const vars = { score: `${hi}-${lo}` }
    const margin = hi - lo
    let bank: readonly string[] | null = null
    if (n.body === STOCK_BODIES.win) bank = margin >= 3 ? RESULT_BODIES.thrashing : lo === 0 ? RESULT_BODIES.cleanWin : margin === 1 ? RESULT_BODIES.narrowWin : RESULT_BODIES.wideWin
    else if (n.body === STOCK_BODIES.draw) bank = hi === 0 ? RESULT_BODIES.goallessDraw : RESULT_BODIES.scoreDraw
    else if (n.body === STOCK_BODIES.loss) bank = margin === 1 ? RESULT_BODIES.narrowLoss : RESULT_BODIES.heavyLoss
    return bank ? fillTemplate(pickVariant(bank, key), vars) : n.body
  }
  if (n.kind === 'info' && n.body === STOCK_BODIES.friendly) return pickVariant(ROUTINE_BODIES.friendly, key)
  if (n.kind === 'info' && n.body === STOCK_BODIES.freeWeekend) return pickVariant(ROUTINE_BODIES.freeWeekend, key)
  if (n.kind === 'transfer' && n.body === STOCK_BODIES.windowShut) return pickVariant(ROUTINE_BODIES.windowShut, key)
  return n.body
}
