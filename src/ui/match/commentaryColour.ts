/**
 * The commentary's colour: one short sentence after an event's own text (a
 * goal by its type and what it does to the score, a big chance, a save, the
 * woodwork, a card, a change, an injury, the whistles), a line before kick-off
 * for the occasion, and now and then a word on the mood in a quiet minute.
 *
 * It reads only what the feed already holds up to the line's minute (the score,
 * the minute, the scorer's goals in the match, a red card) plus an optional
 * context the dashboard reads before kick-off (the table, a man's season goals
 * and form). The line is picked by a pure hash of the match key, the minute and
 * the event, so a replay reads the same and nothing is drawn: the match itself
 * never changes. Pure: no React, no DOM, no RNG.
 */
import type { MatchEvent } from '@engine/types'
import { positionOf, seasonTable } from '@engine/season'
import type { Game } from '@game/types'
import { fillTemplate, flavourChance, flavourHash, ordinalOf, pickVariant } from '@game/logic/flavour'
import type { Side } from './pitchGeometry'

/** What the dashboard knows before kick-off: every field optional, and the commentary reads well without any of it. */
export interface CommentaryContext {
  /** League positions at kick-off and the league's size (a league match in a season). */
  positions?: { home: number; away: number; clubs: number }
  /** Goals each man had this season before kick-off, by player-season id. */
  seasonGoals?: Record<string, number>
  /** Each man's recent match ratings average before kick-off, by player-season id. */
  form?: Record<string, number>
  /** The user's side: his assistant's own changes (`assistantSubs.ts`) read as the assistant's. */
  userSide?: Side
}

/** The match as it stands when an event's line is written: only what has happened so far. */
export interface MatchState {
  /** The score before the event. */
  before: { home: number; away: number }
  /** The score after it (the same as `before` unless it is a goal). */
  after: { home: number; away: number }
  /** The scorer's goals in this match, this one included (0 for anything but a goal). */
  tally: number
  /** The biggest deficit each side has faced so far, before this event. */
  worst: { home: number; away: number }
  /** Red cards each side has had so far, this one included. */
  reds: { home: number; away: number }
  /** The occasion, from the feed ("Derby day", "Cup final"). */
  label?: string
}

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home')

// Goals: what the goal does to the match, the strongest story first
export const GOAL_LINES = {
  fourPlus: ['{p} has four. Unstoppable today.', 'Another for {p}. He is having the game of his life.', '{p} again! Someone fetch a second match ball.', 'Four for {p}, and the defenders have given up trying.', 'They cannot get near {p} today.'],
  hatTrick: ['Hat-trick for {p}! He will want the match ball.', 'That is three for {p}. Take a bow.', '{p} completes his hat-trick. What a performance.', 'Three goals, one man: {p}.', 'The hat-trick is complete, and {p} is mobbed.', 'Three for {p}. A day he will never forget.'],
  comebackAhead: ['From two down to in front: {team} have turned this on its head!', 'What a turnaround. {team} lead now!', '{team} were dead and buried. Not any more.', 'Unbelievable. {team} have gone from two behind to in front.', 'The comeback is complete, and then some: {team} lead!'],
  comebackLevel: ['{team} have clawed it all the way back!', 'Two down, and now level. {team} are not done.', 'The comeback is on: {team} are level!', 'Two goals behind, and {team} have wiped it out.', 'Back from the dead: {team} are level.'],
  lateWinner: ['Surely that is the winner for {team}!', 'Late, late drama: {team} lead!', 'That could be the one. {team} in front with time almost up.', 'Heartbreak for {opp}, joy for {team}.', 'With the clock running down, {team} strike!', 'The ground erupts. {team} lead, and there is hardly any time left.'],
  lateLevel: ['Rescued at the death! {team} are level.', 'Just when it looked over, {team} find a way.', 'A late leveller, and {opp} cannot believe it.', '{team} refuse to lie down. Level, late on.', 'Agony for {opp}: {team} snatch an equaliser.'],
  stoppage: ['In stoppage time, too!', 'Deep into added time. Cruel on {opp}.', 'The board was up and {team} still had something left.', 'Added time, and still {team} come forward.'],
  brace: ['That is two for {p}.', '{p} doubles his tally for the day.', 'A brace for {p}. Sharp as anything.', '{p} again! Two for him now.', 'Second of the day for {p}.'],
  earlyOpener: ['What a start for {team}!', 'Barely time to settle and {team} are ahead.', 'A dream start for {team}.', 'Some of the crowd are still finding their seats. {team} lead!', 'Out of the blocks quickest: {team}.'],
  opener: ['{team} have the breakthrough.', 'The deadlock is broken.', 'First blood to {team}.', 'That is the goal the game needed.', '{team} are in front.', 'At last, a goal, and it belongs to {team}.', 'The opener goes to {team}.'],
  equaliser: ['{team} are level.', 'All square again.', 'Back on terms. Game on.', 'Parity restored, and {opp} are rattled.', '{team} hit straight back.', 'The lead lasts no more: {team} are level.', 'Level again, and the noise goes up a notch.'],
  goAhead: ['{team} back in front.', '{team} edge ahead again.', 'The lead is restored.', '{team} nose in front once more.', 'Ahead again, and {opp} have it all to do.'],
  twoClear: ['{team} have breathing space now.', 'Two clear. {opp} have a mountain to climb.', 'That one feels big.', 'A two-goal cushion for {team}.', '{opp} needed to keep it tight. Now they need two.'],
  rout: ['This is turning into a rout.', '{opp} are falling apart here.', 'Total control from {team}.', 'The floodgates are open.', 'It is one-way traffic now.', '{team} smell blood, and they are not stopping.'],
  pullBack: ['{team} have a lifeline.', 'Game on! {team} pull one back.', 'Now then. {opp} will be nervous.', 'Back in it: {team} halve the deficit.', 'One goal in it now, and {team} believe again.'],
  consolation: ['Little more than a consolation, surely.', 'Pride restored, a little.', 'Too little, too late? Probably.', 'Something for the travelling fans, at least.', 'A small consolation for {team}.'],
} as const

