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

## Photos

All from [Unsplash](https://unsplash.com), under the [Unsplash License](https://unsplash.com/license): free to use for commercial and non-commercial purposes, no permission needed, attribution appreciated but not required. The licence does not allow selling the photos unaltered or using them to build a competing photo service; we do neither.

Rules for adding a photo (also in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), section 7): Unsplash License or Pexels License only (never Unsplash+, iStock or anything paid), no identifiable players or faces, no club crests, no kits with sponsors, no readable stadium or sponsor branding. Download the original outside the repo, write an optimised WebP of at most about 180 KB into `public/img/` with ffmpeg (for example `ffmpeg -i in.jpg -vf scale=1600:-2 -quality 72 out.webp`), and add a row below.

| File in `public/img/` | Where | Title | Author | Source | Licence |
|---|---|---|---|---|---|
| `hero-floodlit-1600.webp`, `hero-floodlit-800.webp` | Home hero (the 800 px crop on phones) | A green soccer field illuminated by bright stadium lights at night | Jonathan Petersson ([@grizzlybear](https://unsplash.com/@grizzlybear)) | https://unsplash.com/photos/ARU18GpF6QQ | Unsplash License |
| `mode-quick.webp` | Quick Draft card | A white line on a green grassy field | Riccardo Bernucci ([@new_ra](https://unsplash.com/@new_ra)) | https://unsplash.com/photos/GQpbLTe6us4 | Unsplash License |
| `mode-daily.webp` | Daily Challenge card | White and blue soccer goal net | Michal Balog ([@mikbutcher](https://unsplash.com/@mikbutcher)) | https://unsplash.com/photos/white-and-blue-soccer-goal-net-MRgJfWsmjnM | Unsplash License |
| `mode-season.webp` | Season card (rotated to landscape) | Bird's-eye view photography of green soccer field with lights | Izuddin Helmi Adnan ([@izuddinhelmi](https://unsplash.com/@izuddinhelmi)) | https://unsplash.com/photos/birds-eye-view-photography-of-green-soccer-field-with-lights-K5ChxJaheKI | Unsplash License |
| `mode-dynasty.webp` | Dynasty card | A crowd of people at a sporting event | Christopher Le ([@chrislevn07](https://unsplash.com/@chrislevn07)) | https://unsplash.com/photos/a-crowd-of-people-at-a-sporting-event-O6TPMlE_Gq8 | Unsplash License |

Each was cropped to the card's shape and re-encoded; nothing else was changed.

## Icons

[Lucide](https://lucide.dev) through the `lucide-react` package (pinned in `package.json`), under the [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE). Parts of Lucide derive from Feather icons (MIT). The licence text ships inside the package.

The TouchLine mark and the wordmark are our own (`src/ui/brand.ts`).
