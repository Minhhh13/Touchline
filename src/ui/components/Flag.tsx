import { useStore } from '@game/store'
import { leagueFlagCode, nationFlagCode, nationName } from '../format'

/**
 * A drawn flag from public/flags (flag-icons by lipis, MIT; see docs/CREDITS.md), never an emoji: Windows shows emoji
 * flags as two letters. 4:3, `size` px wide. Give `label` when nothing beside the flag names it (it becomes the alt
 * text and a tooltip); leave it out when the name is already there, and the image is hidden from screen readers.
 */
export function Flag({ code, label, size = 18 }: { code: string; label?: string; size?: number }) {
  const height = Math.round((size * 3) / 4)
  return (
    <img
      className="flag"
      src={`${import.meta.env.BASE_URL}flags/${code}.svg`}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      title={label}
      width={size}
      height={height}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={{ display: 'inline-block', width: size, height, flex: 'none', verticalAlign: 'middle', objectFit: 'cover', borderRadius: Math.max(1, Math.round(size / 9)), boxShadow: '0 0 0 1px rgba(128, 128, 128, 0.45)' }}
    />
  )
}

/** A nation's flag from its code in the packs; `named` when its name is printed beside it. */
export function NationFlag({ nation, size, named }: { nation: string; size?: number; named?: boolean }) {
  const u = useStore((s) => s.universe)
  return <Flag code={nationFlagCode(u, nation)} label={named ? undefined : nationName(u, nation)} size={size} />
}

/** A league's flag ('europe' for the EU flag); pass `label` only when the league's name is not printed beside it. */
export function LeagueFlag({ leagueId, size, label }: { leagueId: string; size?: number; label?: string }) {
  return <Flag code={leagueFlagCode(leagueId)} label={label} size={size} />
}
