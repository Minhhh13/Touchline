import type { ReactNode } from 'react'
import { Activity, ArrowLeftRight, Armchair, Banknote, BookOpen, CalendarDays, ChartColumn, Crown, Dices, Dumbbell, Gauge, Globe, GraduationCap, Landmark, Lock, MessageSquare, RectangleVertical, Repeat, Shuffle, Sprout, Target, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { useStore } from '@game/store'
import { TWIST_INFO } from '../components/TwistCard'
import { TWIST_ICON } from '../components/icons'
import { Rating } from '../components/bits'
import type { Twist } from '@engine/draft'

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

const SEASON_FACTS: Array<[LucideIcon, string, string]> = [
  [CalendarDays, 'The calendar', 'Three friendlies, then 38 matchweeks (34 with 18 clubs) and a 16-team cup in midweek.'],
  [Globe, 'Continental Cup', 'Optional: a knockout against the 15 strongest clubs from the other leagues.'],
  [Gauge, 'Condition', 'Minutes tire players; tired players play worse and get hurt. Rotate.'],
  [RectangleVertical, 'Cards and injuries', 'Five yellows is a one-match ban, a red a longer one; injuries last a week to a season.'],
  [MessageSquare, 'Morale', 'Results, playing time, talks and dressing-room events move it.'],
  [Dumbbell, 'Training', 'A weekly focus and a pre-match team talk, each a small, clear effect.'],
  [Banknote, 'January window', 'Bids, loans and part-exchange; prices rise under competition and fall on deadline day.'],
  [ArrowLeftRight, 'Live changes', 'Instructions, takers and subs at any minute from the top bar or the squad strip: five changes in three stoppages, half time free; a shout from the 70th.'],
  [Users, 'Captain and set pieces', 'A strong leader lifts the side; a good taker adds chances.'],
  [Armchair, 'Backroom staff', 'Assistant, coach, physio and scout, two tiers each, paid from the wage cap.'],
  [Target, 'Man-marking', 'Mark their danger man from the opposition report.'],
  [TrendingUp, 'Development', 'Every five matchweeks the young who play grow and veterans fade.'],
  [Landmark, 'The board', 'A target from your squad’s strength; with job security on, it can sack you.'],
]

const DYNASTY_FACTS: Array<[LucideIcon, string, string]> = [
  [Sprout, 'Ageing', 'The young grow, the old decline, some retire and contracts run out.'],
  [Dices, 'Summer draft', 'Bonus spins and a summer window as the league moves to the next real season.'],
  [GraduationCap, 'Academy', 'Three real prospects every summer.'],
  [Crown, 'Job offers and legends', 'Bigger clubs may call; the Club tab keeps your all-time legends.'],
]

export function HowTo() {
  const { go, universe: u } = useStore()
  const leagues = u?.available.length ?? 7
  return (
    <div className="page howto">
      <div className="screen-head">
        <div className="screen-title">
          <h1>How it works</h1>
          <div className="screen-meta">
            <span>The game on one page</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="screen-body scroll-whole fill">
      <div className="howto-grid">
        <Section Icon={Dices} title="The wheel and the draft" lead={<>Each spin lands on a real club in a real season, across {leagues} leagues. Draft one player from that squad into an open slot, then spin again.</>}>
          <ol className="howto-steps">
            <li>
              <b>1</b> Spin
            </li>
            <li>
              <b>2</b> Pick one player
            </li>
            <li>
              <b>3</b> Fill your shape
            </li>
          </ol>
          <Facts
            items={[
              [Repeat, 'No dead spins', 'The wheel only stops on squads with someone for a slot you still need.'],
              [Lock, 'Once each', 'A player can be drafted once, whichever season you catch him in.'],
              [Users, 'Squad size', 'Quick drafts build an XI; seasons build 16 to 22.'],
            ]}
          />
        </Section>

        <Section Icon={Shuffle} title="Wheel twists" lead="With twists on, every third spin changes the rules for one pick.">
          <ul className="howto-twists">
            {TWISTS.map((t) => {
              const Icon = TWIST_ICON[t]
              return (
                <li key={t}>
                  <span className="twist-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span>
                    <b>{TWIST_INFO[t].title}</b>
                    <span>{TWIST_INFO[t].rule}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section Icon={ChartColumn} title="Ratings" lead="Thirteen attributes per player-season, taken from the ratings edition published after it. The top of the scale is stretched: 90 against 87 is a bigger gap than 72 against 69.">
          <div className="howto-scale" aria-label="The rating scale">
            {[92, 87, 82, 77, 72, 66].map((v) => (
              <Rating key={v} value={v} />
            ))}
          </div>
          <p className="help">Out of position costs rating: a little for a related role, a lot for a stretch. Values and wages are our own estimates.</p>
        </Section>

        <Section Icon={Activity} title="The match engine" lead="Each XI is scored by unit, shaped by roles, fit and live state. Your instructions meet theirs, expected goals follow, and goals are drawn from them minute by minute.">
          <div className="howto-timeline" aria-label="A match in three parts">
            <span style={{ flex: 45 }}>
              1–45<small>Half-time talk</small>
            </span>
            <span style={{ flex: 25 }}>
              46–70<small>Changes any minute</small>
            </span>
            <span style={{ flex: 20 }}>
              71–90<small>Shouts from 70′</small>
            </span>
          </div>
          <p className="help">A perfect 38-0 is possible with an elite, balanced side and good management. It is meant to be rare.</p>
        </Section>

        <Section wide Icon={CalendarDays} title="Season mode" lead="Your squad takes one real club’s place in a real league season; the others field their real squads of that year.">
          <Facts tiles items={SEASON_FACTS} />
        </Section>

        <Section wide Icon={Crown} title="Dynasty" lead="Season mode that never ends. A top-four finish earns a Continental Cup place.">
          <Facts tiles items={DYNASTY_FACTS} />
        </Section>
      </div>

      <section className="panel howto-credits" data-testid="credits">
        <div className="howto-head">
          <span className="howto-icon" aria-hidden="true">
            <BookOpen size={22} />
          </span>
          <div>
            <h3>Data and credits</h3>
            <p className="small muted">TouchLine is an independent fan project. It is not affiliated with, endorsed by or sponsored by any league, club, governing body, game publisher or ratings provider. Club names and player names are used descriptively. No official crests, logos or likenesses are used. Ratings are an independent interpretation used to make the game work and may differ from any official source.</p>
          </div>
        </div>
        <ul className="small muted howto-sources">
          {u?.sources.map((s, i) => (
            <li key={i}>
              {s.credit} · {s.licence}
            </li>
          ))}
          <li>Flag icons: flag-icons 7.6.0 by Panayiotis Lipiridis (github.com/lipis/flag-icons) · MIT</li>
        </ul>
      </section>
      </div>
    </div>
  )
}
