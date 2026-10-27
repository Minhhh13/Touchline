/**
 * Handing the player a file: a share card's PNG or the save export (O-2 in docs/QA.md). A plain browser keeps the
 * download link it always had. Where a download goes nowhere — an iOS home-screen web app, an embedded iOS web view
 * (no "Safari/" in its user agent), or a browser without `<a download>` — and the Web Share API can take the file, the
 * share sheet opens instead (Save Image, Save to Files, Messages...). A share that fails for any reason but the player
 * closing the sheet falls back to the download. No native code: the iOS wrapper is undecided.
 */

export type SaveRoute = 'download' | 'share'
export type SaveOutcome = 'downloaded' | 'shared' | 'dismissed'

export interface SaveEnv {
  /** `<a download>` exists in this browser. */
  anchorDownload: boolean
  /** An iOS home-screen web app (`navigator.standalone`). */
  standalone: boolean
  /** An embedded iOS web view: Apple's WebKit on a phone or tablet with no "Safari/" token. */
  webView: boolean
  /** `navigator.canShare({ files })` holds for this file. */
  canShareFiles: boolean
}

/** Share where a download would go nowhere and the sheet can take the file; download everywhere else. Pure. */
export function saveRoute(env: SaveEnv): SaveRoute {
  if (!env.canShareFiles) return 'download'
  return !env.anchorDownload || env.standalone || env.webView ? 'share' : 'download'
}

/** Whether a user agent is an embedded iOS web view (WKWebView: AppleWebKit and Mobile/, no Safari/). Pure. */
export function isIosWebView(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
  return ios && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)
}

/** A `data:` URL as a Blob, decoded at once (no fetch), so the share sheet still opens inside the tap. Null when it is not one. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const type = m[1] || 'application/octet-stream'
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type })
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

interface ShareNavigator {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (data: { files?: File[] }) => boolean
  standalone?: boolean
  userAgent?: string
  maxTouchPoints?: number
}

function nav(): ShareNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as unknown as ShareNavigator)
}

function canShare(n: ShareNavigator | undefined, file: File): boolean {
  try {
    return !!n?.share && !!n.canShare && n.canShare({ files: [file] })
  } catch {
    return false
  }
}

function environment(n: ShareNavigator | undefined, file: File): SaveEnv {
  return {
    anchorDownload: typeof HTMLAnchorElement !== 'undefined' && 'download' in HTMLAnchorElement.prototype,
    standalone: n?.standalone === true,
    webView: isIosWebView(n?.userAgent ?? '', n?.maxTouchPoints ?? 0),
    canShareFiles: canShare(n, file),
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Give the player this file: the download, or the share sheet where a download goes nowhere. */
export async function saveBlob(blob: Blob, filename: string, title?: string): Promise<SaveOutcome> {
  const n = nav()
  // A save file the sheet will not take as JSON may still go as plain text with the same name
  const candidates = [new File([blob], filename, { type: blob.type || 'application/octet-stream' }), ...(blob.type === 'application/json' ? [new File([blob], filename, { type: 'text/plain' })] : [])]
  const file = candidates.find((f) => canShare(n, f)) ?? candidates[0]
  if (saveRoute(environment(n, file)) === 'share' && n?.share) {
    try {
      await n.share({ files: [file], ...(title ? { title } : {}) })
      return 'shared'
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'dismissed'
      // NotAllowedError (the tap's activation ran out), a type it refused, anything else: the download as before
    }
  }
  download(blob, filename)
  return 'downloaded'
}

/** A share card (a canvas `data:` URL): downloaded, or shared where a download goes nowhere. */
export function saveDataUrl(dataUrl: string, filename: string, title = 'TouchLine'): Promise<SaveOutcome> {
  const blob = dataUrlToBlob(dataUrl)
  if (blob) return saveBlob(blob, filename, title)
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  return Promise.resolve('downloaded')
}
