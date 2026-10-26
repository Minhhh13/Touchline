/**
 * Server-render helpers for the UI's QA tests: put state where `renderToString` reads it, and the markup checks
 * (text that should never reach a screen, named buttons, labelled inputs, alt text). Test files stub `localStorage`
 * before importing the store, as `qaRender.test.ts` does.
 */
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { useStore } from '@game/store'

type State = ReturnType<typeof useStore.getState>

/** Put state into the store where a server render reads it: `getInitialState` as well as the live state. */
export function show(patch: Partial<State>): void {
  useStore.setState(patch)
  Object.assign(useStore.getInitialState(), useStore.getState())
}

/** The problems in one render's markup. */
export function markupProblems(html: string): string[] {
  const out: string[] = []
  const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')
  const bad = text.match(/.{0,50}\b(NaN|undefined|\[object Object\]|Infinity|null)\b.{0,50}/)
  if (bad) out.push(`text: ${bad[0]}`)
  // A walk over the tags: buttons need a name, inputs a label, images alt text
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g
  const stack: Array<{ tag: string; attrs: string; text: string }> = []
  const labelledIds = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]))
  let last = 0
  let m: RegExpExecArray | null
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]
  while ((m = tagRe.exec(html))) {
    const between = html.slice(last, m.index).replace(/&[a-z#0-9]+;/g, 'x')
    if (between.trim()) for (const f of stack) f.text += between
    last = tagRe.lastIndex
    const [, close, tagRaw, attrs, selfClose] = m
    const tag = tagRaw.toLowerCase()
    if (close) {
      const i = stack.map((f) => f.tag).lastIndexOf(tag)
      if (i < 0) continue
      const f = stack[i]
      stack.length = i
      if (tag === 'button' && !f.text.trim() && !attr(f.attrs, 'aria-label') && !attr(f.attrs, 'title') && !attr(f.attrs, 'aria-labelledby')) out.push(`button without a name: <button${f.attrs.slice(0, 120)}>`)
      continue
    }
    if ((tag === 'dt' || tag === 'dd') && stack.at(-1)?.tag !== 'dl' && !(stack.at(-1)?.tag === 'div' && stack.at(-2)?.tag === 'dl')) out.push(`${tag} outside a dl: <${tag}${attrs.slice(0, 80)}>`)
    if (tag === 'img' && attr(attrs, 'alt') === undefined && attr(attrs, 'aria-hidden') !== 'true') out.push(`img without alt: <img${attrs.slice(0, 100)}>`)
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const type = attr(attrs, 'type')
      const inLabel = stack.some((f) => f.tag === 'label')
      const id = attr(attrs, 'id')
      if (type !== 'hidden' && !/display:\s*none/.test(attr(attrs, 'style') ?? '') && !inLabel && !attr(attrs, 'aria-label') && !attr(attrs, 'aria-labelledby') && !(id && labelledIds.has(id)) && !attr(attrs, 'title')) out.push(`${tag} without a label: <${tag}${attrs.slice(0, 120)}>`)
    }
    const voids = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use', 'col', 'area', 'base', 'wbr'])
    if (!selfClose && !voids.has(tag)) stack.push({ tag, attrs, text: '' })
  }
  return out
}


/** Render one component with what the store holds and return its markup's problems (a throw is one). */
export function renderProblems(C: ComponentType, props: Record<string, unknown> = {}): string[] {
  try {
    return markupProblems(renderToString(createElement(C as ComponentType<Record<string, unknown>>, props)))
  } catch (e) {
    return [`threw: ${e instanceof Error ? e.message : String(e)}`]
  }
}
