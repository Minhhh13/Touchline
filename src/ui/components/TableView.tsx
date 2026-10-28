import type { TableRow } from '@engine/types'
import { USER_TEAM } from '@engine/season'
import { ClubBadge, FormDots, TeamBadge } from './bits'
import { useStore } from '@game/store'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

export function TableView({ rows, teamName, teamCode, compact, highlightTop, nameOf }: { rows: TableRow[]; teamName: string; teamCode?: string; compact?: boolean; highlightTop?: boolean; nameOf?: (clubId: string) => string }) {
  const u = useStore((s) => s.universe)
  // Your row carries your own code (TX), as the header, the fixtures and the match day do
  const savedCode = useStore((s) => s.game?.settings.shortName)
  const code = teamCode ?? savedCode
  return (
    <table className={`tbl${compact ? ' tv-compact' : ''}`}>
      <thead>
        <tr>
          <th>#</th>
          <th>{t('club')}</th>
          <th className="num">{t('colP')}</th>
          {!compact && <th className="num tv-wdl">{t('colW')}</th>}
          {!compact && <th className="num tv-wdl">{t('colD')}</th>}
          {!compact && <th className="num tv-wdl">{t('colL')}</th>}
          <th className="num">{t('colGD')}</th>
          <th className="num">{t('colPts')}</th>
          {!compact && <th className="tv-form">{t('form')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const me = r.teamId === USER_TEAM
          const name = me ? teamName : nameOf ? nameOf(r.teamId) : u?.clubById[r.teamId]?.name ?? r.teamId
          return (
            <tr key={r.teamId} className={me ? 'me' : ''} style={highlightTop && i === 0 ? { fontWeight: 700 } : undefined}>
              <td>{i + 1}</td>
              <td className="tv-club" title={name}>
                <span className="row" style={{ gap: 8 }}>
                  {me ? <TeamBadge code={code} size={22} /> : <ClubBadge clubId={r.teamId} size={22} />}
                  <span className="tv-name">{name}</span>
                </span>
              </td>
              <td className="num">{r.played}</td>
              {!compact && <td className="num tv-wdl">{r.won}</td>}
              {!compact && <td className="num tv-wdl">{r.drawn}</td>}
              {!compact && <td className="num tv-wdl">{r.lost}</td>}
              <td className="num">{r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}{r.goalsFor - r.goalsAgainst}</td>
              <td className="num" style={{ fontWeight: 700 }}>{r.points}</td>
              {!compact && (
                <td className="tv-form">
                  <FormDots form={r.form} />
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
