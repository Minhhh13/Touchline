/**
 * Invented football club names for the setup screens: the default in the team name field and its Shuffle button.
 * Every word list is ours: the places are made up (a test checks each against every club in the packs and a short list
 * of real towns with well-known clubs), the club words are the common ones every league shares (United, Rovers,
 * Athletic), and nothing names a real club, a sponsor or a trademark. Which name comes up is UI randomness only: the
 * screen injects `Math.random` (as `itemReel.ts` does), the name never reaches the seed, and a draft plays the same
 * whatever it is called. Pure; the game logic's own fallback stays 'Touchline XI'.
 */

/** Made-up places: two old English pieces joined, plus a few plain words, none a town with a club of note. */
export const TEAM_PLACES: readonly string[] = [
  'Ashvale', 'Ashmoor', 'Ashcombe', 'Bramwick', 'Bramholm', 'Brookmere', 'Calderwick', 'Caldermoor', 'Eldermoor', 'Elderbridge',
  'Fernmouth', 'Ferncliffe', 'Foxholm', 'Foxmere', 'Glenmouth', 'Glenmere', 'Hartmoor', 'Hartcombe', 'Hazelmouth', 'Kingsmoor',
  'Kingsmere', 'Larkmoor', 'Larkholm', 'Marshcombe', 'Marshwick', 'Millcombe', 'Millmere', 'Northmere', 'Northcombe', 'Northgate',
  'Oakmere', 'Oakcliffe', 'Ravenmoor', 'Ravenmere', 'Ravenholm', 'Redmere', 'Redcombe', 'Rookmere', 'Rookcliffe', 'Silvermoor',
  'Silvermouth', 'Stonemere', 'Stonecombe', 'Thornmere', 'Thornholm', 'Westmere', 'Westcombe', 'Wrenmoor', 'Wrencliffe', 'Willowmere',
  'Alderholm', 'Aldermoor', 'Birchmere', 'Birchcombe', 'Crossmere', 'Fairmoor', 'Fairmere', 'Lowfield', 'Highmoor', 'Highcombe',
  'Brackenmoor', 'Brackenford', 'Heathmoor', 'Heathcombe', 'Elmcliffe', 'Elmhaven', 'Saltmere', 'Sandholm', 'Ambermoor', 'Ambervale',
  'Greymoor', 'Greycliffe', 'Bellcombe', 'Tollmere', 'Mossvale', 'Pinemoor', 'Rushcombe', 'Galeford', 'Galemoor', 'Hollowmere',
  'Ivymoor', 'Kettlewick', 'Mapleford', 'Maplewick', 'Netherholm', 'Netherwick', 'Riverwick', 'Rivermoor', 'Sedgecombe', 'Tidewell',
  'Tidemouth', 'Upperholm', 'Wheatmoor', 'Wheatcliffe', 'Yewmoor', 'Yewcombe', 'Harbour', 'Lantern Hill', 'Copper Lane', 'Mill Lane',
]

/** The club word after a place: the ones every league shares, none tied to one real club (no Hotspur, Wednesday or Argyle). */
export const TEAM_SUFFIXES: readonly string[] = ['United', 'Rovers', 'Athletic', 'Albion', 'Wanderers', 'Town', 'City', 'County', 'Borough', 'Rangers', 'Harriers', 'Swifts', 'Corinthians', 'Villa', 'Dynamos', 'Thistle']

/** The saints of a "St ... Town": real saints, invented towns. */
export const TEAM_SAINTS: readonly string[] = ['Aldric', 'Oswin', 'Edwy', 'Wulfric', 'Brannoc', 'Elfric', 'Anselm', 'Wystan', 'Tudwal', 'Cuthwin']

/** Real places with well-known clubs the pieces above could be mistaken for; a place here is never offered (a test keeps the lists apart). */
export const REAL_PLACES: readonly string[] = ['Ashford', 'Ashton', 'Ashby', 'Ashfield', 'Kingston', 'Kingsbury', 'Kingswood', 'Redbridge', 'Thornbury', 'Westbury', 'Westfield', 'Northwich', 'Hartlepool', 'Stonehaven', 'Fairfield', 'Silverdale', 'Hazlemere', 'Rushmere', 'Ivybridge', 'Meadowbank', 'Sedgemoor', 'St Ives', 'St Albans', 'St Neots', 'St Helens']

/** The longest name offered: a challenge link and a room carry 24 characters. */
export const TEAM_NAME_MAX = 24

export interface TeamNameRoll {
  name: string
  /** Three capital letters for the scoreboard: the place's first three ("Ashvale United" is ASH), ST and the saint's initial for a "St" name. */
  code: string
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)))]

/** The three-letter code of a place: its first three letters, capitals only. */
function placeCode(place: string): string {
  const letters = place.replace(/[^A-Za-z]/g, '').toUpperCase()
  return (letters + 'XXX').slice(0, 3)
}

/** One name from `random` (a number in [0, 1) per call), with no check against anything. */
function rollOnce(random: () => number): TeamNameRoll {
  const shape = random()
  if (shape < 0.06) {
    const saint = pick(TEAM_SAINTS, random)
    return { name: `St ${saint} ${pick(['Town', 'United', 'Athletic', 'Rovers', 'Wanderers'], random)}`, code: `ST${saint[0].toUpperCase()}` }
  }
  const place = pick(TEAM_PLACES, random)
  const code = placeCode(place)
  if (shape < 0.16) return { name: `AFC ${place}`, code }
  if (shape < 0.21) return { name: `Sporting ${place}`, code }
  if (shape < 0.25) return { name: `${place} FC`, code }
  return { name: `${place} ${pick(TEAM_SUFFIXES, random)}`, code }
}

/**
 * An invented club name and its code. `avoid` holds names it must not land on, whatever the case or spacing: the
 * one in the field (so Shuffle always changes it) and the other head-to-head manager's (so two sides never share one).
 */
export function generateTeamName(random: () => number, avoid: readonly string[] = []): TeamNameRoll {
  const used = new Set(avoid.map((x) => x.trim().toLowerCase()))
  let roll = rollOnce(random)
  for (let i = 0; i < 20 && used.has(roll.name.toLowerCase()); i++) roll = rollOnce(random)
  return roll
}

/**
 * The code of a name `generateTeamName` could have given (the shape and every word from the lists above), or null for
 * any other name: a name the player typed keeps `shortNameFor`'s initials, as before.
 */
export function generatedTeamCode(name: string): string | null {
  const n = name.trim()
  const saint = /^St (\S+) (?:Town|United|Athletic|Rovers|Wanderers)$/.exec(n)
  if (saint) return TEAM_SAINTS.includes(saint[1]) ? `ST${saint[1][0]}` : null
  const place = /^(?:AFC|Sporting) (.+)$/.exec(n)?.[1] ?? /^(.+) FC$/.exec(n)?.[1] ?? TEAM_SUFFIXES.filter((s) => n.endsWith(` ${s}`)).map((s) => n.slice(0, -s.length - 1))[0]
  return place && TEAM_PLACES.includes(place) ? placeCode(place) : null
}
