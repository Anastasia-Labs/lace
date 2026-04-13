# Midgard Mode Review

Date: 2026-04-12

## Scope

This review covered the current Midgard-related implementation across:

- `apps/browser-extension-wallet`
- `packages/cardano`
- background provider/config wiring
- Midgard-specific tests
- `scripts/playwright/run_midgard_mode_demo.cjs`
- `docs/midgard-demo.md`

The review focused on correctness, UX clarity, stability, state synchronization, and whether the current test/demo story actually proves that Midgard mode is working.

## Executive Summary

The feature direction is coherent: the code clearly separates Cardano L1 deposit signing from Midgard-backed L2 history/UTxO/send behavior, and there is already meaningful coverage around the banner and background-mediated mode switching.

The main risks are not in one isolated file. They come from the seams between UI state, extension storage, provider caching, and background reloads:

1. Mode transitions are not consistently treated as a single state machine.
2. Provider selection/caching has gaps that can leave the wallet pointed at stale backends.
3. Midgard URL resolution is split across two storage systems.
4. Some Midgard-only paths still fail too late in the UX.
5. The demo harness can report a superficially successful flow without proving Midgard-specific correctness.

## Spot Checks

Targeted suites I ran during the review:

- `corepack yarn workspace @lace/cardano test packages/cardano/src/wallet/lib/midgard/__tests__/history-provider.test.ts --runInBand`
  Result: passed
- `corepack yarn workspace @lace/browser-extension-wallet test src/components/MidgardBanner/__tests__/MidgardBanner.test.tsx --runInBand`
  Result: passed
- `corepack yarn workspace @lace/browser-extension-wallet test src/hooks/__tests__/useWalletManager.test.tsx --runInBand`
  Result: passed, with existing React `act(...)` warnings in that suite

Those passing tests are useful, but they do not cover the highest-risk integration edges listed below.

## Required Runtime Verification

I also ran the repo-required runtime verification flow after producing this document:

- `corepack yarn workspace @lace/browser-extension-wallet build`
  Result: passed, with the existing webpack warning from `src/shims/inquire.js`
- `PW_USER_DATA_DIR=/home/gumbo/midgard-hub/lace/output/playwright/manual-mode-profile MIDGARD_DEMO_STOP_AFTER_LOGIN=1 node scripts/playwright/run_midgard_mode_demo.cjs`
  Result: reached `manual_mode_ready=true`

Because the current demo harness does not actually prove that the Midgard toggle changed state, I attached to the live Chromium session over CDP and verified the popup directly:

- the wallet opened on `popup.html#/assets` and rendered the post-login assets view without getting stuck on loading
- I toggled the popup from standard mode into Midgard mode and confirmed the UI changed from `Layer 2 Inactive` to `Layer 2 Active`
- the assets view remained usable after enabling Midgard: balance rendered, Receive/Send buttons stayed visible, and Send was not disabled
- I opened the Send flow after enabling Midgard and confirmed the address input, cancel button, and next button all rendered

Important limitation:

- this verification used the repo's mock Midgard server path (`midgard_mock_server=http://localhost:3000`), so it proves popup/load/toggle usability but not real backend projection correctness

## Findings

### High

#### 1. An already-open send drawer can stay actionable while the wallet is switching into Midgard

Evidence:

- `apps/browser-extension-wallet/src/views/browser-view/features/send-transaction/components/SendTransactionDrawer/Footer.tsx:124`
- `apps/browser-extension-wallet/src/views/browser-view/features/send-transaction/components/SendTransactionDrawer/Footer.tsx:602`
- `apps/browser-extension-wallet/src/views/browser-view/features/send-transaction/components/SendTransactionDrawer/Footer.tsx:631`

Problem:

The confirm button is disabled only when `isMidgardEnabled && isMidgardActionBlocked(...)` is true. During a Cardano -> Midgard transition, `midgardActivationStatus` is already `switching`, but `isMidgardEnabled` is still false until the reload finishes. An already-open send flow can therefore remain confirmable while the provider set is being swapped underneath it.

Why it matters:

This is precisely the kind of boundary condition that creates flaky, hard-to-reproduce transaction failures. The UI can display a “Switching wallet providers...” label while still permitting confirmation against a half-reloaded state.

