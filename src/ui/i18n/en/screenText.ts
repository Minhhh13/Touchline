import { catalog } from '../index'

/** The short labels in screenText.ts. */
export const screenText = catalog('screenText', {
  samePlace: 'Same place',
  placesHigher: '{n, plural, one {# place} other {# places}} higher',
  placesLower: '{n, plural, one {# place} other {# places}} lower',
  yourBestStart: '{runs} · your best perfect start',
  bestStart: 'Best perfect start {n}-0',
  bestStartAfter: 'best perfect start {n}-0',
  lostTo: 'Lost {score} to {opponent}',
  drewWith: 'Drew {score} with {opponent}',
  cupWinners: 'Cup winners',
  continentalChampions: 'Continental champions',
})
