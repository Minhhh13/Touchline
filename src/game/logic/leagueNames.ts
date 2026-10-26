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

/**
 * A sentence built with "in the <league>" (`summariseSetup`) with the article taken off where English has none. The
 * setup line is tidied here rather than in `setup.ts`, which the edge verifier's bundle carries unchanged.
 */
export function tidyLeagueArticles(line: string): string {
  return line.replace(/\bin the (La |Serie |Ligue )/g, 'in $1')
}
