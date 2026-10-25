# TouchLine

**Spin the wheel. Draft the XI. Manage the season.**

A free, open web football game that fuses the spin-and-draft loop of 38-0 with the week-by-week management of Football Manager. Spin a wheel that lands on a real club in a real season from England, Spain, Italy, Germany or France (2008-09 to 2026-27), draft one player from that squad, repeat until your side is built, then either simulate the season instantly or manage it one matchweek at a time: roles, instructions, condition, injuries, a cup, a January window, a board that counts. Your drafted side takes one real club's place in the league you choose and plays the other clubs' real squads of that season: 38 matchweeks in a 20-club league, 34 in an 18-club one.

No account, no server, no ads. Everything runs in the browser and saves to `localStorage`.

## Features

**Modes**

- **Quick Draft**: eleven spins, eleven picks, then a kick-off screen (mentality, tempo, pressing, defensive line, width, passing, captain and penalty taker, or Skip for the defaults) and the season played back game by game: one game every 700 ms (2x 350 ms, 4x 175 ms) with the opponent, home or away, the score, your scorers with minutes, W/D/L and your position after it, a running P W D L GF GA Pts strip, Pause and "Skip to the end". The whole season is simulated before the first game shows; only the reveal is paced. Five minutes and a shareable result.
- **A bench in Quick Draft** (Setup's Bench option: Off or 1 to 5 places, 5 by default; never on the Daily): any pick can go to the bench instead of a slot while it has room, and once the XI is full you can spin for the bench or go straight to kick-off with eleven. In the season you have three changes for the whole campaign: pause the playback, tap a bench player and the starter he replaces (in a slot he can play), and the change sticks from the next game until you change it again. An injured starter misses the games his injury costs and is covered automatically by the best fit on the bench who can play there, which uses none of the three. The playback shows the XI for the next game on a pitch, the bench with who is injured and the changes left; the summary and the share text list the changes, and challenge links carry them so the season still verifies. With nobody brought on and no injury covered, the season is exactly the one the XI would have played without a bench: bench spins draw from their own stream.
- **January window** (Quick Draft and the Daily, on by default, a toggle under Advanced; the Daily always has it): after matchweek 19 of 38 the playback stops on a window card with a budget (8% of your XI's value for the leaders rising to 20% for the bottom side, at least £5M), three to five offers for your three weakest slots (signings for a fee, the last one a straight swap) and one deal or a pass, with no undo; the tactics can change there too and the second half plays on from the same seeded stream. Passing gives exactly the season you would have had without a window. The summary and the share text name the deal ("January: signed Rice (£45M), Fernandes out").
- **Continental Cup run** (Quick Draft, a toggle under Advanced, off on the Daily): a top-four finish adds up to four knockout ties (round of 16 to a neutral final, penalties after a draw) against the fifteen strongest clubs of the other leagues that season, shown as a bonus panel and a share line ("🌍 Continental Cup: semi-finals"); the league result is untouched.
- **Every game, game by game**: the summary of a quick draft or the Daily lists all 38 games like 38-0 does, with the opponent, the score, your scorers and their minutes ("Haaland 12', 67'", an opponent's own goal as "OG") and your league position after each matchweek. "Play the season" replays it one game every 220 ms with a running P W D L GF GA strip, and the tier banner only lands after the last game; the share text names your best win. The head-to-head result shows the same list for both managers.
- **Highlights of any game**: every game in the quick season's list, during the playback and on the summary, has a ▶ Highlights button that replays its key moments (goals, big chances, saves, cards) on the live pitch with the scoreline and a line of commentary each, with Pause, Next moment, Skip to full time and Close (a bottom sheet on a phone). The game is rebuilt from the season's seed, so the score is always the one in the list; nothing extra is saved but the season's start state.
- **Daily Challenge**: everyone gets the same wheel today (seed `daily-YYYY-MM-DD`). Streaks are tracked.
- **A 38-0 setup in two taps**: Setup runs in 38-0's order: a formation grid with the chosen shape drawn on a pitch and a one-line description (every tile carries its own mini pitch with the eleven positions as dots), Difficulty cards (Easy 3 re-spins, Normal 1, Hard none with ratings hidden), Show ratings On or Off (always off on Hard), Draft mode (Squad First or Position First), Player ratings (Season or Prime, Quick Draft only) and an Era panel with preset chips, a two-handle season slider and an "N of M seasons" count. European Nights, twists, the team name, the seed, the league, season, host club, opposition and one-club or one-nation mode sit under Advanced (More options for a season, which keeps team name, squad size and job security above it), folded by default and remembered per browser; the January window toggle (on) and the Continental Cup run toggle (off) sit there for Quick Draft. One line above Start states every choice, with a change link, and on a phone that line and the Start button sit in a fixed bottom bar. The default host club is the one nearest tenth in that season's real table, and the Home card starts today's Daily directly.
- **Coach marks and the Key**: seven short callouts appear inline the first time you meet the draft reveal, the bench picks, the Squad and Tactics tabs, half time, the match report and the market, each gone for good after Got it (Show tips again on the Profile page brings them back). A Key chip on the Squad panel labels the condition, morale and sharpness bars and adds a legend under the pitch for the disc rating and its natural, acc. and awk. rings, remembered per browser.
- **Season**: draft 16 to 22 players, then manage 38 matchweeks with three pre-season friendlies, a 16-team cup, a transfer window and a board.
- **Dynasty**: Season mode that never ends. Players age, contracts run down, some retire, you get summer bonus spins and the league moves on to the next real season.

**The draft**

- The wheel only lands on squads that can fill a slot you still need: no dead spins.
- A real player can be drafted once, whichever club or season you catch him in.
- Eight formations, each tile drawn as a mini pitch with the eleven positions in that shape (goalkeeper gold, defenders blue, midfielders white, forwards orange) wherever a shape is picked: Quick Draft, Season and Dynasty setup, Head-to-head and the Tactics tab. Position eligibility (a wing-back covers full-back, a wide midfielder covers the wing), era filters, one-club mode, re-spins and shareable seeds.
- **38-0 rules** (Position First on the Draft screen: tap a slot, the button reads "Spin for CB", and the list lights up who fits): a difficulty (Easy 3 re-spins, Normal 1, Hard none with ratings hidden), a ratings toggle for blind drafting, Squad First (spin, then pick anyone and choose his slot) or Position First (choose a slot, then spin: the wheel only stops on a club with someone who can play there, and a re-spin keeps the slot), Season ratings or Prime (every player at his career-best rating across the wheel's leagues, the same on every device), and era presets All-time, 2000s+, 2010s+ and Modern (2016+) with a custom range and an "N of M seasons" count. Quick Draft defaults to Normal, Squad First, Season ratings; the Daily pins all of it so everyone plays the same wheel, and the share text names whatever differs.
- **One-Nation Draft**: pick a nationality at setup and every pick, signing and academy prospect must share it. Only nations with twice the cover for every position in your shape are offered (71 of the 161 known nations in the data for a 4-3-3 across all seven leagues, 26 from England alone); the wheel never lands on a squad without an eligible player, approaches for anyone else are refused by the board, and a wheel that runs dry lets you start with the eleven you have. Win the league for the International achievement.
- **Wheel twists**: every third spin of a quick draft or the Daily is a twist spin. Golden: the wheel only stops on champions. Basement: only the bottom three of their league that season. Blind: ratings hidden until you have picked. Decade: the wheel stays in the decade of your last pick. The wheel decides which, never offers a twist its pool cannot serve (leagues without tables get only blind and decade spins), and a toggle at setup turns twists on for a Season or off for a quick draft.
- **The case reel**: every spin opens like a Counter-Strike case, season first. A drum stops on the drawn season (2017-18), then a strip of every club in that season's league slides under the marker and lands on the drawn club; the clubs the wheel could actually stop on are lit and the rest greyed out, so a golden spin runs through the whole league with only the champion lit. Every club-season carries a rarity colour from its squad strength (gold for the top 5% of its league's history, then red, pink, purple and blue), shown on the card, in the squad header and in the draft log. Tap, Space or Enter skips to the landing; with reduced motion the result shows within a second.
- **Ghost drafts**: after any quick draft, "Challenge a friend" copies a link (`#c=...`, about 600 characters for eleven picks) that carries the seed, the shape, the league, the host club, the rules, every spin's pick and your result. Whoever opens it drafts the same wheel with your pick shown on every spin ("Last time here: K. De Bruyne"), plays the same season and gets a head-to-head summary with both XIs and a verdict line in the share text. The link is replayed pick by pick on arrival, so a claim is marked verified, could not be verified, or unverified when it was built on other data or another engine version; "Run it back" sets your own result as the ghost, and the Profile page marks the best run on each wheel. Tactics changed at kick-off or in January and the January deal travel in the link too, so a tweaked season still verifies.
- Seven leagues: the Premier League, La Liga, Serie A, the Bundesliga, Ligue 1, the Eredivisie and the Primeira Liga, each with its own real clubs and seasons. Play in one league and draft from it alone, or switch on European Nights and draft from all seven.
- **Drawn flags**: every nationality and league shows an SVG flag (from flag-icons, MIT; see [docs/CREDITS.md](docs/CREDITS.md)) rather than an emoji, so flags render on Windows too instead of letter pairs.
- Seeds are honest across leagues: a European Nights seed lands on the same clubs whichever order the league packs were opened, and every loaded universe carries the data stamp of its packs beside an engine version, so a result can be checked against the data and engine that produced it.
- **Head-to-head**: two managers on one device draft from the same spins in snake order, then both sides play the same season, derbies included.
- Matches are played live with two stops: at half time you give a team talk, change instructions and make up to three substitutions; at the 70th minute you get the rest of your five changes, the instructions again and a touchline shout, and the AI reacts to the score at both stops.
- **Match visuals**: a live 2D pitch at the centre of the match-day dashboard (lying down on a desktop, standing up on a phone) with both XIs placed by formation slot and shifted by the instructions (a high line lifts the back four, width spreads the wide men, mentality moves the block), in the clubs' colours. A ball passes between team-mates of the side on top, builds towards the box before every chance and goal, shoots from where the engine says the shot was taken, ripples the net and flashes the scoreboard on a goal and sends the keeper diving on a save; cards, injuries and substitutions are marked on the dot. It follows the clock's pause (freezing mid-pass, and costing nothing while paused) and 1x, 2x and 4x (a minute lasts 330 ms at 1x while the pitch is on show) and stands still with prefers-reduced-motion. Under it a momentum strip and beside it the xG graph story fill with the clock; the report adds both, a shot map, possession and territory, each side's shape with its role labels and instruction arrows, rating bars for both sides and a downloadable match card with the score, the shot map and the xG story.
- **Match day dashboard**: the live match in the style of Football Manager's match screen, and everything on it moves with the clock. A top bar with the scoreboard (club codes on club colours, the clock, the added time once the board is up) and playback; both XIs in formation on pitches standing up, each man a shirt in club colours with his number, live rating, role code and surname, card marks and a sub arrow; three switchable widgets over the live pitch (heat map, match events and the xG graph story by default; also commentary, average positions, pass maps, action zones, shot map, match momentum, match stats, latest scores, live table, dugout and matchday info, each remembered per browser), both sides' stats beside the pitch filling minute by minute (shots, on target, xG, distance, pass completion, corners, tackles, fouls, bookings, possession), the momentum strip, a commentary banner and our XI along the bottom with position codes, condition and ratings. The live table and the round's other scores move as the goals go in elsewhere. The half-time and 70th-minute panels take the widgets' place, the last twenty minutes play live to the whistle, the report's shots, xG and possession are the dashboard's own numbers, and the Live tab replays a finished match on the same dashboard.
- **Match day controls**: the top bar works as Football Manager's does. Tactics shows the shape and roles; Instructions (tempo, width, passing in possession; pressing and the line out of it), the Mentality dropdown, Shouts (from the 70th minute) and Tweaks (penalty, free-kick and corner takers among the men on the pitch) change the match at the minute on the clock, and a chip says where a change lands: now, at the break, waiting for the next stop on an older save, too late in stoppage time, or a replay. Opening a drawer pauses the clock and closing it resumes. The squad strip's cards carry the position code, shirt and number, surname, a condition heart, the live rating, a morale face, cards and a sub arrow with the minute; its Squad control counts subs (n/5) and stoppages (m/3) and opens the substitutions drawer: pick a man off, pick from the bench, queue several and make them in one stoppage (half time spends none).
- **Match day on phones and tablets**: under 1200 px the pitch comes first (standing up on a phone, lying down on a tablet), then the stop panel, the commentary banner, an always-on momentum and xG row, a tab strip with every panel (remembered per browser; a tablet shows two side by side) and our XI as a sideways scroller. Drawers become bottom sheets, and the page never scrolls sideways.
- **Changes with the ball in play**: the engine decides each segment ahead of the clock and, when the manager changes something at minute k (instructions, set-piece takers, up to five substitutions in three windows with half time free, a shout from 70), rolls the segment back to k and replays the rest from a forked stream, so everything already shown stands and an untouched match is identical to a simmed one. The last twenty minutes can be held open to the whistle. Behind the match-day views: shots, on target and xG from the engine's own shot positions (calibrated to its conversion), possession and territory from the momentum, passes, tackles, fouls, corners, offsides and distance modelled minute by minute, live ratings and condition, the round's other scores and the live table revealed at your clock, heat maps, pass networks, action zones, commentary and classic shirt numbers.
- **The 70th-minute window with touchline shouts**: the match runs 1-45, 46-70 and 71-90, each segment taking its share of the expected goals by length (second half weighted 1.06 to 0.94, so 0.47, 0.294 and 0.236 of the match) and of the cards and injuries. All-out attack multiplies your chances by 1.3 and theirs by 1.35 and adds fatigue; shut up shop is ×0.55 and ×0.72; keep shape costs nothing. A side trailing at 70 goes attacking and fast, a side one up goes defensive and deep. Routine substitutions due after 70 wait for the window, and your own changes there override them. A simmed week and a hand-played one run the same three segments, so a seed gives the same match either way.

**Management**

- Thirty-four player roles and six team instructions whose effects are printed in every match report.
- An xG-based match engine with a live ticker, scorers, assists, cards, injuries, substitutions and player ratings.
- **Football Manager depth in the player model**: beside the eight classic attributes every player carries stamina, strength, aggression, jumping and work rate, taken from the EA and European Soccer Database stats (derived from the eight for an older pack). Stamina sets how much condition a match costs (×0.8 at 90, ×1.1 at 30), how hard a starter fades after the 70th minute (up to 10 per cent of his effective rating, and the last twenty minutes' chances with it), who the assistant takes off and how much tired legs add to the injury roll (up to 30 per cent), keepers exempt since their data stamina is not a running number; strength and jumping decide set pieces and an aerial mismatch worth up to 4 per cent of expected goals each way; aggression scales every card (×0.7 to ×1.3) and gives a press some bite; work rate makes pressing and counters run (about ±2 points each) and slows a lazy player's familiarity. The player modal and Explore show an FM-style panel (Technical, Physical, Mental, Defending, Goalkeeping, Fitness with a 1-5 Injury risk) and the squad list can show stamina. Every effect is bounded and written up with its numbers in docs/GAME_DESIGN.md.
- Condition, sharpness, familiarity, morale and form; suspensions at five yellow cards; injuries from a knock to a ruptured ACL.
- Weekly training focus, pre-match team talks, dressing-room events with choices, promises you can break.
- **The assistant's briefing**: the dugout opens with a list of what needs doing before kick-off, each line with the button that does it: a pending decision, lineup problems, tired or rusty starters, a man one yellow from a ban, a promised start left out, the window and deadline day, the midweek tie, a board objective at risk, and when nothing is wrong one line naming your training focus and team talk. Six lines at most, in that order. In pre-season it is a checklist (three friendlies, a captain, roles, staff, set-piece takers, the youth intake) that ticks as you go. On a phone the Play, Sim 5 and Sim to end buttons sit in a fixed bottom bar with the top line of the briefing beside them.
- **While you were away**: Sim 5 and Sim to end finish on a digest of the weeks just played: a strip of results with scores and opponent badges (cup and Europe ties included), the league record and the table move (`9th to 6th, 11 points`), board confidence before and after, the decisions the assistant took in your name, and the injuries, bans, transfers and development reports, eight to a group. A run that ends the season goes straight to the summary instead. Every decision the assistant takes is also kept in the Inbox, and the Inbox tab counts what you have not read yet, with a divider under the new items when you open it.
- **Tap a slot, get a picker**: in the Dugout, tapping a pitch slot opens a picker (a bottom sheet on a phone) with the man in the slot and a To bench button on top, then everyone who can play there sorted by his rating in the position, each with his fit, the number his disc would show and where he is now (Starting at CM, Bench, Unused); injured and suspended men are greyed out and everyone else (awkward or unsuited fits) waits in a folded Out of position group. Tapping a row puts him in, swapping with the occupant, and a toast says what moved (`Saka in at RW, Bowen to the bench`). In the Draft, a player with several open slots shows one chip per slot with his rating there and fits or can cover, and on a phone the landed squad scrolls into view when the reel lands.
- Have a word with any player once a week: praise, demand more, promise a start or reassure him. The reply depends on his form and his professionalism.
- A captain who matters: a leader with a strong mentality lifts the side in big matches and keeps low morale from sinking.
- Set-piece takers: name your penalty, free-kick and corner specialists and the engine uses them.
- Backroom staff: an assistant, a head coach, a physio and a chief scout in three tiers, paid from the wage cap, each with visible effects on familiarity, sharpness, injuries and the market.
- A cup played midweek after matchweeks 6, 14, 24 and 36, with penalties.
- **The Continental Cup**: tick it at setup and you join the fifteen strongest clubs from the other leagues that season in a second midweek knockout. In Dynasty a top-four finish qualifies you again.
- An active transfer market: a January window (and a summer one in Dynasty) with asking prices that move with form, age, rival suitors, bidding wars and deadline-day discounts; loans for fringe players; part-exchange deals; approach any player in the database and the club names a price; choose the contract length; AI clubs bid for your players and really sign the ones they buy; budget and wage cap.
- **Squad status and playing time**: every contract carries a status (key player, first team, rotation, backup, prospect) set by rank when the season starts and changed from the Club tab. The last six matchweeks of minutes are kept per player and measured against what his status promised (85, 65, 35, 15 and 10 per cent): fall more than 15 points short and morale drifts down each week, up to 5 points; play someone beyond his expectation and it drifts up. A key or first-team player short-changed for three weeks comes knocking twice as often, and you can tell him he can leave. Signings choose a status too: the wage demand follows it (×1.25 for a key player down to ×0.8 for a prospect), anyone who would be among your four best refuses rotation or worse, and anyone above your median refuses backup. Renewals offer first team on +10% wages or rotation on the same money, statuses carry through the Dynasty summer and the academy signs prospects.
- A shortlist: star players in Explore and approach them from the market in one click.
- In-season development: every five matchweeks young players who are playing grow and veterans fade, faster with a good coach; the dynasty summer does the big yearly step.
- Club legends: all-time appearances, goals, assists, man-of-the-match awards and titles for everyone who ever played for your side.
- Youth intake: every Dynasty pre-season the academy presents three real prospects aged 20 or under, preferably ones who actually came through at the club you replaced. Sign one for nothing or pass.
- Post-match press conferences: single out your star, credit the squad, take the blame or blame the referee, and answer the job question when the table turns.
- Man-mark the opponent's danger man from the opposition report: his influence drops, your attack loses a little, and the report tells you whether it worked.
- A depth chart of who can cover every position in your shape, rated there.
- **Cleaner Draft and Dugout**: a pick track instead of counters, a draft log with drawn twist icons, the Dugout's numbers as one strip of stats, a briefing with drawn status marks, lined lists instead of a box per row, and the long explanations behind info buttons. On a phone the stats sit two by two and the opposition report folds away.
- Export and import your save file from the Profile page (plain JSON; old exports still import), and a trophy cabinet across every game you have played.
- Small saves: stored results keep only what the screens read and the save is compressed, so a full Season takes about 50 K characters of the browser's 5 MB, a Dynasty with a parked Season under 100 K; if the storage is ever full a toast says so and the game carries on.
- Installable as an app: a service worker caches the shell and any league pack you have opened, so the game starts and plays offline.
- **Light and dark**: the sun and moon in the top bar flips between them and remembers the choice; Auto on the Profile page follows the device's light or dark setting live. The palette is night navy with cyan and violet-magenta neon accents (a cool lavender Daylight theme); Home opens on our own cartoon drawing of a floodlit ground at night with the three numbers that matter, a drawn picture on each of the four mode cards and compact tiles for the rest, with one icon set (Lucide) throughout.
- **Motion**: short and light, CSS first, and all of it off with the device's reduced-motion setting. Screens fade and rise in (the old one fading out through a View Transition where the browser has one, with the nav pill sliding across); the Home cards enter one after another; cards lift on hover, buttons press down, tabs slide one underline, toasts and sheets slide up, bars grow from zero; the league packs load behind a shimmering skeleton; the season summary counts up the record and the points and throws a gold flare for a title and confetti for the perfect season.
- Board target and confidence, with optional job security (you can be sacked), plus two board objectives a season (a cup run, a goals tally, home form, youth minutes, derbies, a European quarter-final) that pay into the budget when met.
- Awards, a team of the season, nineteen achievements, a local leaderboard and a share card for every season.
- **In the record books**: the summary ranks your points, wins, goals scored, goals conceded and defeats against every complete real season of your league in the data with the same number of matches (26 Premier League seasons back to 2000-01, 16 Bundesliga seasons of 34 games), names the three seasons ahead of you and the real champions that year, and marks an outright league record with a gold chip; the share text adds a line for a top-ten points total. A new points record on Realistic difficulty over a full season unlocks the Record Books achievement; leagues without tables (Ligue 1, the Eredivisie, the Primeira Liga) have no record book. Dynasty history shows the real champions beside each of your seasons.
- Calibrated or Realistic difficulty.
- One saved game per mode: a quick draft never overwrites your dynasty.

**Explore**: browse every club-season in all seven leagues with its real squad and ratings, the highest-rated player-seasons by position, a player search, and a career page for any player: every season across every league, his peak, and a star to shortlist a season for the market.

**Opposition reports** before every match, league-wide statistics (Golden Boot, assists, ratings, clean sheets) and an expanding deck of dressing-room events: contract renewals, wantaway stars, media pressure, rushed injury returns and derby bonuses.

## Screenshots

| The draft | The dugout |
| --- | --- |
| ![The wheel has landed on Crystal Palace 2023-24](docs/screenshots/draft.png) | ![Squad, pitch and team talk before kick-off](docs/screenshots/dugout.png) |

| Season summary | Match report |
| --- | --- |
| ![A quick-draft season summary with share text](docs/screenshots/summary.png) | ![Goals, stats, tactical notes and player ratings](docs/screenshots/match-report.png) |

| Transfer market | Continental Cup |
| --- | --- |
| ![January window with loans, part-exchange and approaches for any player](docs/screenshots/transfer-market.png) | ![The Continental Cup bracket against the best of the other leagues](docs/screenshots/continental-cup.png) |

| Set pieces and tactics | Backroom staff |
| --- | --- |
| ![Formation, instructions, training and set-piece takers](docs/screenshots/tactics-set-pieces.png) | ![Board, finances, staff and contracts](docs/screenshots/backroom-staff.png) |

![Opposition report with man-marking, the squad and the depth chart](docs/screenshots/squad-depth-chart.png)

## Getting started

Requires Node 20 or later (Node 22.13 or later to rebuild the data).

```bash
git clone https://github.com/Minhhh13/Touchline.git
cd Touchline
npm install
npm run dev        # Vite dev server
npm test           # Vitest: engine, draft, match, season and data checks
npm run typecheck  # tsc -b --noEmit
npm run build      # tsc -b && vite build, output in dist/
npm run preview    # serve the production build
```

The player database ships in the repository (`public/data/<league>/` plus `public/data/leagues.json`): 69,155 player-seasons across seven leagues, 1.1 to 1.5 MB per league (format 3, with the five depth columns), loaded on demand. To rebuild it from the public datasets (downloads several large archives on the first run, needs `unzip` and `node:sqlite`):

```bash
node scripts/import/build.mjs
```

See `docs/DATA.md` for sources, method, cache location (`.cache/datasets` or `DATA_CACHE`) and the nationality enrichment step.

## Project structure

```
index.html                 Entry page (fonts, favicon, meta)
public/favicon.svg         The mark; public/icons/ holds the app icons rendered from it
src/
  main.tsx                 React root
  engine/                  Pure, deterministic game engine (no React, no DOM)
    rng.ts                 xoshiro128** PRNG, seeds, daily seed
    types.ts               Shared domain types
    positions.ts           Ten positions, attribute weights, position fit
    roles.ts               34 roles with weights, unit contributions, effects
    formations.ts          Eight formations with slot coordinates
    ratings.ts             Role ratings, live modifiers, team strength, chemistry, auto-pick
    tactics.ts             Team instructions, AI styles, tactical modifiers
    match.ts               The match engine (xG, Poisson goals, events, ratings)
    matchDetail.ts         Shot positions and the momentum series for the pitch views
    matchFeed.ts           One feed for a match in play or finished: sorted events, timeline, tactics at a minute, added time
    matchStats.ts          Team stats minute by minute: shots, xG, possession, passes, tackles, fouls, corners, distance
    liveRatings.ts         Match ratings and condition as the match goes
    season.ts              Fixtures, table, cup, recovery, morale, board, tiers
    draft.ts               The wheel and draft rules
    market.ts              Transfer windows, pricing, bids, offers, finances
    events.ts              Dressing-room and media events
    training.ts            Weekly training focus
    awards.ts              Awards, achievements, share text
    universe.ts            Loads players.json and meta.json into typed structures
    depth.ts               Stamina, strength, aggression, jumping, work rate: derivations and the bounded engine factors
    __tests__/             Vitest suites
  game/
    store.ts               Zustand store with Immer, persisted to localStorage
    types.ts               Game, settings, profile types
    logic/                 setup, quick season, weekly loop, squad, market ops, dynasty, the reel deal and rarity tiers, match day (other scores, live table)
  ui/
    App.tsx                Shell and routing between screens
    screens/               Home, Setup, Draft, Dugout, MatchScreen, Summary, Explore, Profile, HowTo
    components/            CaseReel, GameByGame, Pitch, PlayerRow, TableView, MatchTicker, LivePitch, MatchCharts, AttributePanel, Logo, Celebrate, icons (news, twist and briefing icons), bits (with the Info tooltip)
    matchday/              The match-day dashboard: shell and clock, widget registry, top bar and drawers, stop panel, squad strip, phone tabs, shirts and panels
    match/                 Pure pitch geometry, the ball path generator, chart series and the shared live clock; dot movement, spells of play, heat and pass maps, commentary, shirt numbers and codes
    brand.ts               The name, the mark's geometry and the canvas colours
    styles.css             Design tokens (dark "Floodlit" and light "Daylight") and the shared components
    theme.ts               Auto, Light and Dark: which theme is on screen, following the device live
    motion.ts              View Transitions, count-ups, the celebration's pattern; the rules are in DESIGN_SYSTEM.md section 12
scripts/import/            Data pipeline (build.mjs, download.mjs, parsers, club and nation tables)
scripts/brand/icons.mjs    Renders the favicon and the app icons from the mark
public/data/england/       Generated players.json and meta.json
docs/                      RESEARCH.md, GAME_DESIGN.md, DATA.md, DESIGN_SYSTEM.md, CREDITS.md
.github/workflows/ci.yml   Typecheck, test and build on Node 22
```

## Tech stack

- Vite 6, React 19, TypeScript 5.8 (strict).
- Zustand 5 with Immer for state, persisted to `localStorage` under `touchline-save-v1`, compacted and compressed with lz-string.
- Vitest 3 for tests.
- Lucide icons (`lucide-react`, ISC), imported icon by icon.
- No backend, no analytics, no external services at runtime; Google Fonts is the only third-party request.
- Path aliases `@engine`, `@game`, `@ui`.

## Data and credits

Ratings and squads are built from public datasets: Stefano Leone's EA Sports FC 24 complete player dataset (CC0), nyagami's FC 25 database (Apache 2.0), justdhia's FC 26 ratings (CC0), mikedpad's FC 27 ratings (unofficial non-commercial snapshot), Hugo Mathien's European Soccer Database (ODbL), openfootball/england results (public domain) and Wikidata (CC0). A player's rating for a season comes from the edition published after it, so it reflects how he actually played. Values and wages are our own model. Full detail, method and limits are in [docs/DATA.md](docs/DATA.md).

The Home art is our own (inline SVG in `src/ui/components/Art.tsx`); icons are Lucide (ISC) and flags are flag-icons (MIT), credited in [docs/CREDITS.md](docs/CREDITS.md).

Design documents:

- [docs/RESEARCH.md](docs/RESEARCH.md): 38-0 and Football Manager analysis and the fusion thesis.
- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md): every system and formula as implemented.
- [docs/DATA.md](docs/DATA.md): data pipeline, sources and licences.
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md): the logo, the blue palette for both themes, type, spacing and the component rules every screen follows, and the motion rules.
- [docs/CREDITS.md](docs/CREDITS.md): the flags and the icon set, with author, source and licence.

## Roadmap

- Seasons before 2008-09 (needs a ratings source for the 1990s and 2000s)
- Online leaderboards for the daily challenge
- More leagues (Portugal, the Netherlands) and a group stage for the Continental Cup
- Youth intake and player development targets in Dynasty


## Disclaimer

TouchLine is an independent fan project. It is not affiliated with, endorsed by or sponsored by any league, club, governing body, game publisher or ratings provider. Club and player names are used descriptively; no official crests, logos, kits or likenesses are used. Player ratings are an independent interpretation derived from publicly available data and may differ from any official source. Datasets are credited to their authors and used under their published licences.
