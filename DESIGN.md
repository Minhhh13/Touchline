---
name: TouchLine Matchday Ledger
description: A football working interface built from fixture-sheet rhythm, score columns and a structural touchline rule.
colors:
  floodlit-ground: "#071724"
  floodlit-panel: "#0d2132"
  floodlit-raised: "#18334b"
  floodlit-rule: "#284259"
  floodlit-rule-strong: "#5a7389"
  floodlit-ink: "#f4f7fb"
  floodlit-ink-secondary: "#c7d3de"
  floodlit-action: "#85b7ff"
  daylight-ground: "#eef0f3"
  daylight-panel: "#ffffff"
  daylight-rule: "#cbd4de"
  daylight-rule-strong: "#7f91a2"
  daylight-ink: "#0b1a2b"
  daylight-ink-secondary: "#34495d"
  daylight-action: "#1f2de6"
  programme-field: "#123d82"
  programme-ink: "#ffffff"
typography:
  family: "Sora, Segoe UI, system-ui, -apple-system, Roboto, sans-serif"
  hero: "700 4.5rem/0.98 Sora"
  screen-title: "700 2.25rem/1.1 Sora"
  section-title: "700 1.5rem/1.1 Sora"
  body: "400 0.875rem/1.45 Sora"
  metadata: "600 0.75rem/1.45 Sora"
  figures: "Sora with tabular-nums"
radii:
  detail: 2px
  small: 3px
  control: 4px
  panel: 6px
  status-pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
components:
  primary-button: "Solid action colour, rectangular 4 px corner, 40 px minimum height and a restrained press transform."
  secondary-button: "Panel-coloured control with a strong hairline and no resting shadow."
  ledger-panel: "Flat panel separated by a hairline; a filled surface appears only when it holds a true group or action."
  screen-heading: "Score-led title with one structural touchline rule and concise supporting context."
  format-row: "Full-width ruled row with title, one-line explanation, duration and directional action."
  status-chip: "Compact pill used only for a true fact, filter or state."
---

# Overview

TouchLine is a football game, not a SaaS dashboard. The interface is a modern matchday working document: calm enough to make decisions in, quick enough to scan during a match, and dramatic only when football supplies the event. The same system covers Home, setup, draft, the Dugout, matchday, summaries and utility screens in Floodlit and Daylight themes.

# Creative North Star

**The Matchday Ledger.** Every screen should feel like one page of the same football run: choose, draft, prepare, play, review. Fixture-sheet rhythm, aligned figures and one structural touchline rule create hierarchy without interchangeable rounded cards. Cover the logo and the interface should still read as TouchLine.

# Colors

Floodlit uses stadium blue rather than black; Daylight uses cool match paper rather than warm beige. Action blue is the only decorative UI colour. Red, amber and green remain literal football or system state. The programme field is a deliberate brand interruption used for one dominant feature, not a gradient recipe for every panel.

Rules:

- Use semantic tokens from `src/ui/styles.css`; do not invent screen-level palettes.
- Keep text and controls at the contrast levels enforced by the existing test suite.
- Do not use purple glow, glass, gradient text or status colours as decoration.
- Keep pitches, ratings, club colours and trophy metals because they carry game meaning.

# Typography

Sora is the single product family. Weight, size and tabular alignment establish authority; a second display face is unnecessary. Headlines are compact and score-led, body copy is direct, and metadata is short. Sentence case is the default. Capitals are for codes, small labels, table headers and match states only.

# Layout

Desktop works inside a constrained game column and uses asymmetric composition where one decision is dominant. Hairline rules create sections; nested cards do not. Home is a programme, Setup a five-step team sheet, Draft a three-zone working desk, Dugout a club ledger and Matchday a dense operational dashboard. At phone widths these structures reflow as whole units in document order with 44 px targets, safe-area support and no horizontal page scroll.

# Elevation & Depth

Normal content is flat. Depth belongs to overlays: dialogs, sheets, toasts, tooltips and a dragged object. A panel never combines a decorative border with a resting shadow. Hover feedback uses a quiet colour wash or a tiny directional movement on fine pointers. Game-event light and flare remain inside goals, results, reels and trophies.

# Shapes

Corners are tight and mechanical. Panels use the panel radius, controls the control radius and dense details the smaller values. Pills are reserved for filters and true status. The touchline rule is structural: it may anchor a screen heading, chronology or selected state, but it must not become a decorative stripe on every card.

# Components

- Primary buttons carry the one forward action in a region. They are solid, rectangular and quiet at rest.
- Secondary and ghost buttons preserve the hierarchy with borders or plain text treatment.
- Panels are real groups, not wrappers around every paragraph.
- Format rows and table rows favour stable columns and tabular numbers.
- Inputs use a clear 1 px edge, a 2 px focus outline and a 40 px minimum control height.
- Navigation uses an underline and colour change, not a floating pill.
- Routine motion uses the 140, 190 and 260 ms tokens; 360 ms is for a meaningful landing. No generic page cascade, ambient shimmer or travelling CTA shine.

# Do / Don't

Do:

- Lead with the next football decision, current score or current competition state.
- Let real data, badges, pitch diagrams and aligned figures carry the screen.
- Use rules, whitespace and type before adding another container.
- Gate hover motion to fine pointers and honour reduced motion.
- Reserve expressive motion for reveals, goals, results and trophies.

Don't:

- Build a cloud of equal rounded cards.
- Add decorative mode numbers, eyebrow copy above every heading or invented proof.
- Use gradients, glows, glass or continuous motion to make an ordinary control look important.
- Hide a phone action behind an overlay or let a sticky hover state follow a touch.
- Change engine behaviour, seeds or save shape for a visual effect.
