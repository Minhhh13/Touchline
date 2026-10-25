import { Bandage, Banknote, CircleCheck, Circle, CircleDot, Dumbbell, EyeOff, History, Info as InfoGlyph, Landmark, Mail, Medal, MessageSquare, RectangleVertical, Sparkles, ArrowDownToLine, TriangleAlert, Trophy, type LucideIcon } from 'lucide-react'
import type { NewsItem } from '@engine/season'
import type { Twist } from '@engine/draft'
import type { BriefingItem } from '@game/logic/briefing'

/** The Inbox's picture for each kind of news; the same meanings as the digest's groups (DESIGN_SYSTEM.md section 7). */
export const NEWS_ICON: Record<NewsItem['kind'], LucideIcon> = {
  result: CircleDot,
  injury: Bandage,
  suspension: RectangleVertical,
  board: Landmark,
  transfer: Banknote,
  award: Trophy,
  event: MessageSquare,
  cup: Medal,
  training: Dumbbell,
  info: InfoGlyph,
}

/** One picture per wheel twist, drawn in the twist card and the draft log. */
export const TWIST_ICON: Record<Twist, LucideIcon> = {
  golden: Sparkles,
  basement: ArrowDownToLine,
  blind: EyeOff,
  decade: History,
}

/** A red card: the suspension icon filled in the bad colour. */
export function RedCard({ size = 14 }: { size?: number }) {
  return <RectangleVertical size={size} className="ic-red-card" aria-hidden="true" />
}

/** The news icon, with the suspension drawn as a filled red card. */
export function NewsIcon({ kind, size = 16 }: { kind: NewsItem['kind']; size?: number }) {
  if (kind === 'suspension') return <RedCard size={size} />
  const Icon = NEWS_ICON[kind]
  return <Icon size={size} aria-hidden="true" />
}

/** The briefing's status mark: a ticked or open box for the pre-season checklist, otherwise its level. */
export function BriefingIcon({ item, size = 16 }: { item: Pick<BriefingItem, 'done' | 'level'>; size?: number }) {
  if (item.done !== undefined) return item.done ? <CircleCheck size={size} aria-hidden="true" /> : <Circle size={size} aria-hidden="true" />
  const Icon = { block: Mail, warn: TriangleAlert, info: InfoGlyph, ok: CircleCheck }[item.level]
  return <Icon size={size} aria-hidden="true" />
}
