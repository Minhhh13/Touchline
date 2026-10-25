/**
 * Real competition, award, game and brand names that must never reach text a
 * player can read (the trademark sweep, docs/DATA.md "Display names"). Player
 * and club names stay real. The data credits are the one exception: they name
 * their sources as the licences require, and they come from the packs'
 * `sources` and `src/ui/credits.ts`, which the source scan skips.
 */
export const BANNED_NAMES: Array<{ name: string; re: RegExp }> = [
  { name: 'Premier League', re: /premier\s+league/i },
  { name: 'La Liga / LaLiga', re: /\bla\s*liga\b/i },
  { name: 'Serie A', re: /\bserie\s+a\b/i },
  { name: 'Bundesliga', re: /bundesliga/i },
  { name: 'Ligue 1', re: /\bligue\s*1\b/i },
  { name: 'Eredivisie', re: /eredivisie/i },
  { name: 'Primeira Liga', re: /primeira\s+liga/i },
  { name: 'Liga Portugal', re: /liga\s+portugal/i },
  { name: 'Champions League', re: /champions\s+league/i },
  { name: 'UCL', re: /\bUCL\b/ },
  { name: 'Europa League', re: /europa\s+league/i },
  { name: 'Conference League', re: /conference\s+league/i },
  { name: 'FA Cup', re: /\bFA\s+Cup\b/i },
  { name: 'League Cup', re: /\bLeague\s+Cup\b/ },
  { name: 'Copa del Rey', re: /copa\s+del\s+rey/i },
  { name: 'DFB-Pokal', re: /\bDFB\b|pokal/i },
  { name: 'Coppa Italia', re: /coppa\s+italia/i },
  { name: 'Coupe de France', re: /coupe\s+de\s+france/i },
  { name: 'KNVB Beker', re: /\bKNVB\b|\bbeker\b/i },
  { name: 'Taca de Portugal', re: /ta[cç]a\s+de\s+portugal/i },
  { name: "Ballon d'Or", re: /ballon\s+d['’]?\s*or/i },
  { name: 'PFA', re: /\bPFA\b/ },
  { name: 'Football Manager', re: /football\s+manager/i },
  { name: 'FM', re: /\bFM\b/ },
  { name: 'FIFA', re: /\bFIFA\b/i },
  { name: 'EA Sports / EA FC', re: /\bEA\s+sports\b|\bEA\s+FC\b|\bEAFC\b/i },
  { name: '38-0', re: /(^|[^\d])38\s*-\s*0(?![\d])/ },
]

/** The banned names found in `text`, by display name. */
export function bannedIn(text: string): string[] {
  return BANNED_NAMES.filter((b) => b.re.test(text)).map((b) => b.name)
}
