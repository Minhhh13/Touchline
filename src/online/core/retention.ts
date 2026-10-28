/**
 * The figures the privacy page states, in one place, so a test can pin them to the SQL and the client that
 * enforce them (`retention.test.ts`). Pure data: it imports nothing, and the privacy page renders in every
 * build, online or not.
 */
export const RETENTION = {
  /** Where the online layer's data lives (Supabase project `yvqpmyqomkwtudxmkeou`). */
  region: 'Sydney, Australia (ap-southeast-2)',
  /** Previous copies kept per save slot (`public.cloud_saves.prev_*`). */
  previousCopies: 1,
  /** Save files one account may keep in the cloud at once (the `saves` bucket's insert policy). */
  saveObjectCap: 16,
  /** Days a spent rate-limit window is kept before the daily clean-up removes it (`online_housekeeping`). */
  rateLimitDays: 2,
  /** Days a short challenge code lives (`public.challenges.expires_at`). */
  challengeCodeDays: 365,
  /** Characters of an account id an Edge Function log line may carry. */
  logUserIdChars: 8,
  /** Minutes an online head-to-head room waits for its second manager (`private.h2h_wait`). */
  roomWaitMinutes: 30,
  /** Minutes a room's draft may sit with no pick before it times out (`private.h2h_idle`). */
  roomIdleMinutes: 15,
  /** Hours a room is kept after it ends, then deleted (`private.h2h_keep`, the `touchline-h2h-rooms` job). */
  roomKeepHours: 24,
  /** Days a device keeps its seat in a room (`SEAT_KEEP_MS` in src/online/rooms.ts). */
  seatKeepDays: 2,
  /** Days an error report is kept after it was last seen (`private.error_reports_keep`, the `touchline-error-reports` job). */
  errorReportDays: 30,
  /** Error reports one device sends at most in an hour and a day (`DEVICE_LIMITS` in src/online/core/errorReport.ts). */
  errorReportsPerHour: 10,
  errorReportsPerDay: 30,
  /** The device-local keys the online layer writes (besides the game's own save). */
  deviceKeys: ['touchline-auth-v1', 'touchline-online-v1', 'touchline-online-prompts-v1', 'touchline-rooms-v1', 'touchline-error-reports-v1'],
} as const
