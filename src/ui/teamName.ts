import { useState } from 'react'
import { shortNameFor } from '@game/logic/setup'
import { generateTeamName, generatedTeamCode } from '@game/logic/teamNames'

/*
 * The team name a setup screen opens with: the name this viewer last typed and played with, or a freshly invented
 * one (`generateTeamName` on `Math.random`, UI randomness that never feeds the game). The typed name lives in its own
 * per-viewer key, never in the save; blocked storage just means a new invented name each time.
 */

export const TEAM_NAME_KEY = 'touchline-team-name'

/** The name this viewer last typed and started a game with, or null. */
export function savedTeamName(): string | null {
  try {
    const v = localStorage.getItem(TEAM_NAME_KEY)?.trim()
    return v ? v : null
  } catch {
    return null
  }
}

/** File the name a game started with: a typed one is kept for next time, an invented one clears the key so the next setup invents again. */
export function rememberTeamName(name: string): void {
  try {
    if (generatedTeamCode(name) === null && name.trim()) localStorage.setItem(TEAM_NAME_KEY, name.trim())
    else localStorage.removeItem(TEAM_NAME_KEY)
  } catch {
    // Storage blocked: the next setup invents a name
  }
}

/** The three-letter code for a name: an invented name's own (Ashvale United is ASH), a typed one's initials as before. */
export function teamShortName(name: string): string {
  return generatedTeamCode(name) ?? shortNameFor(name)
}

/** The name a new game takes with no setup screen (the first draft from Home): the remembered one, or an invented one. */
export function startingTeamName(random: () => number = Math.random): string {
  return savedTeamName() ?? generateTeamName(random).name
}

/** The name and code a game takes with no setup screen (the Daily Arena from Home or the World board): `startingTeamName` and its code. */
export function startingTeam(random: () => number = Math.random): { teamName: string; shortName: string } {
  const teamName = startingTeamName(random)
  return { teamName, shortName: teamShortName(teamName) }
}

/**
 * The team name field's state for a setup screen: `value` and `setValue` for the field, `name` the one a game starts
 * with (the field, or the invented spare shown as its placeholder when the field is blank), `fallback` that spare.
 */
export function useTeamName(): { value: string; setValue: (v: string) => void; name: string; shortName: string; fallback: string } {
  const [first] = useState(() => {
    const spare = generateTeamName(Math.random).name
    return { value: savedTeamName() ?? spare, spare }
  })
  const [value, setValue] = useState(first.value)
  const name = value.trim() || first.spare
  return { value, setValue, name, shortName: teamShortName(name), fallback: first.spare }
}
