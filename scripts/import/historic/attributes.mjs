/**
 * Attributes for classic player-seasons, which no source rates.
 *
 *  - A player with a later EA profile (an ESD snapshot) keeps its shape,
 *    shifted by the gap between the estimated overall and that profile's.
 *  - Anyone else gets the per-position regression templates (templates.json,
 *    fitted on the 2008-13 packs: each attribute from overall, age, age^2,
 *    overall^2 and height) plus deterministic noise from the player id, with sd
 *    0.6 times the template's residual sd.
 *
 * Every attribute is then clamped to the range the 2008-13 England rows show
 * for the primary position, and no attribute goes above 94 unless the overall
 * is 85 or more (no pace 95 for a 78-rated striker).
 */
import fs from 'node:fs'
import path from 'node:path'
import { HISTORIC_DIR } from './config.mjs'

export const TEMPLATES = JSON.parse(fs.readFileSync(path.join(HISTORIC_DIR, 'templates.json'), 'utf8'))
export const CORE = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'men', 'gk']
export const DEPTH = ['sta', 'str', 'agg', 'jmp', 'wr']
const KEYS = [...CORE, ...DEPTH]
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

const residSd = (attr, pos) => TEMPLATES.report[attr]?.by_pos?.[pos]?.resid_sd ?? TEMPLATES.report[attr]?.rmse_model ?? 6

/**
 * { pac, sho, pas, dri, def, phy, men, gk, sta, str, agg, jmp, wr } for one row.
 *   ovr, age, height, pos (primary), id
 *   later   { ovr, attrs } from an ESD profile, or null
 *   ranges  { [pos]: { [attr]: [lo, hi] } } from the 2008-13 England rows
 *   gauss   (id, salt) -> deterministic N(0, 1)
 */
export function attributesFor({ ovr, age, height, pos, id, later, ranges, gauss }) {
  const att = {}
  if (later) {
    const shift = ovr - later.ovr
    for (const a of KEYS) {
      const v = later.attrs[a]
      if (!Number.isFinite(v)) continue
      // goalkeeping of an outfielder and the depth attributes do not move with the overall
      att[a] = a === 'gk' && pos !== 'GK' ? v : DEPTH.includes(a) || (pos === 'GK' && a !== 'gk' && a !== 'phy') ? v : v + shift
    }
  }
  const h = height || TEMPLATES.height_mean[pos] || 181
  const x = [1, ovr - 70, age - 27, (age - 27) ** 2, (ovr - 70) ** 2, h - 180, 1]
  KEYS.forEach((a, i) => {
    if (Number.isFinite(att[a])) return
    const w = TEMPLATES.models[a]?.[pos]
    if (!w) return
    let v = w.reduce((s, wi, j) => s + wi * x[j], 0)
    if (!(a === 'gk' && pos !== 'GK')) v += gauss(id, 50 + i) * 0.6 * residSd(a, pos)
    att[a] = v
  })
  const top = ovr >= 85 ? 99 : 94
  for (const a of KEYS) {
    const r = ranges?.[pos]?.[a]
    let v = att[a]
    if (r) v = clamp(v, r[0], r[1])
    att[a] = clamp(Math.round(v), 1, top)
  }
  if (pos !== 'GK') att.gk = clamp(att.gk, 1, 25)
  return att
}
