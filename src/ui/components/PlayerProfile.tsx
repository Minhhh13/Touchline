import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Star, Trophy } from 'lucide-react'
import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { isEstimated } from '@game/logic/era'
import { bestSeasons, careerRows, roleSuitability, similarPlayers, type CareerRow } from '@game/logic/playerProfile'
import { shortSeason } from '@game/logic/playerCard'
import { Bar, ClubBadge, EstimatedChip, Pos, Rating } from './bits'
import { NationFlag } from './Flag'
import { clubName, clubShort, money, seasonLabel } from '../format'
import { translator } from '../i18n'
import { playerCard } from '../i18n/en/playerCard'

const t = translator(playerCard)

/**
 * The player card's deeper tabs (display only, every figure from `playerProfile.ts`): the season-by-season career
 * table with each club's finish and the change in rating, his best seasons, the roles he suits and the most similar
 * player-seasons in the loaded data. Each is a list inside the card's one scroller.
 */

function Delta({ d }: { d: number | null }) {
  if (d === null || d === 0) return null
  const up = d > 0
  return (
    <span className={`pc-delta ${up ? 'up' : 'down'}`} title={t(up ? 'deltaUp' : 'deltaDown', { n: Math.abs(d) })}>
      {up ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
      {Math.abs(d)}
    </span>
  )
}

function Finish({ row }: { row: Pick<CareerRow, 'finish' | 'champions'> }) {
  if (!row.finish) return <span className="muted">–</span>
  return (
    <span className={`pc-finish ${row.champions ? 'gold' : ''}`} title={row.champions ? t('champions') : t('finishTip', { pos: row.finish })}>
      {row.champions && <Trophy size={12} className="gold-ic" aria-hidden="true" />}
      {t('finish', { pos: row.finish })}
    </span>
  )
}

/** Every season, oldest first: club, position, age, rating with its change, the club's finish and the value. */
export function CareerTable({ u, seasons, current, peakId, shortlist, onStar }: { u: LoadedUniverse; seasons: PlayerSeason[]; current: string; peakId?: string; shortlist: string[]; onStar: (id: string) => void }) {
  const rows = useMemo(() => careerRows(u, seasons), [u, seasons])
  return (
    <table className="tbl pc-tbl">
      <thead>
        <tr>
          <th className="c-season">{t('colSeason')}</th>
          <th>{t('colClub')}</th>
          <th className="c-pos">{t('colPos')}</th>
          <th className="num c-age">{t('colAge')}</th>
          <th className="num c-ovr">{t('colOvr')}</th>
          <th className="num c-finish" title={t('colFinishTip')}>{t('colFinish')}</th>
          <th className="num c-value">{t('colValue')}</th>
          <th className="c-star">{t('shortlist')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const s = r.p
          const on = shortlist.includes(s.id)
          return (
            <tr key={s.id} className={`${s.id === current ? 'me' : ''} ${s.id === peakId ? 'best' : ''}`} title={`${seasonLabel(s.season)} · ${clubName(u, s.clubId)} · ${s.overall} · ${money(s.value)}`}>
              <td>
                <span className="pc-season-long">{seasonLabel(s.season)}</span>
                <span className="pc-season-short">{shortSeason(s.season)}</span>
              </td>
              <td>
                <span className="pc-club">
                  <ClubBadge clubId={s.clubId} size={18} />
                  <span className="pc-club-name">{clubName(u, s.clubId)}</span>
                </span>
              </td>
              <td className="c-pos">
                <Pos p={s.positions[0]} />
              </td>
              <td className="num">{s.age}</td>
              <td className="num">
                <span className="pc-ovr">
                  <Rating value={s.overall} />
                  <Delta d={r.delta} />
                </span>
                {r.estimated && <> <EstimatedChip compact /></>}
              </td>
              <td className="num c-finish">
                <Finish row={r} />
              </td>
              <td className="num c-value">{money(s.value)}</td>
              <td className="c-star">
                <button type="button" className={`pc-star ${on ? 'on' : ''}`} onClick={() => onStar(s.id)} title={t(on ? 'onShortlist' : 'shortlistSeason')} aria-label={t(on ? 'removeShortlist' : 'shortlistSeason')} aria-pressed={on}>
                  <Star size={16} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** His five best seasons, best first, each with its club, age and the club's finish. */
export function BestSeasons({ u, seasons }: { u: LoadedUniverse; seasons: PlayerSeason[] }) {
  const best = useMemo(() => bestSeasons(seasons, 5), [seasons])
  const rows = useMemo(() => new Map(careerRows(u, best).map((r) => [r.p.id, r])), [u, best])
  return (
    <ol className="pc-list" data-testid="card-best-seasons">
      {best.map((p, i) => {
        const r = rows.get(p.id)
        return (
          <li key={p.id} className="pc-line">
            <span className="pc-rank muted">{i + 1}</span>
            <Rating value={p.overall} />
            <span className="pc-line-main">
              <span className="pc-line-name">
                <ClubBadge clubId={p.clubId} size={18} /> <span className="ellipsis">{clubName(u, p.clubId)}</span>
              </span>
              <span className="pc-line-meta">
                {seasonLabel(p.season)} · {t('ageLine', { n: p.age })} · <Pos p={p.positions[0]} />
                {r?.estimated && <> <EstimatedChip compact /></>}
              </span>
            </span>
            {r && <Finish row={r} />}
          </li>
        )
      })}
    </ol>
  )
}

/** The roles he suits, best first, with the engine's role rating as a bar. */
export function RoleList({ p }: { p: PlayerSeason }) {
  const roles = useMemo(() => roleSuitability(p, 10), [p])
  const top = roles[0]?.rating ?? 0
  return (
    <div data-testid="card-roles">
      <p className="small muted pc-tab-note">{t('rolesNote')}</p>
      <ol className="pc-list">
        {roles.map((r) => (
          <li key={`${r.roleId}@${r.position}`} className={`pc-line pc-role ${r.rating === top ? 'top' : ''}`}>
            <Pos p={r.position} />
            <span className="pc-line-main">
              <span className="pc-line-name">{r.name}</span>
              <span className="pc-line-meta">{t(r.fit === 'natural' ? 'fitNatural' : 'fitCover')}</span>
            </span>
            <span className="pc-role-bar">
              <Bar value={r.rating} colour={r.fit === 'natural' ? 'var(--good)' : 'var(--meter-mid)'} />
            </span>
            <span className="mono pc-role-val">{r.rating}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The six closest player-seasons: same first position, an overall within six, the nearest attributes. */
export function SimilarList({ u, p, onPlayer }: { u: LoadedUniverse; p: PlayerSeason; onPlayer?: (playerId: string) => void }) {
  const hits = useMemo(() => similarPlayers(u, p, { limit: 8, classic: true }), [u, p])
  if (!hits.length) return <p className="small muted pc-empty">{t('noSimilar')}</p>
  return (
    <div data-testid="card-similar">
      <p className="small muted pc-tab-note">{t('similarNote', { season: seasonLabel(p.season) })}</p>
      <ol className="pc-list">
        {hits.map((h) => {
          const body = (
            <>
              <Rating value={h.p.overall} />
              <NationFlag nation={h.p.nationality} />
              <span className="pc-line-main">
                <span className="pc-line-name ellipsis">{h.p.name}</span>
                <span className="pc-line-meta">
                  {clubShort(u, h.p.clubId)} {seasonLabel(h.p.season)} · {t('ageLine', { n: h.p.age })}
                  {isEstimated(u, h.p) && <> <EstimatedChip compact /></>}
                </span>
              </span>
              <span className="chip pc-match" title={t('matchTip')}>{t('match', { n: h.match })}</span>
            </>
          )
          return (
            <li key={h.p.id}>
              {onPlayer ? (
                <button type="button" className="pc-line pc-line-btn" onClick={() => onPlayer(h.p.playerId)} data-testid="similar-player">
                  {body}
                </button>
              ) : (
                <span className="pc-line">{body}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