/** Lines for a goal's type, read off the engine's own words for it. */
export const GOAL_TYPE_LINES: Record<'header' | 'longRange' | 'volley' | 'tapIn' | 'chip' | 'teamMove' | 'solo' | 'scramble' | 'penalty' | 'ownGoal' | 'finish', readonly string[]> = {
  header: ['Towering header.', 'Up he went, and nobody could live with him.', 'Bullet header. No chance for the keeper.', 'Met it perfectly with his head.', 'A thumping header, and the net bulges.'],
  longRange: ['What a hit!', 'From there! The keeper never moved.', 'Picked his spot from distance.', 'He just let fly, and it flew in.', 'A screamer from range.'],
  volley: ['Sweet as you like on the volley.', 'Struck on the half-volley and it flew in.', 'Technique of the highest order.', 'He never let it bounce.', 'Leaning back, and he kept it down beautifully.'],
  tapIn: ['The easiest goal he will ever score.', 'In the right place at the right time.', 'A poacher’s goal.', 'All he had to do was turn it in.', 'Gambled on the ball coming through, and it did.'],
  chip: ['Cheeky. Very cheeky.', 'Delicate. The keeper could only watch it drop.', 'The coolest head in the ground.', 'A feather touch over the keeper.', 'He saw the keeper off his line and lifted it over.'],
  teamMove: ['A goal made on the training ground.', 'Passing, movement, finish. Lovely stuff.', 'Pass after pass, and the net bulges.', 'Everyone touched it, and it ended in the net.', 'A move of real quality from front to back.'],
  solo: ['Took the keeper out of the game entirely.', 'Composure itself.', 'Waltzed round him like he was not there.', 'He made the keeper commit, then walked it in.', 'Ice in his veins.'],
  scramble: ['Not pretty, but they all count.', 'It went through a forest of legs.', 'Bundled in, and nobody minds.', 'Ugly, scrappy, and absolutely vital.', 'Pinball in the box, and in it goes.'],
  penalty: ['Sent the keeper the wrong way.', 'Never in doubt from the spot.', 'Cool as you like from twelve yards.', 'Into the corner, and the keeper guessed wrong.', 'He waited for the keeper to move, then rolled it in.', 'Struck high and hard. Unsaveable.'],
  ownGoal: ['A nightmare for {p}.', 'He will not want to see that one again.', 'Cruel, but that one goes down as his.', 'A gift for {team}.', 'He tried to clear it and only found his own net.', 'Hands on heads. {p} cannot believe it.'],
  finish: ['Clinical.', 'What a finish.', 'Emphatic.', 'No mistake there.', 'Tucked away with real calm.', 'Into the bottom corner.', 'The keeper got nowhere near it.', 'Finished with a minimum of fuss.'],
}

export const DERBY_GOAL_LINES = ['Bragging rights at stake, and {team} have struck.', 'Half the ground goes up.', 'Local pride on the line, and {team} land a blow.', 'In a derby, that one means even more.']

