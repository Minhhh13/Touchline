/** O-2 (docs/QA.md): the share card and the save export download in a browser and open the share sheet where a download goes nowhere. */
import { describe, expect, it } from 'vitest'
import { dataUrlToBlob, isIosWebView, saveRoute, type SaveEnv } from '../saveFile'

const browser: SaveEnv = { anchorDownload: true, standalone: false, webView: false, canShareFiles: true }

describe('saving a file', () => {
  it('downloads in a plain browser, and shares only where a download goes nowhere and the sheet takes the file', () => {
    expect(saveRoute(browser)).toBe('download')
    expect(saveRoute({ ...browser, canShareFiles: false })).toBe('download')
    expect(saveRoute({ ...browser, standalone: true })).toBe('share')
    expect(saveRoute({ ...browser, webView: true })).toBe('share')
    expect(saveRoute({ ...browser, anchorDownload: false })).toBe('share')
    // Nowhere to share it: the download is still the best there is
    expect(saveRoute({ ...browser, webView: true, canShareFiles: false })).toBe('download')
  })

  it('tells an embedded iOS web view from Safari and other browsers', () => {
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const webView = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1'
    const ipadWebView = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
    const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
    expect(isIosWebView(safari)).toBe(false)
    expect(isIosWebView(webView)).toBe(true)
    expect(isIosWebView(chromeIos)).toBe(false)
    expect(isIosWebView(ipadWebView, 5)).toBe(true)
    expect(isIosWebView(ipadWebView, 0)).toBe(false)
    expect(isIosWebView(macSafari, 0)).toBe(false)
    expect(isIosWebView(android)).toBe(false)
  })

  it('turns a canvas data URL into the same bytes', async () => {
    const png = [137, 80, 78, 71, 13, 10, 26, 10]
    const url = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`
    const blob = dataUrlToBlob(url)!
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual(png)
    expect(await dataUrlToBlob('data:text/plain,a%20b')!.text()).toBe('a b')
    expect(dataUrlToBlob('blob:nope')).toBeNull()
  })
})
