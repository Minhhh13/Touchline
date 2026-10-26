import { Compass, Sparkles, Trophy } from 'lucide-react'
import type { DraftRecap as Recap } from '@game/logic/draftRecap'
import type { PickGrade } from '@game/logic/pickGrades'
import type { PlayerSeason } from '@engine/types'
import { countPhrase } from '../screenText'
import { seasonLabel } from '../format'

const GRADE_CLASS: Record<PickGrade, string> = { A: 'good', B: 'info', C: 'warn', D: 'bad' }
const GRADES: PickGrade[] = ['A', 'B', 'C', 'D']

/**
 * The Draft's middle box once every pick is made: the draft's grade and verdict, the grade tally, the best pick, the one
 * that got away and how far the wheel travelled, then the button on to the next step. Display only (`draftRecap`).
 */
export function DraftRecap({ recap, get, slotName, cta, onCta }: { recap: Recap; get: (id: string) => PlayerSeason | undefined; slotName: (slotId: string) => string; cta: string; onCta: () => void }) {
  const r = recap
  const best = r.best ? get(r.best.pickedId) : undefined
  const missed = r.miss ? get(r.miss.pickedId) : undefined
  const span = r.seasons ? (r.seasons[0] === r.seasons[1] ? seasonLabel(r.seasons[0]) : `${seasonLabel(r.seasons[0])} to ${seasonLabel(r.seasons[1])}`) : null
  return (
    <div className="draft-recap" data-testid="draft-recap">
      <div className="recap-head">
        {r.grade && (
          <span className={`recap-grade ${GRADE_CLASS[r.grade]}`} data-testid="draft-grade" aria-label={`Draft grade ${r.grade}`}>
            {r.grade}
          </span>
        )}
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <span className="eyebrow">{r.grade ? 'Your draft' : 'All picks made'}</span>
          <h3 className="recap-verdict" data-testid="draft-verdict">
            {r.verdict}
          </h3>
          {r.grade && (
            <div className="row wrap recap-tally" style={{ gap: 6 }}>
              {GRADES.filter((g) => r.tally[g] > 0).map((g) => (
                <span key={g} className={`chip pick-grade ${GRADE_CLASS[g]}`} data-testid={`recap-tally-${g}`}>
                  {g} × {r.tally[g]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="recap-cards">
        {r.best && best && (
          <div className="recap-card" data-testid="recap-best">
            <span className="recap-icon good" aria-hidden>
              <Trophy size={18} />
            </span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="eyebrow">Best pick</span>
              <b>{best.name}</b>
              <span className="small muted">
                {r.best.rating} at {slotName(r.best.slotId)}, spin {r.best.spin + 1} · {seasonLabel(best.season)}
              </span>
            </div>
          </div>
        )}
        {r.miss && missed && (
          <div className="recap-card" data-testid="recap-miss">
            <span className="recap-icon warn" aria-hidden>
              <Sparkles size={18} />
            </span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="eyebrow">The one that got away</span>
              <b>{r.miss.bestName}</b>
              <span className="small muted">
                {r.miss.best} at {slotName(r.miss.slotId)} on spin {r.miss.spin + 1}; you took {missed.name} ({r.miss.rating})
              </span>
            </div>
          </div>
        )}
        <div className="recap-card" data-testid="recap-travel">
          <span className="recap-icon" aria-hidden>
            <Compass size={18} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="eyebrow">Where the wheel went</span>
            <b>
              {countPhrase(r.clubs, 'clubs')} · {countPhrase(r.nations, 'nations')}
            </b>
            <span className="small muted">
              {countPhrase(r.picks, 'picks')}
              {span ? `, ${span}` : ''}
              {r.xiRating !== null ? ` · XI ${r.xiRating.toFixed(1)} in its slots` : ''}
            </span>
          </div>
        </div>
      </div>
      <button className="btn primary big block recap-go" onClick={onCta} data-testid="recap-go">
        {cta}
      </button>
    </div>
  )
}
