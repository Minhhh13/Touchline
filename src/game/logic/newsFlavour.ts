/**
 * The inbox's flavour, at display time only. The season loop stores a stock
 * body for a handful of routine items ("Three points.", a friendly, a free
 * weekend, the window shutting, a ban); the Inbox and the digest show one of several
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
  fiveYellows: 'Five yellow cards: a one-match ban.',
} as const

/** Result lines by what the score says, `{score}` the winner's score first ("3-1"). The stock line is in every bank. */
export const RESULT_BODIES = {
  thrashing: ['Three points, and a statement.', 'A thrashing. Enjoy this one.', 'Ruthless from first whistle to last.', 'That is how you send a message.', 'A {score} hammering. The rest of the league will have noticed.', 'Every shot seemed to go in.', 'One-way traffic from start to finish.', 'The kind of afternoon a manager dreams about.'],
  cleanWin: ['Three points and a clean sheet.', 'Job done, nothing conceded.', 'Solid at the back, and three points in the bag.', STOCK_BODIES.win, 'A {score} win and the keeper barely got his gloves dirty.', 'Nothing got past the back line. Three points.', 'A shut-out and the points: the perfect day at the office.'],
  narrowWin: [STOCK_BODIES.win, 'Made hard work of it, but three points.', 'Edged it. They all count.', 'A {score} win, and a big three points.', 'Not pretty. Very welcome.', 'Hung on for {score}. The nerves can settle now.', 'A one-goal margin, and every bit of it earned.', 'Ugly, gritty, three points.'],
  wideWin: [STOCK_BODIES.win, 'A comfortable {score} win.', 'Never really in doubt.', 'Three points and a few goals to go with them.', 'In control from start to finish: {score}.', 'Two goals clear and never looking back.'],
  shootoutWin: ['Goals at both ends, but the three points stay with us.', 'A {score} thriller, and the right side of it.', 'Not one for the purists, but what a game to win.', 'Outscored them in the end: {score}.'],
  goallessDraw: [STOCK_BODIES.draw, 'A goalless point. Neither side could find a way through.', 'Stalemate. The clean sheet is something.', 'A point, and not a lot else.', 'Nil-nil. The keepers could have brought a deckchair.', 'A point, and a clean sheet to show for it.'],
  scoreDraw: [STOCK_BODIES.draw, 'A {score} draw: honours even.', 'Shared spoils after an entertaining game.', 'A point each, and plenty of goals.', 'Level at {score}, and both sides will feel they could have won it.', 'A point. Take it and move on.'],
  thrillerDraw: ['A {score} classic, and a point apiece.', 'Goals everywhere, and nobody could find a winner.', 'Breathless stuff: {score}, and a point each.', 'The neutrals loved it. The managers less so.'],
  narrowLoss: [STOCK_BODIES.loss, 'So close. One goal the difference.', 'Beaten by the odd goal. Small margins.', 'A {score} defeat. Heads up for the next one.', 'Deserved more than nothing from that.', 'A {score} defeat that could easily have been a draw.', 'One moment decided it, and it went against us.'],
  heavyLoss: [STOCK_BODIES.loss, 'A heavy defeat. That will sting.', 'One to forget, and quickly.', 'Back to the training ground after that.', 'A {score} beating. Questions will be asked.', 'Outplayed, and the scoreline says so.', 'A long trip home after that one.'],
} as const

export const ROUTINE_BODIES = {
  friendly: [STOCK_BODIES.friendly, 'A useful run-out before the real thing.', 'Minutes in the legs, and nobody hurt.', 'A workout more than a contest.', 'The fitness coaches will be happy with that one.', 'A chance to try a few things before the season starts.'],
  freeWeekend: [STOCK_BODIES.freeWeekend, 'An odd number of clubs means a weekend off for everyone this round. Rest and recharge.', 'No game this round: the fixture list gives everyone a turn to sit out.', 'A blank weekend on the fixture list. The physios will take it.'],
  windowShut: [STOCK_BODIES.windowShut, 'The January window has shut. What you have is what you have.', 'Deadline passed. The squad is set for the run-in.', 'The phones go quiet: no more business until the summer.'],
  fiveYellows: [STOCK_BODIES.fiveYellows, 'Five bookings now, and that means a one-match ban.', 'One booking too many: he sits out the next match.', 'The yellow cards have caught up with him: a one-match ban.'],
} as const

/** A red card's ban as stored ("Suspended for 2 matches."): the match count, or null. */
export function redCardBan(body: string): number | null {
  const m = /^Suspended for (\d+) match(?:es)?\.$/.exec(body)
  return m ? Number(m[1]) : null
}

/** A red card's ban in other words, `{n}` the matches; the stored line keeps its place as the first of four. */
export const RED_CARD_BODIES = ['Sent off: a {n}-match ban.', 'A red card, and a {n}-match ban to go with it.', 'He sits out a {n}-match ban after that red card.'] as const

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
    if (n.body === STOCK_BODIES.win) bank = margin >= 3 ? RESULT_BODIES.thrashing : lo === 0 ? RESULT_BODIES.cleanWin : lo >= 2 ? RESULT_BODIES.shootoutWin : margin === 1 ? RESULT_BODIES.narrowWin : RESULT_BODIES.wideWin
    else if (n.body === STOCK_BODIES.draw) bank = hi === 0 ? RESULT_BODIES.goallessDraw : hi >= 3 ? RESULT_BODIES.thrillerDraw : RESULT_BODIES.scoreDraw
    else if (n.body === STOCK_BODIES.loss) bank = margin === 1 ? RESULT_BODIES.narrowLoss : RESULT_BODIES.heavyLoss
    return bank ? fillTemplate(pickVariant(bank, key), vars) : n.body
  }
  if (n.kind === 'info' && n.body === STOCK_BODIES.friendly) return pickVariant(ROUTINE_BODIES.friendly, key)
  if (n.kind === 'info' && n.body === STOCK_BODIES.freeWeekend) return pickVariant(ROUTINE_BODIES.freeWeekend, key)
  if (n.kind === 'transfer' && n.body === STOCK_BODIES.windowShut) return pickVariant(ROUTINE_BODIES.windowShut, key)
  if (n.kind === 'suspension' && n.body === STOCK_BODIES.fiveYellows) return pickVariant(ROUTINE_BODIES.fiveYellows, key)
  if (n.kind === 'suspension') {
    const ban = redCardBan(n.body)
    if (ban !== null) {
      const line = pickVariant([n.body, ...RED_CARD_BODIES], key)
      return line === n.body ? line : fillTemplate(line, { n: ban })
    }
  }
  return n.body
}
