# Full-interface redesign

Status: implemented, verified and ready for PR.

## Grounded direction set

The directions were ordered by resonance with TouchLine's audience and product truth before the Impeccable assignment was applied.

1. **Stadium wayfinding** — firm concourse type, bold colour fields and directional bands; familiar and immediately football-adjacent, with some risk of feeling like a sports brand template.
2. **Match programme** — editorial spreads, large fixtures and narrow supporting columns; strong for storytelling, weaker for frequent controls.
3. **Broadcast desk** — score-first hierarchy, compact live data and decisive state colour; excellent in matchday, liable to make quiet setup screens feel televised.
4. **Tactical notebook** — calm paper ground, formation geometry and annotation marks; distinctive for management, less convincing for online and trophy surfaces.
5. **Football data desk** — dense tables, precise filters and scan-first typography; highly usable, but too close to a neutral statistics product.
6. **Matchday Ledger** — a modern working game built from fixture-sheet rhythm, score columns and one vertical touchline rule. It moves between calm planning and high-stakes match moments without changing visual language.
7. **Supporters' paper** — expressive headlines, cut-and-paste rhythm and fan voice; memorable but too noisy for a long season.

## Challenger verdicts

- **Factory catalog:** competitive on audience identification through its music-and-football cultural lineage, but loses product clarity because coded labels hide meaning. Its donated discipline is ruthless editing: one dominant fact and no duplicated label.
- **Midnight transit diagram:** competitive on product clarity for progression, but risks reading as transport before football. Its donated discipline is route legibility: chronology keeps its context while the active event is emphasised.
- **Dark developer console:** declined because its dense tool language does not identify football. Its donated discipline is precise hairline separation and isolated destructive actions.
- **Character goods catalog:** declined because mascot bounce and pastel ranking undercut TouchLine's tone. Its donated discipline is whole-cell responsive reflow without broken partial cards.
- **Lexicon shoulder and plate:** competitive on editorial authority, but its printed-control language would make the game slower to operate. Its donated discipline is a strict readable measure and a stable range marker on long views.
- **Variable-font specimen:** declined because scale contrast alone cannot organise TouchLine's varied game state. Its donated discipline is making type, not decoration, carry the most important moments.

## Direction contract

**THESIS:** Matchday Ledger makes every screen read like one part of the same football run: choose, draft, prepare, play, review. It refuses the category default of a neutral dashboard made from interchangeable rounded cards. Hierarchy comes from score-led type, alignment, rules and deliberate density; containers appear only when they hold an action or a true group.

**OWN-WORLD:** Daylight uses chalky blue-white, navy ink and cobalt; Floodlit uses deep stadium blue, cool white and electric blue. Football state colours stay literal and sparing. Sora remains the single family, with tabular figures and strong weight contrast. Corners are modest, shadows rare, and one 2 px vertical touchline rule anchors key headers, active navigation, chronological feeds and selected rows. Buttons are rectangular and calm; pills are reserved for filters and true status.

**STORY:** A new player sees where to begin and why each mode differs. A returning player sees Resume first without losing discovery. During a run, the eye always finds the next consequential action, the current score or table state, and the evidence behind a decision. Quiet setup screens feel considered; match and trophy screens may become dramatic without becoming a separate product.

**FIRST VIEWPORT:** Desktop uses a compact full-width top shell, a constrained 1200 px working column and an asymmetric 7/5 Home lead: the main play or resume action and its football context on the left, a live run or challenge ledger on the right. Mode choices follow as ruled rows or strong cells rather than a card cloud. Phone collapses to one column with the primary action in the first thumb-reachable screen and a stable bottom dock only where the current flow needs it. The touchline rule begins at the screen title and continues through the active content.

**FORM:** Chosen form: Matchday Ledger, candidate 6 of 7. Impeccable direction seed `seed:0c3bb1a35d31cbd9`. Code-led Operate build across the complete TouchLine UI. The signature move is the touchline rule shifting between navigation, chronology and selection while standard controls remain familiar.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Motion contract

- Frequent interactions use immediate state changes or 140–190 ms transform/colour transitions.
- Sheets and dialogs use 220–280 ms ease-out motion, enter and exit on the same path, and remain interruptible.
- Hover movement is gated to fine pointers. Touch never inherits a sticky hover state.
- No generic page-load cascade, scroll reveal, floating decoration, continuous ambient motion or whole-card bounce.
- Only transform and opacity animate in routine UI. Layout-changing animation remains limited to an interaction that genuinely explains a state change.
- Reduced motion removes travel and scale while retaining clear state changes.
- Expressive sequences remain reserved for football reveals, goals, results and trophies, with sound and motion still obeying the player's preferences.

## Finish review — 2026-11-05 UTC

**Disposition: ship.** PRODUCT.md, the direction contract, DESIGN.md and the structured handoff persist the world. Final 1440×900 and 390×844 captures match the promised daylight ground, programme hierarchy, rectangular controls, ruled mode list and whole-unit phone reflow. Type, material and ground all match the own-world contract; the first viewport retains the primary play action, Daily feature and stable phone dock without a generic card cloud.

No material fixes remain. The code-led build produced no separate quality-bar card, so the ceiling was judged against PRODUCT.md, this contract and DESIGN.md. Real-device safe-area, keyboard, sticky-hover and installed-PWA feel remain the final manual release check; the browser captures and console were clean.
