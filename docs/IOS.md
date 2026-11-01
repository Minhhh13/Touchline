# TouchLine on iOS

The iOS app bundles the existing React game with Capacitor and targets iOS 16.4 or newer. The minimum follows the game's existing modern WebKit layout features (container units, dynamic viewport units and color mixing), rather than Capacitor's lower runtime minimum. The league packs ship inside the app, so an installed build can start a local game without a connection. The browser and iOS builds use the same engine and save format, but each installation has its own storage. Use the Profile's save export/import to move a save between installations.

## Local setup

- macOS with Xcode 26 or newer and its first-launch setup complete.
- Node 22.13 or newer and npm.
- An installed iOS Simulator runtime (Xcode → Settings → Components).

```sh
npm ci
npm run ios:sync
npm run ios:open
```

Open `ios/App/App.xcodeproj`, select the App scheme and an iPhone Simulator, then Run. Swift Package Manager resolves the native Capacitor dependency; CocoaPods is not required. `npm run ios:run` builds, syncs and asks for a run target from the command line. `npm run ios:build` produces an unsigned Debug Simulator build in `.cache/ios-build`.

After every web-code or asset change, run `npm run ios:sync` before building in Xcode again. Xcode compiles the copied `dist` output, not the live `src` directory. Keep the native project and package lock committed; generated web assets, local Xcode state and build products are ignored.

`capacitor.config.ts` uses `dist` as `webDir` and deliberately has no remote `server.url`. An app build contains the game; it does not depend on the hosted website to load. The web build keeps its service worker; native builds use their bundled files directly.

## Device signing and distribution

`quest.touchline.app` is the development bundle identifier. Confirm the final identifier with the team's Apple Developer account before the first distribution upload. In Xcode, select App → Signing & Capabilities, choose the team's account and enable automatic signing. A Simulator build does not need a development team.

For a physical iPhone, select the paired device in Xcode and run the app with that team's signing configuration. For TestFlight, configure the matching app record in App Store Connect, select a generic iOS device, archive a Release build and distribute the archive through Xcode Organizer. Do not commit certificates, provisioning profiles, Apple account credentials or local signing settings.

The native icon and launch mark use the existing `markSvg` in `src/ui/brand.ts` (full tier, square tile, scale 0.78); the launch background follows the device appearance. This first target is a development build. Before TestFlight, confirm the app identifier, signing team, version/build number, privacy disclosures, support/privacy URLs and the complete device smoke. App Store submission is a separate release step.

PNG cards are passed to the native share sheet as images, so choose **Save Image** to add one to Photos. Save exports remain files and offer **Save to Files**. Dismissing either sheet is a normal cancellation. A temporary save export stays in the app cache while its sheet is open and is removed when it closes; image cards need no temporary file. `NSPhotoLibraryAddUsageDescription` explains the add-only Photos request when the user chooses Save Image; the app does not read the photo library. The app privacy manifest declares the Filesystem plugin's file-timestamp API use (`C617.1`). The status-bar text follows the game's light/dark theme.

## Optional online features

Local play remains available with no Supabase configuration. Optional `VITE_SUPABASE_*` settings are public build-time values as documented in `ONLINE.md`; changing them requires another build and sync. Never bundle a service-role key.

Native email/OAuth redirects need a callback flow back into the app and the corresponding Supabase redirect allowlist. A browser callback to `capacitor://localhost` is not a finished native authentication flow. Verify sign-in, account deletion, cloud saves and online rooms on a device before enabling online features in a distributed iOS build. The app shares `https://touchline.quest/` for season, Run-in and head-to-head results. Challenge and room links use the same public host with their invite details. Browser shares keep their current deployment URL.

## Phone verification

The current integration uses main's Home, Setup, Draft, Dugout/Tactics, matchday and Summary layouts. Native-only adjustments keep an accessible icon menu at the top, safe areas and pre-season tasks in page flow. Profile offers Full / Quick / Skip reels; main's landed-reel reload protection remains intact. Season/Dynasty summaries show all match results in a box about six rows high and let an accepted job offer advance to the next season. Explore places Home on the left and Boxes on the right on a phone. These changes do not alter engine outcomes or saved data.

