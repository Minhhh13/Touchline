/**
 * The shape of a translation file, `src/ui/i18n/locales/<id>.ts` (`de.ts`, `pt-BR.ts`): its messages by full key
 * (`home.title`), every key one the English catalogues hold (TypeScript checks it), each message keeping the English
 * one's arguments and tags (`i18n.test.ts` checks it). A key left out reads in English. Type-only: nothing here ships.
 */
import type { CATALOGS } from '../en'

type All = typeof CATALOGS
/** Every message's full key: `<namespace>.<key>`. */
export type FullKey = { [N in keyof All]: `${All[N]['ns']}.${keyof All[N]['messages'] & string}` }[keyof All]

export interface Translation {
  /** The BCP 47 id, the same as the file name (`de`, `pt-BR`). */
  id: string
  /** The language's own name ("Deutsch"); add it to `LOCALE_NAMES` in `language.ts` too. */
  name: string
  messages: Partial<Record<FullKey, string>>
}
