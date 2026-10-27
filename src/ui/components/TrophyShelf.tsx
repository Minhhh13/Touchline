import '../visuals.css'
import { TrebleArt, TrophyArt, type TrophyKind } from './TrophyArt'

export interface ShelfTrophy {
  kind: TrophyKind | 'treble'
  label: string
  n: number
}

/**
 * The Trophy cabinet's top shelf: the league's trophy, the Cup, the Continental Cup and the Treble, drawn
 * (`TrophyArt`), standing on a lit plank. A trophy still to be won is a faint outline; one won stands in a soft gold
 * halo with its count. Decoration plus a count: the label and number are real text, the art is aria-hidden.
 */
export function TrophyShelf({ items }: { items: ShelfTrophy[] }) {
  return (
    <div className="trophy-shelf" data-testid="trophy-shelf">
      <ul className="shelf-row">
        {items.map((t) => (
          <li key={t.label} className={`shelf-item ${t.n ? 'won' : 'empty'}`} data-testid="shelf-item" data-kind={t.kind}>
            <span className="shelf-art">{t.kind === 'treble' ? <TrebleArt size={58} className={t.n ? '' : 'muted'} /> : <TrophyArt kind={t.kind} size={74} muted={!t.n} />}</span>
            <span className="shelf-n">{t.n ? `×${t.n}` : '0'}</span>
            <span className="shelf-label small">{t.label}</span>
          </li>
        ))}
      </ul>
      <span className="shelf-plank" aria-hidden="true" />
    </div>
  )
}