All styles read the shared `--safe-top`, `--safe-right`, `--safe-bottom` and `--safe-left` tokens. Browser QA can use `safeAreaOverride` from `src/ui/safeArea.ts` to emulate a notch and home indicator; do not add a second family of inset tokens.

- Check Home → Quick Draft → Setup → Draft → season result and Season → a live match through both decision stops.
- Test light/dark themes at 360–430 px portrait widths and in landscape.
- Check the top bar, its hidden/restore state, bottom actions, player card and full-screen substitution sheets against the notch and home indicator.
- Focus a team-name or search field: the text stays at least 16 px and the keyboard leaves the field reachable.
- Check navigation and primary controls are easy to tap; tables scroll inside their panels without horizontal page overflow.
- Relaunch after a pick to verify the save survives; check a new local game in airplane mode.
- Check sharing, exported save files and imported saves on a real iPhone before release; desktop browser success alone does not establish WKWebView file handling.

References: [Capacitor iOS](https://capacitorjs.com/docs/ios), [Swift Package Manager](https://capacitorjs.com/docs/ios/spm), [Apple's distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## Deferred after the 2026-11-01 main-first integration

The owner requested prioritising the collaborator's current main over conflicting older prototypes. These items remain separate follow-ups; they are not included in PR #72's final integration:

- Equal compact Home cards and removal of Daily's separate Play button: rework against main's new Daily resume, rotation and onboarding behaviour.
- Larger formation previews and the old three-tab Draft workspace: reintroduce selectively after checking main's accessibility and phone scrolling at enlarged text sizes.
- Experimental Tactics screen with the current XI, bench and swap/formation controls: preserve the newer roles and set-piece controls when designing it again.
- Experimental match scoreboard and hideable bottom controls drawer: rework against main's matchday stops, accessibility and performance changes.
- Earlier private phone tabs for kickoff, playback and Summary: keep main's current page flow until each replacement is tested independently.
- GLXH-inspired match simulation and the reported changing-club squad issue: investigate separately with deterministic regression cases; this integration makes no game-logic change.

Earlier prototypes remain in branch history at `690d25c`; the old `docs/screenshots/ios-*.webp` images are historical, not screenshots of this integration. Native authentication callbacks, paid-team signing and TestFlight release checks also remain outstanding. Updating this PR does not merge the repository owner's separate local `ios-native` work.

Native sharing reference: [Apple: Save to Camera Roll](https://developer.apple.com/documentation/uikit/uiactivity/activitytype-swift.struct/savetocameraroll) and [Photos add-only usage description](https://developer.apple.com/documentation/bundleresources/information-property-list/nsphotolibraryaddusagedescription).

## Integration verification — 2026-11-01

- Typecheck, full Vitest (2,801 passed, 22 skipped), production build, four distribution-budget checks, secret-key scan and the verifier check pass. Engine 7's verifier remains `verifier-ecc269657e48639b.js`; engine, game logic and save format match main.
- Chromium: Quick Draft through manager, case, January, Summary and reload; managed Season through 45/70-minute stops, full-time report and all 38 results. The completed-season list renders 38 entries in a 420 px scrolling region, including the final result. Desktop Dugout fits 1280×720.
- Mobile WebKit: the completed season loads at 390×844 without horizontal page overflow, including native-layout emulation. A single `ResizeObserver loop completed with undelivered notifications` warning occurs on Summary in both the integrated branch and the existing production build; investigate separately against main rather than hiding the warning.
- The unsigned iOS Simulator build succeeds and launches on the already booted iPhone Simulator. Real-device Photos permission/save, native sign-in and distribution remain release checks; browser emulation does not establish those behaviours.
- The production site was checked before PR merge and still serves its existing engine-7 build. A post-merge production check must wait for the owner's review/merge and Render's deployment of that commit.