// Chances
export const CHANCE_LINES = {
  woodwork: ['So close!', 'Inches away.', 'The woodwork saves {opp}.', 'It is still shaking.', 'Unlucky. That deserved better.', 'The frame of the goal comes to the rescue.', 'Off the woodwork, and away.'],
  save: ['Strong hands.', 'Kept out, just.', 'He had to be at his best there.', 'Big moment, big save.', 'The keeper stands tall.', 'Fingertips!', 'What a stop.', 'Down low, and he smothers it.', 'The keeper reads it all the way.', 'Brave from the keeper.', 'Beaten for power? Not this time.'],
  line: ['Desperate defending.', 'Someone threw a body at it.', 'How has that stayed out?', 'Last-ditch stuff.', 'Cleared off the line!', 'A block that is worth a goal.'],
  miss: ['He has to hit the target there.', 'A let-off for {opp}.', 'He will be having nightmares about that.', 'That was the chance.', 'Should have scored.', 'Wide, and he knows it.', 'Over the bar. He leant back.', 'The crowd groan as one.', 'A big chance goes begging.', 'He snatched at it.', 'Not far away, but not close enough.', '{opp} breathe again.'],
  lateLevel: ['That was the chance to level it.', 'So nearly the equaliser.', '{team} will rue that.', 'The leveller was right there.', 'Time is running out for {team}, and so are the chances.'],
  lateCushion: ['That would have settled it.', 'A second would have killed it off.', '{opp} survive.', 'That would have been game over.', '{opp} are still in this, just.'],
} as const

// Cards
export const CARD_LINES = {
  early: ['Early booking. He will have to be careful now.', 'A long afternoon ahead on a yellow.', 'Too eager, too soon.', 'In the book before the game has settled.'],
  tactical: ['Taking one for the team.', 'Cynical, and he knew it.', 'Stopped the break at the cost of a yellow.', 'A professional foul, and a price worth paying for him.'],
  yellow: ['No complaints.', 'The referee had no choice.', 'Mistimed, and in the book he goes.', 'He went in late.', 'A clumsy challenge, and a deserved booking.', 'He will be walking a tightrope now.', 'The referee reaches for his pocket.', 'Silly from him.'],
  secondYellow: ['Two yellows and gone. Daft.', 'He was walking a tightrope all game.', 'An early bath.', 'He had been warned.'],
  straightRed: ['That changes everything.', 'Reckless. Off he goes.', 'No arguments. Straight off.', 'Down to ten.', 'Dangerous, and the referee had no hesitation.'],
  downToNine: ['Down to nine now! Chaos.', 'Two men short. This is a long way back.', 'Nine men. It is backs to the wall now.'],
} as const

// Changes and injuries
export const SUB_LINES = {
  chasing: ['A roll of the dice.', 'Fresh legs, and a goal needed.', 'Everything forward now.', 'Throwing on the attackers.', 'Chasing the game.', 'A gamble from the bench.'],
  holding: ['Time to see it out.', 'Shoring things up.', 'Running down the clock, too.', 'Closing the game down.', 'An extra body to protect the lead.'],
  halfTime: ['A change at the break.', 'Something needed changing, clearly.', 'A half-time reshuffle.'],
  routine: ['Fresh legs.', 'A like-for-like swap.', 'Applause as he goes off.', 'A chance to impress.', 'He has given everything.', 'A rest for tired legs.', 'New energy from the bench.', 'Warm applause for the man going off.'],
} as const

export const INJURY_LINES = ['That looks painful.', 'The physio is on.', 'A worry for {team}.', 'He is in real discomfort.', 'Not what {team} needed.', 'He is down and holding his leg.', 'The bench look concerned.', 'He tries to run it off, but it does not look good.']

// The whistles
export const HALF_TIME_LINES = {
  goalless: ['Nothing to choose between them.', 'Tight, cagey, goalless.', 'Plenty of effort, no goals.', 'All to play for.', 'Goalless at the break, and both managers have thinking to do.'],
  level: ['Honours even at the break.', 'All square, and everything to play for.', 'Level, and it could go either way.', 'Nothing between them at the interval.'],
  lead: ['{team} will be the happier side.', 'Advantage {team}.', '{opp} have work to do.', 'Big team talk coming for {opp}.', '{team} go in with their noses in front.'],
  comfortable: ['{team} in control.', 'It looks like {team}’s day.', 'A mountain for {opp} in the second half.', '{opp} need a miracle after the break.'],
} as const

