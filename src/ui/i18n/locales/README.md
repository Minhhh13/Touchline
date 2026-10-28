# Translations

One file per language, named by its BCP 47 id: `de.ts`, `fr.ts`, `pt-BR.ts`. Nothing here yet: the owner picks the
languages. Each file is its own chunk, fetched only when a viewer chooses that language (Profile, Settings, Language)
or when Auto finds it in the device's languages.

```ts
import type { Translation } from './types'

const de: Translation = {
  id: 'de',
  name: 'Deutsch',
  messages: {
    'home.title': 'TouchLine',
    'nav.home': 'Start',
    // A key left out reads in English
  },
}
export default de
```

Then add the name to `LOCALE_NAMES` in `../language.ts`. Every key and its English text is in `../en/*.ts`
(`I18N_EXPORT=1 npx vitest run src/ui/__tests__/i18n.test.ts` writes them all to `.i18n/en.json` for a translator).
Keep each message's `{arguments}` and `<tags>`; plurals use the language's own categories
(`{n, plural, one {# Spiel} other {# Spiele}}`). `src/ui/__tests__/i18n.test.ts` fails on an unknown key, a changed
argument or tag, or a message that does not parse.
