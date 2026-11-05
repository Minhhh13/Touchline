# TouchLine product context

## What it is

TouchLine is a deterministic browser football game. Players spin for real club seasons, draft an XI, set up a side and manage matches, seasons, cups and challenges. It combines the immediacy of a wheel draft with the depth and consequence of a football management game.

## Who it is for

- Football fans who want to build a side quickly and immediately understand why each choice matters.
- Players who enjoy deeper squad, tactical and season decisions without needing a traditional desktop management game's learning curve.
- Returning players chasing Daily, Weekly, Arena, Run-in, Cup and Head-to-head challenges on phone or laptop.

## What people come here to do

1. Choose a mode and get into a run quickly.
2. Draft a coherent team from real club-season data.
3. Read the state of a match or season at a glance, then make an informed decision.
4. Follow results, records, stories and trophies across a run.
5. Resume safely and trust that the same seed produces the same football outcome.

## Product character

TouchLine should feel like a beautifully made football game, not a SaaS dashboard and not a licensed-club imitation. It is confident, brisk, informed and a little dramatic on the moments that deserve it. The interface should be calm during decisions and expressive around reveals, goals and trophies.

The design language is matchday editorial: the clarity of a team sheet, the rhythm of a fixture list, the authority of a good sports desk and the immediacy of the touchline. The signature move is a single vertical touchline rule that anchors key headers, selected states and match chronology. It is structural, never ornamental.

## Brand commitments

- The product name is **TouchLine**.
- Keep the existing TouchLine mark and Sora typeface; both are embedded in the current identity and lockup geometry.
- Blue remains the primary brand family. Red, amber and green are used for football meaning and system state, not decoration.
- Use British English and sentence case.
- Prefer direct football language and concrete numbers over vague marketing copy.
- Do not invent clubs, testimonials, ratings, partners or performance claims.

## Visual commitments

- One coherent system across Home, setup, draft, matchday, season, summaries, Arena, online, Explore, profile, help, privacy, dialogs and transient states.
- A light and dark theme with equal care. Light should feel like paper and daylight; dark should feel floodlit, not pure black.
- Strong alignment, decisive type hierarchy, hairline rules and restrained surfaces. Containers are used for interaction or grouping, not to put every paragraph in a card.
- Football data stays readable: tabular figures, stable columns, explicit labels and colour never acting alone.
- Motion is brief and purposeful. Frequent actions are quiet; reveals and achievements earn the drama.
- Desktop uses available width for hierarchy rather than stretching text. Phone layouts keep 44 px targets, safe areas and natural one-handed reach.

## Platform and technical constraints

- Web application built with Vite, React 19, strict TypeScript, Zustand and Immer, with a Capacitor iOS shell.
- The deterministic engine and save format are product contracts; a visual change must not alter random draws, engine behaviour or save compatibility.
- Existing localisation, pseudo-locale, keyboard, screen-reader, reduced-motion and 200% text support must remain intact.
- No licensed club crests, kits, league marks, player photographs or other copyrighted football artwork. Clubs and seasons are represented through data, colour and TouchLine's own graphic language.
- New UI uses the repository's tokens and shared components. No raw screen-level colour system, arbitrary motion or one-off visual dialect.

## Evidence already in the product

- A large real club-season player dataset across seven leagues.
- Deterministic seeds and a versioned engine.
- Multiple complete modes, offline play, optional online identity and shared records.
- Existing accessibility, localisation, sound and responsive-layout test coverage.

## Definition of a successful redesign

At a glance, a new player can find the main way to play, a returning player can resume, and an experienced player can scan dense football state without hunting. Every screen feels authored by the same team. The interface is recognisably TouchLine even with the logo covered, and it avoids the familiar AI-site tells: gratuitous gradients, glass, floating pill clusters, ornamental cards, invented proof and purple glow.
