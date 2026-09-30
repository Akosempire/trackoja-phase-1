# Browser compatibility

TrackOja targets current Chrome, Edge, Firefox and Safari, including Android and
iOS browsers. This is not a promise to support every historical browser version.
The existing design tokens and components remain the same across browsers.

## Repeatable checks

```sh
npm ci
npm run test:browsers:install
npm run build
npm run test:browsers
```

The full matrix also expects Chrome and Edge to be installed on the machine.
For an environment without those branded browsers, run the engine/device matrix:

```sh
npm run test:browsers -- --project=chromium --project=firefox --project=webkit --project=android --project=iphone --project=ipad
```

On Linux CI, install system dependencies with
`npx playwright install --with-deps chromium firefox webkit`.
The development fixture server uses port 4175; the built application uses 4176.
Keep the generated build current before testing production PWA behavior.
Run `npm run test:visual` separately for the established screenshot baselines.
Different browser font renderers are checked for usable layout, not identical pixels.

## What the matrix checks

| Projects | Checks |
| --- | --- |
| Chromium, installed Chrome, installed Edge, Firefox, WebKit | Shared React controls and platform routes at 320, 375, 390, 430, 768, 1024, 1280 and 1440 pixels, in light and dark themes |
| Pixel 7, iPhone 13, iPad emulation | Public authentication fields, recovery navigation, install guidance, decimal validation, manual barcode entry and page overflow |
| All eight projects | Built application's service-worker registration and cached sign-in shell reload after its dedicated server is stopped |

Shared controls cover populated/loading/empty/error states, search/button alignment,
mobile Scan placement, modal and drawer dismissal/focus restoration, keyboard tabs,
retry actions, billing tabs, plan dialogs and admin pagination/filter navigation.
Platform services are isolated fixtures; public authentication tests do not submit
credentials or alter customer accounts. Offline sign-in UI does not mean a user can
authenticate or submit server writes without a connection.

The PWA test stops a private local proxy for each browser and confirms a plain HTTP
client cannot reach it before reloading the cached screen. This avoids the
[Playwright 1.63 WebKit offline-emulation bug](https://github.com/microsoft/playwright/issues/42775)
without skipping the cache fallback check. It does not simulate an operating
system switching into airplane mode.

## Compatibility fix

WebKit does not focus a button on pointer activation. Consequently, closing a
native dialog could restore focus to a previous control instead of its opener.
The shared Button now focuses itself without scrolling before invoking its action.
The existing modal/drawer regression checks exercise this behavior across engines.

## Local verification, 30 September 2026

- Exercised the matrix on Windows with Chromium 153, Chrome 153.0.8010.53,
  Edge 154.0.4258.37, Playwright Firefox 155 and WebKit 26.6.
- UI checks passed across the initial runs and targeted reruns after the focus fix;
  initial Firefox startup timeouts were rerun in isolation. The configuration
  limits concurrency to two workers and allows time for cold browser startup.
- The final server-unavailable PWA test passed in all eight projects.
- 606 unit tests, ESLint, TypeScript, production build and static PWA checks passed.

## Release checks that still need devices and a deployed environment

- Run Safari on actual macOS and iOS, and Chrome on Android. Playwright WebKit on
  Windows and mobile emulation do not certify those operating systems or hardware.
- Check Add to Home Screen/install, standalone launch and updates over HTTPS.
  Install UI differs by browser; a universal native install prompt is not assumed.
- Check real camera permission grant/denial and scanning on physical devices.
  Automated checks exercise manual entry when camera access is unavailable.
- Smoke-test authenticated roles, onboarding, subscriptions and payment-provider
  redirects in the configured environment. Local fixtures cannot certify live RLS,
  migrations, provider availability or customer account state.

References: [Playwright browsers](https://playwright.dev/docs/browsers) and
[device emulation](https://playwright.dev/docs/emulation).
