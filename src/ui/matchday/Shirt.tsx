/** Our own shirt: a simple outline in the side's colour with the number on it (no real kits). */
import { textColourFor } from '../format'

const PATH = 'M8.2 2.5 3.4 4.6 1 9.4l3.6 2 1.6-1.4V22.5h11.6V10l1.6 1.4 3.6-2-2.4-4.8-4.8-2.1c-.6 1.7-2.2 2.8-3.8 2.8s-3.2-1.1-3.8-2.8Z'

export function Shirt({ colour, number, size = 26, dim = false, title }: { colour: string; number?: number | string; size?: number; dim?: boolean; title?: string }) {
  const ink = textColourFor(colour)
  return (
    <svg className={`md-shirt ${dim ? 'dim' : ''}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={PATH} fill={colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.9" strokeLinejoin="round" />
      {number !== undefined && (
        <text x="12" y="17.2" textAnchor="middle" fontSize={String(number).length > 1 ? 8.4 : 9.4} fontWeight="800" fill={ink}>
          {number}
        </text>
      )}
    </svg>
  )
}
