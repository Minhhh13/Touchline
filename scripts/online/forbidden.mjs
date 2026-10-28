// The globals a server bundle must not name (shared by build-verifier.mjs and edgeBundle.mjs; no shebang, so
// vite.config.ts can import it through edgeBundle.mjs).
/** Globals that exist only in a browser or in Node. `crypto`, `TextEncoder`, `structuredClone` exist in Deno. */
export const FORBIDDEN = ['window.', 'document.', 'localStorage', 'sessionStorage', 'process.', 'require(', 'navigator.']

/** The globals read through a dot: `game.window.offers` (the Season loop's transfer window) is a property, not the global. */
const DOTTED = new Set(['window.', 'document.', 'process.', 'navigator.'])

/** Whether `code` names the global `g`: anywhere for the plain names, and for a dotted one not as another object's
 * property (`x.window.`, `x?.window.`) or the tail of a longer name (`myWindow.`), but always through `globalThis.` or `self.`. */
function names(code, g) {
  if (!DOTTED.has(g)) return code.includes(g)
  for (let i = code.indexOf(g); i >= 0; i = code.indexOf(g, i + 1)) {
    const before = code.slice(Math.max(0, i - 16), i)
    if (/(?:^|[^\w$])(?:globalThis|self)\s*\??\.\s*$/.test(before)) return true
    if (/[\w$]$/.test(before) || /\.\s*$/.test(before)) continue
    return true
  }
  return false
}

export function forbiddenIn(code) {
  return FORBIDDEN.filter((g) => names(code, g))
}
