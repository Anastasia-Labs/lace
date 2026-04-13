# Repository Agents Notes

- After making code changes for any task, do not consider the task complete until you have run the Playwright manual login flow against the current build and verified that the extension loads successfully and Midgard mode enabling works.
- Use the bundled Chromium manual flow command from the repo root:

```bash
corepack yarn workspace @lace/browser-extension-wallet build
PW_USER_DATA_DIR=/home/gumbo/midgard-hub/lace/output/playwright/manual-mode-profile \
MIDGARD_DEMO_STOP_AFTER_LOGIN=1 \
node scripts/playwright/run_midgard_mode_demo.cjs
```

- The verification bar is:
  - the wallet reaches the post-login popup without getting stuck on loading
  - the extension UI finishes loading
  - Midgard mode can be enabled and the wallet remains usable afterward