export const FULL_TIME_LINES = {
  comeback: ['What a comeback from {team}!', '{team} came from behind and won it.', 'They never stopped, and {team} have their reward.', 'Behind, and then in front: {team} have won it.'],
  lateWinner: ['Won it at the death, {team}.', 'A late, late winner. Scenes.', 'Drama to the very end, and {team} have it.', 'Left it late, but {team} will not care.'],
  derbyWin: ['Bragging rights to {team}.', 'The derby belongs to {team}.', 'That one will be talked about for weeks.', 'A derby win, and the city is theirs.'],
  thrashing: ['A thrashing.', 'A statement from {team}.', 'One-way traffic from start to finish.', 'Embarrassing for {opp}.', 'A hammering, and it could have been more.'],
  cleanSheet: ['A clean sheet for {team}, too.', 'Job done, and nothing conceded.', 'Solid at the back, ruthless up top.', 'Three points and a clean sheet.', 'Nothing past them all game.'],
  goalFest: ['What a game!', 'Goals galore.', 'Defences took the day off.', 'Entertainment from start to finish.'],
  win: ['Three points for {team}.', 'A big win for {team}.', '{team} take the spoils.', 'Job done for {team}.', 'A deserved win for {team}.', '{team} see it out.'],
  goalless: ['Goalless, and nobody can quite say why.', 'Stalemate.', 'A point each, and not much else.', 'No goals, but no lack of effort.'],
  draw: ['Honours even.', 'A point apiece.', 'Neither side could find a winner.', 'All square at the end.', 'They share the points.'],
} as const

// Before kick-off
export const PRE_MATCH_LINES = {
  derby: ['Derby day, and the noise is something else.', 'A derby: form goes out of the window.', 'Local rivals, local pride. Here we go.'],
  decider: ['A title decider, and the tension is everywhere.', 'Top against top: this could shape the season.', 'Big game. Huge game.'],
  final: ['A final. Nobody remembers the runners-up.', 'One game for the trophy.', 'Ninety minutes from silverware.'],
  semi: ['A semi-final: the final is in sight.', 'One step from the final.'],
  european: ['A European night under the lights.', 'Continental football, and a big crowd.'],
  cup: ['Cup football: anything can happen.', 'A cup tie, and nobody wants to go out.'],
  topVsBottom: ['Top against bottom on paper, but games are not won on paper.', 'The leaders against the strugglers.', 'A mismatch in the table. On the pitch?'],
  sixPointer: ['A relegation six-pointer.', 'Down at the bottom, and both sides need this.', 'Nerves at the wrong end of the table.'],
  leaders: ['{team} start the day top of the table.', 'The leaders are in action.'],
} as const

// Quiet minutes: the mood of the match
export const MOOD_LINES = {
  early: ['A cagey start.', 'Both sides feeling each other out.', 'Nobody wants to make the first mistake.', 'Plenty of caution in these opening minutes.', 'A tentative opening.', 'Early days, and both sides are careful.', 'Nobody has settled yet.', 'A slow start from both sides.'],
  goalless: ['Still goalless, and it is tight.', 'The goal will not come.', 'Chess more than football right now.', 'Plenty of midfield scrapping, very little goalmouth action.', 'Somebody needs to take a risk.', 'Neither keeper has been worked much lately.', 'Still waiting for the breakthrough.', 'Few clear chances so far.', 'Tight and tense, and still no goal.'],
  secondHalf: ['{team} have come out with purpose.', 'A brighter start to the half from {team}.', '{team} look sharper after the break.', 'A lively start to the second half from {team}.', 'The second half is under way, and {team} are pressing.'],
  nervy: ['Nervy now for {lead}.', '{trail} throw bodies forward.', 'One goal in it, and the clock is ticking.', '{lead} sitting deeper and deeper.', 'Every clearance gets a cheer.', 'The fans of {lead} are whistling for the end.', '{trail} are camped in the other half.', 'Long minutes for the side in front.', 'Can {lead} see it out?', 'One more goal would settle the nerves for {lead}.'],
  lateLevel: ['Both sides sense a winner is there.', 'Who blinks first?', 'Legs are going now.', 'Settle for a point, or go for it?', 'Gaps are opening up all over the pitch.', 'Still level, and the clock is running down.', 'One goal would surely win it now.', 'Nobody wants to lose it now.'],
  cruising: ['{lead} are cruising.', 'Comfortable for {lead}.', '{trail} are out on their feet.', '{lead} are playing keep-ball now.', 'The contest is over, and everyone knows it.', 'This one is over as a contest.', 'The points look safe for {lead}.', 'Exhibition stuff now from {lead}.'],
  comfortable: ['Two goals to the good, {lead} can manage this.', 'A two-goal cushion for {lead}.', 'Breathing room for {lead} now.', 'A goal back would make things interesting for {trail}.'],
  openGame: ['Goals at both ends, and it is wide open.', 'End to end, and anyone could win it.', 'Neither side can keep the other out.', 'An open game, and nobody is sitting back.'],
  tenMen: ['{short} are digging in with ten.', 'Ten men, and {short} running twice as hard.', 'A man short, {short} are sitting deep.', 'With ten men, {short} have no choice but to defend.', 'The numbers are against {short}.'],
} as const

