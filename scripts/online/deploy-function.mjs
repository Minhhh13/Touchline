#!/usr/bin/env node
// Stage and deploy the Edge Function for this build's engine: `touchline-e{ENGINE_VERSION}` (one function per engine
// version, so yesterday's board finishes on its own engine; CLAUDE.md, online invariants).
//
//   npm run deploy:function -- --stage-only   build the verifier bundle and stage supabase/functions/touchline-e{V}/
//                                             (index.ts importing ./verifier.js, verifier.js, deno.json, deno.lock)
//                                             plus deploy-files.json, the file list an agent passes to the Supabase
//                                             connector's deploy_edge_function (entrypoint index.ts, verify_jwt false:
//                                             withSupabase checks a user's JWT or the publishable key itself, so
//                                             guests can reach the online rooms; docs/ONLINE.md section 5e)
//   SUPABASE_ACCESS_TOKEN=... npm run deploy:function
//                                             stage, then deploy with the Supabase CLI (server-side bundling, no Docker)
//
// The project is fixed: yvqpmyqomkwtudxmkeou. Never deploy to any other project. The token is a scoped personal
// access token of the owner's, read from the environment only; it is never written anywhere.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLE, buildVerifier } from './build-verifier.mjs'

export const PROJECT_REF = 'yvqpmyqomkwtudxmkeou'
export const CLI = 'supabase@2.122.0'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = path.join(root, 'supabase', 'functions', 'touchline')

export async function stage() {
  const { engine } = await buildVerifier()
  if (!engine) throw new Error('ENGINE_VERSION not found')
  const name = `touchline-e${engine}`
  const dir = path.join(root, 'supabase', 'functions', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const index = readFileSync(path.join(source, 'index.ts'), 'utf8')
  if (!index.includes("'../_shared/verifier.js'")) throw new Error('index.ts no longer imports ../_shared/verifier.js')
  writeFileSync(path.join(dir, 'index.ts'), index.replace("'../_shared/verifier.js'", "'./verifier.js'"))
  copyFileSync(BUNDLE, path.join(dir, 'verifier.js'))
  copyFileSync(path.join(source, 'deno.json'), path.join(dir, 'deno.json'))
  if (existsSync(path.join(source, 'deno.lock'))) copyFileSync(path.join(source, 'deno.lock'), path.join(dir, 'deno.lock'))
  const files = ['index.ts', 'verifier.js', 'deno.json', ...(existsSync(path.join(dir, 'deno.lock')) ? ['deno.lock'] : [])]
  writeFileSync(path.join(dir, 'deploy-files.json'), JSON.stringify({ project_id: PROJECT_REF, name, entrypoint_path: 'index.ts', verify_jwt: false, files: files.map((f) => ({ name: f, content: readFileSync(path.join(dir, f), 'utf8') })) }))
  return { name, dir, files }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staged = await stage()
  console.log(`staged ${staged.name}: ${staged.files.join(', ')} in ${path.relative(root, staged.dir)}`)
  if (process.argv.includes('--stage-only')) process.exit(0)
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error('SUPABASE_ACCESS_TOKEN is not set: deploy with the Supabase connector (deploy-files.json) or set a scoped token')
    process.exit(1)
  }
  execFileSync('npx', ['-y', CLI, 'functions', 'deploy', staged.name, '--project-ref', PROJECT_REF, '--use-api', '--no-verify-jwt'], { cwd: root, stdio: 'inherit' })
  console.log(`deployed ${staged.name} to ${PROJECT_REF}; set the function secret TOUCHLINE_SITE_URL if it is not set yet`)
}
