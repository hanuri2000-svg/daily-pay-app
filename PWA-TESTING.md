# PWA update isolation (v5.6.9)

The update button updates the registration at this application's exact directory
scope, with `updateViaCache: "none"`. It waits for activation before reloading.
It never unregisters origin-wide registrations or clears CacheStorage from the
page. A failed or offline update leaves the current page and working cache intact.

The worker precaches the new release before calling `skipWaiting()`. Activation
removes only this scope's obsolete `rabic-gongsu-pro:<encoded-scope>:v…` caches.
The historical `rabic-gongsu-pro-v…` and `labor-settlement-pro-v…` families are
removed only when all cached request URLs belong to this app's directory.
Ambiguous legacy caches are retained. `sw.js` imports the same safe lifecycle for
older installations. Offline reads use only the active release's cache.

The ledger's `work-ledger-pro-v1` localStorage key, other settings, and the
`rabic-receipts-v1` IndexedDB database are not cleared or migrated by this change.

## Run the complete suite

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:all
```

For an existing Chromium installation, set `PWA_CHROMIUM_PATH` to its executable.
`npm test` runs the Node lifecycle/update-handler suite without a browser.
GitHub Actions runs both suites on pushes and pull requests.

Coverage includes mixed caches and registrations on one origin, scoped and legacy
cache migration, actual v5.6.8 worker behavior before migration, the legacy worker
entry point, a subsequent release installed through the update button, failed
precache and retry, offline launch/reload with release query parameters, and exact
preservation of ledger/settlement/settings data and an IndexedDB receipt Blob.
Sibling applications are represented by small independent worker fixtures using
`spawn-note-v1.7.11` and `other-app-v3`; the real sibling repositories are unchanged.

## Existing open v5.6.8 pages

An already open page keeps its old JavaScript until a normal online reload.
Reload the page online to receive the repaired update handler. Deploying a new
worker cannot replace JavaScript already executing in an open document.

The automated browser suite uses Chromium. Installed iOS/Safari PWA checks should
also verify online reload, airplane-mode reopen, existing records, and receipts.
The original report concerned deletion scope in code; it did not establish a
real user outage.
