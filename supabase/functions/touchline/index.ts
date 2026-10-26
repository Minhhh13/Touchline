// TouchLine's Edge Function, deployed once per engine version as `touchline-e{ENGINE_VERSION}`, the multi-file form
// (scripts/online/deploy-function.mjs stages this file beside the verifier bundle). The loader form (loader.ts,
// scripts/online/build-loader.mjs) runs the same handler from the hashed bundle the site publishes. The whole request
// flow lives in src/online/server (service.ts, and edge.ts for the Supabase clients, Storage, Auth admin and the live
// site), tested there; this file only hands each verified request to it.
//
// Every request carries a signed-in user's JWT or the project's publishable key (withSupabase auth ['user',
// 'publishable'], which verifies either; deploy with verify_jwt off, or the platform refuses guests before this code).
// A request with only the key is a guest and may only play the online rooms (service.ts). The user id comes only from
// the verified claims. The service role is the platform's own (SUPABASE_SECRET_KEYS); no key
// is in this code. Secret TOUCHLINE_SITE_URL names the live site whose build.json and packs are the truth.
import { withSupabase } from '@supabase/server'
import { createEdgeHandler } from '../_shared/verifier.js'

const handle = createEdgeHandler({ site: Deno.env.get('TOUCHLINE_SITE_URL') ?? 'https://touchline.quest' })

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'], errors: { detailed: false } }, (req, ctx) => handle(req, ctx)),
}
