import { catalog } from '../index'

/** The shell's words the first download carries: the save protection line (persistStorage.ts) and the damaged-link toast (gameHash.ts). */
export const shell = catalog('shell', {
  persisted: 'Protected: this browser keeps your save until you clear it.',
  bestEffort: 'Not protected: this browser may clear your save when the device runs low on space. Protect it, and export a copy now and then.',
  unprotected: 'This browser cannot protect your save from clearing: export a copy now and then.',
  damagedLink: 'That link is damaged or cut short: ask your friend to send it again.',
})
