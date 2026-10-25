# AGENTS.md

TouchLine is a deterministic browser football game (Vite, React 19, TypeScript strict, Zustand + Immer). The full agent guide is **[CLAUDE.md](CLAUDE.md)**: read it before changing anything. Working with another person: [CONTRIBUTING.md](CONTRIBUTING.md). Project status: [docs/HANDOVER.md](docs/HANDOVER.md).

## The five rules that matter most

1. **Seeded randomness only.** No `Math.random` or `Date` in `src/engine` or `src/game/logic` beyond the exceptions listed in CLAUDE.md (`randomSeed`, `dailySeed`, game ids and `createdAt`). Rehydrate with `Rng.fromState(game.rngState)` and write back `rng.getState()`. If a change alters how many random draws, or their order, a spin, match, season or event takes, bump `ENGINE_VERSION` in `src/engine/version.ts` and note it in `docs/GAME_DESIGN.md` section 15.
2. **Old saves must load.** New persisted fields are optional and read with `??`; required defaults go in `normaliseGame` (`src/game/logic/save.ts`). Never change `SAVE_KEY` (`touchline-save-v1`) or the persist version without a migration.
3. **Immer recipes return nothing.** In a direct `produce` call, wrap value-returning calls in `void` or a block body (`mutate` in `store.ts` already does); never mutate state read from the store.
4. **Green before push.** `npm run typecheck && npm test && npm run build` (strict TypeScript, no `any`, no unused symbols), a Vitest test for every behaviour, Playwright smokes for UI changes, and README plus `docs/GAME_DESIGN.md` updated with the feature.
5. **Branch, PR, no secrets.** One feature branch per change, PR into `main`, CI green, never force-push `main`. No secrets in the repo; the Supabase `service_role` key never reaches the browser or a `VITE_` variable.
6. **Keep the handover current.** Two people and their agents share this repo. Read `docs/HANDOVER.md` and the open issues before starting, and in the same PR as every change update its in-progress table, what ships, hosting notes and a dated change-log line; update `CLAUDE.md` when a command, path or convention changes. Details: the "Keep the handover current" section of CLAUDE.md.
