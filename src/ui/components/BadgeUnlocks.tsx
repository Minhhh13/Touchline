import { Share2, Trophy } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { nextToChase, unlockShareText, type TrophyItem } from '@game/logic/trophyChase'
import { translator } from '../i18n'
import { profile as profileText } from '../i18n/en/profile'
import { badgeCount, badgeTitle, milestoneCount, milestoneTitle, progressText } from '../i18n/trophyText'
import { shareOrCopy } from '../shareSheet'
import { trophyIcon } from '../trophyIcons'
import { profileTrophyItems, useTrophyReveal } from '../trophyReveal'
import { useBadgeSound } from '../sound/useBadgeSound'
import { prefersReducedMotion } from '../motion'
import { Tip } from './bits'

const t = translator(profileText)

/** A tier's name; an earned tile always has one. */
const tierName = (i: TrophyItem) => (i.tier ? t(`tier_${i.tier}`) : '')

/** How many fresh unlocks the card draws; the rest are counted. */
const SHOWN = 3

export const itemTitle = (i: TrophyItem) => (i.kind === 'badge' ? badgeTitle(i) : milestoneTitle(i))
export const itemCount = (i: TrophyItem) => (i.kind === 'badge' ? badgeCount(i, i.value) : milestoneCount(i, i.value))

/** One medal: the tier ring and the badge's icon (`pop` plays the unlock's entrance). */
export function UnlockMedal({ item, pop = false }: { item: TrophyItem; pop?: boolean }) {
  const Icon = trophyIcon(item.kind, item.id)
  return (
    <span className={`badge-ring ${item.tier ?? ''}${pop ? ' unlock-medal' : ''}`}>
      <Icon size={20} aria-hidden="true" />
    </span>
  )
}

/** The way to the next tier: its words and a meter. */
export function ChaseRow({ item }: { item: TrophyItem }) {
  const progress = progressText(item.tiers, item.value, item.stamp)
  return (
    <div className="chase-row" data-testid="chase-next">
      <UnlockMedal item={item} />
      <span className="milestone-text">
        <div className="title">{itemTitle(item)}</div>
        <div className="small muted">{progress}</div>
        <span className="milestone-meter" role="img" aria-label={progress}>
          <span style={{ width: `${Math.round(item.toward * 100)}%` }} />
        </span>
      </span>
    </div>
  )
}

/**
 * Under a result: the badges and tiers it unlocked, each with its medal, a share and the next one to chase, until the
 * viewer says Got it or opens the Trophy Room. Nothing shows while nothing is new. Presentation only.
 */
export function BadgeUnlocks() {
  const { profile, universe, go, showToast } = useStorePick('profile', 'universe', 'go', 'showToast')
  const items = profileTrophyItems(profile, universe)
  const { fresh, markSeen } = useTrophyReveal(items)
  // The medal's ring, once, as the Trophy Room rings it (the same heard list)
  useBadgeSound(fresh.length ? items.flatMap((i) => (i.key ? [i.key] : [])) : [])
  const share = async (i: TrophyItem) => {
    const out = await shareOrCopy({ title: 'TouchLine', text: unlockShareText(i, profile.managerName), url: 'https://touchline.quest/' })
    if (out === 'copied') showToast(t('unlockCopied'))
    else if (out === 'failed') showToast(t('unlockShareFailed'))
  }
  // Polite and always mounted, so the unlock is announced once as it lands
  return (
    <div role="status" aria-live="polite" className="unlock-live">
      {fresh.length > 0 && (
        <section className={`panel unlock-card${prefersReducedMotion() ? '' : ' animate'}`} data-testid="badge-unlocks" aria-labelledby="unlock-title">
          <h3 id="unlock-title" className="row" style={{ gap: 8 }}>
            <Trophy size={18} aria-hidden="true" /> {t('unlockedHead', { n: fresh.length })}
          </h3>
          <ul className="unlock-list">
            {fresh.slice(0, SHOWN).map((i, n) => (
              <li key={i.key ?? i.id} className="unlock-item" data-testid="badge-unlock" data-tier={i.tier ?? 'none'} style={{ animationDelay: `calc(${n} * var(--dur-2))` }}>
                <UnlockMedal item={i} pop />
                <span className="milestone-text">
                  <div className="title">{itemTitle(i)}</div>
                  <div className="small">{i.stamp ? t('unlockedStamp') : t('unlockedTier', { tier: tierName(i) })} · {itemCount(i)}</div>
                </span>
                <button type="button" className="btn sm ghost" onClick={() => void share(i)} aria-label={t('shareUnlockAria', { title: itemTitle(i) })} data-testid="badge-unlock-share">
                  <Share2 size={14} aria-hidden="true" /> {t('shareUnlock')}
                </button>
              </li>
            ))}
          </ul>
          {fresh.length > SHOWN && <div className="small muted">{t('unlockMore', { n: fresh.length - SHOWN })}</div>}
          <ChaseBlock items={items} />
          <Tip id="feats-first">{t('featsTip')}</Tip>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn sm"
              // The Trophy Room marks the new tiles New, then files them as seen itself
              onClick={() => go('profile')}
              data-testid="badge-unlock-room"
            >
              <Trophy size={14} aria-hidden="true" /> {t('openTrophyRoom')}
            </button>
            <button type="button" className="btn sm primary" onClick={markSeen} data-testid="badge-unlock-done">
              {t('unlockDone')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

/** The next one or two to chase, under an unlock and at the top of the Trophy Room. */
export function ChaseBlock({ items, n = 2 }: { items: readonly TrophyItem[]; n?: number }) {
  const next = nextToChase(items, n)
  if (!next.length) return null
  return (
    <div className="chase-block" data-testid="chase-block">
      <div className="small muted chase-head">{t('nextToChase')}</div>
      <div className="chase-rows">
        {next.map((i) => (
          <ChaseRow key={i.id} item={i} />
        ))}
      </div>
    </div>
  )
}
