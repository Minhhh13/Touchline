import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Round 5: every radio group and every icon-only button carries an accessible name. The checks read the JSX of every
// .tsx file under src/ui, so a new Segmented, radio group or icon button without a name fails here before it ships.

const UI = fileURLToPath(new URL('..', import.meta.url))

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsxFiles(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

const tagOf = (el: Opening) => el.tagName.getText()
function attr(el: Opening, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name)
}
const spreads = (el: Opening) => el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p))
const named = (el: Opening) => !!(attr(el, 'aria-label') || attr(el, 'aria-labelledby'))
const literal = (a: ts.JsxAttribute | undefined) => (a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : undefined)

/** An icon: a self-closing element whose tag starts upper case (Lucide, PowerUpIcon...), or `{x ? <A /> : <B />}` of two. */
function iconExpr(e: ts.Node | undefined): boolean {
  if (!e) return false
  if (ts.isJsxSelfClosingElement(e)) return /^[A-Z]/.test(tagOf(e)) && tagOf(e) !== 'Rating'
  if (ts.isJsxExpression(e) || ts.isParenthesizedExpression(e)) return iconExpr(e.expression)
  if (ts.isConditionalExpression(e)) return iconExpr(e.whenTrue) && iconExpr(e.whenFalse)
  return false
}

/** A button's content is only icons: elements whose tag starts upper case (Lucide, PowerUpIcon...) with no text, no expression and no `sr-only` text. */
function iconOnly(children: ts.NodeArray<ts.JsxChild>): boolean {
  let icons = 0
  for (const c of children) {
    if (ts.isJsxText(c)) {
      if (c.getText().trim()) return false
    } else if (ts.isJsxSelfClosingElement(c) || ts.isJsxExpression(c)) {
      if (!iconExpr(c)) return false
      icons++
    } else return false
  }
  return icons > 0
}

const where = (file: string, sf: ts.SourceFile, node: ts.Node) => `${relative(UI, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`

function scan() {
  const segmented: string[] = []
  const groups: string[] = []
  const buttons: string[] = []
  let iconButtons = 0
  for (const file of tsxFiles(UI)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        if (tagOf(node) === 'Segmented' && !attr(node, 'label') && !spreads(node)) segmented.push(where(file, sf, node))
        if (literal(attr(node, 'role')) === 'radiogroup' && !named(node) && !spreads(node)) groups.push(where(file, sf, node))
      }
      if (ts.isJsxElement(node) && tagOf(node.openingElement) === 'button') {
        const open = node.openingElement
        if (iconOnly(node.children)) iconButtons++
        if (!named(open) && !spreads(open) && iconOnly(node.children)) buttons.push(where(file, sf, open))
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'button' && !named(node) && !spreads(node)) buttons.push(where(file, sf, node))
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { segmented, groups, buttons, iconButtons }
}

describe('accessible names (round 5)', () => {
  const found = scan()

  it('the scan reads the screens (it finds the Segmented switches it checks)', () => {
    const all = tsxFiles(UI).map((f) => readFileSync(f, 'utf8').match(/<Segmented\b/g)?.length ?? 0).reduce((a, b) => a + b, 0)
    expect(all).toBeGreaterThan(40)
    // and the icon buttons, every one of them named today
    expect(found.iconButtons).toBeGreaterThanOrEqual(5)
  })

  it('every Segmented in src/ui is given a label', () => {
    expect(found.segmented).toEqual([])
  })

  it('every role="radiogroup" is named', () => {
    expect(found.groups).toEqual([])
  })

  it('no icon-only button goes without an aria-label', () => {
    expect(found.buttons).toEqual([])
  })

  it('the scanner itself catches an unnamed Segmented, group and icon button', () => {
    const sf = ts.createSourceFile('x.tsx', `const a = <><Segmented value={v} options={o} /><Segmented label={t('x')} value={v} /><div role="radiogroup"></div><button onClick={go}><X size={14} /></button><button aria-label={t('y')}><X /></button><button><X /> {t('z')}</button></>`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const hits: string[] = []
    const visit = (node: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && tagOf(node) === 'Segmented' && !attr(node, 'label')) hits.push('segmented')
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && literal(attr(node, 'role')) === 'radiogroup' && !named(node)) hits.push('group')
      if (ts.isJsxElement(node) && tagOf(node.openingElement) === 'button' && !named(node.openingElement) && iconOnly(node.children)) hits.push('button')
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(hits).toEqual(['segmented', 'group', 'button'])
  })
})