Suggested fix:

- Gate send confirmation on `midgardActivationStatus === 'switching'` regardless of the current effective mode.
- Add a regression test for opening Send in Cardano mode, toggling Midgard on, and verifying that confirmation is blocked until reload completion.

#### 2. The non-paginated wallet activity path can hang in loading state or race stale results back into the UI

Evidence:

- `apps/browser-extension-wallet/src/hooks/useWalletActivities.ts:84`
- `apps/browser-extension-wallet/src/stores/slices/wallet-activities-slice.ts:545`

Problem:

`getWalletActivities` sets `walletActivitiesStatus` to `LOADING`, then awaits `mapWalletActivities(...)` without `try/catch`, cancellation, or last-write-wins protection. Any Midgard decode/provider failure can leave the UI stuck in loading, and a slower prior refresh can overwrite newer Midgard state.

Why it matters:

Midgard adds more asynchronous enrichment work than the plain Cardano path. Without cancellation and failure handling, activity becomes one of the easiest places for the UI to look “frozen” or stale even when the wallet is otherwise usable.

Suggested fix:

- Wrap the slice fetch in `try/catch`.
- Preserve the last good activity list on failure and set an explicit error state.
- Make the non-paginated path last-write-wins, similar to the paginated hook.

#### 3. `MidgardChainHistoryProvider` violates the chain-history pagination contract

Evidence:

- `packages/cardano/src/wallet/lib/midgard/history-provider.ts:89`
- `packages/cardano/src/wallet/lib/midgard/history-provider.ts:145`

Problem:

`transactionsByAddresses(...)` ignores `pagination.startAt`, `pagination.limit`, and `pagination.order`. It always sorts descending and returns the full merged Midgard/L1 bridge set.

Why it matters:

This is both a correctness and scalability issue. Callers expect paged results. Ignoring pagination can turn what should be a bounded fetch into an unbounded Midgard history load for active wallets, and it can break pagination-dependent UX in subtle ways.

Suggested fix:

- Honor `startAt`, `limit`, and `order`.
- Slice after merge/dedup using the requested pagination window.
- Add tests for ascending and descending pagination with small page sizes.

#### 4. Provider caching can keep using the wrong Cardano submit backend after settings changes

Evidence:

- `apps/browser-extension-wallet/src/lib/scripts/background/config.ts:116`
- `packages/cardano/src/wallet/lib/providers.ts:53`

Problem:

The provider cache key only tracks Midgard enablement and the resolved Midgard URL. It does not include `customSubmitTxUrl`, even though the submit provider construction depends on it.

Why it matters:

Changing the custom Cardano submit URL in settings can leave the wallet using a stale cached `TxSubmitProvider` until some unrelated cache invalidation occurs.

Suggested fix:

- Include `customSubmitTxUrl` in the cache metadata.
- Alternatively, explicitly clear the provider cache whenever the custom submit URL changes.
- Add a regression test for toggling the custom submit endpoint on the same chain.

#### 5. Midgard bootstrap and storage-driven refresh paths can show the wallet as “ready” before the provider transition is actually finished

Evidence:

- `apps/browser-extension-wallet/src/hooks/useMidgardRefresh.ts:9`
- `apps/browser-extension-wallet/src/hooks/useMidgardRefresh.ts:115`
- `apps/browser-extension-wallet/src/hooks/useAppInit.ts:31`

Problem:

The initial storage sync and the external storage listener both mutate Midgard UI state independently of the background reload lifecycle. The refresh hook can clear errors or set mode state without a strong guarantee that the corresponding provider swap has completed.

Why it matters:

Midgard mode is only trustworthy if UI state and provider state move together. Right now the code has multiple places that can make the foreground look settled while the background is still reloading or has reloaded to a different effective configuration.

Suggested fix:

- Treat Midgard mode changes and Midgard URL changes as one background-owned transition state machine.
- Expose a provider-reload status from the background instead of reconstructing it ad hoc in the UI.
- Add focused tests for `chrome.storage.onChanged` ordering, bootstrap races, and failed restore/rollback behavior.

#### 6. The Playwright/demo harness does not reliably prove that Midgard-specific state changed

Evidence:

