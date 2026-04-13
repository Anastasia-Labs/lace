const { chromium } = require('playwright');
const { mkdtemp, mkdir, readFile, writeFile, chmod } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');

const extensionPath = '/home/gumbo/midgard-hub/lace/apps/browser-extension-wallet/dist';
const outputDir = '/home/gumbo/midgard-hub/output/playwright';
const mnemonicFile = process.env.PW_MNEMONIC_FILE || `${outputDir}/playwright-wallet-mnemonic.txt`;
const shouldRecordVideo = process.env.PW_RECORD_VIDEO === '1';
const password = 'N_8J@bne87A';
const validMnemonicLengths = new Set([12, 15, 24]);
const popupViewport = { width: 780, height: 1560 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const asActiveExtensionPage = (context, extensionId) => {
  const prefix = `chrome-extension://${extensionId}/`;
  const candidates = context.pages().filter((candidate) => !candidate.isClosed() && candidate.url().startsWith(prefix));
  return candidates[candidates.length - 1];
};

const safeVisible = async (locator) => locator.isVisible().catch(() => false);

const safeEnabled = async (locator) => locator.isEnabled().catch(() => false);

const safeCount = async (locator) => locator.count().catch(() => 0);

const parseMnemonicWords = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const loadMnemonicWords = async () => {
  try {
    const raw = await readFile(mnemonicFile, 'utf8');
    const words = parseMnemonicWords(raw);
    return validMnemonicLengths.has(words.length) ? words : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
};

const saveMnemonicWords = async (words) => {
  if (!validMnemonicLengths.has(words.length)) return false;
  await mkdir(dirname(mnemonicFile), { recursive: true });
  await writeFile(mnemonicFile, `${words.join(' ')}\n`, { mode: 0o600 });
  await chmod(mnemonicFile, 0o600).catch(() => undefined);
  return true;
};

const setupPageListeners = (page) => {
  page.on('pageerror', (error) => console.log(`pageerror=${error.message}`));
  page.on('requestfailed', (request) => console.log(`requestfailed=${request.url()} reason=${request.failure()?.errorText || ''}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.log(`console_${message.type()}=${message.text()}`);
    }
  });
};

(async () => {
  await mkdir(outputDir, { recursive: true });
  const userDataDir = process.env.PW_USER_DATA_DIR || (await mkdtemp(join(tmpdir(), 'lace-pw-ext-')));
  let mnemonicWords = await loadMnemonicWords();
  const hasStoredMnemonic = mnemonicWords.length > 0;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: popupViewport,
    ...(shouldRecordVideo
      ? {
          recordVideo: {
            dir: outputDir,
            size: popupViewport
          }
        }
      : {}),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const videoHandles = [];
  const registerVideo = (page) => {
    if (!shouldRecordVideo) return;
    const video = page.video();
    if (video) videoHandles.push(video);
  };

  try {
    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', {
        timeout: 30_000
      }));

    const extensionId = new URL(serviceWorker.url()).host;
    let page = await context.newPage();
    setupPageListeners(page);
    registerVideo(page);
    context.on('page', (newPage) => {
      setupPageListeners(newPage);
      registerVideo(newPage);
    });

    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    let depositInput;
    let switchedToPreprod = false;
    let reopenedPopup = false;
    let persistedMnemonicInThisRun = hasStoredMnemonic;

    for (let i = 0; i < 80; i++) {
      page = asActiveExtensionPage(context, extensionId) || page;
      if (!page || page.isClosed()) {
        await wait(500);
        continue;
      }

      depositInput = page.locator('input[placeholder="Amount (ADA)"]');
      const createWalletButton = page.locator('[data-testid="create-wallet-button"]');
      const restoreWalletButton = page.locator('[data-testid="restore-wallet-button"]');
      const createButtonByText = page.getByRole('button', { name: /^Create$/ });
      const nextButton = page.locator('[data-testid="wallet-setup-step-btn-next"]');
      const copyButton = page.locator('[data-testid="copy-to-clipboard-button"]');
      const pasteButton = page.locator('[data-testid="paste-from-clipboard-button"]');
      const walletNameInput = page.locator('[data-testid="wallet-name-input"]');
      const walletPasswordInput = page.locator('[data-testid="wallet-password-verification-input"]');
      const walletPasswordConfirmInput = page.locator('[data-testid="wallet-password-confirmation-input"]');
      const unlockButton = page.locator('[data-testid="unlock-button"]');
      const depositButton = page.getByRole('button', { name: /Deposit to Midgard/i });
      const midgardModeLabel = page.getByText(/Midgard mode/i);
      const reloadExtensionButton = page.getByRole('button', { name: /Reload extension/i });
      const mnemonicInputs = page.locator('[data-testid="mnemonic-word-input"]');
      const mnemonicWritedownWords = page.locator('[data-testid="mnemonic-word-writedown"]');
      const midgardSwitchChecked = (await page.locator('.ant-switch-checked').count().catch(() => 0)) > 0;

      const state = {
        url: page.url(),
        createById: await safeVisible(createWalletButton),
        restoreById: await safeVisible(restoreWalletButton),
        createByText: await safeVisible(createButtonByText),
        next: await safeVisible(nextButton),
        copy: await safeVisible(copyButton),
        paste: await safeVisible(pasteButton),
        walletName: await safeVisible(walletNameInput),
        unlock: await safeVisible(unlockButton),
        midgardSwitchChecked,
        depositInput: await safeVisible(depositInput),
        depositButton: await safeVisible(depositButton),
        mnemonicInputCount: await safeCount(mnemonicInputs),
        mnemonicWritedownCount: await safeCount(mnemonicWritedownWords)
      };

      console.log(`step=${i} state=${JSON.stringify(state)}`);
      try {
        await page.screenshot({ path: `${outputDir}/debug-step-${String(i).padStart(2, '0')}.png`, fullPage: true });
      } catch (error) {
        if (!String(error).includes('Target closed')) throw error;
        await wait(400);
        continue;
      }

      if (state.depositInput) break;

      if (!state.depositInput && state.url.includes('/assets') && !reopenedPopup) {
        const popupPage = await context.newPage();
        setupPageListeners(popupPage);
        await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
        reopenedPopup = true;
        await wait(1500);
        continue;
      }

      if (!state.depositInput && (await safeVisible(reloadExtensionButton))) {
        await reloadExtensionButton.click().catch(() => undefined);
        await wait(2000);
        await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
        await wait(1000);
        continue;
      }

      if (!state.depositInput && (await safeVisible(midgardModeLabel)) && !state.midgardSwitchChecked) {
        await midgardModeLabel.click().catch(() => undefined);
        await wait(1200);
        continue;
      }

      if (!state.depositInput && state.midgardSwitchChecked && state.depositButton) {
        await depositButton.click().catch(() => undefined);
        await wait(900);
        continue;
      }

      if (!state.depositInput && state.url.includes('/assets') && !switchedToPreprod) {
        const switched = await page
          .evaluate(() => {
            const currentSettingsRaw = window.localStorage.getItem('appSettings');
            const currentSettings = currentSettingsRaw ? JSON.parse(currentSettingsRaw) : {};
            const nextSettings = { ...currentSettings, chainName: 'Preprod' };
            window.localStorage.setItem('appSettings', JSON.stringify(nextSettings));
            window.location.reload();
            return true;
          })
          .catch((error) => {
            console.log(`preprod_switch_failed=${String(error)}`);
            return false;
          });
        console.log(`preprod_switch_applied=${switched}`);
        switchedToPreprod = true;
        await wait(3000);
        continue;
      }

      if (mnemonicWords.length > 0 && state.restoreById) {
        await restoreWalletButton.click();
        await wait(1000);
        continue;
      }

      if (state.createById) {
        await createWalletButton.click();
        await wait(800);
        continue;
      }

      if (state.createByText) {
        await createButtonByText.click();
        await wait(1000);
        continue;
      }

      if (state.copy) {
        if (!persistedMnemonicInThisRun && state.mnemonicWritedownCount > 0) {
          const rawWords = await mnemonicWritedownWords.allInnerTexts();
          const capturedWords = rawWords.map((rawWord) => rawWord.trim().split(/\s+/).pop()).filter(Boolean);
          if (validMnemonicLengths.has(capturedWords.length)) {
            mnemonicWords = capturedWords;
            const saved = await saveMnemonicWords(mnemonicWords);
            persistedMnemonicInThisRun = saved;
            console.log(`captured_mnemonic_words=${mnemonicWords.length}`);
            console.log(`mnemonic_saved=${saved}`);
          }
        }
        await copyButton.click().catch(() => undefined);
        await wait(500);
      }

      if (state.paste) {
        if (mnemonicWords.length > 0 && state.mnemonicInputCount > 0) {
          for (let index = 0; index < Math.min(state.mnemonicInputCount, mnemonicWords.length); index++) {
            await mnemonicInputs.nth(index).fill(mnemonicWords[index]).catch(() => undefined);
          }
          const stepTitle = page.locator('[data-testid="wallet-setup-step-title"]').first();
          if (await safeVisible(stepTitle)) await stepTitle.click().catch(() => undefined);
        } else {
          await pasteButton.click().catch(() => undefined);
        }
        await wait(500);
      }

      if (state.walletName) {
        await walletNameInput.fill('Playwright Wallet');
        if (await safeVisible(walletPasswordInput)) await walletPasswordInput.fill(password);
        if (await safeVisible(walletPasswordConfirmInput)) await walletPasswordConfirmInput.fill(password);
        if (await safeVisible(nextButton) && (await safeEnabled(nextButton))) {
          await nextButton.click();
          await wait(2000);
          continue;
        }
      }

      if (state.unlock) {
        const passwordInput = page.locator('input[type="password"]').first();
        if (await safeVisible(passwordInput)) await passwordInput.fill(password);
        await unlockButton.click();
        await wait(1500);
        continue;
      }

      const gotItButton = page.getByRole('button', { name: /^Got it$/i });
      if (await safeVisible(gotItButton)) {
        await gotItButton.click();
        await wait(800);
        continue;
      }

      const analyticsRejectButton = page.getByRole('button', { name: /^Reject$/i });
      if (await safeVisible(analyticsRejectButton)) {
        await analyticsRejectButton.click();
        await wait(800);
        continue;
      }

      const enterWalletButton = page.getByRole('button', { name: /Enter wallet/i });
      if (await safeVisible(enterWalletButton)) {
        await enterWalletButton.click();
        await wait(1200);
        continue;
      }

      if (mnemonicWords.length > 0 && state.mnemonicInputCount > 0) {
        for (let index = 0; index < Math.min(state.mnemonicInputCount, mnemonicWords.length); index++) {
          await mnemonicInputs.nth(index).fill(mnemonicWords[index]).catch(() => undefined);
        }
        await wait(500);
      }

      if (state.next && (await safeEnabled(nextButton))) {
        await nextButton.click();
        await wait(900);
        continue;
      }

      await wait(1000);
    }

    page = asActiveExtensionPage(context, extensionId) || page;
    depositInput = page.locator('input[placeholder="Amount (ADA)"]');
    await depositInput.waitFor({ timeout: 30_000 });
    await wait(1000);

    const walletAddresses = await page.evaluate(async () => {
      try {
        // Exposed by wallet-api-ui for e2e/debug flows.
        const wallets = await window.firstValueFrom(window.walletRepository.wallets$);
        return wallets
          .flatMap((wallet) => wallet?.metadata?.walletAddresses || [])
          .map((address) => (typeof address === 'string' ? address : address?.toString?.() || String(address)));
      } catch {
        return [];
      }
    });
    let primaryWalletAddress = walletAddresses[0] || '';
    if (!primaryWalletAddress) {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/receive`, { waitUntil: 'domcontentloaded' });
      await wait(1500);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const maybeAddress = bodyText.match(/addr_test1[0-9a-z]+|addr1[0-9a-z]+/i)?.[0];
      if (maybeAddress) primaryWalletAddress = maybeAddress;
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' });
      await wait(600);
    }

    await page.screenshot({ path: `${outputDir}/deposit-flow-01-home.png`, fullPage: true });

    await depositInput.fill('1.2345');
    await wait(500);
    await page.screenshot({ path: `${outputDir}/deposit-flow-02-entered-amount.png`, fullPage: true });

    await depositInput.fill('999999');
    await wait(500);
    await page.screenshot({ path: `${outputDir}/deposit-flow-03-validation.png`, fullPage: true });

    const maxButton = page.getByRole('button', { name: /^Max$/ });
    if ((await safeVisible(maxButton)) && (await safeEnabled(maxButton))) {
      await maxButton.click();
      await wait(500);
      await page.screenshot({ path: `${outputDir}/deposit-flow-04-max.png`, fullPage: true });
    }

    console.log(`extension_id=${extensionId}`);
    console.log(`user_data_dir=${userDataDir}`);
    console.log(`wallet_address=${primaryWalletAddress}`);
    console.log(`mnemonic_file=${mnemonicFile}`);
    console.log(
      `screenshots=${outputDir}/deposit-flow-01-home.png,${outputDir}/deposit-flow-02-entered-amount.png,${outputDir}/deposit-flow-03-validation.png`
    );
  } finally {
    await context.close();
    if (shouldRecordVideo) {
      const resolvedPaths = [];
      for (const video of videoHandles) {
        const videoPath = await video.path().catch(() => '');
        if (videoPath) resolvedPaths.push(videoPath);
      }
      console.log(`videos=${resolvedPaths.join(',')}`);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
