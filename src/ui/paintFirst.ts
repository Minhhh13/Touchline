/**
 * Paint first, then do the heavy work (`afterPaint.ts`, the one implementation). This module was a second copy that
 * had drifted (no hidden-tab fallback, a busy flag set after the button had gone); it now re-exports that one, so the
 * Dugout's Play button, Sim 5 and Kick off behave alike. Presentation only.
 */
export { afterNextPaint, runAfterPaint, useAfterPaint as usePaintFirst } from './afterPaint'
