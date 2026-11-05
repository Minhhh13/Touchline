---
name: TouchLine Floodlight Scorebox
description: A living day-and-night football ground with a quiet wordmark, readable pixel type and clear game decisions.
colors:
  floodlit-ground: "#050b18"
  floodlit-panel: "#0b1629"
  floodlit-raised: "#13233d"
  floodlit-rule: "#243752"
  floodlit-wire: "#5ee7f7"
  floodlit-ink: "#f5f1df"
  floodlit-ink-secondary: "#c4d6df"
  event-coral: "#ff5b7f"
  daylight-ground: "#cfe9f2"
  daylight-panel: "#f7fbf7"
  daylight-rule: "#94b7c4"
  daylight-ink: "#071526"
  daylight-action: "#08677a"
typography:
  brand: "400 VT323, ui-monospace, monospace"
  display: "400 VT323, ui-monospace, monospace"
  family: "VT323, ui-monospace, monospace"
  hero: "400 5.5rem/1 VT323"
  screen-title: "400 2.75rem/1.1 VT323"
  section-title: "400 1.875rem/1.1 VT323"
  body: "400 1.375rem/1.25 VT323"
  metadata: "400 1.125rem/1.4 VT323"
  figures: "VT323 with tabular-nums"
radii:
  detail: 0
  small: 1px
  control: 2px
  panel: 2px
  status-pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
components:
  primary-button: "Solid cyan action, square scorebox edge, 40 px minimum height and a restrained one-pixel press."
  secondary-button: "Panel-coloured control with a strong hairline and no resting shadow."
  ledger-panel: "Midnight scorebox panel with a cyan top wire; filled surfaces hold real groups or actions."
  screen-heading: "Readable VT323 title with concise context and one structural touchline wire."
  format-row: "Full-width ruled row with title, one-line explanation, duration and directional action."
  status-chip: "Compact pill used only for a true fact, filter or state."
---

# Overview

TouchLine is a football game, not a SaaS dashboard. The interface is a compact playable football world: the Home screen opens inside a bright pixel training ground, shared controls read like a scoreboard and the dense management surfaces remain quick to scan. The same system covers Home, setup, draft, the Dugout, matchday, summaries and utility screens in Floodlit and Daylight themes.

# Creative North Star

**The Floodlight Scorebox.** Every screen should feel like part of the same football run: choose, draft, prepare, play, review. Pixel display type, cyan score wires, aligned figures and a scene-first Home create a game identity without turning working screens into decoration. Cover the logo and the interface should still read as TouchLine.

# Colors

Floodlit uses midnight stadium navy; Daylight uses pale sky and off-white. Cyan is the action wire and coral is the flag/event accent. Red, amber and green remain literal football or system state. Home has two aligned original environments: the daylight ground with a pale sky and the floodlit ground with deep blue air, warm windows and lamp light. The existing theme preference controls both the world and the working UI.

Rules:

- Use semantic tokens from `src/ui/styles.css`; do not invent screen-level palettes.
- Keep text and controls at the contrast levels enforced by the existing test suite.
- Do not use purple glow, glass, gradient text or status colours as decoration.
- Keep pitches, ratings, club colours and trophy metals because they carry game meaning.

# Typography

VT323 is the single product face, verified against the owner's reference site. It ships locally in regular 400 with its OFL licence; do not synthesize bold pixels. The smaller cap height needs larger roles: 22 px body, 20 px secondary copy, 18 px metadata and 16 px small labels. Fixed geometry such as pitch labels retains its measured size. Headlines stay compact, copy stays short and figures align. The canonical accessible name remains `TouchLine`; the visual wordmark is styled in capitals like stadium signage.

# Layout

Desktop works inside a constrained game column and uses asymmetric composition where one decision is dominant. Home is the exception: the detailed full-viewport ground leads, with a smaller drifting lockup, one approximate simulation tally and one fixed Play button. The tally starts from the owner's verified 300,000, adds one estimated game a minute, uses ≈ and explicitly identifies the estimate in its title. It never represents live activity. Play reveals the five main formats in a bottom scorebox; challenges, saved runs and utility links are one further choice away. Home has no top bar, gutter or document scroll at 1280×720, 1440×900 or 390×844. Setup is a five-step team sheet, Draft a three-zone working desk, Dugout a club ledger and Matchday a dense operational dashboard. Phone reel landings announce the club without scrolling the reel away. At phone widths structures reflow in document order with 44 px targets and safe areas.

# Elevation & Depth

Normal content is flat. Depth belongs to overlays: dialogs, sheets, toasts, tooltips and a dragged object. A panel never combines a decorative border with a resting shadow. Hover feedback uses a quiet colour wash or a tiny directional movement on fine pointers. Game-event light and flare remain inside goals, results, reels and trophies.

# Shapes

Corners are square and mechanical. Panels use a cyan top wire or an ordinary border according to hierarchy; controls use the tiny control radius. Pills are reserved for filters and true status. Pixel edges are crisp rather than noisy, and scanlines are static and faint—never animated texture.

# Components

- Primary buttons carry the one forward action in a region. They are solid, rectangular and quiet at rest.
- Secondary and ghost buttons preserve the hierarchy with borders or plain text treatment.
- Panels are real groups, not wrappers around every paragraph.
- Format rows and table rows favour stable columns and tabular numbers.
- Inputs use a clear 1 px edge, a 2 px focus outline and a 40 px minimum control height.
- Navigation uses an underline and colour change, not a floating pill.
- Routine motion uses the 140, 190 and 260 ms tokens; 360 ms is for a meaningful landing. No generic page cascade, ambient shimmer or travelling CTA shine.
- Home's clouds, trees, two training players, ball, flags and occasional night-lamp dimming move in small independent transform/opacity layers. The wordmark floats 4 px; Play and the camera stay fixed. Pause stops the scene and tally; hidden tabs pause; reduced motion shows a finished still. Keep the ground image itself static.

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
