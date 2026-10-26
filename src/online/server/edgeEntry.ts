/**
 * The entry of the hashed edge bundle the site publishes as `dist/edge/verifier-<hash16>.js`
 * (`scripts/online/edgeBundle.mjs`): the Edge Function's loader fetches it, checks its SHA-256 against the constant it
 * was deployed with, runs it and calls `createEdgeHandler`. Everything the server replays with (engine, game rules,
 * verifier, request flow) is in here; nothing in it is secret (it is the same code the client ships).
 */
export { ENGINE_VERSION } from '@engine/version'
export { createEdgeHandler, EDGE_MAX_BODY } from './edge'
