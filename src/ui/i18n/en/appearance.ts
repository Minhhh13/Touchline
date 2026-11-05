import { catalog } from '../index'

export const appearance = catalog('appearance', {
  title: 'Appearance',
  open: 'Appearance and colours',
  theme: 'Theme',
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
  autoHint: "Auto follows your device's light or dark setting.",
  colours: 'Dark colours',
  slate: 'Slate',
  midnight: 'Midnight',
  warm: 'Warm',
  coloursHint: 'For Dark mode. Light keeps its own colours.',
})
