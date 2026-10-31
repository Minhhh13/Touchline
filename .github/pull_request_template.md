## What and why

<!-- What this changes and why. Link the issue: Closes #N -->

## How it was tested

<!-- Commands run, seeds tried, screenshots for UI at 1280 px and 390 px -->

## Checklist

- [ ] `npm run typecheck`, `npm test` and `npm run build` pass locally
- [ ] A Vitest test covers the new behaviour
- [ ] `ENGINE_VERSION` bumped if random draws changed (and noted in docs/GAME_DESIGN.md section 15), or not needed
- [ ] New save fields are optional and old saves still load, or no save change
- [ ] docs/FEATURES.md and docs/GAME_DESIGN.md describe the change (the README only for a new mode or headline feature)
- [ ] docs/HANDOVER.md updated (in-progress table, what ships, hosting notes, a dated change-log line); CLAUDE.md updated if a command, path or convention changed
- [ ] No secrets, `.env.local` files or dataset archives included
