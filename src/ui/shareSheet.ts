/**
 * Sharing a link: the system share sheet where there is one (phones, Safari, Edge), the clipboard everywhere else.
 * The sheet closing without a choice is the player's answer, never an error, so nothing is copied behind their back.
 */

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed'

export interface ShareInput {
  title: string
  text: string
  url: string
}

interface ShareNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>
  canShare?: (data: { title?: string; text?: string; url?: string }) => boolean
  clipboard?: { writeText(text: string): Promise<void> }
}

/** Whether this browser has a share sheet that takes a link. */
export function hasShareSheet(n: ShareNavigator | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as ShareNavigator)): boolean {
  if (!n?.share) return false
  try {
    return n.canShare ? n.canShare({ url: 'https://touchline.quest/' }) : true
  } catch {
    return false
  }
}

/** What the clipboard gets when there is no sheet: the words, then the link on its own line. Pure. */
export function shareMessage(input: ShareInput): string {
  return `${input.text}\n${input.url}`
}

/** Open the share sheet, or copy the message; resolves to what happened. */
export async function shareOrCopy(input: ShareInput, n: ShareNavigator | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as ShareNavigator)): Promise<ShareOutcome> {
  if (n?.share && hasShareSheet(n)) {
    try {
      await n.share({ title: input.title, text: input.text, url: input.url })
      return 'shared'
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'dismissed'
      // A sheet that would not open (no user gesture left, a policy): fall through to the clipboard
    }
  }
  return copyText(shareMessage(input), n)
}

/** Copy text; resolves to `copied` or `failed`. */
export async function copyText(text: string, n: ShareNavigator | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as ShareNavigator)): Promise<'copied' | 'failed'> {
  try {
    if (!n?.clipboard) return 'failed'
    await n.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
