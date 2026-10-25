import type { CupTie } from '@engine/cup'
import { ClubBadge } from './bits'

/**
 * A knockout's rounds side by side (stacked on a phone): every tie drawn so
 * far with its score, the side that went through in bold and your tie
 * outlined; a round not yet drawn says when it will be.
 */
export function Bracket({ rounds, ties, nameOf, badgeOf, userId, seeds = [] }: { rounds: string[]; ties: CupTie[][]; nameOf: (key: string) => string; badgeOf: (key: string) => string; userId: string; seeds?: string[] }) {
  const seeded = new Set(seeds)
  const side = (key: string, t: CupTie, align: 'left' | 'right') => (
    <span className="row" style={{ gap: 6, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', fontWeight: t.winner === key ? 700 : 400, minWidth: 0 }}>
      {align === 'left' && <ClubBadge clubId={badgeOf(key)} size={16} />}
      <span style={{ overflowWrap: 'break-word' }}>
        {nameOf(key)}
        {seeded.has(key) && <span className="muted small" title="Seeded"> (s)</span>}
      </span>
      {align === 'right' && <ClubBadge clubId={badgeOf(key)} size={16} />}
    </span>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14 }} data-testid="bracket">
      {rounds.map((name, r) => (
        <div key={name} className="col" style={{ gap: 4 }} data-testid={`bracket-round-${r}`}>
          <h3 style={{ fontSize: 15 }}>{name}</h3>
          {!ties[r] && <div className="small muted">Drawn after the {rounds[r - 1]?.toLowerCase() ?? 'previous round'}</div>}
          {ties[r]?.map((t, i) => {
            const me = t.home === userId || t.away === userId
            const played = t.hg !== undefined && t.ag !== undefined
            return (
              <div key={i} className={`fixture ${me ? 'me' : ''}`} style={{ gridTemplateColumns: '1fr auto 1fr', gap: 6 }} data-testid={me ? 'bracket-me' : undefined}>
                {side(t.home, t, 'right')}
                <span className="sc" style={{ fontSize: 15, minWidth: 44 }}>
                  {played ? `${t.hg}-${t.ag}` : 'v'}
                  {t.pens && <div className="small muted">{`${t.pens.home}-${t.pens.away} pens`}</div>}
                </span>
                {side(t.away, t, 'left')}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
