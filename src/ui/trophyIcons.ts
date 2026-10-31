/**
 * The Trophy Room's pictures: one Lucide icon per badge and milestone, shared by the Trophy Room and the unlock
 * reveal (`components/BadgeUnlocks.tsx`). Presentation only; an id missing here draws `Award`.
 */
import { Award, Axe, BadgeCheck, BadgePercent, BrickWall, CalendarCheck, CalendarCheck2, CalendarClock, CalendarDays, CalendarRange, Castle, CheckCheck, ChevronsUp, Clock3, Compass, Crown, FireExtinguisher, Flag, Flame, Footprints, Gem, Globe, GraduationCap, Heart, Hourglass, Landmark, Layers, LifeBuoy, Link, ListOrdered, Medal, Moon, Mountain, PiggyBank, Rewind, Route, ScrollText, Shield, Swords, Target, Trophy, Undo2, Users, Wifi, Zap, type LucideIcon } from 'lucide-react'

/** The engine's twelve badges (the badge's emoji stays as data, for the manager card). */
export const BADGE_ICON: Record<string, LucideIcon> = {
  'serial-winner': Trophy,
  centurion: Target,
  perfectionist: Gem,
  'cup-collector': Medal,
  globetrotter: Compass,
  international: Flag,
  'grounds-tour': Landmark,
  regular: CalendarDays,
  'sunday-league': CalendarRange,
  ironman: ChevronsUp,
  'giant-killer': Axe,
  'survival-artist': LifeBuoy,
}

/** The milestones (`milestoneBadges.ts`). */
export const MILESTONE_ICON: Record<string, LucideIcon> = {
  invincibles: Shield,
  'treble-winners': Crown,
  'double-act': Layers,
  'continental-kings': Globe,
  'winning-machine': Zap,
  decade: Hourglass,
  'old-school': ScrollText,
  moneyball: PiggyBank,
  'perfect-day': CalendarCheck,
  summit: Mountain,
  'long-road': Route,
  'under-the-lights': Moon,
  'hot-seat': Users,
  'old-hand': CalendarClock,
  completist: BadgeCheck,
  'golden-boot': Footprints,
  'the-wall': BrickWall,
  'chain-gang': Link,
  loyalty: Heart,
  'group-winners': ListOrdered,
  'comeback-kings': Undo2,
  'dynasty-builder': Castle,
  academy: GraduationCap,
  'through-the-ages': Rewind,
  'bargain-hunter': BadgePercent,
  'perfect-draft': CheckCheck,
  'online-victor': Wifi,
  'arena-champion': Swords,
  'weekly-winner': CalendarCheck2,
  firefighter: FireExtinguisher,
  'six-from-six': Flame,
  'class-of-92': Clock3,
}

/** The icon of a badge or milestone by id. */
export function trophyIcon(kind: 'badge' | 'milestone', id: string): LucideIcon {
  return (kind === 'badge' ? BADGE_ICON[id] : MILESTONE_ICON[id]) ?? Award
}
