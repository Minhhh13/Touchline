import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { bannedIn } from './banned'

const ROOT = path.resolve(__dirname, '..', '..', '..')

/** Every TypeScript source under src, outside the tests. */
function sources(dir = path.join(ROOT, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
}

/**
 * The text a player can read that a source file carries: string literals, template text and JSX text, never comments
 * or identifiers (code comments may keep real names). Module specifiers are skipped. Returns each piece with its line.
 */
export function playerText(file: string, text = readFileSync(file, 'utf8')): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Array<{ line: number; text: string }> = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      const t = ts.isJsxText(node) ? node.getText(sf) : node.text
      if (t.trim()) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: t })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Banned names in a file's player-facing text, as "path:line name in "text"". */
function scan(file: string, text?: string): string[] {
  const rel = path.relative(ROOT, file)
  return playerText(file, text).flatMap((p) => bannedIn(p.text).map((name) => `${rel}:${p.line} ${name} in ${JSON.stringify(p.text.trim().slice(0, 80))}`))
}

describe('no real competition, award, game or brand names in player-facing text', () => {
  it('finds none in the string literals and JSX text of src', () => {
    const files = sources()
    expect(files.length).toBeGreaterThan(60)
    expect(files.flatMap((f) => scan(f))).toEqual([])
  })

  it('finds none in the page shell, the install manifest and the service worker', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>
    expect(bannedIn(html.replace(/<script[\s\S]*?<\/script>/g, ''))).toEqual([])
    expect(bannedIn(JSON.stringify(manifest))).toEqual([])
    expect(scan(path.join(ROOT, 'public', 'sw.js'))).toEqual([])
  })

  it('reads player text the way a player would: literals and JSX count, comments and identifiers do not', () => {
    const sample = [
      "// Premier League clubs, Football Manager style: comments may name them",
      "const FM = 1",
      "const a = 'Win the Champions League'",
      'const b = `${FM} games in the Bundesliga`',
      'export const C = () => <p title="Ballon d\'Or">The 38-0 classic</p>',
    ].join('\n')
    const hits = scan(path.join(ROOT, 'src', 'sample.tsx'), sample)
    expect(hits.map((h) => h.split(' in ')[0].replace(/^\S+ /, ''))).toEqual(['Champions League', 'Bundesliga', "Ballon d'Or", '38-0'])
    expect(hits[0]).toMatch(/^src\/sample\.tsx:3 /)
  })
})
