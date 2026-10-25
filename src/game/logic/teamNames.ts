/**
 * Invented team names for the setup screens' Randomise button: football in-jokes, never a real club. The list is ours;
 * a test checks it against every club in the packs. Which one comes up is UI randomness only: the name never reaches
 * the seed, and a draft plays the same whatever it is called.
 */
export const FUN_TEAM_NAMES: readonly string[] = [
  'Back Post FC',
  'Corner Flag United',
  'Sunday League Legends',
  'Nutmeg Rovers',
  'Offside Trap Athletic',
  'Top Bins Town',
  'Row Z Rangers',
  'Hoofball Wanderers',
  'Park The Bus FC',
  'False Nine Albion',
  'Rabona Rovers',
  'Panenka Palace',
  'Stoppage Time XI',
  'Far Post Wanderers',
  'Half Volley Harriers',
  'Bicycle Kick City',
  'Clean Sheet County',
  'Through Ball Thistle',
  'Crossbar Challenge FC',
  'Tiki Taka Town',
  'Dummy Run Dynamos',
  'Sweeper Keeper FC',
  'Gegenpress Galaxy',
  'Long Throw Lions',
  'Six Yard Box FC',
  'Dugout Dreamers',
  'Penalty Spot Pirates',
  'Warm Up Wanderers',
  'Group Chat Athletic',
  'Five-a-Side Phoenix',
  'Shin Pad Sporting',
  'Half Time Oranges',
  'Mud Bath Rovers',
  'Away End Albion',
  'Hat-trick Heroes',
  'Golden Goal Getters',
  'Screamer Specialists',
  'Wall Pass Wizards',
]

/**
 * The name `roll` (a number in [0, 1), from the UI's own randomness) lands on, never the one already in the field, so
 * every press changes it.
 */
export function randomTeamName(roll: number, current = ''): string {
  const n = FUN_TEAM_NAMES.length
  const i = Math.min(n - 1, Math.max(0, Math.floor(roll * n)))
  const name = FUN_TEAM_NAMES[i]
  return name === current.trim() ? FUN_TEAM_NAMES[(i + 1) % n] : name
}
