import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { buildInfoFrom } from './src/online/buildInfo'

// On GitHub Pages the site lives under /<repo>/; set BASE_PATH in CI.
const base = process.env.BASE_PATH || '/'

/** Stamp the service worker's cache version per build so a new deploy replaces the old cache. */
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
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD__', stamp))
    },
  }
}

/** Write `dist/build.json` (`{ engine, data, builtAt }`): the live site's copy tells the online layer which engine and data it serves. */
function buildInfo(): Plugin {
  let outDir = 'dist'
  return {
    name: 'touchline-build-info',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const root = path.dirname(fileURLToPath(import.meta.url))
      const info = buildInfoFrom(readFileSync(path.resolve(root, 'src/engine/version.ts'), 'utf8'), readFileSync(path.resolve(root, 'public/data/leagues.json'), 'utf8'), new Date().toISOString())
      writeFileSync(path.resolve(outDir, 'build.json'), JSON.stringify(info))
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
