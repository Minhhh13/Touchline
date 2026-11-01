import { Capacitor, registerPlugin } from '@capacitor/core'
import { saveBlob, saveDataUrl } from './saveFile'

interface ExportFile {
  filename: string
  data: string
  encoding: 'utf8' | 'base64'
}

export interface NativeExportBridge {
  write: (file: { path: string; data: string; encoding: ExportFile['encoding'] }) => Promise<{ uri: string }>
  share: (uri: string) => Promise<void>
  remove: (directory: string) => Promise<void>
}

export interface NativeImageShareBridge {
  shareImage: (options: { data: string; filename: string }) => Promise<void>
}

const NativeImageShare = registerPlugin<NativeImageShareBridge>('TouchlineImageShare')

let exportSequence = 0

/** Keep a team name in the filename, never in the path to the exported file. */
export function exportFilename(filename: string): string {
  return filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '') || 'touchline-export'
}

export function dataUrlBase64(dataUrl: string): string {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error('The image could not be exported.')
  return match[1]
}

/** Keep the file alive until the native sheet finishes, then remove this export's private cache folder. */
export async function shareNativeFile(file: ExportFile, bridge: NativeExportBridge): Promise<void> {
  const directory = `touchline-exports/${Date.now()}-${++exportSequence}`
  try {
    const { uri } = await bridge.write({ path: `${directory}/${exportFilename(file.filename)}`, data: file.data, encoding: file.encoding })
    try {
      await bridge.share(uri)
    } catch (error) {
      // Capacitor Share on iOS rejects when the person dismisses the sheet. That is a normal action.
      if (!error || typeof error !== 'object' || !('message' in error) || error.message !== 'Share canceled') throw error
    }
  } finally {
    // A cache-cleanup failure must not report a successful share as an export failure.
    await bridge.remove(directory).catch(() => undefined)
  }
}

/** Share a real UIImage on iOS, so the system sheet offers Save Image / Save to Photos. */
export async function shareNativeImage(dataUrl: string, filename: string, bridge: NativeImageShareBridge): Promise<void> {
  await bridge.shareImage({ data: dataUrlBase64(dataUrl), filename: exportFilename(filename) })
}

async function nativeBridge(): Promise<NativeExportBridge> {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  return {
    write: ({ path, data, encoding }) => Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true, ...(encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}) }),
    share: async (uri) => { await Share.share({ files: [uri] }) },
    remove: (path) => Filesystem.rmdir({ path, directory: Directory.Cache, recursive: true }),
  }
}

export async function exportDataUrl(dataUrl: string, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await shareNativeImage(dataUrl, filename, NativeImageShare)
  else await saveDataUrl(dataUrl, filename)
}

export async function exportTextFile(text: string, filename: string, type: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await shareNativeFile({ filename, data: text, encoding: 'utf8' }, await nativeBridge())
  else await saveBlob(new Blob([text], { type }), filename)
}
