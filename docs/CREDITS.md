# Credits

TouchLine builds on other people's open work. Each section below credits one source and carries the notice its licence asks for, so sections can be added independently; the data sources behind the player packs are credited in [DATA.md](DATA.md) and on the game's How it works page.

## Flag icons

- **What**: the 4:3 SVG flags in `public/flags/`, one per nation in the data packs plus the EU flag for European Nights and the all-leagues wheel. They are drawn as images because Windows shows emoji flags as two letters.
- **Source**: [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 by Panayiotis Lipiridis (lipis), from the npm package `flag-icons@7.6.0`.
- **Licence**: MIT, notice below. The same notice ships beside the SVGs as `public/flags/LICENSE.txt`, so every copy of the built site carries it.
- **How they get here**: `scripts/brand/flags.mjs` copies only the flags the packs need (see the comment at its top for how to rerun it). `public/flags/unknown.svg`, the neutral flag shown for an unknown nationality, is TouchLine's own and not part of flag-icons.

```
The MIT License (MIT)

Copyright (c) 2013 Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Icons

[Lucide](https://lucide.dev) through the `lucide-react` package (pinned in `package.json`), under the [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE). Parts of Lucide derive from Feather icons (MIT). The licence text ships inside the package.

The TouchLine mark and the wordmark are our own (`src/ui/brand.ts`), and so are the Home illustrations and the neon art (`src/ui/components/Art.tsx`): drawn for TouchLine, no photos or downloaded art.

## Sound

None to credit: every sound in TouchLine (the case reel's ticks, the season whoosh and pop, the rarity reveals, the referee's whistle, the crowd, the net, the fanfares and the rest of the palette) is synthesised in code with the Web Audio API in `src/ui/sound/`, from oscillators and seeded noise. No audio files ship, and no recording, sample or sound from any game or website (Counter-Strike, case-opening sites or others) is used or copied.

