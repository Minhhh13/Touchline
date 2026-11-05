---
name: TouchLine Floodlight Scorebox
description: A compact browser-football world built from a floodlit stadium, pixel scoreboards and match-control clarity.
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
  brand: "700 Pixelify Sans, Segoe UI, system-ui, sans-serif"
  display: "700 Pixelify Sans, Segoe UI, system-ui, sans-serif"
  family: "Sora, Segoe UI, system-ui, -apple-system, Roboto, sans-serif"
  hero: "700 clamp(3.2rem, 7vw, 6.5rem)/0.82 Pixelify Sans"
  screen-title: "700 2.25rem/1.1 Pixelify Sans"
  section-title: "700 1.5rem/1.1 Pixelify Sans"
  body: "400 0.875rem/1.45 Sora"
  metadata: "600 0.75rem/1.45 Sora"
  figures: "Sora with tabular-nums"
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
  screen-heading: "Pixel display title with concise Sora context and one structural touchline wire."
  format-row: "Full-width ruled row with title, one-line explanation, duration and directional action."
  status-chip: "Compact pill used only for a true fact, filter or state."
---

# Overview

TouchLine is a football game, not a SaaS dashboard. The interface is a compact playable football world: the Home screen opens inside a floodlit ground, shared controls read like a scoreboard and the dense management surfaces remain quick to scan. The same system covers Home, setup, draft, the Dugout, matchday, summaries and utility screens in Floodlit and Daylight themes.

# Creative North Star

**The Floodlight Scorebox.** Every screen should feel like part of the same football run: choose, draft, prepare, play, review. Pixel display type, cyan score wires, aligned figures and a scene-first Home create a game identity without turning working screens into decoration. Cover the logo and the interface should still read as TouchLine.

# Colors

Floodlit uses midnight stadium navy rather than black; Daylight uses pale sky and off-white rather than warm beige. Cyan is the action wire and coral is the flag/event accent. Red, amber and green remain literal football or system state. Home stays in its fixed night-world palette in either theme so text never falls across a low-contrast scene transition.

Rules:

- Use semantic tokens from `src/ui/styles.css`; do not invent screen-level palettes.
- Keep text and controls at the contrast levels enforced by the existing test suite.
- Do not use purple glow, glass, gradient text or status colours as decoration.
- Keep pitches, ratings, club colours and trophy metals because they carry game meaning.

# Typography

Pixelify Sans is the display system for the wordmark, headings, navigation and action labels. Sora remains the reading face for body copy and figures, keeping long management screens clear. Headlines are compact and score-led, body copy is direct, and metadata is short. The canonical accessible name remains `TouchLine`; the visual wordmark is styled in capitals like stadium signage.

# Layout

Desktop works inside a constrained game column and uses asymmetric composition where one decision is dominant. Home is a floodlit stadium scene with a large season line, an original corner-flag mascot and compact HUD modules; newcomers and returning players both fit the complete Home board without page scrolling at 1280×720 and 1440×900. Short desktop windows remove secondary descriptions before removing actions. The first-run action remains visible in the opening phone viewport, where necessary vertical scrolling is kept. Setup is a five-step team sheet, Draft a three-zone working desk, Dugout a club ledger and Matchday a dense operational dashboard. At phone widths these structures reflow as whole units in document order with 44 px targets, safe-area support and no horizontal page scroll.

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