/** The goal's type from the engine's words for it. */
export function goalType(e: Pick<MatchEvent, 'type' | 'text'>): keyof typeof GOAL_TYPE_LINES {
  if (e.type === 'penalty') return 'penalty'
  if (e.type === 'own_goal') return 'ownGoal'
  const t = e.text
  if (/heads/.test(t)) return 'header'
  if (/from the edge|roof of the net/.test(t)) return 'longRange'
  if (/volley/.test(t)) return 'volley'
  if (/taps in|close range/.test(t)) return 'tapIn'
  if (/chips/.test(t)) return 'chip'
  if (/team move/.test(t)) return 'teamMove'
  if (/rounds the keeper/.test(t)) return 'solo'
  if (/crowd of bodies|loose ball/.test(t)) return 'scramble'
  return 'finish'
}

function eventKey(feedKey: string, e: Pick<MatchEvent, 'minute' | 'type' | 'playerId' | 'side'>): string {
  return `${feedKey}|${e.minute}|${e.type}|${e.side}|${e.playerId ?? ''}`
}

/**
 * One entry of `bank` by the hash, as `pickVariant`, but never one already in `used` (the lines this match has said):
 * from the hashed entry on to the first fresh one, which joins `used`; null when the bank is spent. Without `used` it is
 * `pickVariant` exactly, so a line read on its own is the one the match reads first.
 */
export function pickFresh(bank: readonly string[], key: string, used?: Set<string>): string | null {
  const start = flavourHash(key) % bank.length
  if (!used) return bank[start]
  for (let i = 0; i < bank.length; i++) {
    const line = bank[(start + i) % bank.length]
    if (!used.has(line)) {
      used.add(line)
      return line
    }
  }
  return null
}

/** The goal's colour: the story of the score first (four, a hat-trick, a comeback, a late one, a brace), else the situation, the type, a derby or the scorer's season. With `used`, never a line the match has said; null once every fitting line is spent. */
export function goalColour(feedKey: string, e: MatchEvent, s: MatchState, names: { home: string; away: string }, ctx: CommentaryContext = {}, used?: Set<string>): string | null {
  const us = e.side
  const them = other(us)
  const gf = s.after[us]
  const ga = s.after[them]
  const key = eventKey(feedKey, e)
  const vars = { p: e.playerName ?? 'He', team: names[us], opp: names[them] }
  const say = (bank: readonly string[], k = key): string | null => {
    const line = pickFresh(bank, k, used)
    return line === null ? null : fillTemplate(line, vars)
  }
  // An own goal counts for the other side: its line is about the man who scored it
  if (e.type === 'own_goal') return say(GOAL_TYPE_LINES.ownGoal)
  const story: readonly string[] | null =
    s.tally >= 4 ? GOAL_LINES.fourPlus
    : s.tally === 3 ? GOAL_LINES.hatTrick
    : s.worst[us] >= 2 && gf > ga && s.before[us] <= s.before[them] ? GOAL_LINES.comebackAhead
    : s.worst[us] >= 2 && gf === ga ? GOAL_LINES.comebackLevel
    : e.minute >= 85 && gf === ga + 1 && s.before[us] === s.before[them] ? GOAL_LINES.lateWinner
    : e.minute >= 85 && gf === ga ? GOAL_LINES.lateLevel
    : e.minute > 90 && flavourChance(key, 1, 2) ? GOAL_LINES.stoppage
    : s.tally === 2 ? GOAL_LINES.brace
    : null
  // A story spent in this match falls back to the goal's type, then a plain word on the finish
  if (story) return say(story) ?? say(GOAL_TYPE_LINES[goalType(e)], `${key}#type`) ?? say(GOAL_TYPE_LINES.finish, `${key}#finish`)
  const situation: readonly string[] =
    gf + ga === 1 ? (e.minute <= 5 ? GOAL_LINES.earlyOpener : GOAL_LINES.opener)
    : gf === ga ? GOAL_LINES.equaliser
    : s.before[us] === s.before[them] ? GOAL_LINES.goAhead
    : gf - ga >= 3 ? GOAL_LINES.rout
    : gf - ga === 2 ? GOAL_LINES.twoClear
    : ga - gf === 1 ? GOAL_LINES.pullBack
    : gf < ga ? GOAL_LINES.consolation
    : GOAL_LINES.opener
  // Otherwise one of a few angles, by the hash: the situation, the type, the derby, the scorer's season
  const angles: Array<() => string | null> = [() => say(situation), () => say(GOAL_TYPE_LINES[goalType(e)], `${key}#type`)]
  if (s.label === 'Derby day') angles.push(() => say(DERBY_GOAL_LINES, `${key}#derby`))
  const before = e.playerId ? ctx.seasonGoals?.[e.playerId] : undefined
  if (before !== undefined) angles.push(() => seasonGoalLine(before + s.tally, key, used))
  const form = e.playerId ? ctx.form?.[e.playerId] : undefined
  if (form !== undefined && (form >= 7.4 || form <= 6.3)) angles.push(() => pickFresh(form >= 7.4 ? FORM_LINES.hot : FORM_LINES.cold, `${key}#form`, used))
  // The hashed angle first, then the others in turn, then the finish, so a busy match still says something new
  const first = flavourHash(`${key}#angle`) % angles.length
  for (let i = 0; i < angles.length; i++) {
    const line = angles[(first + i) % angles.length]()
    if (line !== null) return line
  }
  return say(GOAL_TYPE_LINES.finish, `${key}#finish`)
}

