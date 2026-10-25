/**
 * The raw-response cache of the classic-seasons import, and the only code that
 * talks to the network (used by fetch.mjs alone; facts.mjs reads the cache
 * with `allowNetwork` off).
 *
 *   wp/<sha1 of title>.json   one English Wikipedia page: { title, resolved, missing, qid, text }
 *   wd/<qid>.json             one Wikidata entity, trimmed to the claims the import reads
 *
 * Requests are serial, at least PAUSE_MS apart per host, with a descriptive
 * User-Agent, and back off on HTTP 429 or 5xx. A cached response is never
 * fetched again, so a rerun is free and an interrupted run resumes.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { WP_CACHE, WD_CACHE, USER_AGENT, PAUSE_MS, BATCH } from './config.mjs'

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const lastCall = {}
let requests = 0
export const requestCount = () => requests

/**
 * One request: the body on 200, null on 404, and for a redirect (when
 * `follow` is off) the target URL. Waits PAUSE_MS between requests to a host
 * and backs off on 429 and 5xx; gives up after `attempts` tries (returns
 * undefined) so a caller can fall back to another endpoint.
 */
function http(url, { form, follow = true, attempts = 40, key } = {}) {
  const host = key ?? new URL(url).host
  for (let attempt = 0; attempt < attempts; attempt++) {
    const since = Date.now() - (lastCall[host] ?? 0)
    if (since < (PAUSE_MS[host] ?? 3000)) sleep((PAUSE_MS[host] ?? 3000) - since)
    lastCall[host] = Date.now()
    requests++
    const args = ['-sS', '-m', '300', '-A', USER_AGENT, '-w', '\n%{http_code} %{redirect_url}']
    if (follow) args.push('-L')
    if (form) for (const [k, v] of Object.entries(form)) args.push('--data-urlencode', `${k}=${v}`)
    args.push(url)
    let out
    try {
      out = execFileSync('curl', args, { maxBuffer: 1 << 30 }).toString()
    } catch (e) {
      console.error(`  network error (${String(e.message).slice(0, 120)}), retrying`)
      sleep(10000 * (attempt + 1))
      continue
    }
    const cut = out.lastIndexOf('\n')
    const [codeText, redirect] = out.slice(cut + 1).split(' ')
    const code = Number(codeText)
    const body = out.slice(0, cut)
    if (code === 200) return body
    if (code === 404) return null
    if (!follow && code >= 300 && code < 400) return { redirect }
    if (attempt + 1 >= attempts) break
    // A shared address meets Wikimedia's limiter in bursts: a refused request is retried after 15 s, growing to a minute
    const wait = Math.min(60000, 15000 * (attempt + 1))
    console.error(`  HTTP ${code} from ${host}, waiting ${wait / 1000} s`)
    sleep(wait)
  }
  if (attempts !== 40) return undefined // the caller retries on the next run
  throw new Error(`giving up on ${url}`)
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')
export const normTitle = (t) => {
  const s = String(t).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
const wpFile = (title) => path.join(WP_CACHE, sha1(normTitle(title)) + '.json')
const wdFile = (qid) => path.join(WD_CACHE, qid + '.json')
const write = (file, v) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(v))
}

/** Cached page, or null when it has not been fetched. */
export function wpPage(title) {
  const f = wpFile(title)
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null
}
export function putWpPage(rec) {
  write(wpFile(rec.title), rec)
}

