const { chromium } = require('playwright');
const { mkdtemp, mkdir, readFile, writeFile, chmod } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const KeyManagement = require('@cardano-sdk/key-management');
const Crypto = require('@cardano-sdk/crypto');

const extensionPath = '/home/gumbo/midgard-hub/lace/apps/browser-extension-wallet/dist';
const password = 'N_8J@bne87A';
const mnemonicFile = process.env.PW_MNEMONIC_FILE || '/home/gumbo/midgard-hub/output/playwright/playwright-wallet-mnemonic.txt';
const validMnemonicLengths = new Set([12, 15, 24]);

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
};

(async () => {
  const userDataDir = process.env.PW_USER_DATA_DIR || (await mkdtemp(join(tmpdir(), 'lace-pw-addr-')));
  let mnemonicWords = await loadMnemonicWords();
  const hasStoredMnemonic = mnemonicWords.length > 0;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 390, height: 780 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', {
        timeout: 30_000
      }));

    const extensionId = new URL(serviceWorker.url()).host;
    let page = await context.newPage();
    setupPageListeners(page);
    context.on('page', (newPage) => setupPageListeners(newPage));

    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    let ready = false;
    let persistedMnemonicInThisRun = hasStoredMnemonic;

    for (let i = 0; i < 120; i++) {
      page = asActiveExtensionPage(context, extensionId) || page;
      if (!page || page.isClosed()) {
        await wait(400);
        continue;
      }

      const url = page.url();
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
      const mnemonicInputs = page.locator('[data-testid="mnemonic-word-input"]');
      const mnemonicWritedownWords = page.locator('[data-testid="mnemonic-word-writedown"]');

      const state = {
        url,
        createById: await safeVisible(createWalletButton),
        restoreById: await safeVisible(restoreWalletButton),
        createByText: await safeVisible(createButtonByText),
        next: await safeVisible(nextButton),
        copy: await safeVisible(copyButton),
        paste: await safeVisible(pasteButton),
        walletName: await safeVisible(walletNameInput),
        unlock: await safeVisible(unlockButton),
        mnemonicInputCount: await safeCount(mnemonicInputs),
        mnemonicWritedownCount: await safeCount(mnemonicWritedownWords)
      };
      console.log(`step=${i} state=${JSON.stringify(state)}`);

      if (url.includes('/assets') || url.includes('/receive')) {
        ready = true;
        break;
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
      if (mnemonicWords.length > 0 && state.mnemonicInputCount > 0) {
        for (let index = 0; index < Math.min(state.mnemonicInputCount, mnemonicWords.length); index++) {
          await mnemonicInputs.nth(index).fill(mnemonicWords[index]).catch(() => undefined);
        }
        await wait(500);
      }
      if (state.walletName) {
        await walletNameInput.fill('Playwright Wallet');
        if (await safeVisible(walletPasswordInput)) await walletPasswordInput.fill(password);
        if (await safeVisible(walletPasswordConfirmInput)) await walletPasswordConfirmInput.fill(password);
        if (await safeVisible(nextButton) && (await safeEnabled(nextButton))) {
          await nextButton.click();
          await wait(1800);
          continue;
        }
      }
      if (state.unlock) {
        const passwordInput = page.locator('input[type="password"]').first();
        if (await safeVisible(passwordInput)) await passwordInput.fill(password);
        await unlockButton.click();
        await wait(1400);
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
        await wait(1100);
        continue;
      }

      if (state.next && (await safeEnabled(nextButton))) {
        await nextButton.click();
        await wait(900);
        continue;
      }

      await wait(1000);
    }

    if (!ready) throw new Error('Wallet did not become ready');

    page = asActiveExtensionPage(context, extensionId) || page;
    if (!page.url().includes('app.html#/assets')) {
      await page.goto(`chrome-extension://${extensionId}/app.html#/assets`, { waitUntil: 'domcontentloaded' });
      await wait(1500);
    }

    let maybeAddress = await page.evaluate(async () => {
      try {
        const activeWallet = await window.firstValueFrom(window.walletManager.activeWallet$);
        if (activeWallet?.observableWallet?.addresses$) {
          const addresses = await window.firstValueFrom(activeWallet.observableWallet.addresses$);
          const firstAddress = addresses?.[0]?.address;
          if (typeof firstAddress === 'string') return firstAddress;
          if (firstAddress?.toString) return firstAddress.toString();
        }
      } catch {
        // fallback to DOM extraction below
      }

      const directFundingAddress = document.querySelector('[data-testid="info-wallet-full-address"]')?.textContent?.trim();
      if (directFundingAddress && (directFundingAddress.startsWith('addr_test1') || directFundingAddress.startsWith('addr1'))) {
        return directFundingAddress;
      }

      const elements = Array.from(document.querySelectorAll('*'));
      for (const element of elements) {
        for (const key of Object.keys(element)) {
          if (!key.startsWith('__reactFiber$')) continue;
          let fiber = element[key];
          let guard = 0;
          while (fiber && guard < 25) {
            guard += 1;
            const props = fiber.memoizedProps;
            const candidates = [props?.address, props?.walletAddress, props?.copyText, props?.label];
            for (const value of candidates) {
              if (typeof value === 'string' && (value.startsWith('addr_test1') || value.startsWith('addr1'))) {
                return value;
              }
            }
            fiber = fiber.return;
          }
        }
      }

      return '';
    });

    if (!maybeAddress) {
      const receiveButton = page.locator('[data-testid="receive-button"]');
      if (await safeVisible(receiveButton)) {
        await receiveButton.click();
        await wait(1200);
      }

      const addressNode = page.locator('[data-testid="address-card-address"]').first();
      if (await safeVisible(addressNode)) {
        maybeAddress = (await addressNode.innerText()).trim();
      }
    }

    if ((!maybeAddress || maybeAddress.includes('...')) && mnemonicWords.length > 0) {
      const keyAgent = await KeyManagement.InMemoryKeyAgent.fromBip39MnemonicWords(
        {
          chainId: { networkId: 0, networkMagic: 1 },
          getPassphrase: async () => Buffer.from(''),
          mnemonicWords,
          accountIndex: 0
        },
        {
          bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(),
          logger: console
        }
      );
      const derived = await keyAgent.deriveAddress({ index: 0, type: 0 }, 0);
      maybeAddress = derived.address.toString();
    }

    if (!maybeAddress || maybeAddress.includes('...')) {
      const bodyText = await page.locator('body').innerText();
      maybeAddress = bodyText.match(/addr_test1[0-9a-z]+|addr1[0-9a-z]+/i)?.[0] || maybeAddress;
    }

    console.log(`extension_id=${extensionId}`);
    console.log(`user_data_dir=${userDataDir}`);
    console.log(`wallet_address=${maybeAddress}`);
    console.log(`mnemonic_file=${mnemonicFile}`);
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