export const FORM_LINES = {
  hot: ['He is in the form of his life.', 'Another one for a man who cannot stop scoring.', 'Form like that is priceless.', 'Everything he touches goes in at the moment.'],
  cold: ['Just what he needed after a quiet spell.', 'That should do his confidence the world of good.', 'The monkey is off his back.', 'He has been waiting for that one.'],
} as const

/** "His 12th of the season." and the like, by the hash; a round number gets its own line. With `used`, null when the match has said it. */
export function seasonGoalLine(n: number, key: string, used?: Set<string>): string | null {
  if (n === 1) return pickFresh(['His first of the season.', 'Off the mark for the season.'], `${key}#season`, used)
  if (n % 10 === 0) return pickFresh([`That is ${n} for the season. Remarkable.`, `${n} goals this season now.`], `${key}#season`, used)
  return pickFresh([`His ${ordinalOf(n)} of the season.`, `That makes ${n} for the season.`, `Goal number ${n} this season.`], `${key}#season`, used)
}

/** A chance or a save: the woodwork, the keeper, the line or a miss, with a word for the score late on. Sometimes nothing (a third of the time, or once the fitting lines are spent with `used`). */
export function chanceColour(feedKey: string, e: MatchEvent, s: MatchState, names: { home: string; away: string }, used?: Set<string>): string | null {
  const key = eventKey(feedKey, e)
  if (!flavourChance(key, 2, 3)) return null
  const us = e.side
  const them = other(us)
  const vars = { team: names[us], opp: names[them] }
  const say = (bank: readonly string[]): string | null => {
    const line = pickFresh(bank, key, used)
    return line === null ? null : fillTemplate(line, vars)
  }
  const late = (bank: readonly string[]) => (flavourChance(`${key}#late`, 1, 2) ? say(bank) : null)
  const t = e.text
  const plain = () => (/post|crossbar/.test(t) ? say(CHANCE_LINES.woodwork) : /on the line/.test(t) ? say(CHANCE_LINES.line) : e.type === 'save' ? say(CHANCE_LINES.save) : say(CHANCE_LINES.miss))
  if (e.minute >= 75 && s.before[them] - s.before[us] === 1) return late(CHANCE_LINES.lateLevel) ?? plain()
  if (e.minute >= 75 && s.before[us] - s.before[them] === 1) return late(CHANCE_LINES.lateCushion) ?? plain()
  return plain()
}

