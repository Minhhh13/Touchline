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

PNG cards and save exports open the native share sheet: choose **Save to Files** to keep a copy. Dismissing the sheet is a normal cancellation. Each temporary export stays in the app cache while the sheet is open and is removed when it closes. The app privacy manifest declares the Filesystem plugin's file-timestamp API use (`C617.1`). The status-bar text follows the game's light/dark theme.

## Optional online features

Local play remains available with no Supabase configuration. Optional `VITE_SUPABASE_*` settings are public build-time values as documented in `ONLINE.md`; changing them requires another build and sync. Never bundle a service-role key.

Native email/OAuth redirects need a callback flow back into the app and the corresponding Supabase redirect allowlist. A browser callback to `capacitor://localhost` is not a finished native authentication flow. Verify sign-in, account deletion, cloud saves and online rooms on a device before enabling online features in a distributed iOS build. Public challenge links must continue to point to `https://touchline.quest`, so recipients can open them in a browser.

## Phone verification

- Check Home → Quick Draft → Setup → Draft → season result and Season → a live match through both decision stops.
- Test light/dark themes at 360–430 px portrait widths and in landscape.
- Check the top bar, its hidden/restore state, bottom actions, player card and full-screen substitution sheets against the notch and home indicator.
- Focus a team-name or search field: the text stays at least 16 px and the keyboard leaves the field reachable.
- Check navigation and primary controls are easy to tap; tables scroll inside their panels without horizontal page overflow.
- Relaunch after a pick to verify the save survives; check a new local game in airplane mode.
- Check sharing, exported save files and imported saves on a real iPhone before release; desktop browser success alone does not establish WKWebView file handling.

References: [Capacitor iOS](https://capacitorjs.com/docs/ios), [Swift Package Manager](https://capacitorjs.com/docs/ios/spm), [Apple's distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