- `scripts/playwright/run_midgard_mode_demo.cjs:239`
- `scripts/playwright/run_midgard_mode_demo.cjs:272`
- `scripts/playwright/run_midgard_mode_demo.cjs:678`
- `scripts/playwright/run_midgard_mode_demo.cjs:1413`

Problem:

The mock fallback returns static state, the deposit path can wait up to four minutes for a projection that mock mode will never produce, and the script only logs projection-related values instead of asserting them. The send flow also accepts generic success text without proving that the transaction stayed on the Midgard path.

Why it matters:

This is the verification harness the repo currently leans on for Midgard confidence. If it can pass without proving Midgard-specific behavior, it will miss exactly the regressions that matter.

Suggested fix:

- Make the mock server stateful, or skip projection assertions entirely in mock mode.
- Fail the run if projected UTxO count/balance does not change when using a real Midgard backend.
- Add Midgard-specific post-send assertions, such as a Midgard-labeled activity entry or a pending Midgard tx record in wallet state.

### Medium

#### 7. Midgard URL resolution is split between `window.localStorage` and `chrome.storage.local`

Evidence:

- `apps/browser-extension-wallet/src/utils/midgard-url.ts:22`
- `apps/browser-extension-wallet/src/lib/scripts/background/config.ts:60`
- `apps/browser-extension-wallet/src/hooks/useMidgardRefresh.ts:133`

Problem:

Foreground helpers like `getMidgardUrl(...)` read from `window.localStorage`, while background provider creation reads from `chrome.storage.local`. A change applied through one path can leave the other stale.

Why it matters:

This can make the wallet UI talk to one Midgard URL while the active provider stack talks to another. Deposit/send helpers and provider reloads must not diverge on the backend they target.

Suggested fix:

- Use one storage source of truth for Midgard URL resolution.
- If the foreground must cache it, synchronize it explicitly from the background-owned value.
- Add tests around override propagation across popup/browser/background surfaces.

#### 8. Midgard native signing looks broader than it really is, and hardware-wallet failure happens too late

Evidence:

- `apps/browser-extension-wallet/src/lib/midgard-signing-coordinator.ts:32`
- `apps/browser-extension-wallet/src/lib/midgard-signing-coordinator.ts:79`
- `apps/browser-extension-wallet/src/views/browser-view/features/send-transaction/components/SendTransactionDrawer/Footer.tsx:267`

Problem:

The coordinator initially accepts any bip32 wallet shape, but then rejects anything except `WalletType.InMemory` inside `req.sign(...)`. The send flow only discovers that limitation during confirmation.

Why it matters:

This is a UX trap. Midgard send can appear fully available for Ledger/Trezor users until the final step, where it fails with an implementation detail rather than a product-level “not supported” state.

Suggested fix:

- Reject unsupported wallet types before publishing the signing request.
- Block or hide Midgard send earlier in the UI for unsupported wallet types.
- Add explicit Ledger/Trezor rejection tests.

#### 9. The send flow marks Midgard unhealthy for any Midgard send failure, including local construction/signing errors

Evidence:

- `apps/browser-extension-wallet/src/views/browser-view/features/send-transaction/components/SendTransactionDrawer/Footer.tsx:323`
- `apps/browser-extension-wallet/src/views/browser-view/features/send-transaction/components/SendTransactionDrawer/Footer.tsx:344`

Problem:

The Midgard submit catch block unconditionally calls `setMidgardHealthDegraded(...)`. That folds local validation, local signing, transaction assembly, and actual Midgard connectivity failures into the same “Midgard is unavailable” state.

Why it matters:

This can unnecessarily block all Midgard actions after a non-network error and makes the degraded banner misleading.

Suggested fix:

- Only degrade Midgard health for genuine Midgard/backend health failures.
- Keep local signing/build failures scoped to the transaction flow.
- Add a test proving that a local signing failure does not flip global Midgard health.

#### 10. The cached Cardano deposit balance is global and can leak across wallet/account/environment changes

Evidence:

- `apps/browser-extension-wallet/src/components/MidgardBanner/MidgardBanner.tsx:58`
- `apps/browser-extension-wallet/src/components/MidgardBanner/MidgardBanner.tsx:168`

Problem:

