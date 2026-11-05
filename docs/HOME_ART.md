# Living Home art

Made for the owner's 2026-11-05 brief: the football ground leads, the logo is smaller, the world stays gently alive, and day and night have separate designs. All four bitmap assets were made with the **built-in OpenAI image-generation tool**, with true transparent backgrounds. No external artwork, reference-site screenshot, player likeness, real crest, sponsor, lettering or interface is embedded.

The generated PNG originals remain in the generation library. These project files preserve their dimensions and alpha, encoded as quality-90 WebP with full-quality alpha to keep the Home download small. The combined four assets are approximately 1.02 MiB. There was no programmatic drawing, compositing or visual retouch of the generated art.

| Project file | Pixels | Purpose |
| --- | --- | --- |
| `public/art/touchline-ground-day.webp` | 2172 × 724 | The static daylight ground; transparent sky leaves room for independent clouds |
| `public/art/touchline-ground-night.webp` | 2172 × 724 | An aligned night edition with warm windows and restrained floodlight spill |
| `public/art/touchline-player-run.webp` | 1774 × 887 | Four equal columns of the same generic footballer in a jogging cycle |
| `public/art/touchline-oak.webp` | 1166 × 1349 | A single foreground oak, reused at the two edges and gently swayed |

`touchline-clouds.svg` is original simple stepped cloud geometry. The tiny moving football and pennants are code-native shapes. `HomeWorld.tsx` keeps the image layers decorative, and `HomeWorld.css` animates only transforms and opacity. The ground image and camera never move. A device-local pause, hidden-tab pause and reduced-motion still cover every moving layer. The smaller wordmark drifts independently of the fixed Play target.

## Final generation briefs

### Day ground — new image

Use case: illustration-story. Production background layer for TouchLine, wide landscape 3:1. A beautifully crafted high-definition pixel-art small English football training ground, across the lower portion of a clean game home screen. Sky fully transparent above distant treetops, town roofs and tall floodlight masts; no painted sky or clouds. Rich dark-teal mown grass, correctly drawn white penalty box and a single modest goal with tidy square netting right of centre. Grass fills the bottom and both sides edge to edge. Layered blue hills and leafy trees, a few brick houses, low clubhouse, small covered standing terrace and one pitch rail. Slender far-left and far-right floodlight masts, cream lamps. No flags, because they are separate moving elements. Restrained side-on 16-bit-game perspective, clear depth and highlights on real edges; consistent small square pixels, a harmonised navy/blue/pine/teal palette and tiny warm windows. Avoid noisy dithering, blur, plastic 3D, malformed goals and impossible markings. No characters, mascot, football, text, crest, UI or watermark. Genuine transparent PNG.

### Night ground — lighting edit of the day ground

Use case: lighting-weather. Preserve the exact 2172 × 724 composition, silhouette and every mast, goal, fence, house, terrace and line position, so the editions can crossfade without shifting. Preserve alpha above the trees and between masts; no sky, stars, moon or clouds in the image. Change lighting and palette only: indigo and midnight-teal trees and roofs, cool moonlit blue-green grass, clear cream lines, warm amber windows, warm-white lamps and restrained light spill onto the pitch, cool net and fence highlights. Small-football-ground-at-night mood with crisp pixel detail. No extra objects, characters, flags, text or logo. Genuine transparent PNG.

### Running player — new sprite strip

Use case: stylized-concept. Exactly four equal-width columns in one row on a 2:1 canvas, four full-body side-on poses of the same footballer facing right: left leg forward, neutral passing pose, right leg forward, neutral passing pose. Identical scale, head height and baseline, centred in each quarter with transparent gaps. A handcrafted 16-bit sprite, compact arm movement, coral shirt, navy shorts, cream socks, navy boots, warm brown skin and short dark hair. No tiny face details, sponsor, logo, number, ball, ground, shadow oval, border, frame label or text. Everything outside the figures genuinely transparent. Ready for a four-step transform animation.

### Oak — new transparent layer

Use case: illustration-story. One isolated mature oak, broad asymmetrical leafy crown, sturdy trunk, roots and natural branches visible through small gaps. Full silhouette with transparent margin, rooted at the bottom. Match the ground's handcrafted small-pixel environment art: clustered deep pine and muted teal-green leaves, cool-blue shadows, restrained olive highlights and depth. No random speckle, glossy 3D or blurred edge. Neutral daylight palette that can be darkened in the night UI. No sky, ground, shadow oval, text, people, ball, goal or watermark. Portrait composition; genuine transparent PNG.