const EXPORT_PAGE = /<page>\s*<title>([^<]*)<\/title>([\s\S]*?)<\/page>/g
/** Wikitext of up to `size` pages per request through Special:Export (index.php), redirects followed. */
function exportPages(titles, size, label) {
  const out = new Map() // requested title -> { resolved, text } (absent: no such page)
  let todo = titles.map((t) => ({ asked: t, at: t }))
  for (let hop = 0; hop < 3 && todo.length; hop++) {
    const next = []
    for (let i = 0; i < todo.length; i += size) {
      const chunk = todo.slice(i, i + size)
      const body = http('https://en.wikipedia.org/w/index.php?title=Special:Export', { form: { pages: chunk.map((x) => x.at).join('\n'), curonly: '1', action: 'submit' } }) ?? ''
      const got = new Map()
      for (const m of body.matchAll(EXPORT_PAGE)) {
        const title = unxml(m[1])
        const redirect = m[2].match(/<redirect title="([^"]*)"/)
        const text = m[2].match(/<text[^>]*?(?:\/>|>([\s\S]*?)<\/text>)/)
        got.set(title, redirect ? { redirect: unxml(redirect[1]) } : { text: unxml(text?.[1] ?? '') })
      }
      for (const x of chunk) {
        const g = got.get(normTitle(x.at))
        if (!g) continue
        if (g.redirect) next.push({ asked: x.asked, at: normTitle(g.redirect) })
        else out.set(x.asked, { resolved: normTitle(x.at), text: g.text })
      }
      console.log(`  ${label} (text${hop ? ', redirects' : ''}): ${Math.min(i + size, todo.length)}/${todo.length}`)
    }
    todo = next
  }
  return out
}

/**
 * Wikidata ids of resolved titles: api.php pageprops, 50 titles a request.
 * `seedIds` (title -> id, from an earlier run's cache) answers first. When
 * api.php refuses (it is rate-limited much harder than the rest of the site
 * through a shared address), Wikidata's Special:ItemByTitle answers one title
 * at a time. A title neither answers is left unresolved for the next run.
 */
function itemIds(titles, label, onId) {
  const out = { set: (t, q) => onId(t, q) }
  const seed = seedIds()
  const ask = titles.filter((t) => { if (seed.has(t)) { out.set(t, seed.get(t)); return false } return true })
  for (let i = 0; i < ask.length; i += 50) {
    const chunk = ask.slice(i, i + 50)
    const body = http('https://en.wikipedia.org/w/api.php', { form: { action: 'query', format: 'json', formatversion: '2', prop: 'pageprops', ppprop: 'wikibase_item', titles: chunk.join('|') }, attempts: 1, key: 'api' })
    if (!body) {
      for (const t of chunk) {
        // Special:ItemByTitle answers with a redirect to the item (index.php, which the limiter treats far more kindly)
        const r = http(`https://www.wikidata.org/wiki/Special:ItemByTitle/enwiki/${encodeURIComponent(t.replace(/ /g, '_'))}`, { follow: false, attempts: 12 })
        if (r === undefined) continue
        out.set(t, typeof r === 'object' && r ? r.redirect?.match(/\/(Q\d+)$/)?.[1] ?? null : null)
      }
      console.log(`  ${label} (ids, one by one): ${Math.min(i + 50, ask.length)}/${ask.length}`)
      continue
    }
    const q = JSON.parse(body).query ?? {}
    const norm = new Map((q.normalized ?? []).map((n) => [n.to, n.from]))
    for (const p of q.pages ?? []) out.set(norm.get(p.title) ?? p.title, p.pageprops?.wikibase_item ?? null)
    console.log(`  ${label} (ids): ${Math.min(i + 50, ask.length)}/${ask.length}`)
  }
  return out
}
let seedCache = null
/** Optional `$DATA_CACHE/historic/seed-ids.json`: resolved title -> Wikidata id, carried over from an earlier cache. */
function seedIds() {
  if (!seedCache) {
    const f = path.join(path.dirname(WP_CACHE), 'seed-ids.json')
    seedCache = new Map(fs.existsSync(f) ? Object.entries(JSON.parse(fs.readFileSync(f, 'utf8'))) : [])
  }
  return seedCache
}

/**
 * Fetch every title not in the cache: its wikitext through Special:Export
 * (`size` pages a request), the redirect it resolves to, and its Wikidata id.
 * A page whose id could not be fetched is cached with `qid: undefined` and its
 * id is retried by the next run. Returns the number of titles fetched.
 */
