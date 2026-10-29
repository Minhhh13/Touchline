/**
 * `logicLine()` for the shell (App.tsx's digest and toast): the mirror of the game logic's English lives in a game
 * screen's chunk (`./logicText`, with its large catalogue), which hands itself over here when it loads. Until a game
 * screen has loaded, a line reads as the logic wrote it; a line that reaches the shell comes from a game, so its
 * screen has loaded the mirror first.
 */
let mirror: ((text: string) => string) | null = null

/** Called once by `./logicText` when it loads. */
export function setLogicMirror(fn: (text: string) => string): void {
  mirror = fn
}

/** A line the game logic built, in the viewer's language once the mirror has loaded. */
export function shellLogicLine(text: string): string {
  return mirror ? mirror(text) : text
}
