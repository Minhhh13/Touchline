import { splitSeason } from '../arenaText'

/**
 * A club-season's name with its season kept on one line (`Manchester United <nowrap>2026-27</nowrap>`): a narrow box
 * broke "2026-27" at its hyphen. A name without a trailing season prints as it is.
 */
export function SeasonName({ name }: { name: string }) {
  const { club, season } = splitSeason(name)
  if (!season) return <>{name}</>
  return (
    <>
      {club} <span style={{ whiteSpace: 'nowrap' }}>{season}</span>
    </>
  )
}