export function fetchWpPages(titles, { size = BATCH.pages, label = 'pages', ids = true } = {}) {
  const all = [...new Set(titles.map(normTitle))].filter(Boolean)
  const todo = all.filter((t) => !wpPage(t))
  const texts = exportPages(todo, size, label)
  for (const t of todo) {
    const x = texts.get(t)
    putWpPage(x ? { title: t, resolved: x.resolved, missing: false, text: x.text } : { title: t, resolved: null, missing: true, qid: null, text: '' })
  }
  if (!ids) return todo.length
  const noId = all.map(wpPage).filter((p) => p && !p.missing && p.qid === undefined)
  // each id is written as soon as it is known, so an interrupted run keeps what it found
  const byResolved = new Map()
  for (const p of noId) { if (!byResolved.has(p.resolved)) byResolved.set(p.resolved, []); byResolved.get(p.resolved).push(p) }
  itemIds([...byResolved.keys()], label, (t, qid) => { for (const p of byResolved.get(t) ?? []) putWpPage({ ...p, qid }) })
  return todo.length
}

// ------------------------------------------------------------------ Wikidata

const KEEP = ['P569', 'P2048', 'P1532', 'P27', 'P413', 'P54', 'P1469', 'P31', 'P17', 'P1350']
const QUALS = ['P580', 'P582', 'P1350', 'P1351', 'P1642']
function snakValue(s) {
  const v = s?.datavalue?.value
  if (v == null) return null
  if (typeof v === 'string') return v
  if (v.id) return v.id
  if (v.time) return v.time.replace(/^\+/, '').slice(0, 10) + (v.precision < 11 ? `~${v.precision}` : '')
  if (v.amount != null) return { amount: Number(v.amount), unit: String(v.unit ?? '').split('/').pop() }
  return null
}
/** The entity reduced to { id, label, sitelinks, enwiki, claims: { P: [{ v, rank, q: { P: [v] } }] } }. */
export function trimEntity(e) {
  const claims = {}
  for (const p of KEEP) {
    const list = (e.claims?.[p] ?? []).filter((c) => c.rank !== 'deprecated').map((c) => {
      const q = {}
      for (const qp of QUALS) { const vals = (c.qualifiers?.[qp] ?? []).map(snakValue).filter((x) => x != null); if (vals.length) q[qp] = vals }
      return { v: snakValue(c.mainsnak), rank: c.rank, ...(Object.keys(q).length ? { q } : {}) }
    }).filter((c) => c.v != null)
    if (list.length) claims[p] = list
  }
  return { id: e.id, label: e.labels?.en?.value ?? null, sitelinks: Object.keys(e.sitelinks ?? {}).length, enwiki: e.sitelinks?.enwiki?.title ?? null, claims }
}
export function wdEntity(qid) {
  const f = wdFile(qid)
  if (!fs.existsSync(f)) return null
  const e = JSON.parse(fs.readFileSync(f, 'utf8'))
  return e.redirect ? wdEntity(e.redirect) : e
}

/** Fetch every entity not in the cache through Special:Export (one request per `size` items). */
export function fetchWdEntities(qids, { size = BATCH.entities, label = 'entities' } = {}) {
  let todo = [...new Set(qids)].filter((q) => /^Q\d+$/.test(q) && !fs.existsSync(wdFile(q)))
  let total = 0
  for (let round = 0; round < 3 && todo.length; round++) {
    const next = []
    for (let i = 0; i < todo.length; i += size) {
      const chunk = todo.slice(i, i + size)
      const body = http('https://www.wikidata.org/w/index.php?title=Special:Export', { form: { pages: chunk.join('\n'), curonly: '1', action: 'submit' } }) ?? ''
      const got = new Set()
      for (const m of body.matchAll(/<page>[\s\S]*?<title>(Q\d+)<\/title>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/page>/g)) {
        const qid = m[1]
        let e
        try { e = JSON.parse(unxml(m[2])) } catch { continue }
        got.add(qid)
        if (e.redirect) { write(wdFile(qid), { id: qid, redirect: e.redirect }); next.push(e.redirect) } else write(wdFile(qid), trimEntity(e))
      }
      for (const qid of chunk) if (!got.has(qid)) write(wdFile(qid), { id: qid, missing: true, label: null, sitelinks: 0, enwiki: null, claims: {} })
      total += chunk.length
      console.log(`  ${label}: ${Math.min(i + size, todo.length)}/${todo.length} fetched`)
    }
    todo = next.filter((q) => !fs.existsSync(wdFile(q)))
  }
  return total
}