/** A card: a second yellow, a red and nine men, an early booking, a tactical one late on while ahead. Every red, and half the yellows (with `used`, none once its lines are spent). */
export function cardColour(feedKey: string, e: MatchEvent, s: MatchState, used?: Set<string>): string | null {
  const key = eventKey(feedKey, e)
  if (e.type === 'red') {
    if (s.reds[e.side] >= 2) return pickFresh(CARD_LINES.downToNine, key, used)
    return pickFresh(/second yellow/.test(e.text) ? CARD_LINES.secondYellow : CARD_LINES.straightRed, key, used)
  }
  if (!flavourChance(key, 1, 2)) return null
  if (e.minute <= 20) return pickFresh(CARD_LINES.early, key, used)
  if (e.minute >= 70 && s.before[e.side] > s.before[other(e.side)]) return pickFresh(CARD_LINES.tactical, key, used) ?? pickFresh(CARD_LINES.yellow, key, used)
  return pickFresh(CARD_LINES.yellow, key, used)
}

/** A change: chasing the game, holding on, at the break, or routine (half the time). An injury's replacement says enough already. */
export function subColour(feedKey: string, e: MatchEvent, s: MatchState, used?: Set<string>): string | null {
  if (/injured/.test(e.text)) return null
  const key = eventKey(feedKey, e)
  const diff = s.before[e.side] - s.before[other(e.side)]
  if (e.minute >= 70 && diff < 0) return pickFresh(SUB_LINES.chasing, key, used)
  if (e.minute >= 75 && diff > 0 && flavourChance(key, 1, 2)) return pickFresh(SUB_LINES.holding, key, used)
  if (e.minute === 45 || e.minute === 46) return pickFresh(SUB_LINES.halfTime, key, used)
  return flavourChance(key, 1, 2) ? pickFresh(SUB_LINES.routine, key, used) : null
}

export function injuryColour(feedKey: string, e: MatchEvent, names: { home: string; away: string }, used?: Set<string>): string | null {
  const line = pickFresh(INJURY_LINES, eventKey(feedKey, e), used)
  return line === null ? null : fillTemplate(line, { team: names[e.side] })
}

/** The half-time word on the score. */
export function halfTimeColour(feedKey: string, score: { home: number; away: number }, names: { home: string; away: string }): string {
  const key = `${feedKey}|ht`
  if (score.home === score.away) return pickVariant(score.home === 0 ? HALF_TIME_LINES.goalless : HALF_TIME_LINES.level, key)
  const lead: Side = score.home > score.away ? 'home' : 'away'
  const bank = Math.abs(score.home - score.away) >= 2 ? HALF_TIME_LINES.comfortable : HALF_TIME_LINES.lead
  return fillTemplate(pickVariant(bank, key), { team: names[lead], opp: names[other(lead)] })
}

/** The full-time verdict: a comeback, a late winner, a derby, a thrashing, a clean sheet, a goal fest, or the plain result. */
export function fullTimeColour(feedKey: string, events: MatchEvent[], names: { home: string; away: string }, label?: string): string {
  const key = `${feedKey}|ft`
  const goals = events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
  const score = { home: 0, away: 0 }
  const worst = { home: 0, away: 0 }
  let levelBeforeLast = false
  for (const g of goals) {
    levelBeforeLast = score.home === score.away
    score[g.side]++
    worst.home = Math.max(worst.home, score.away - score.home)
    worst.away = Math.max(worst.away, score.home - score.away)
  }
  if (score.home === score.away) return pickVariant(score.home === 0 ? FULL_TIME_LINES.goalless : FULL_TIME_LINES.draw, key)
  const win: Side = score.home > score.away ? 'home' : 'away'
  const vars = { team: names[win], opp: names[other(win)] }
  const say = (bank: readonly string[]) => fillTemplate(pickVariant(bank, key), vars)
  const last = goals[goals.length - 1]
  if (worst[win] >= 1) return say(FULL_TIME_LINES.comeback)
  if (last && last.side === win && last.minute >= 85 && levelBeforeLast) return say(FULL_TIME_LINES.lateWinner)
  if (label === 'Derby day' && flavourChance(key, 2, 3)) return say(FULL_TIME_LINES.derbyWin)
  const margin = Math.abs(score.home - score.away)
  if (margin >= 4) return say(FULL_TIME_LINES.thrashing)
  if (score[other(win)] === 0 && flavourChance(key, 2, 3)) return say(FULL_TIME_LINES.cleanSheet)
  if (score.home + score.away >= 6) return say(FULL_TIME_LINES.goalFest)
  return say(FULL_TIME_LINES.win)
}

