import { useStore } from '@game/store'
import { RETENTION } from '../../online/core/retention'
import { onlineAvailable } from '../../online/api'
import { APP_NAME } from '../brand'

/** Privacy and fair play: what TouchLine keeps, where, for how long, how to delete it, and the leaderboard rules. */
export function Privacy() {
  const go = useStore((s) => s.go)
  const online = onlineAvailable()
  return (
    <div className="page" style={{ maxWidth: 860 }} data-testid="privacy-page">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <h1>Privacy and fair play</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="col">
        <div className="panel">
          <h3>The short version</h3>
          <p>{APP_NAME} is a free, non-commercial fan game with no ads and no tracking. You never need an account: every mode works signed out and offline, and your games are saved in this browser. Signing in is optional and only adds cloud saves, the world leaderboard and short challenge links.</p>
          {!online && <p className="help">This build has no online features at all: nothing you do here leaves this device.</p>}
        </div>
        <div className="panel">
          <h3>On this device</h3>
          <p>Your games, record, settings and shortlist are kept in this browser's local storage. They never leave the device unless you sign in and they sync, or you export them from the Profile page. Clearing the site's data, or Delete all data on the Profile page, removes them.</p>
          <p className="muted small">An online build also keeps three small entries here: your sign-in session, a random id for this device and which account its games last synced with, and which sign-in prompts you dismissed ({RETENTION.deviceKeys.join(', ')}).</p>
        </div>
        <div className="panel">
          <h3>If you sign in</h3>
          <p>Accounts and data are held by Supabase, in {RETENTION.region}.</p>
          <ul>
            <li><b>Your sign-in.</b> Your email address, or your Google identity if you continue with Google. Only the sign-in service holds it; {APP_NAME}'s own tables never store your email, and the game shows it masked.</li>
            <li><b>Your name and flag.</b> The name on the leaderboards you choose, and an optional country. Nobody else can read your profile; boards show the name and flag copied onto each score when you post it.</li>
            <li><b>Cloud saves.</b> A copy of each game slot (Quick, Season, Dynasty, head-to-head), your record and shortlist, and {RETENTION.previousCopies} previous copy per slot until it is replaced. At most {RETENTION.saveObjectCap} save files per account.</li>
            <li><b>Leaderboard entries.</b> For each Daily and weekly challenge you post: the draft (picks stay hidden until the day or week closes, then anyone can race it under your team name; the manager name on this device is never posted), the result the server's replay produced, the name and flag you posted under, and your all-time Daily totals and streaks.</li>
            <li><b>Short challenge links.</b> The draft a link points to, kept for {RETENTION.challengeCodeDays} days.</li>
            <li><b>Housekeeping.</b> Counters that limit how often an account can post or save, deleted after {RETENTION.rateLimitDays} days. Server logs record the request, its outcome, how long it took and the first {RETENTION.logUserIdChars} characters of your account id, never what you sent.</li>
          </ul>
          <p className="muted small">No IP address, browser details or location are written to {APP_NAME}'s tables, nothing is sold or shared, and no analytics or advertising scripts run.</p>
        </div>
        <div className="panel">
          <h3>Deleting your data</h3>
          <ul>
            <li><b>Delete my cloud data</b> (the Account screen, from the top bar) removes every cloud save and the synced record. Your games on this device stay.</li>
            <li><b>Delete account</b> removes your cloud saves, signs you out everywhere and deletes the account, with your profile, leaderboard entries, totals and challenge links.</li>
            <li><b>Signing out</b> keeps everything on this device; it only stops syncing.</li>
          </ul>
          <p className="muted small">If you cannot sign in any more and want your data removed, open an issue on the project or contact the owner, naming the email you used.</p>
        </div>
        <div className="panel" data-testid="fair-play">
          <h3>Fair play and the leaderboards</h3>
          <ul>
            <li>Every ranked score is replayed by the server with the game's own engine; a posted score is never stored as it was sent. Edited picks, extra re-spins or forged figures are refused.</li>
            <li>The first post per account per Daily or weekly challenge stands. Ties go to whoever posted first.</li>
            <li>The Daily and weekly seeds are public and the season is deterministic, so practising a puzzle offline before posting is possible for everyone alike; it is how fixed-seed boards work.</li>
            <li>One account per person. Names that impersonate someone, or are abusive, are renamed, and entries that break these rules are hidden, at the owner's discretion.</li>
            <li>Free to play for fun. The game, the boards and the cloud copies come with no guarantee and may be reset or end.</li>
          </ul>
        </div>
        <div className="panel">
          <h3>Player data</h3>
          <p>Ratings are reworked from community datasets derived from EA Sports FC and FIFA ratings (Kaggle: FC 24 and FC 26 CC0, FC 25 Apache 2.0, FC 27 a non-commercial snapshot), the European Soccer Database (ODbL), openfootball results (public domain) and Wikidata (CC0). The ratings originate with EA Sports; {APP_NAME} is not affiliated with EA, any league or any club, and uses no real crests, kits, logos or photos.</p>
        </div>
      </div>
    </div>
  )
}
