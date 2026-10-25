import { useStore } from '@game/store'

export function HowTo() {
  const { go, universe: u } = useStore()
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <h1>How it works</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="col">
        <div className="panel">
          <h3>The wheel and the draft</h3>
          <p>Each spin lands on a real English top-flight club in a specific season. You draft one player from that squad into an open slot in your formation, then spin again. The wheel only stops on squads that contain someone who can fill a slot you still need, so there are no dead spins. A player can be drafted once, whichever season you catch him in. Quick drafts build an XI; season drafts build a squad of sixteen to twenty-two with bench picks after the eleven.</p>
          <p>Players can be drafted into their natural positions or a closely related one (a wing-back at full-back, a wide midfielder on the wing, a number ten up front). Playing out of position costs rating: a little for a related position, a lot for a stretch.</p>
        </div>
        <div className="panel">
          <h3>Ratings</h3>
          <p>Ratings come from public datasets of EA Sports FC and FIFA editions and the European Soccer Database, reworked into thirteen attributes: pace, shooting, passing, dribbling, defending, physical, mentality and goalkeeping, plus stamina, strength, aggression, jumping and work rate, which decide how legs last, who wins the duels, who gets booked and how well a press runs. A player's rating for a season is taken from the edition published after it, so it reflects how he actually played that year. Values and wages are our own estimates in today's money. Ratings are an independent interpretation used to make the game work and may differ from any official source.</p>
        </div>
        <div className="panel">
          <h3>The match engine</h3>
          <p>Each side's eleven is scored by unit: goalkeeping, defence, midfield and attack, with each player's contribution shaped by his role (a wing-back pushes quality forward, an anchor keeps it back), his fit for the position, and his live state: condition, morale, sharpness, familiarity with your system and recent form. Your team instructions then interact with the opponent's: a high line against a quick, direct side is a risk; a high press against a nervy, technical one is a weapon. The two attack-versus-defence comparisons set expected goals for each side, home advantage and a dose of any-given-Saturday variance are added, and goals are drawn from a Poisson distribution. Scorers, assists, cards, injuries, substitutions and chances are then laid out minute by minute.</p>
          <p>The top of the rating scale is stretched: the difference between a 90 and an 87 is far bigger in football terms than between a 72 and a 69, so an all-time XI should feel like one. A perfect 38-0 is possible with an elite, balanced side and good management. It is meant to be rare.</p>
        </div>
        <div className="panel">
          <h3>Season mode</h3>
          <ul>
            <li>Your drafted squad takes one real club's place in a real league season. The other nineteen field their real squads of that year.</li>
            <li>Three pre-season friendlies build sharpness and familiarity. Then 38 matchweeks (34 in an 18-club league) plus a 16-team cup played midweek after matchweeks 6, 14, 24 and 36.</li>
            <li>Tick the Continental Cup at setup for a second knockout against the fifteen strongest clubs from the other leagues that season, on the free midweeks after matchweeks 10, 19, 29 and 33. In Dynasty mode a top-four finish qualifies you again.</li>
            <li>Condition drops with minutes and recovers weekly; tired players get hurt and play badly. Rotate.</li>
            <li>Five yellow cards is a one-match ban; red cards bring longer ones. Injuries range from a week to a season.</li>
            <li>Morale moves with results, playing time and your handling of dressing-room events. Stars sulk on the bench.</li>
            <li>Pick a weekly training focus and a pre-match team talk. Both have small, legible effects.</li>
            <li>During a live match change your instructions, mentality, set-piece takers or shout (from the 70th minute) and make substitutions at any minute from the top bar or the squad strip: five changes in three stoppages, with changes at half time free. A chip in the bar says when a change lands.</li>
            <li>The January window opens after matchweek 19: a market of players from every era, with asking prices that rise under competition and fall on deadline day. Take fringe players on loan, offer one of yours in part-exchange, or approach any player in the database and let his club name a price. Rival clubs bid for your players too, and really sign the ones they buy.</li>
            <li>Have a word with a player once a week: praise, demand more, promise a start or reassure him. His form and his professionalism decide how it lands.</li>
            <li>Name your captain and your set-piece takers. A leader with a strong mentality lifts the side; a good corner or free-kick specialist adds chances.</li>
            <li>Hire backroom staff from the Club tab: an assistant, a head coach, a physio and a chief scout, each in two tiers, paid from the wage cap.</li>
            <li>Man-mark the opponent's danger man from the opposition report. Face the press after wins and defeats; answer the job question when the table turns.</li>
            <li>Every five matchweeks young players who are playing grow a little and veterans fade; a good coach speeds the former.</li>
            <li>The board sets a target from your squad's strength. Confidence moves with results; with job security on, it can end your season.</li>
          </ul>
        </div>
        <div className="panel">
          <h3>Dynasty</h3>
          <p>At the end of a season your players age a year: the young grow, the old decline, some retire, loans go home and some contracts expire. The league moves on to the next real season, you get bonus spins and a summer window, the academy presents three real prospects, bigger clubs may offer you their job, and a top-four finish earns a Continental Cup place. The Club tab keeps your all-time legends.</p>
        </div>
        <div className="panel" data-testid="credits">
          <h3>Data and credits</h3>
          <p className="small muted">TouchLine is an independent fan project. It is not affiliated with, endorsed by or sponsored by any league, club, governing body, game publisher or ratings provider. Club names and player names are used descriptively. No official crests, logos or likenesses are used.</p>
          <ul className="small muted">
            {u?.sources.map((s, i) => (
              <li key={i}>
                {s.credit} · {s.licence}
              </li>
            ))}
            <li>Flag icons: flag-icons 7.6.0 by Panayiotis Lipiridis (github.com/lipis/flag-icons) · MIT</li>
          </ul>
          <button className="btn ghost sm" onClick={() => go('privacy')} data-testid="howto-privacy">
            Privacy and fair play
          </button>
        </div>
      </div>
    </div>
  )
}
