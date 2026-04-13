# Midgard Demo Flow

This demo runner records the supported Midgard popup flow:

1. Deposit to Midgard
2. Send funds to the same wallet address

Withdrawal is intentionally excluded until the UI and backend flow are fully implemented.

## Prerequisites

1. Build the extension:

```bash
yarn build
```

2. Configure Midgard + Preprod in `apps/browser-extension-wallet/.env` (or `.env.local`):

```bash
DEFAULT_CHAIN=Preprod
MIDGARD_URL_PREPROD=http://localhost:3000/
BYPASS_FATAL_ERRORS=true
```

3. Ensure the Midgard backend is running and reachable at `MIDGARD_URL_PREPROD`.
   If it is not reachable, the demo runner auto-starts a local mock Midgard server (HTTP only) so you can still verify the popup flow and Midgard send wiring.
   Mock mode does not pretend to verify Layer 1 deposit projection; the runner logs that projection verification was skipped.

## Run

```bash
yarn demo:midgard-flow
```

## Useful Environment Variables

- `PW_RECORD_VIDEO=1`: enable Playwright video capture
- `PW_USER_DATA_DIR=/path/to/profile`: reuse a persistent browser profile
- `PW_MNEMONIC_FILE=/path/to/mnemonic.txt`: custom mnemonic storage file
- `PW_WALLET_PASSWORD=...`: override default test password
- `MIDGARD_DEPOSIT_ADA=1.2345`: deposit amount in ADA
- `MIDGARD_SEND_ADA=0.2`: self-send amount in ADA
- `MIDGARD_DEMO_MIDGARD_URL=http://localhost:3000`: Midgard base URL used by the runner for health/mock
- `MIDGARD_USE_MOCK=0`: disable auto-mock fallback and fail fast if Midgard is unavailable
- `MIDGARD_MOCK_INITIAL_LOVELACE=5000000000`: initial mocked UTxO coins used for demo flows

## What The Runner Verifies

- The Midgard toggle actually changes to the requested state before the flow continues.
- Deposit uses the live Midgard backend only when projection can be verified end-to-end.
- Send succeeds while Midgard mode remains enabled and issues a Midgard `/submit` request.
- Mock mode remains UI-focused and explicitly skips any claim that a deposit projected on Layer 2.

## Output Artifacts

Artifacts are written to:

- `/home/gumbo/midgard-hub/output/playwright`

The script logs generated screenshot paths, optional video paths, and the wallet address to stdout.
