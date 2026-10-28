/*
 * Safe areas, pure. styles.css reads every inset through four tokens on `:root` (`--safe-top`, `--safe-right`,
 * `--safe-bottom`, `--safe-left`, each `env(safe-area-inset-*, 0px)`), so the notch and the home indicator are kept
 * clear in an installed home-screen web app (index.html asks for viewport-fit=cover and a black-translucent status bar),
 * and a browser preview, where every inset is 0, can stand in for a device by overriding the tokens (`safeAreaOverride`,
 * injected with Playwright's `page.addStyleTag({ content })`).
 */

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export const SAFE_TOKENS = { top: '--safe-top', right: '--safe-right', bottom: '--safe-bottom', left: '--safe-left' } as const

/** Portrait insets of the iPhones the release is checked on, by CSS viewport (Apple's figures, in points). */
export const DEVICE_INSETS: Record<string, Insets & { width: number; height: number }> = {
  // iPhone 12 to 14, 6.1"
  '390x844': { width: 390, height: 844, top: 47, right: 0, bottom: 34, left: 0 },
  // iPhone 14 Pro Max to 16 Plus, 6.7" (Dynamic Island)
  '430x932': { width: 430, height: 932, top: 59, right: 0, bottom: 34, left: 0 },
  // iPhone 16 Pro Max and later, 6.9" (the App Store's largest screenshot size)
  '440x956': { width: 440, height: 956, top: 62, right: 0, bottom: 34, left: 0 },
  // iPhone 12 and 13 Pro Max, 6.5" (the App Store's second size)
  '428x926': { width: 428, height: 926, top: 47, right: 0, bottom: 34, left: 0 },
}

/** A stylesheet that stands in for a device's insets in a browser that has none. */
export function safeAreaOverride(i: Insets): string {
  const px = (n: number) => `${Math.max(0, Math.round(n))}px`
  return `:root{${SAFE_TOKENS.top}:${px(i.top)} !important;${SAFE_TOKENS.right}:${px(i.right)} !important;${SAFE_TOKENS.bottom}:${px(i.bottom)} !important;${SAFE_TOKENS.left}:${px(i.left)} !important}`
}

/** Raw `env(safe-area-inset-*)` uses outside the four token definitions: each is an inset the override cannot reach. */
export function strayInsets(css: string): string[] {
  const out: string[] = []
  const re = /env\(\s*safe-area-inset-(top|right|bottom|left)[^)]*\)/g
  for (const line of css.split('\n')) {
    if (!re.test(line)) continue
    re.lastIndex = 0
    if (/^\s*--safe-(top|right|bottom|left):\s*env\(safe-area-inset-\1, 0px\);\s*$/.test(line)) continue
    out.push(line.trim())
  }
  return out
}
