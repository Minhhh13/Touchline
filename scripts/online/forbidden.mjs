// The globals a server bundle must not name (shared by build-verifier.mjs and edgeBundle.mjs; no shebang, so
// vite.config.ts can import it through edgeBundle.mjs).
/** Globals that exist only in a browser or in Node. `crypto`, `TextEncoder`, `structuredClone` exist in Deno. */
export const FORBIDDEN = ['window.', 'document.', 'localStorage', 'sessionStorage', 'process.', 'require(', 'navigator.']

export function forbiddenIn(code) {
  return FORBIDDEN.filter((g) => code.includes(g))
}
