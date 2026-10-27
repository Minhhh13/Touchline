import { Fragment, type ReactNode } from 'react'

/**
 * Rich text from a translated string: each `<name>…</name>` pair becomes `tags.name(children)`, so a sentence with a
 * bold word stays one message a translator can reorder ("Press <b>Spin</b> to start"). A tag with no renderer, or an
 * unpaired one, prints as plain text.
 */
export function rich(text: string, tags: Record<string, (children: ReactNode) => ReactNode>): ReactNode {
  const re = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    const render = tags[m[1]]
    if (!render) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<Fragment key={i++}>{render(rich(m[2], tags))}</Fragment>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length === 1 && typeof out[0] === 'string' ? out[0] : out
}

/** The usual renderers: bold and emphasis. */
export const B = { b: (c: ReactNode) => <b>{c}</b>, i: (c: ReactNode) => <i>{c}</i> }
