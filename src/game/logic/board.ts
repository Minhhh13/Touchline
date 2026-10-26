/**
 * Board requests and the wage-to-transfer slider (FM-depth Batch 2). Both are
 * deterministic: a request is granted when board confidence is at least 60 and
 * its finance condition holds, with no dice, and refused otherwise for 2
 * confidence; one request per 8 matchweeks. The slider turns £10k a week of
 * wage room into £2M of transfer budget, or back.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { squadWages } from './squad'
import { postNews } from './news'

export type RequestKind = 'budget' | 'staff' | 'youth'

export const REQUEST_CONFIDENCE = 60
export const REQUEST_GAP = 8
export const REFUSAL_CONFIDENCE = -2
/** The staff request adds this much to the weekly wage cap, GBP thousands: about one elite backroom role. */
export const STAFF_REQUEST_WAGES = 60
/** Youth facilities: each grant adds an academy candidate a summer, up to this many. */
export const MAX_YOUTH_FACILITIES = 2
/** One step of the slider: GBP thousands a week of wage cap against GBP millions of budget; net steps either way in a season. */
export const SHIFT_WAGE = 10
export const SHIFT_BUDGET = 2
export const SHIFT_LIMIT = 25

/** The budget request's amount: the wage cap over 150, at least £5M (a £3M-a-week cap asks £20M). */
export function budgetAsk(game: Game): number {
  return Math.max(5, Math.round(game.finances.wageCap / 150))
}

export interface RequestOption {
  kind: RequestKind
  label: string
  /** What is asked for. */
  ask: string
  /** The finance condition the board checks, in words. */
  condition: string
  /** Whether that condition holds now. */
  conditionMet: boolean
}

/** The requests open to this game: budget and staff always, youth facilities in Dynasty. */
export function requestOptions(game: Game, u: LoadedUniverse): RequestOption[] {
  const wages = squadWages(game, u)
  const out: RequestOption[] = [
    { kind: 'budget', label: 'Transfer funds', ask: `+£${budgetAsk(game)}M to the budget`, condition: 'the wage bill is within 95% of the cap', conditionMet: wages <= game.finances.wageCap * 0.95 },
    { kind: 'staff', label: 'Backroom budget', ask: `+£${STAFF_REQUEST_WAGES}k a week on the wage cap`, condition: 'at least £10M in the bank', conditionMet: game.finances.budget >= 10 },
  ]
  if (game.settings.mode === 'dynasty') {
    const have = game.youthFacilities ?? 0
    out.push({ kind: 'youth', label: 'Youth facilities', ask: have >= MAX_YOUTH_FACILITIES ? 'Facilities are already the best they can be' : '+1 academy prospect every summer', condition: 'at least £20M in the bank', conditionMet: game.finances.budget >= 20 && have < MAX_YOUTH_FACILITIES })
  }
  return out
}

/** The matchweek the next request can be made, or null when one can be made now. */
export function nextRequestAt(game: Game): number | null {
  const season = game.season
  if (!season) return null
  const last = season.requests?.at(-1)
  if (!last) return null
  const at = last.mw + REQUEST_GAP
  return season.matchweek >= at ? null : at
}

/** Ask the board: granted at confidence 60 or more with the condition met, refused (−2 confidence) otherwise. */
export function makeRequest(game: Game, u: LoadedUniverse, kind: RequestKind): { ok: boolean; accepted: boolean; message: string } {
  const season = game.season
  if (!season || season.sacked) return { ok: false, accepted: false, message: 'There is no board to ask.' }
  if (season.matchweek >= season.matchweeks) return { ok: false, accepted: false, message: 'The season is over.' }
  const wait = nextRequestAt(game)
  if (wait !== null) return { ok: false, accepted: false, message: `One request every ${REQUEST_GAP} matchweeks: the next after matchweek ${wait - 1}.` }
  const opt = requestOptions(game, u).find((o) => o.kind === kind)
  if (!opt) return { ok: false, accepted: false, message: 'The board does not take that request here.' }
  const accepted = season.confidence >= REQUEST_CONFIDENCE && opt.conditionMet
  ;(season.requests ??= []).push({ kind, mw: season.matchweek, accepted })
  if (!accepted) {
    const why = season.confidence < REQUEST_CONFIDENCE ? `confidence is ${Math.round(season.confidence)}, they want ${REQUEST_CONFIDENCE}` : `they want ${opt.condition}`
    season.confidence = Math.max(0, season.confidence + REFUSAL_CONFIDENCE)
    postNews(game, { matchweek: season.matchweek, kind: 'board', title: `Request refused: ${opt.label.toLowerCase()}`, body: `The board says no: ${why}. Asking cost you 2 confidence.` })
    return { ok: true, accepted: false, message: `Refused: ${why}. −2 confidence.` }
  }
  if (kind === 'budget') game.finances.budget = Math.round((game.finances.budget + budgetAsk(game)) * 10) / 10
  else if (kind === 'staff') game.finances.wageCap += STAFF_REQUEST_WAGES
  else game.youthFacilities = Math.min(MAX_YOUTH_FACILITIES, (game.youthFacilities ?? 0) + 1)
  postNews(game, { matchweek: season.matchweek, kind: 'board', title: `Request granted: ${opt.label.toLowerCase()}`, body: `${opt.ask}.` })
  return { ok: true, accepted: true, message: `Granted: ${opt.ask}.` }
}

/** Weekly wage room under the cap, GBP thousands (players and staff). */
export function wageRoom(game: Game, u: LoadedUniverse): number {
  return game.finances.wageCap - squadWages(game, u)
}

/**
 * Move the slider one step: `+1` turns £10k a week of wage room into £2M of
 * budget, `−1` turns £2M of budget into £10k a week of cap. Within the wage
 * room, the budget, and 25 net steps either way a season.
 */
export function shiftWages(game: Game, u: LoadedUniverse, dir: 1 | -1): { ok: boolean; message: string } {
  const f = game.finances
  const net = f.wageShift ?? 0
  if (Math.abs(net + dir) > SHIFT_LIMIT) return { ok: false, message: `The board allows ${SHIFT_LIMIT} steps either way in a season.` }
  if (dir === 1) {
    if (wageRoom(game, u) < SHIFT_WAGE) return { ok: false, message: 'No wage room left to give up.' }
    f.wageCap -= SHIFT_WAGE
    f.budget = Math.round((f.budget + SHIFT_BUDGET) * 10) / 10
  } else {
    if (f.budget < SHIFT_BUDGET) return { ok: false, message: `You need £${SHIFT_BUDGET}M of budget to move into wages.` }
    f.wageCap += SHIFT_WAGE
    f.budget = Math.round((f.budget - SHIFT_BUDGET) * 10) / 10
  }
  if (net + dir === 0) delete f.wageShift
  else f.wageShift = net + dir
  return { ok: true, message: dir === 1 ? `£${SHIFT_WAGE}k a week of wages into £${SHIFT_BUDGET}M of budget.` : `£${SHIFT_BUDGET}M of budget into £${SHIFT_WAGE}k a week of wages.` }
}