The “last Cardano available balance” cache is stored in one unscoped localStorage key: `midgardLastCardanoAvailableLovelace`.

Why it matters:

If the user switches wallet, account, or network while Midgard remains enabled, the deposit drawer can display another wallet’s cached L1 balance and validate the Max action against stale data.

Suggested fix:

- Scope the cache by wallet/account/environment, or
- Refresh the Cardano-side balance on-demand when opening the deposit drawer.
- Add a wallet/account switch regression test.

#### 11. The asset-detail send entry point does not honor the same Midgard blocking logic as the main send CTA

Evidence:

- `apps/browser-extension-wallet/src/views/browser-view/features/assets/components/AssetDetailsDrawer/AssetDetailsDrawer.tsx:50`
- `apps/browser-extension-wallet/src/views/browser-view/features/assets/components/AssetDetailsDrawer/AssetDetailsDrawer.tsx:69`
- `apps/browser-extension-wallet/src/views/browser-view/features/assets/components/Assets.tsx:231`

Problem:

The portfolio CTA path uses Midgard gating, but the asset-details drawer footer always calls `openSendDrawer(...)`.

Why it matters:

In degraded mode or during provider switching, users can still enter the send flow from the asset drawer and only discover the problem later.

Suggested fix:

- Apply `isMidgardActionBlocked(...)` consistently to the asset-details send path.
- Disable or hide that button when Midgard actions are blocked.

#### 12. Malformed Midgard UTxO records are silently filtered out instead of failing fast

Evidence:

- `packages/cardano/src/wallet/lib/midgard/utxo-provider.ts:28`
- `packages/cardano/src/wallet/lib/midgard/utxo-provider.ts:57`

Problem:

`transformMidgardUtxo(...)` logs decode failures and returns `undefined`, and the caller simply filters those records away.

Why it matters:

In Midgard mode that can silently under-report balance and inputs while leaving the wallet apparently healthy.

Suggested fix:

- Treat malformed Midgard UTxO payloads as provider failures.
- Surface them through health/error pathways rather than dropping them.

#### 13. Midgard URL override reloads do not surface a transition state or a user-facing failure

Evidence:

- `apps/browser-extension-wallet/src/hooks/useMidgardRefresh.ts:133`
- `apps/browser-extension-wallet/src/lib/scripts/background/onStorageChange.ts:59`

Problem:

URL override changes clear provider cache and call `reloadWallet()`, but the foreground store never enters a reloading state and reload failures are only logged.

Why it matters:

Users can keep interacting while providers are being replaced, and a broken new URL can leave the wallet in a stale or confusing state without a clear banner/message.

Suggested fix:

- Route override-driven reloads through the same transition/error flow as explicit mode switches, or
- Introduce a dedicated provider-reload state that blocks Midgard actions until completion.

#### 14. Provider-dependent activity mapping is memoized with an incomplete cache key

Evidence:

- `apps/browser-extension-wallet/src/stores/slices/wallet-activities-slice.ts:136`
- `apps/browser-extension-wallet/src/stores/slices/wallet-activities-slice.ts:522`

Problem:

The memoization key tracks transaction IDs and a few scalars, but not provider identity, full address set, or reload/config epochs.

Why it matters:

After Midgard URL changes, provider reloads, or later HD address discovery, activity resolution and Midgard labels can be stale even though the inputs to the transform have materially changed.

Suggested fix:

- Include a stable provider/config token and the full address set in the memo key, or
- Remove memoization around provider-dependent activity enrichment.

#### 15. Deposit building only succeeds if one address can fund the full amount

Evidence:

- `apps/browser-extension-wallet/src/components/MidgardBanner/deposit.ts:90`

Problem:

`buildMidgardDeposit(...)` iterates funding addresses and only proceeds when a single address has enough coins for the deposit. If the wallet has enough total L1 ADA spread across multiple addresses, the deposit still fails.

Why it matters:

This is a real UX footgun for larger or older wallets where funds are distributed across multiple addresses.

Suggested fix:

- Either support multi-address funding explicitly, or
- Surface the limitation clearly before submission so “Max” does not imply a deposit should succeed when it cannot.

#### 16. The docs and demo still present withdrawal as part of the flow, but the UI does not implement it

Evidence:

