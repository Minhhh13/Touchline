/**
 * A league's name in a sentence: "in the Premier League", "the Bundesliga", "the Eredivisie", but "in La Liga", "in
 * Serie A", "in Ligue 1" (they carry no article in English). Pure, display only.
 */
export function leagueArticle(name: string): '' | 'the ' {
  return /^(La |Serie |Ligue )/.test(name) ? '' : 'the '
}

/** "in the Premier League", "in La Liga". */
export function inLeague(name: string): string {
  return `in ${leagueArticle(name)}${name}`
}
