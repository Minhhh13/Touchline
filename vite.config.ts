import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { buildInfoFrom } from './src/online/buildInfo'
import { buildEdgeBundle } from './scripts/online/edgeBundle.mjs'

// On GitHub Pages the site lives under /<repo>/; set BASE_PATH in CI.
const base = process.env.BASE_PATH || '/'

/**
 * Stamp the service worker's cache version per build so a new deploy replaces the old cache, and hand it the list of
 * built assets (`'__ASSETS__'` becomes `'./assets/<file>', ...`) so it caches every one when it installs.
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'touchline-stamp-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const file = path.resolve(outDir, 'sw.js')
      if (!existsSync(file)) return
      const stamp = `${Date.now().toString(36)}`
      const dir = path.resolve(outDir, 'assets')
      const assets = existsSync(dir) ? readdirSync(dir).sort().map((f) => `'./assets/${f}'`) : []
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD__', stamp).replace("'__ASSETS__'", assets.join(', ')))
    },
  }
}

/**
 * Write `dist/build.json` (`{ engine, data, builtAt, verifier }`): the live site's copy tells the online layer which
 * engine and data it serves. Also publish the hashed edge bundle the Edge Function's loader runs
 * (`dist/edge/verifier-<hash16>.js`, scripts/online/edgeBundle.mjs): public engine code, no secret, in every build so
 * the live site always serves the bundle of the engine it runs. An outgoing engine's bundle may sit in `public/edge/`
 * (copied as is, so its loader keeps working for its last 7 days; docs/ONLINE.md section 7): every file there must
 * still hash to the name it carries, or the build fails.
 */
function buildInfo(): Plugin {
  let outDir = 'dist'
  return {
    name: 'touchline-build-info',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    async closeBundle() {
      const root = path.dirname(fileURLToPath(import.meta.url))
      const edge = await buildEdgeBundle()
      mkdirSync(path.resolve(outDir, 'edge'), { recursive: true })
      writeFileSync(path.resolve(outDir, edge.file), edge.bytes)
      for (const name of readdirSync(path.resolve(outDir, 'edge'))) {
        const sha = createHash('sha256').update(readFileSync(path.resolve(outDir, 'edge', name))).digest('hex')
        if (name !== `verifier-${sha.slice(0, 16)}.js`) throw new Error(`dist/edge/${name} does not hash to its name (SHA-256 ${sha})`)
      }
      const info = buildInfoFrom(readFileSync(path.resolve(root, 'src/engine/version.ts'), 'utf8'), readFileSync(path.resolve(root, 'public/data/leagues.json'), 'utf8'), new Date().toISOString())
      writeFileSync(path.resolve(outDir, 'build.json'), JSON.stringify({ ...info, verifier: { path: edge.file, sha256: edge.sha256 } }))
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), stampServiceWorker(), buildInfo()],
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/game', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