/** The line after "Kick-off.": the occasion, or the table when it tells a story; null for an ordinary game. */
export function preMatchLine(feedKey: string, names: { home: string; away: string }, label?: string, ctx: CommentaryContext = {}): string | null {
  const key = `${feedKey}|pre`
  const by: Partial<Record<string, readonly string[]>> = {
    'Derby day': PRE_MATCH_LINES.derby,
    'Title decider': PRE_MATCH_LINES.decider,
    'Cup final': PRE_MATCH_LINES.final,
    'Continental final': PRE_MATCH_LINES.final,
    'Cup semi-final': PRE_MATCH_LINES.semi,
    'Continental semi-final': PRE_MATCH_LINES.semi,
    'European night': PRE_MATCH_LINES.european,
    'Cup tie': PRE_MATCH_LINES.cup,
  }
  const bank = label ? by[label] : undefined
  if (bank) return pickVariant(bank, key)
  const p = ctx.positions
  if (!p || p.clubs < 4) return null
  const drop = p.clubs - 2
  if ((p.home === 1 && p.away >= drop) || (p.away === 1 && p.home >= drop)) return pickVariant(PRE_MATCH_LINES.topVsBottom, key)
  if (p.home >= drop && p.away >= drop) return pickVariant(PRE_MATCH_LINES.sixPointer, key)
  if (p.home === 1 || p.away === 1) return fillTemplate(pickVariant(PRE_MATCH_LINES.leaders, key), { team: names[p.home === 1 ? 'home' : 'away'] })
  return null
}

/** A word on the mood for a quiet minute, from the score and the clock; null when the mood has nothing to say (or, with `used`, nothing new). */
export function moodLine(feedKey: string, minute: number, score: { home: number; away: number }, reds: { home: number; away: number }, momentumSide: Side, names: { home: string; away: string }, used?: Set<string>): string | null {
  const key = `${feedKey}|mood|${minute}`
  const diff = score.home - score.away
  const lead: Side | null = diff > 0 ? 'home' : diff < 0 ? 'away' : null
  const vars = { team: names[momentumSide], lead: lead ? names[lead] : '', trail: lead ? names[other(lead)] : '', short: reds.home > reds.away ? names.home : names.away }
  const say = (bank: readonly string[]) => {
    const line = pickFresh(bank, key, used)
    return line === null ? null : fillTemplate(line, vars)
  }
  if (reds.home !== reds.away && flavourChance(key, 1, 3)) return say(MOOD_LINES.tenMen)
  if (lead && Math.abs(diff) >= 3) return say(MOOD_LINES.cruising)
  if (minute >= 80 && lead && Math.abs(diff) === 1) return say(MOOD_LINES.nervy)
  if (minute >= 80 && !lead) return say(MOOD_LINES.lateLevel)
  if (minute >= 46 && minute <= 52) return say(MOOD_LINES.secondHalf)
  if (minute <= 10 && score.home + score.away === 0) return say(MOOD_LINES.early)
  if (minute >= 30 && minute <= 70 && score.home + score.away === 0) return say(MOOD_LINES.goalless)
  if (minute >= 55 && lead && Math.abs(diff) === 2) return say(MOOD_LINES.comfortable)
  if (minute >= 20 && minute < 80 && !lead && score.home + score.away >= 2) return say(MOOD_LINES.openGame)
  return null
}

/**
 * The context the dashboard reads before kick-off of a live league match: both sides' places in the table and our
 * men's season goals and form (a squad's stats only move at the whistle, so in play they are still the pre-match
 * ones). Empty for anything else (a replay, a cup tie, a friendly, the arena), where those numbers would already hold
 * the match or mean nothing.
 */
export function commentaryContextFor(game: Pick<Game, 'season' | 'squad'>, homeId: string, awayId: string, liveLeague: boolean): CommentaryContext {
  if (!liveLeague || !game.season) return {}
  const table = seasonTable(game.season)
  const home = positionOf(table, homeId)
  const away = positionOf(table, awayId)
  const seasonGoals: Record<string, number> = {}
  const form: Record<string, number> = {}
  for (const [id, s] of Object.entries(game.squad ?? {})) {
    seasonGoals[id] = s.seasonStats?.goals ?? 0
    const r = s.recentRatings ?? []
    if (r.length >= 3) form[id] = r.reduce((a, b) => a + b, 0) / r.length
  }
  // Positions mean something once a few rounds are in
  const played = table.find((r) => r.teamId === homeId)?.played ?? 0
  return { ...(home > 0 && away > 0 && played >= 5 ? { positions: { home, away, clubs: table.length } } : {}), seasonGoals, form }
}
