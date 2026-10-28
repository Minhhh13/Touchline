/**
 * What brings a player back and brings a friend: the share card's "beat me" box, the share text's tidy pass and
 * invitation line, and Home's comeback facts (the Daily's reminder, personal bests, the next badge). Pure and display
 * only: nothing here draws, and nothing in a game reads it. Kept out of `challenge.ts`, `setup.ts` and the rest the
 * edge verifier bundles. The card and the share text are not translated (CLAUDE.md), so their words live here; Home
 * words its facts through its own catalogue.
 */
import { TIER_NAMES, type BadgeState, type BadgeTier } from '@engine/badges'
import type { Game, Profile, QuickBests } from '../types'

/** The address printed on every card and at the foot of the share text. */
export const SHARE_HOST = 'touchline.quest'

/** Which summary a card or a share text comes from. */
export type InviteKind = 'quick' | 'daily' | 'weekly' | 'season' | 'dynasty' | 'final' | 'cup' | 'gauntlet' | 'runin' | 'h2h'

/** The card's "beat me" box: a call, a line under it and where to play. */
export interface Invite {
  title: string
  line: string
  where: string
}

export interface InviteFacts {
  points?: number
  /** League position (a run-in's finish). */
  position?: number
  /** The arena run won (a final won, a cup lifted, every rung climbed). */
  won?: boolean
  /** Gauntlet rungs climbed. */
  rungs?: number
  /** A short challenge code (`#s=`), printed beside the address. */
  code?: string | null
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`

/** The "beat me" box for a summary of `kind`. */
export function inviteFor(kind: InviteKind, f: InviteFacts = {}): Invite {
  const where = f.code ? `${SHARE_HOST} · code ${f.code}` : SHARE_HOST
  const beat = f.points !== undefined ? ` Beat ${pts(f.points)}.` : ''
  switch (kind) {
    case 'quick':
      return { title: 'Beat my draft', line: `Same spins, same wheel.${beat}`, where }
    case 'daily':
      return { title: "Beat today's Daily", line: `One wheel for everyone today.${beat}`, where }
    case 'weekly':
      return { title: "Beat this week's draft", line: `One wheel all week.${beat}`, where }
    case 'season':
    case 'dynasty':
      return { title: 'Can you top this?', line: `Draft your own XI.${beat}`, where }
    case 'final':
      return { title: 'Beat my final', line: f.won ? 'Same final. Win it too.' : 'Same final. Can you win it?', where }
    case 'cup':
      return { title: 'Beat my cup run', line: f.won ? 'Same draw. Lift it too.' : 'Same draw. Go further.', where }
    case 'gauntlet':
      return { title: 'Beat my climb', line: f.won ? 'Same ladder. Climb every rung too.' : `Same ladder. Climb past rung ${f.rungs ?? 0}.`, where }
    case 'runin':
      return { title: 'Take the same job', line: f.position ? `Ten games to go. Finish above ${ordinal(f.position)}.` : 'Ten games to go. Do better.', where }
    case 'h2h':
      return { title: 'Draft against a friend', line: 'Two managers, one wheel.', where }
  }
}

/** The kind of invitation a finished game makes: by mode, and by format in the arena. */
export function inviteKindOf(game: Pick<Game, 'settings'>): InviteKind {
  switch (game.settings.mode) {
    case 'daily':
      return 'daily'
    case 'weekly':
      return 'weekly'
    case 'season':
      return 'season'
    case 'dynasty':
      return 'dynasty'
    case 'runin':
      return 'runin'
    case 'arena':
      return game.settings.arena?.format === 'gauntlet' ? 'gauntlet' : (game.settings.arena?.size ?? 2) === 2 ? 'final' : 'cup'
    default:
      // The online weekly plays as a Quick Draft on the week's seed
      return game.settings.seed.startsWith('weekly-') ? 'weekly' : 'quick'
  }
}

/** The share text's last line: the call and where to answer it (the challenge link when there is one). */
export function inviteLine(invite: Invite, url?: string | null): string {
  return `${invite.title}: ${url || SHARE_HOST}`
}

/** Glyphs that carry a result (the form blocks, a result's own icon) and stay in the share text. */
const STATUS = new Set(['🟩', '🟨', '🟥', '⬛', '⬜'])
/** A picture used as a label, and the word that replaces it. */
const LABEL: Record<string, string> = { '⚽': 'Top scorer', '⭐': 'Star' }
const PICTO = /\p{Extended_Pictographic}\uFE0F?/gu
const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}\s?/gu

/**
 * The share text emoji-light: the form blocks and each result line's own icon stay, a flag (shown as two letters on
 * Windows) goes, a ball or a star used as a label becomes a word ("Top scorer Haaland 31"; "MOTM: De Bruyne" keeps
 * only its words), and any other picture goes.
 */
export function tidyShareText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let out = line.replace(FLAG, '')
      // A result's icon before its banner in capitals (`🏆 WINNERS`, `🪜 7 RUNGS`, a run-in's `✅ SURVIVED`) is a status glyph
      const lead = /^(\p{Extended_Pictographic}\uFE0F?) (?:\d+ )?[A-Z]{2,}\b/u.exec(out)
      const keepLead = !!lead && !(lead[1].replace('\uFE0F', '') in LABEL)
      const head = keepLead && lead ? `${lead[1]} ` : ''
      const body = out.slice(head.length)
      out =
        head +
        body.replace(new RegExp(`${PICTO.source}\\s?`, 'gu'), (m, offset: number, whole: string) => {
          const glyph = m.trim().replace('\uFE0F', '')
          if (STATUS.has(glyph)) return m
          const word = LABEL[glyph]
          if (!word) return ''
          // A label already named after it ("MOTM: De Bruyne") needs no word of its own
          return /^[A-Za-z ]+:/.test(whole.slice(offset + m.length)) ? '' : glyph === '⭐' && offset === 0 ? 'Player of the season: ' : `${word}: `
        })
      return out.replace(/\s+$/, '')
    })
    .filter((l) => l.trim() !== '')
    .join('\n')
}

/** The share text as sent: tidied, then the invitation. */
export function shareWithInvite(text: string, invite: Invite, url?: string | null): string {
  return `${tidyShareText(text)}\n${inviteLine(invite, url)}`
}

/** A head-to-head on the card: the challenger's and my points, and who won. */
export interface CardVersus {
  name: string
  mine: number
  theirs: number
  /** True when I won, false when the challenger did, null when level. */
  won: boolean | null
}

/** A challenge's result for the card, decided as `verdictLine` decides it: points, then fewer defeats. */
export function versusOf(name: string, mine: { pts: number; l: number }, theirs: { pts: number; l: number }): CardVersus {
  const won = mine.pts !== theirs.pts ? mine.pts > theirs.pts : mine.l !== theirs.l ? mine.l < theirs.l : null
  return { name, mine: mine.pts, theirs: theirs.pts, won }
}

// ---------------------------------------------------------------------------
// Home: the Daily's reminder, personal bests and the next badge
// ---------------------------------------------------------------------------

/** Today's Daily as Home words it: played (with the streak), a streak that ends tonight, or a fresh puzzle. */
export type DailyNudge = { kind: 'played'; points: number; streak: number } | { kind: 'atRisk'; streak: number } | { kind: 'fresh' }

/** `today` and `yesterday` are daily seeds (`daily-YYYY-MM-DD`). */
export function dailyNudge(profile: Pick<Profile, 'dailyStreak' | 'lastDailyDate' | 'dailyResults'>, today: string, yesterday: string): DailyNudge {
  const done = profile.dailyResults[today]
  if (done) return { kind: 'played', points: done.points, streak: profile.dailyStreak }
  if (profile.dailyStreak > 0 && profile.lastDailyDate === yesterday) return { kind: 'atRisk', streak: profile.dailyStreak }
  return { kind: 'fresh' }
}

/** One personal best Home shows. */
export type Best = { id: 'record'; won: number; drawn: number; lost: number } | { id: 'perfectRun'; n: number } | { id: 'gauntlet'; n: number } | { id: 'arenaStreak'; n: number } | { id: 'weeklyStreak'; n: number }

/** At most `n` bests, the most telling first; nothing before a first result. */
export function personalBests(profile: Pick<Profile, 'quickBests' | 'cabinet' | 'arenaDaily' | 'weekly'>, n = 3): Best[] {
  const out: Best[] = []
  const q: QuickBests = profile.quickBests ?? {}
  if (q.bestRecord) out.push({ id: 'record', won: q.bestRecord.won, drawn: q.bestRecord.drawn, lost: q.bestRecord.lost })
  if ((q.longestPerfectRun ?? 0) >= 3) out.push({ id: 'perfectRun', n: q.longestPerfectRun ?? 0 })
  const rungs = profile.cabinet?.gauntlet.best ?? 0
  if (rungs > 0) out.push({ id: 'gauntlet', n: rungs })
  if ((profile.weekly?.streak ?? 0) > 1) out.push({ id: 'weeklyStreak', n: profile.weekly?.streak ?? 0 })
  if ((profile.arenaDaily?.streak ?? 0) > 1) out.push({ id: 'arenaStreak', n: profile.arenaDaily?.streak ?? 0 })
  return out.slice(0, n)
}

/** The badge nearest its next tier: what the Trophy Room nudges towards. */
export interface NextBadge {
  state: BadgeState
  target: number
  tier: BadgeTier
  left: number
}

/**
 * The badge to chase next: one already started first (the most of the way there), else the one with the lowest
 * first step. Null once every badge is gold.
 */
export function nextBadge(states: BadgeState[]): NextBadge | null {
  let best: { n: NextBadge; score: number } | null = null
  for (const state of states) {
    const i = state.badge.tiers.findIndex((t) => state.value < t)
    if (i === -1) continue
    const target = state.badge.tiers[i]
    // Started badges rank above untouched ones; then the share of the way there; then the fewest left
    const score = (state.value > 0 ? 2 : 0) + state.value / target - (target - state.value) / 1e4
    if (!best || score > best.score) best = { n: { state, target, tier: TIER_NAMES[i], left: target - state.value }, score }
  }
  return best?.n ?? null
}

/** After a quick season, against the profile's best record (which already counts this one): this is the best, or how far off it. */
export type OneMore = { kind: 'best' } | { kind: 'short'; wins: number } | { kind: 'moreDefeats' }

export function oneMore(best: QuickBests['bestRecord'] | undefined, mine: { won: number; lost: number }): OneMore | null {
  if (!best) return null
  if (mine.won === best.won && mine.lost === best.lost) return { kind: 'best' }
  return best.won > mine.won ? { kind: 'short', wins: best.won - mine.won } : { kind: 'moreDefeats' }
}
