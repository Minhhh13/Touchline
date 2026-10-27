import type { ReactNode } from 'react'
import { Activity, ArrowLeftRight, Armchair, Award, Banknote, BookOpen, CalendarCheck, CalendarDays, ChartColumn, Crown, Dices, Dumbbell, Flag, Gauge, Globe, GraduationCap, Landmark, Layers, Lock, MessageSquare, Mountain, Package, RectangleVertical, Repeat, Shuffle, Sprout, Swords, Target, Trophy, TrendingUp, Users, Zap, type LucideIcon } from 'lucide-react'
import { useStore } from '@game/store'
import { TWIST_INFO } from '../components/TwistCard'
import { TWIST_ICON } from '../components/icons'
import { EstimatedChip, Rating } from '../components/bits'
import { seasonLabel } from '../format'
import { classicFromIndex } from '@game/logic/era'
import type { Twist } from '@engine/draft'
import { translator } from '../i18n'
import { howto } from '../i18n/en/howto'
import { B, rich } from '../i18n/rich'

const t = translator(howto)
const KBD = { kbd: (c: ReactNode) => <kbd>{c}</kbd> }

/** One section of How it works: a picture, a title, a line or two, then what illustrates it. */
function Section({ Icon, title, lead, children, wide }: { Icon: LucideIcon; title: string; lead: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <section className={`panel howto-section ${wide ? 'wide' : ''}`}>
      <div className="howto-head">
        <span className="howto-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <div>
          <h3>{title}</h3>
          <p className="howto-lead">{lead}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

/** A grid of facts: an icon and a short line each. */
function Facts({ items, tiles }: { items: Array<[LucideIcon, string, string]>; tiles?: boolean }) {
  return (
    <ul className={`howto-facts ${tiles ? 'tiles' : ''}`}>
      {items.map(([Icon, title, line]) => (
        <li key={title}>
          <Icon size={18} aria-hidden="true" />
          <span>
            <b>{title}</b>
            <span>{line}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

const TWISTS: Twist[] = ['golden', 'basement', 'blind', 'decade']

const seasonFacts = (): Array<[LucideIcon, string, string]> => [
  [CalendarDays, t('fCalendarTitle'), t('fCalendar')],
  [Globe, t('fContinentalTitle'), t('fContinental')],
  [Gauge, t('fConditionTitle'), t('fCondition')],
  [RectangleVertical, t('fCardsTitle'), t('fCards')],
  [MessageSquare, t('fMoraleTitle'), t('fMorale')],
  [Dumbbell, t('fTrainingTitle'), t('fTraining')],
  [Banknote, t('fJanuaryTitle'), t('fJanuary')],
  [ArrowLeftRight, t('fLiveTitle'), t('fLive')],
  [Users, t('fCaptainTitle'), t('fCaptain')],
  [Armchair, t('fStaffTitle'), t('fStaff')],
  [Target, t('fMarkingTitle'), t('fMarking')],
  [TrendingUp, t('fDevelopmentTitle'), t('fDevelopment')],
  [Landmark, t('fBoardTitle'), t('fBoard')],
]

const modeFacts = (): Array<[LucideIcon, string, string]> => [
  [Zap, t('mQuickDraftTitle'), t('mQuickDraft')],
  [Banknote, t('mQuickJanuaryTitle'), t('mQuickJanuary')],
  [Package, t('mEndCaseTitle'), t('mEndCase')],
  [CalendarCheck, t('mDailyTitle'), t('mDaily')],
  [CalendarDays, t('mWeeklyTitle'), t('mWeekly')],
  [Layers, t('mSuperTitle'), t('mSuper')],
  [Trophy, t('mCupTitle'), t('mCup')],
  [Mountain, t('mGauntletTitle'), t('mGauntlet')],
  [CalendarCheck, t('mDailyArenaTitle'), t('mDailyArena')],
  [Flag, t('mRunInTitle'), t('mRunIn')],
  [Swords, t('mH2HTitle'), t('mH2H')],
  [Award, t('mTrophyRoomTitle'), t('mTrophyRoom')],
]

const dynastyFacts = (): Array<[LucideIcon, string, string]> => [
  [Sprout, t('dAgeingTitle'), t('dAgeing')],
  [Dices, t('dSummerTitle'), t('dSummer')],
  [GraduationCap, t('dAcademyTitle'), t('dAcademy')],
  [Crown, t('dJobsTitle'), t('dJobs')],
]

export function HowTo() {
  const { go, universe: u } = useStore()
  // From the data index: the classic pack itself loads only when a game asks for it
  const classicFrom = u ? classicFromIndex(u.available, u.available.map((l) => l.id)) : undefined
  const leagues = u?.available.length ?? 7
  return (
    <div className="page howto">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{t('title')}</h1>
          <div className="screen-meta">
            <span>{t('meta')}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          {t('home')}
        </button>
      </div>
      <div className="screen-body scroll-whole fill">
      <div className="howto-grid">
        <Section Icon={Dices} title={t('wheelTitle')} lead={t('wheelLead', { leagues })}>
          <ol className="howto-steps">
            <li>{rich(t('step1'), B)}</li>
            <li>{rich(t('step2'), B)}</li>
            <li>{rich(t('step3'), B)}</li>
          </ol>
          <Facts
            items={[
              [Repeat, t('noDeadTitle'), t('noDead')],
              [Lock, t('onceTitle'), t('once')],
              [Users, t('squadTitle'), t('squad')],
            ]}
          />
        </Section>

        <Section Icon={Shuffle} title={t('twistsTitle')} lead={t('twistsLead')}>
          <ul className="howto-twists">
            {TWISTS.map((tw) => {
              const Icon = TWIST_ICON[tw]
              return (
                <li key={tw}>
                  <span className="twist-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span>
                    <b>{TWIST_INFO[tw].title}</b>
                    <span>{TWIST_INFO[tw].rule}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section Icon={ChartColumn} title={t('ratingsTitle')} lead={t('ratingsLead')}>
          <div className="howto-scale" role="group" aria-label={t('ratingScale')}>
            {[92, 87, 82, 77, 72, 66].map((v) => (
              <Rating key={v} value={v} />
            ))}
          </div>
          <p className="help">{t('ratingsHelp')}</p>
          {classicFrom !== undefined && u && (
            <p className="help" data-testid="howto-estimated">
              <EstimatedChip compact />{t('classic', { from: seasonLabel(classicFrom), to: seasonLabel(u.firstSeason - 1) })}
            </p>
          )}
        </Section>

        <Section Icon={Activity} title={t('engineTitle')} lead={t('engineLead')}>
          <div className="howto-timeline" role="group" aria-label={t('matchParts')}>
            <span style={{ flex: 45 }}>
              1–45<small>{t('firstHalf')}</small>
            </span>
            <span style={{ flex: 25 }}>
              46–70<small>{t('secondHalf')}</small>
            </span>
            <span style={{ flex: 20 }}>
              71–90<small>{t('lateGame')}</small>
            </span>
          </div>
          <p className="help">{t('perfect')}</p>
          <p className="help" data-testid="howto-keys">
            {rich(t('keys'), KBD)}
          </p>
        </Section>

        <Section wide Icon={CalendarDays} title={t('seasonTitle')} lead={t('seasonLead')}>
          <Facts tiles items={seasonFacts()} />
        </Section>

        <Section wide Icon={Dices} title={t('modesTitle')} lead={t('modesLead')}>
          <Facts tiles items={modeFacts()} />
        </Section>

        <Section wide Icon={Crown} title={t('dynastyTitle')} lead={t('dynastyLead')}>
          <Facts tiles items={dynastyFacts()} />
        </Section>
      </div>

      <section className="panel howto-credits" data-testid="credits">
        <div className="howto-head">
          <span className="howto-icon" aria-hidden="true">
            <BookOpen size={22} />
          </span>
          <div>
            <h3>{t('creditsTitle')}</h3>
            <p className="small muted">{t('disclaimer')}</p>
          </div>
        </div>
        <ul className="small muted howto-sources">
          {u?.sources.map((s, i) => (
            <li key={i}>
              {s.credit} · {s.licence}
            </li>
          ))}
          <li>{t('flagCredit')}</li>
        </ul>
        <button className="btn ghost sm" onClick={() => go('privacy')} data-testid="howto-privacy">
          {t('privacy')}
        </button>
      </section>
      </div>
    </div>
  )
}
