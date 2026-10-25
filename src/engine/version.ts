/**
 * Version of the engine's random-number consumption.
 *
 * Bump it whenever a change alters how many draws a spin, a pick, a match or a
 * season takes from the seeded `Rng`, or the order it takes them in: the same
 * seed then produces different results, and anything that replays a seed on
 * another device (a challenge link, a leaderboard comparison) carries this
 * stamp beside the data stamp so a mismatch can be reported instead of silently
 * failing verification.
 */
export const ENGINE_VERSION = '4'
