/**
 * Countries for the flag on an online profile and the boards' country filter: ISO 3166-1 alpha-2 codes, named in
 * the player's language by `Intl.DisplayNames` (English codes as a fallback). Display only.
 */
import { countryFlag } from '../../online/core/country'

const CODES =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ')

let names: Intl.DisplayNames | null = null
try {
  names = new Intl.DisplayNames(undefined, { type: 'region' })
} catch {
  names = null
}

export function countryName(code: string): string {
  try {
    return names?.of(code) ?? code
  } catch {
    return code
  }
}

export interface CountryOption {
  code: string
  label: string
}

/** Every country, sorted by name, labelled with its flag. */
export const COUNTRY_OPTIONS: CountryOption[] = CODES.map((code) => ({ code, label: `${countryFlag(code)} ${countryName(code)}` })).sort((a, b) => a.label.slice(a.label.indexOf(' ') + 1).localeCompare(b.label.slice(b.label.indexOf(' ') + 1)))
