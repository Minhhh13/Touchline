import { ArrowBigUpDash, ArrowLeftRight, Backpack, Copyright, Eye, Lock, Repeat, BadgeCheck, CircleArrowUp, Coins, Dog, Skull, Timer, Tornado, Armchair, Bandage, Banknote, BrickWall, CalendarCheck, CircleCheck, Circle, CircleDot, Crown, Dumbbell, EyeOff, Footprints, Gem, Globe, Hand, Handshake, Heart, History, Info as InfoGlyph, Landmark, Mail, Medal, MessageSquare, RectangleVertical, ScrollText, Shield, Sparkles, Sprout, Star, Target, ArrowDownToLine, TriangleAlert, Trophy, Zap, type LucideIcon } from 'lucide-react'
import type { NewsItem } from '@engine/season'
import type { Twist } from '@engine/draft'
import type { ModeCard } from '@engine/modes'
import { POWER_UPS, type PowerUp } from '@engine/powerups'
import type { BriefingItem } from '@game/logic/briefing'
import type { RuleIcon } from '@game/logic/setup'
import { FerrisWheel, Gift, Package, UserRound } from 'lucide-react'

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

/** One picture per Quick Draft mode card (Setup's Modes row, the Draft's mode chips); `MODE_INFO.icon` keeps the emoji for share text. */
export const MODE_ICON: Record<ModeCard, LucideIcon> = {
  crazy: Tornado,
  hard: Skull,
  underdog: Dog,
  legends: BadgeCheck,
  speedrun: Timer,
  gamble: Coins,
  upgrader: CircleArrowUp,
}

/** The fixed-rules chips' pictures (`describeRuleChips`): the mode cards' own, and the ones Setup's Power-ups, End case and Manager cards draw. */
export const RULE_ICON: Record<RuleIcon, LucideIcon> = {
  ...MODE_ICON,
  'power-ups': Package,
  'end-case': Gift,
  'manager-spin': FerrisWheel,
  'manager-pick': UserRound,
}

/** A red card: the suspension icon filled in the bad colour. */
export function RedCard({ size = 14 }: { size?: number }) {
  return <RectangleVertical size={size} className="ic-red-card" aria-hidden="true" />
}

/** A yellow card: the same shape filled in gold. */
export function YellowCard({ size = 14 }: { size?: number }) {
  return <RectangleVertical size={size} className="ic-yellow-card" aria-hidden="true" />
}

/**
 * One picture per achievement (ACHIEVEMENTS in engine/awards.ts keeps its
 * emoji for share text). An id missing here falls back to the trophy.
 */
export const ACHIEVEMENT_ICON: Record<string, LucideIcon> = {
  perfect: Gem,
  invincible: Shield,
  champions: Trophy,
  centurions: Target,
  double: Medal,
  cup: Medal,
  continental: Globe,
  treble: Crown,
  boot30: Footprints,
  glove20: BrickWall,
  'hard-champions': EyeOff,
  'one-club-champions': Heart,
  'one-nation-champions': Globe,
  'quick-perfect': Zap,
  'daily-streak-7': CalendarCheck,
  'dynasty-3': Crown,
  survivor: Armchair,
  dealmaker: Handshake,
  'record-points': ScrollText,
}

export function AchievementIcon({ id, size = 22 }: { id: string; size?: number }) {
  const Icon = ACHIEVEMENT_ICON[id] ?? Trophy
  return <Icon size={size} aria-hidden="true" />
}

/** The season awards: player of the season, golden boot (and the quick season's top scorer), playmaker, golden glove, young player. */
export const AWARD_ICON = {
  pots: Star,
  boot: Footprints,
  playmaker: Target,
  glove: Hand,
  young: Sprout,
} as const satisfies Record<string, LucideIcon>

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

/**
 * Each power-up's picture on the tray, the locker, the draft log, the case reel and its odds (the emoji in
 * `POWER_UP_INFO.icon` stay for share text only): an arrow up for the Upgrader, a repeat for the season re-roll, an eye
 * for Peek, two arrows for Swap, the C of the armband, a padlock for Lock.
 */
export const POWER_UP_ICON: Record<PowerUp, LucideIcon> = {
  upgrader: ArrowBigUpDash,
  reroll: Repeat,
  peek: Eye,
  swap: ArrowLeftRight,
  armband: Copyright,
  lock: Lock,
}

/** The locker's own picture. */
export const LOCKER_ICON: LucideIcon = Backpack

export function PowerUpIcon({ kind, size = 16 }: { kind: PowerUp; size?: number | string }) {
  const Icon = POWER_UP_ICON[kind]
  return <Icon size={size} aria-hidden="true" />
}

const CASE_KEYS = new Set<string>([...POWER_UPS, 'icon'])

/** Whether a reel card's key is a case item (a power-up or the Icon), whose picture is an icon rather than its text face. */
export function isCaseItemKey(key: string): key is PowerUp | 'icon' {
  return CASE_KEYS.has(key)
}

/** A case item's picture: the power-up's icon, or a star for the Icon. */
export function CaseItemIcon({ item, size = 16 }: { item: PowerUp | 'icon'; size?: number | string }) {
  return item === 'icon' ? <Star size={size} aria-hidden="true" /> : <PowerUpIcon kind={item} size={size} />
}
