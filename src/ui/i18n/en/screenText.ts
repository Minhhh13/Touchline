import { catalog } from '../index'

/** The short labels in screenText.ts. */
export const screenText = catalog('screenText', {
  samePlace: 'Same place',
  placesHigher: '{n, plural, one {# place} other {# places}} higher',
  placesLower: '{n, plural, one {# place} other {# places}} lower',
  yourBestStart: '{runs} · your best perfect start',
  bestStart: 'Best perfect start: {n, plural, one {# win} other {# wins}}',
  bestStartAfter: 'best perfect start: {n, plural, one {# win} other {# wins}}',
  lostTo: 'Lost {score} to {opponent}',
  drewWith: 'Drew {score} with {opponent}',
  cupWinners: 'Cup winners',
  continentalChampions: 'Continental champions',
})