- `docs/midgard-demo.md:3`
- `scripts/playwright/run_midgard_mode_demo.cjs:791`
- `apps/browser-extension-wallet/src/components/MidgardBanner/MidgardBanner.tsx:534`

Problem:

The banner’s Withdraw button is permanently disabled, but the demo/docs still treat withdrawal as part of the overall Midgard flow.

Why it matters:

This creates false expectations for both users and reviewers, and it weakens the credibility of the current verification story.

Suggested fix:

- Remove withdrawal from the documented/demo flow until it exists, or
- Implement the withdrawal drawer and cover it end to end.

### Low

#### 17. The Midgard toggle/banner is not implemented as an accessible primary control

Evidence:

- `apps/browser-extension-wallet/src/components/MidgardBanner/MidgardBanner.tsx:438`
- `apps/browser-extension-wallet/src/components/MidgardBanner/MidgardBanner.tsx:466`

Problem:

The main clickable surface is a `div` with `aria-disabled` and `aria-busy`, not a semantic button. Async status text is also not announced through a live region.

Why it matters:

This makes the primary mode switch less keyboard/screen-reader friendly than it should be.

Suggested fix:

- Make the interactive surface semantic, or make only the actual switch/button interactive.
- Add `aria-live` for async mode/health state changes.

#### 18. The demo helper never re-verifies that the toggle actually reached the requested state

Evidence:

- `scripts/playwright/run_midgard_mode_demo.cjs:368`

Problem:

The helper clicks once and continues. It does not assert that the checked state matches the requested mode after the click.

Why it matters:

A flaky click or stale DOM can leave the wallet in Cardano mode while the script continues into Midgard-only assertions.

Suggested fix:

- Re-read the toggle state after the click and fail fast if it did not change as requested.

#### 19. The Cardano deposit submit path ignores provider-returned tx IDs

Evidence:

- `apps/browser-extension-wallet/src/components/MidgardBanner/deposit.ts:67`
- `packages/cardano/src/wallet/lib/midgard/tx-submit-provider.ts:57`

Problem:

`submitSignedCardanoTx(...)` recomputes the tx id locally from CBOR and ignores any provider-returned identifier.

Why it matters:

If the backend reports success with the wrong tx id, the UI/demo path will not detect the mismatch.

Suggested fix:

- Thread the provider-returned tx id through the call chain, or
- Explicitly compare it to the locally computed id and fail on mismatch.

#### 20. Midgard-specific activity-detail behavior is effectively untested at the component level

Evidence:

- `apps/browser-extension-wallet/src/views/browser-view/features/activity/components/ActivityDetail.tsx:129`
- `apps/browser-extension-wallet/src/views/browser-view/features/activity/components/__tests__/ActivityDetail.test.tsx:22`

Problem:

The current test file only covers `getTransactionData(...)`; it does not assert Midgard-specific labels, pending wording, or the “no external explorer link for Layer2-native txs” behavior.

Why it matters:

Those are exactly the behaviors that will regress quietly if activity modeling changes.

Suggested fix:

- Add component-level tests for pending deposit/send, confirmed Layer2-native activity, and external-link suppression for Midgard-native txs.

## Recommendations

### Immediate

1. Fix send gating during provider transitions.
2. Fix `MidgardChainHistoryProvider` pagination/order behavior.
3. Unify Midgard URL storage and access.
4. Fix provider cache invalidation for `customSubmitTxUrl`.
5. Make the demo harness assert Midgard-specific state changes.

### Next

1. Move Midgard mode and Midgard URL reloads under a single background-owned transition state.
2. Decide whether hardware-wallet Midgard send is unsupported for now or needs implementation, then make the UX explicit.
3. Scope the cached L1 deposit balance by wallet/account/network.
4. Tighten activity mapping memoization and failure handling.

## Positive Notes

- `MidgardBanner` coverage is already meaningful: switch success, switch failure, degraded mode, deposit happy path, and runtime URL override are all tested.
- `useWalletManager` already covers the background-mediated Midgard mode-switch success and failure paths.
- The Midgard implementation is intentionally trying to avoid silently falling back from L2 to L1 in several places, which is the right design bias.

The remaining work is mostly about making those design intentions hold reliably across all the integration edges.
