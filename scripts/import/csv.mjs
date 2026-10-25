/**
 * Minimal streaming CSV reader. Handles quoted fields, escaped quotes and
 * newlines inside quotes. Yields rows as objects keyed by header.
 */
import { createReadStream } from 'node:fs'

export async function* readCsv(path, { delimiter = ',' } = {}) {
  const stream = createReadStream(path, { encoding: 'utf8' })
  let header = null
  let field = ''
  let row = []
  let inQuotes = false
  let prevQuote = false
  let first = true

  const emit = function* () {
    if (first) {
      // strip BOM
      if (row.length && row[0].charCodeAt(0) === 0xfeff) row[0] = row[0].slice(1)
      header = row.map((h) => h.trim())
      first = false
    } else if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      const obj = {}
      for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? ''
      yield obj
    }
    row = []
  }

  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]
      if (inQuotes) {
        if (ch === '"') {
          if (prevQuote) {
            field += '"'
            prevQuote = false
          } else {
            prevQuote = true
          }
        } else if (prevQuote) {
          // closing quote followed by something
          inQuotes = false
          prevQuote = false
          if (ch === delimiter) {
            row.push(field)
            field = ''
          } else if (ch === '\n') {
            row.push(field)
            field = ''
            yield* emit()
          } else if (ch === '\r') {
            // ignore
          } else {
            field += ch
          }
        } else {
          field += ch
        }
      } else if (ch === '"') {
        inQuotes = true
        prevQuote = false
      } else if (ch === delimiter) {
        row.push(field)
        field = ''
      } else if (ch === '\n') {
        row.push(field)
        field = ''
        yield* emit()
      } else if (ch === '\r') {
        // ignore
      } else {
        field += ch
      }
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    yield* emit()
  }
}
