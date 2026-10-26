import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dataUrlBase64, shareNativeFile, type NativeExportBridge } from '../exportFile'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function diskBridge(share: (uri: string) => Promise<void>): Promise<{ root: string; bridge: NativeExportBridge }> {
  const root = await mkdtemp(join(tmpdir(), 'touchline-export-'))
  roots.push(root)
  return {
    root,
    bridge: {
      write: async ({ path, data, encoding }) => {
        const full = join(root, path)
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, data, encoding)
        return { uri: pathToFileURL(full).href }
      },
      share,
      remove: (directory) => rm(join(root, directory), { recursive: true, force: true }),
    },
  }
}

describe('native file export', () => {
  it('keeps a UTF-8 save available to the share sheet, then removes its cache copy', async () => {
    const save = JSON.stringify({ state: { teamName: 'Đội bóng 日本', seed: 'ios-save-export' }, version: 1 })
    let shared = ''
    const { root, bridge } = await diskBridge(async (uri) => {
      shared = uri
      expect(await readFile(fileURLToPath(uri), 'utf8')).toBe(save)
      expect(uri.endsWith('/touchline-save.json')).toBe(true)
    })
    await shareNativeFile({ filename: 'touchline-save.json', data: save, encoding: 'utf8' }, bridge)
    expect(shared.startsWith('file://')).toBe(true)
    await expect(readFile(fileURLToPath(shared))).rejects.toThrow()
    expect(await readdir(join(root, 'touchline-exports'))).toEqual([])
  })

  it('exports the original PNG bytes and confines an unsafe team name to the filename', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2wS8AAAAASUVORK5CYII='
    let file = ''
    const { root, bridge } = await diskBridge(async (uri) => {
      file = fileURLToPath(uri)
      expect(await readFile(file)).toEqual(Buffer.from(png, 'base64'))
      expect(dirname(file).startsWith(join(root, 'touchline-exports'))).toBe(true)
      expect(file.endsWith('.png')).toBe(true)
    })
    await shareNativeFile({ filename: '../../team/name.png', data: dataUrlBase64(`data:image/png;base64,${png}`), encoding: 'base64' }, bridge)
    await expect(readFile(file)).rejects.toThrow()
  })

  it('treats dismissal as a normal action and still clears the temporary file', async () => {
    const { root, bridge } = await diskBridge(async () => { throw new Error('Share canceled') })
    await expect(shareNativeFile({ filename: 'save.json', data: '{}', encoding: 'utf8' }, bridge)).resolves.toBeUndefined()
    expect(await readdir(join(root, 'touchline-exports'))).toEqual([])
  })

  it('reports a failed share and still clears the temporary file', async () => {
    const { root, bridge } = await diskBridge(async () => { throw new Error('Error sharing item') })
    await expect(shareNativeFile({ filename: 'save.json', data: '{}', encoding: 'utf8' }, bridge)).rejects.toThrow('Error sharing item')
    expect(await readdir(join(root, 'touchline-exports'))).toEqual([])
  })

  it('never opens the sheet when writing fails, and a cleanup failure does not hide that error', async () => {
    let opened = false
    const bridge: NativeExportBridge = {
      write: async () => { throw new Error('Storage full') },
      share: async () => { opened = true },
      remove: async () => { throw new Error('Cleanup failed') },
    }
    await expect(shareNativeFile({ filename: 'save.json', data: '{}', encoding: 'utf8' }, bridge)).rejects.toThrow('Storage full')
    expect(opened).toBe(false)
  })

  it('rejects a non-binary data URL instead of writing it as broken image bytes', () => {
    expect(() => dataUrlBase64('data:text/plain,hello')).toThrow('The image could not be exported.')
  })
})
