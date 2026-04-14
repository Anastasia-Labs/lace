const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { mkdtemp, mkdir, readFile, writeFile, chmod } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { Serialization, Cardano } = require('@cardano-sdk/core');

const extensionPath = '/home/gumbo/midgard-hub/lace/apps/browser-extension-wallet/dist';
const extensionManifestPath = join(extensionPath, 'manifest.json');
const outputDir = '/home/gumbo/midgard-hub/output/playwright';
const mnemonicFile = process.env.PW_MNEMONIC_FILE || `${outputDir}/playwright-wallet-mnemonic.txt`;
const shouldRecordVideo = process.env.PW_RECORD_VIDEO === '1';
const stopAfterLogin = process.env.MIDGARD_DEMO_STOP_AFTER_LOGIN === '1';
const validatePopupScroll = process.env.MIDGARD_VALIDATE_POPUP_SCROLL === '1';
const validateFullscreenLayout = process.env.MIDGARD_VALIDATE_FULLSCREEN_LAYOUT === '1';
const validateDepositLayout = process.env.MIDGARD_VALIDATE_DEPOSIT_LAYOUT === '1';
const validateSendShell = process.env.MIDGARD_VALIDATE_SEND_SHELL === '1';
const validateSendLayout = process.env.MIDGARD_VALIDATE_SEND_LAYOUT === '1';
const validateOnly = process.env.MIDGARD_DEMO_VALIDATE_ONLY === '1';
const withdrawalRequested = process.env.MIDGARD_INCLUDE_WITHDRAWAL === '1';
const skipDeposit = process.env.MIDGARD_SKIP_DEPOSIT === '1';
const midgardBaseUrl = process.env.MIDGARD_DEMO_MIDGARD_URL || 'http://localhost:3000';
const allowMockMidgard = process.env.MIDGARD_USE_MOCK !== '0';
const browserExecutablePath = process.env.PW_CHROME_EXECUTABLE || '';
const password = process.env.PW_WALLET_PASSWORD || 'N_8J@bne87A';
const depositAmountAda = process.env.MIDGARD_DEPOSIT_ADA || '1.2345';
const sendAmountAda = process.env.MIDGARD_SEND_ADA || '0.200000';
const mockInitialLovelace = BigInt(process.env.MIDGARD_MOCK_INITIAL_LOVELACE || '5000000000');
const parseDimension = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const popupViewportDefaults = stopAfterLogin ? { width: 1280, height: 900 } : { width: 1560, height: 1560 };
const popupViewport = {
  width: parseDimension(process.env.PW_VIEWPORT_WIDTH, popupViewportDefaults.width),
  height: parseDimension(process.env.PW_VIEWPORT_HEIGHT, popupViewportDefaults.height)
};
const shouldUseNativeWindowSizing = stopAfterLogin;
const contextViewport = shouldUseNativeWindowSizing ? null : popupViewport;
const remoteDebuggingPortRaw = process.env.PW_REMOTE_DEBUG_PORT || (stopAfterLogin ? '9222' : '');
const remoteDebuggingPort = parseDimension(remoteDebuggingPortRaw, 0);
const validMnemonicLengths = new Set([12, 15, 24]);
let cachedExtensionId;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeVisible = async (locator) => locator.isVisible().catch(() => false);
const safeEnabled = async (locator) => locator.isEnabled().catch(() => false);
const safeCount = async (locator) => locator.count().catch(() => 0);
const trimTrailingSlashes = (value) => String(value || '').replace(/\/+$/, '');
const clickWithFallback = async (locator) => {
  try {
    await locator.click({ timeout: 8000 });
  } catch {
    await locator.click({ force: true, timeout: 8000 }).catch(() => undefined);
    await locator.evaluate((node) => node.click()).catch(() => undefined);
  }
};

const advanceMnemonicVerificationStep = async ({ page, mnemonicWordCount }) => {
  const nextButton = page.locator('[data-testid="wallet-setup-step-btn-next"]');
  const mnemonicInputs = page.locator('[data-testid="mnemonic-word-input"]');
  const inputCount = await safeCount(mnemonicInputs);

  if (inputCount > 0) {
    const lastIndex = Math.max(0, Math.min(inputCount, mnemonicWordCount || inputCount) - 1);
    const lastInput = mnemonicInputs.nth(lastIndex);
    await lastInput.press('Tab').catch(() => undefined);
    await wait(150);
    await page.locator('[data-testid="wallet-setup-step-content"]').click({ position: { x: 8, y: 8 } }).catch(() => undefined);
    await wait(150);
  }

  await page
    .waitForFunction(() => {
      const next = document.querySelector('[data-testid="wallet-setup-step-btn-next"]');
      return !!next && !next.hasAttribute('disabled');
    }, { timeout: 8000 })
    .catch(() => undefined);

  if (await safeVisible(nextButton) && (await safeEnabled(nextButton))) {
    await clickWithFallback(nextButton);
    await wait(900);
    return true;
  }

  return false;
};

const installFetchProbe = async (page) => {
  await page
    .evaluate(() => {
      if (window.__midgardFetchProbeInstalled) return;
      window.__midgardFetchProbeInstalled = true;
      window.__midgardDemoFetches = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        window.__midgardDemoFetches.push(String(requestUrl || ''));
        return originalFetch(...args);
      };
    })
    .catch(() => undefined);
};

const readFetchProbe = async (page) =>
  await page
    .evaluate(() => ({
      fetchCount: Array.isArray(window.__midgardDemoFetches) ? window.__midgardDemoFetches.length : 0,
      fetches: Array.isArray(window.__midgardDemoFetches) ? window.__midgardDemoFetches.slice(-20) : [],
      midgardUrlOverride: window.localStorage.getItem('midgardUrlOverride') || '',
      appSettings: window.localStorage.getItem('appSettings') || ''
    }))
    .catch(() => ({ fetchCount: 0, fetches: [], midgardUrlOverride: '', appSettings: '' }));

const asActiveExtensionPage = (context, extensionId) => {
  const prefix = `chrome-extension://${extensionId}/`;
  const candidates = context.pages().filter((candidate) => !candidate.isClosed() && candidate.url().startsWith(prefix));
  return candidates[candidates.length - 1];
};

const computeExtensionIdFromManifest = async () => {
  if (cachedExtensionId) {
    return cachedExtensionId;
  }

  const manifest = JSON.parse(await readFile(extensionManifestPath, 'utf8'));
  if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
    throw new Error(`Extension manifest at ${extensionManifestPath} is missing a public key`);
  }

  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  cachedExtensionId = digest.replace(/[0-9a-f]/g, (char) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(char, 16)));
  return cachedExtensionId;
};

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

const toBaseUrl = (value) => {
  const parsed = new URL(value);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  return {
    host: parsed.hostname,
    port,
    origin: `${parsed.protocol}//${parsed.host}`,
    protocol: parsed.protocol
  };
};

const isMidgardSubmitRequest = (requestUrl, baseUrl) => {
  try {
    const request = new URL(requestUrl);
    const expectedBase = new URL(trimTrailingSlashes(baseUrl));
    return (
      request.origin === expectedBase.origin &&
      request.pathname.replace(/\/+$/, '') === `${expectedBase.pathname.replace(/\/+$/, '')}/submit`
    );
  } catch {
    return false;
  }
};

const makeMockTxId = (seed) => createHash('sha256').update(seed).digest('hex');

const createMockUtxoForAddress = (address) => {
  const txId = makeMockTxId(`midgard-demo:${address}`);
  const txInput = Serialization.TransactionInput.fromCore({
    txId: Cardano.TransactionId(txId),
    index: 0
  });
  const txOutput = Serialization.TransactionOutput.fromCore({
    address: Cardano.PaymentAddress(address),
    value: { coins: mockInitialLovelace }
  });
  return {
    outref: txInput.toCbor(),
    value: txOutput.toCbor()
  };
};

const readJsonBody = async (req) =>
  await new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });

const writeJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json();
};

const getMidgardUtxos = async (baseUrl, address) => {
  const normalized = baseUrl.replace(/\/+$/, '');
  const payload = await getJson(`${normalized}/utxos?address=${encodeURIComponent(address)}`);
  return Array.isArray(payload?.utxos) ? payload.utxos : [];
};

const waitForMidgardProjection = async ({ baseUrl, address, previousCount, timeoutMs = 240_000 }) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const utxos = await getMidgardUtxos(baseUrl, address);
    if (utxos.length > previousCount) return utxos;
    await wait(3_000);
  }
  return await getMidgardUtxos(baseUrl, address);
};

const readPortfolioBalance = async (page) => {
  const balanceValue = await page.locator('[data-testid="portfolio-balance-value"]').innerText().catch(() => '');
  const balanceCurrency = await page.locator('[data-testid="portfolio-balance-currency"]').innerText().catch(() => '');
  return `${balanceValue} ${balanceCurrency}`.trim();
};

const startMockMidgardServer = async (baseUrl) => {
  const target = toBaseUrl(baseUrl);
  if (target.protocol !== 'http:') {
    throw new Error(`Mock Midgard server only supports http URLs. Received: ${baseUrl}`);
  }

  const server = createServer(async (req, res) => {
    const parsed = new URL(req.url || '/', target.origin);
    const normalizedPath = parsed.pathname.replace(/\/{2,}/g, '/');
    const method = req.method || 'GET';
    console.log(`midgard_mock_request=${method} ${normalizedPath}`);

    if (method === 'GET' && normalizedPath === '/healthz') {
      writeJson(res, 200, { status: 'ok', mock: true, now: new Date().toISOString() });
      return;
    }

    if (method === 'GET' && normalizedPath === '/utxos') {
      const address = parsed.searchParams.get('address') || '';
      if (!address) {
        writeJson(res, 400, { error: 'Missing address query parameter' });
        return;
      }
      try {
        const utxo = createMockUtxoForAddress(address);
        writeJson(res, 200, { utxos: [utxo] });
      } catch (error) {
        writeJson(res, 422, { error: `Invalid address: ${String(error)}` });
      }
      return;
    }

    if (method === 'GET' && normalizedPath === '/txs') {
      writeJson(res, 200, { txs: [] });
      return;
    }

    if (method === 'POST' && normalizedPath === '/deposit/build') {
      writeJson(res, 200, { unsignedTxCbor: 'deadbeef' });
      return;
    }

    if (method === 'POST' && normalizedPath === '/withdrawal') {
      const body = await readJsonBody(req);
      const suffix = makeMockTxId(`withdrawal:${Date.now()}:${body?.refund_address || 'unknown'}`).slice(0, 64);
      writeJson(res, 200, { txHash: suffix });
      return;
    }

    if (method === 'POST' && normalizedPath === '/submit') {
      const body = await readJsonBody(req);
      const txCbor = typeof body?.tx_cbor === 'string' ? body.tx_cbor : '';
      const suffix = makeMockTxId(`submit:${Date.now()}:${txCbor.slice(0, 24)}`).slice(0, 64);
      writeJson(res, 200, { txId: suffix, status: 'queued' });
      return;
    }

    writeJson(res, 404, { error: `No mock handler for ${method} ${normalizedPath}` });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(target.port, target.host, () => resolve(undefined));
  });

  return { server, baseUrl: target.origin };
};

const isMidgardHealthy = async (baseUrl) => {
  const normalized = baseUrl.replace(/\/+$/, '');
  try {
    const response = await fetch(`${normalized}/healthz`);
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({}));
    return body?.status === 'ok' || body?.ok === true;
  } catch {
    return false;
  }
};

const ensurePreprod = async (page) => {
  await page
    .evaluate(async (runtimeMidgardUrl) => {
      window.localStorage.setItem('midgardUrlOverride', runtimeMidgardUrl);

      if (window.chrome?.storage?.local?.set) {
        await new Promise((resolve) => {
          window.chrome.storage.local.set({ midgardUrlOverride: runtimeMidgardUrl }, () => resolve(undefined));
        });
      }
    }, midgardBaseUrl)
    .catch(() => undefined);

  const switched = await page
    .evaluate((runtimeMidgardUrl) => {
      const currentRaw = window.localStorage.getItem('appSettings');
      const current = currentRaw ? JSON.parse(currentRaw) : {};
      window.localStorage.setItem('midgardUrlOverride', runtimeMidgardUrl);

      if (window.chrome?.storage?.local?.set) {
        window.chrome.storage.local.set({ midgardUrlOverride: runtimeMidgardUrl });
      }

      if (current.chainName === 'Preprod') return false;
      window.localStorage.setItem('appSettings', JSON.stringify({ ...current, chainName: 'Preprod' }));
      window.location.reload();
      return true;
    }, midgardBaseUrl)
    .catch(() => false);

  if (switched) await wait(2500);
};

const waitForMidgardToggleIdle = async (page, timeoutMs = 45_000) => {
  await page.waitForFunction(
    () => {
      const toggle = document.querySelector('[data-testid="midgard-mode-toggle"]');
      return !!toggle && toggle.getAttribute('aria-busy') !== 'true';
    },
    { timeout: timeoutMs }
  );
};

const readMidgardModeState = async (page) => {
  const state = await page
    .evaluate(() => {
      const switchNode = document.querySelector('[data-testid="midgard-mode-switch"]');
      if (!switchNode) return null;

      const candidate =
        switchNode.matches('.ant-switch') || switchNode.getAttribute('role') === 'switch'
          ? switchNode
          : switchNode.closest('.ant-switch') || switchNode.querySelector('.ant-switch');

      if (!candidate) return null;

      const ariaChecked = candidate.getAttribute('aria-checked');
      if (ariaChecked === 'true') return true;
      if (ariaChecked === 'false') return false;

      return candidate.classList.contains('ant-switch-checked');
    })
    .catch(() => null);

  if (typeof state !== 'boolean') {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Could not determine Midgard toggle state. Body snippet: ${summarizeBodyText(bodyText)}`);
  }

  return state;
};

const setMidgardModeOnAssetsPage = async (page, enabled) => {
  const toggle = page.locator('[data-testid="midgard-mode-toggle"]');
  await toggle.waitFor({ timeout: 30_000 });
  await waitForMidgardToggleIdle(page);

  const initialState = await readMidgardModeState(page);
  if (initialState === enabled) {
    return;
  }

  await clickWithFallback(toggle);
  await waitForMidgardToggleIdle(page);

  const finalState = await readMidgardModeState(page);
  if (finalState !== enabled) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Midgard toggle did not reach expected state=${enabled}. initial=${initialState} final=${finalState}. Body snippet: ${summarizeBodyText(
        bodyText
      )}`
    );
  }
};

const waitForBodyTextOutcome = async (page, checks, timeoutMs) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const match = checks.find(({ pattern }) => pattern.test(bodyText));
    if (match) return { key: match.key, bodyText };
    await wait(350);
  }
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return { key: null, bodyText };
};

const summarizeBodyText = (bodyText) =>
  String(bodyText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);

const waitForWalletReady = async ({ context, extensionId, mnemonicWords }) => {
  let page = await context.newPage();
  setupPageListeners(page);
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;

  let navigationError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
      navigationError = undefined;
      break;
    } catch (error) {
      navigationError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ERR_BLOCKED_BY_CLIENT')) {
        throw error;
      }
      await wait(1000);
    }
  }

  if (navigationError) {
    throw navigationError;
  }

  let persistedMnemonicInThisRun = mnemonicWords.length > 0;
  let ready = false;

  for (let i = 0; i < 140; i++) {
    page = asActiveExtensionPage(context, extensionId) || page;
    if (!page || page.isClosed()) {
      await wait(500);
      continue;
    }

    const state = {
      url: page.url(),
      createById: await safeVisible(page.locator('[data-testid="create-wallet-button"]')),
      restoreById: await safeVisible(page.locator('[data-testid="restore-wallet-button"]')),
      createByText: await safeVisible(page.getByRole('button', { name: /^Create$/ })),
      next: await safeVisible(page.locator('[data-testid="wallet-setup-step-btn-next"]')),
      copy: await safeVisible(page.locator('[data-testid="copy-to-clipboard-button"]')),
      paste: await safeVisible(page.locator('[data-testid="paste-from-clipboard-button"]')),
      walletName: await safeVisible(page.locator('[data-testid="wallet-name-input"]')),
      unlock: await safeVisible(page.locator('[data-testid="unlock-button"]')),
      sendCta: await safeVisible(page.locator('[data-testid="send-button"]'))
    };

    if (state.url.includes('/assets') && state.sendCta) {
      ready = true;
      break;
    }

    if (mnemonicWords.length > 0 && state.restoreById) {
      await page.locator('[data-testid="restore-wallet-button"]').click();
      await wait(1000);
      continue;
    }

    if (state.createById) {
      await page.locator('[data-testid="create-wallet-button"]').click();
      await wait(900);
      continue;
    }

    if (state.createByText) {
      await clickWithFallback(page.getByRole('button', { name: /^Create$/ }));
      await wait(1000);
      continue;
    }

    if (state.copy) {
      const mnemonicWritedownWords = page.locator('[data-testid="mnemonic-word-writedown"]');
      if (!persistedMnemonicInThisRun && (await safeCount(mnemonicWritedownWords)) > 0) {
        const rawWords = await mnemonicWritedownWords.allInnerTexts();
        const capturedWords = rawWords.map((rawWord) => rawWord.trim().split(/\s+/).pop()).filter(Boolean);
        if (validMnemonicLengths.has(capturedWords.length)) {
          mnemonicWords = capturedWords;
          persistedMnemonicInThisRun = await saveMnemonicWords(mnemonicWords);
          console.log(`captured_mnemonic_words=${mnemonicWords.length}`);
          console.log(`mnemonic_saved=${persistedMnemonicInThisRun}`);
        }
      }
      await page.locator('[data-testid="copy-to-clipboard-button"]').click().catch(() => undefined);
      await wait(500);
    }

    if (state.paste) {
      const mnemonicInputs = page.locator('[data-testid="mnemonic-word-input"]');
      const mnemonicInputCount = await safeCount(mnemonicInputs);
      if (mnemonicWords.length > 0 && mnemonicInputCount > 0) {
        for (let index = 0; index < Math.min(mnemonicInputCount, mnemonicWords.length); index++) {
          await mnemonicInputs.nth(index).fill(mnemonicWords[index]).catch(() => undefined);
        }
        const advanced = await advanceMnemonicVerificationStep({
          page,
          mnemonicWordCount: Math.min(mnemonicInputCount, mnemonicWords.length)
        });
        if (advanced) {
          continue;
        }
      } else {
        await page.locator('[data-testid="paste-from-clipboard-button"]').click().catch(() => undefined);
        const advanced = await advanceMnemonicVerificationStep({
          page,
          mnemonicWordCount: mnemonicWords.length || mnemonicInputCount
        });
        if (advanced) {
          continue;
        }
      }
      await wait(650);
    }

    if (state.walletName) {
      await page.locator('[data-testid="wallet-name-input"]').fill('Playwright Wallet');
      const passwordInput = page.locator('[data-testid="wallet-password-verification-input"]');
      const confirmInput = page.locator('[data-testid="wallet-password-confirmation-input"]');
      if (await safeVisible(passwordInput)) await passwordInput.fill(password);
      if (await safeVisible(confirmInput)) await confirmInput.fill(password);
      const nextButton = page.locator('[data-testid="wallet-setup-step-btn-next"]');
      if (await safeVisible(nextButton)) {
        await clickWithFallback(nextButton);
        await wait(2000);
      }
      continue;
    }

    if (state.unlock) {
      const passwordInput = page.locator('input[type="password"]').first();
      if (await safeVisible(passwordInput)) await passwordInput.fill(password);
      await clickWithFallback(page.locator('[data-testid="unlock-button"]'));
      await wait(1500);
      continue;
    }

    const gotItButton = page.getByRole('button', { name: /^Got it$/i });
    if (await safeVisible(gotItButton)) {
      await clickWithFallback(gotItButton);
      await wait(700);
      continue;
    }

    const analyticsRejectButton = page.getByRole('button', { name: /^Reject$/i });
    if (await safeVisible(analyticsRejectButton)) {
      await clickWithFallback(analyticsRejectButton);
      await wait(700);
      continue;
    }

    const enterWalletButton = page.getByRole('button', { name: /Enter wallet/i });
    if (await safeVisible(enterWalletButton)) {
      await clickWithFallback(enterWalletButton);
      await wait(1200);
      continue;
    }

    const nextButton = page.locator('[data-testid="wallet-setup-step-btn-next"]');
    if (await safeVisible(nextButton) && (await safeEnabled(nextButton))) {
      await clickWithFallback(nextButton);
      await wait(900);
      continue;
    }

    await wait(900);
  }

  page = asActiveExtensionPage(context, extensionId) || page;
  if (!ready) {
    await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await wait(1300);
  }

  return { page, mnemonicWords };
};

const getPrimaryWalletAddress = async ({ page, extensionId }) => {
  const currentUrl = page.url();
  const appSurface = currentUrl.includes('/app.html') ? 'app.html' : 'popup.html';
  const route = (hash) => `chrome-extension://${extensionId}/${appSurface}${hash}`;
  let primaryWalletAddress = await page.evaluate(async () => {
    try {
      const wallets = await window.firstValueFrom(window.walletRepository.wallets$);
      const walletAddresses = wallets
        .flatMap((wallet) => wallet?.metadata?.walletAddresses || [])
        .map((address) => (typeof address === 'string' ? address : address?.toString?.() || String(address)));
      return walletAddresses[0] || '';
    } catch {
      return '';
    }
  });

  if (!primaryWalletAddress) {
    await page.goto(route('#/receive'), { waitUntil: 'domcontentloaded' });
    await wait(1400);
    primaryWalletAddress = await page.locator('[data-testid="info-wallet-full-address"]').first().innerText().catch(() => '');
    if (!primaryWalletAddress) {
      await page.waitForSelector('[data-testid="info-wallet-full-address"]', { timeout: 10_000 }).catch(() => undefined);
      primaryWalletAddress = await page
        .locator('[data-testid="info-wallet-full-address"]')
        .first()
        .innerText()
        .catch(() => '');
    }
    const bodyText = await page.locator('body').innerText().catch(() => '');
    primaryWalletAddress = primaryWalletAddress || bodyText.match(/addr_test1[0-9a-z]+|addr1[0-9a-z]+/i)?.[0] || '';
    await page.goto(route('#/assets'), { waitUntil: 'domcontentloaded' });
    await wait(900);
  }

  if (!primaryWalletAddress) {
    throw new Error('Could not determine wallet address');
  }

  return primaryWalletAddress;
};

const ensureMidgardEnabledAndOpenDeposit = async (page) => {
  await ensurePreprod(page);
  await page.waitForSelector('[data-testid="midgard-mode-toggle"]', { timeout: 30_000 });

  await setMidgardModeOnAssetsPage(page, true);

  const depositInput = page.locator('[data-testid="midgard-deposit-amount-input"]');
  if (!(await safeVisible(depositInput))) {
    const depositButton = page.locator('[data-testid="midgard-deposit-action-button"]');
    await clickWithFallback(depositButton);
    await depositInput.waitFor({ timeout: 30_000 });
    await wait(600);
  }
};

const runDepositFlow = async ({ page, primaryWalletAddress, artifacts, projectionExpected }) => {
  await ensureMidgardEnabledAndOpenDeposit(page);
  await installFetchProbe(page);
  const midgardUtxosBefore = await getMidgardUtxos(midgardBaseUrl, primaryWalletAddress);

  const depositInput = page.locator('[data-testid="midgard-deposit-amount-input"]');
  await depositInput.fill(depositAmountAda);
  const passwordInput = page.locator('[data-testid="midgard-deposit-password-input"]');
  if (await safeVisible(passwordInput)) {
    await passwordInput.fill(password);
    await wait(200);
  }
  await wait(400);
  const beforePath = `${outputDir}/midgard-demo-01-deposit-ready.png`;
  await page.screenshot({ path: beforePath, fullPage: true });
  artifacts.push(beforePath);

  const confirmDepositButton = page.locator('[data-testid="midgard-deposit-confirm-button"]');
  if (!(await safeEnabled(confirmDepositButton))) {
    throw new Error('Deposit confirm button is disabled after amount entry');
  }

  await clickWithFallback(confirmDepositButton);
  await wait(700);

  const pendingPath = `${outputDir}/midgard-demo-02-deposit-submitting.png`;
  await page.screenshot({ path: pendingPath, fullPage: true });
  artifacts.push(pendingPath);

  const depositOutcome = await waitForBodyTextOutcome(
    page,
    [
      { key: 'success', pattern: /Deposit submitted on Cardano/i },
      { key: 'failure', pattern: /Deposit failed/i }
    ],
    120_000
  );

  if (depositOutcome.key !== 'success') {
    const debug = await readFetchProbe(page);
    throw new Error(
      `Deposit did not succeed. Body snippet: ${summarizeBodyText(depositOutcome.bodyText)}; fetches=${JSON.stringify(
        debug.fetches
      )}; midgardUrlOverride=${debug.midgardUrlOverride}; appSettings=${debug.appSettings}`
    );
  }

  if (projectionExpected) {
    const projectedUtxos = await waitForMidgardProjection({
      baseUrl: midgardBaseUrl,
      address: primaryWalletAddress,
      previousCount: midgardUtxosBefore.length
    });
    const projectionSeen = projectedUtxos.length > midgardUtxosBefore.length;
    console.log(`midgard_projection_status=${projectionSeen ? 'observed' : 'missing'}`);
    console.log(`midgard_utxos_before=${midgardUtxosBefore.length}`);
    console.log(`midgard_utxos_after=${projectedUtxos.length}`);

    if (!projectionSeen) {
      throw new Error(
        `Midgard deposit did not project new UTxOs within the timeout. before=${midgardUtxosBefore.length} after=${projectedUtxos.length}`
      );
    }
  } else {
    console.log('midgard_projection_status=skipped_mock_backend');
    console.log(`midgard_utxos_before=${midgardUtxosBefore.length}`);
    console.log('midgard_projection_note=mock_backend_does_not_observe_l1_deposit_projection');
  }

  await page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await wait(4_000);
  const refreshedBalance = await readPortfolioBalance(page);
  console.log(`midgard_balance_after_refresh=${refreshedBalance}`);

  await wait(800);
  const afterPath = `${outputDir}/midgard-demo-03-deposit-success.png`;
  await page.screenshot({ path: afterPath, fullPage: true });
  artifacts.push(afterPath);
};

const runSendToSelfFlow = async ({ page, primaryWalletAddress, context, extensionId, artifacts }) => {
  page = asActiveExtensionPage(context, extensionId) || page;
  await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' });
  await wait(1000);
  await installFetchProbe(page);
  await waitForMidgardToggleIdle(page);
  const modeBeforeSend = await readMidgardModeState(page);
  if (!modeBeforeSend) {
    throw new Error('Send-to-self flow requires Midgard mode to be enabled before opening the send drawer');
  }
  const fetchProbeBeforeSend = await readFetchProbe(page);

  const sendButton = page.locator('[data-testid="send-button"]');
  const roleSendButton = page.getByRole('button', { name: /^Send$/i });
  const ctasContainer = page.locator('[data-testid="transaction-ctas-container"]');

  await ctasContainer.waitFor({ timeout: 20_000 }).catch(() => undefined);

  if (await safeVisible(sendButton)) {
    await clickWithFallback(sendButton);
  } else if (await safeVisible(roleSendButton)) {
    await clickWithFallback(roleSendButton);
  } else {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.warn(`midgard_send_cta_missing body=${summarizeBodyText(bodyText)}`);
    await page.goto(`chrome-extension://${extensionId}/popup.html#/send/1`, { waitUntil: 'domcontentloaded' });
    await wait(1200);
  }

  const addressInput = page.locator('[data-testid="address-input"] input').first();
  await addressInput.waitFor({ timeout: 30_000 });
  await addressInput.fill(primaryWalletAddress);
  await wait(350);

  const amountInput = page.locator('[data-testid="coin-configure-input"]').first();
  await amountInput.waitFor({ timeout: 30_000 });
  await amountInput.fill(sendAmountAda);
  await wait(350);

  const formPath = `${outputDir}/midgard-demo-04-send-form.png`;
  await page.screenshot({ path: formPath, fullPage: true });
  artifacts.push(formPath);

  let isSuccess = false;
  for (let i = 0; i < 14; i++) {
    const successContainer = page.locator('[data-testid="transaction-success-container"]');
    if (await safeVisible(successContainer)) {
      isSuccess = true;
      break;
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/transaction successful|you can safely close this panel|this may take a few minutes/i.test(bodyText)) {
      isSuccess = true;
      break;
    }

    const passwordInput = page.locator('input[type="password"]').first();
    if (await safeVisible(passwordInput)) {
      await passwordInput.fill(password);
      await wait(200);
    }

    const nextButton = page.locator('[data-testid="send-next-btn"]');
    if ((await safeVisible(nextButton)) && (await safeEnabled(nextButton))) {
      await clickWithFallback(nextButton);
      await wait(1300);
      continue;
    }

    const closeOverlay = page.locator('[aria-label="Close"], [data-testid="modal-close-button"]').first();
    if (await safeVisible(closeOverlay)) {
      await closeOverlay.click().catch(() => undefined);
      await wait(400);
      continue;
    }

    await wait(700);
  }

  if (!isSuccess) {
    const debugPath = `${outputDir}/midgard-demo-send-failure.png`;
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => undefined);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Send-to-self flow did not reach success state. Body snippet: ${summarizeBodyText(bodyText)}`);
  }

  const successPath = `${outputDir}/midgard-demo-05-send-success.png`;
  await page.screenshot({ path: successPath, fullPage: true });
  artifacts.push(successPath);

  const sendDebug = await readFetchProbe(page);
  const midgardSubmitObserved = sendDebug.fetches.some((requestUrl) => isMidgardSubmitRequest(requestUrl, midgardBaseUrl));
  if (!midgardSubmitObserved || sendDebug.fetchCount <= fetchProbeBeforeSend.fetchCount) {
    throw new Error(
      `Send-to-self flow reached success UI without a verified Midgard submit request. fetchCountBefore=${fetchProbeBeforeSend.fetchCount} fetchCountAfter=${sendDebug.fetchCount} fetches=${JSON.stringify(
        sendDebug.fetches
      )}`
    );
  }

  console.log('midgard_send_success=true');
  console.log(`midgard_send_submit_observed=${midgardSubmitObserved}`);

  const closeButton = page.locator('[data-testid="send-cancel-btn"]');
  if (await safeVisible(closeButton)) {
    await closeButton.click().catch(() => undefined);
    await wait(900);
  }

  await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await waitForMidgardToggleIdle(page);
  const modeAfterSend = await readMidgardModeState(page);
  if (!modeAfterSend) {
    throw new Error('Midgard mode was no longer enabled after the send-to-self flow completed');
  }
  console.log('midgard_mode_after_send=enabled');
};

const verifyPopupMidgardScroll = async ({ page, artifacts }) => {
  await page.waitForSelector('[data-testid="header-container"]', { timeout: 20_000 });
  await page.waitForTimeout(1200);

  const beforePath = `${outputDir}/midgard-popup-scroll-before.png`;
  await page.screenshot({ path: beforePath, fullPage: true });
  artifacts.push(beforePath);

  const metrics = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="header-container"]');
    const midgardToggle = document.querySelector('[data-testid="midgard-mode-toggle"]');
    const findTokensNode = () =>
      Array.from(document.querySelectorAll('h1, h2, h3, h4, div, span, p')).find((node) =>
        /^tokens\b/i.test((node.textContent || '').trim())
      );
    const tokensNode = findTokensNode();

    const isScrollable = (node) => {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      return (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight - node.clientHeight > 8;
    };

    const scrollableElements = [document.documentElement, document.body, ...Array.from(document.querySelectorAll('*'))].filter(
      (node) => node instanceof HTMLElement && isScrollable(node)
    );

    const scored = scrollableElements
      .map((node) => ({
        node,
        containsHeader: !!(header && node.contains(header)),
        clientHeight: node.clientHeight,
        score: (header && node.contains(header) ? 1_000_000 : 0) + node.clientHeight
      }))
      .sort((left, right) => right.score - left.score);

    const target = scored[0]?.node || null;

    const getTop = (node) => {
      if (!node || !(node instanceof HTMLElement)) return null;
      return Math.round(node.getBoundingClientRect().top);
    };

    const before = {
      containsHeader: !!(target && header && target.contains(header)),
      targetTag: target ? target.tagName : null,
      targetClass: target ? target.className : null,
      scrollTop: target ? target.scrollTop : null,
      scrollHeight: target ? target.scrollHeight : null,
      clientHeight: target ? target.clientHeight : null,
      headerTop: getTop(header),
      midgardTop: getTop(midgardToggle),
      tokensTop: getTop(tokensNode)
    };

    if (target) {
      target.scrollTop = Math.max(target.scrollTop, Math.min(target.scrollHeight, target.clientHeight));
      target.scrollTop = Math.min(target.scrollHeight, target.scrollTop + Math.max(250, Math.floor(target.clientHeight * 0.7)));
    }

    const after = {
      scrollTop: target ? target.scrollTop : null,
      headerTop: getTop(header),
      midgardTop: getTop(midgardToggle),
      tokensTop: getTop(tokensNode)
    };

    return { before, after };
  });

  await page.waitForTimeout(450);
  const afterPath = `${outputDir}/midgard-popup-scroll-after.png`;
  await page.screenshot({ path: afterPath, fullPage: true });
  artifacts.push(afterPath);

  const headerMovedUp =
    typeof metrics.before.headerTop === 'number' &&
    typeof metrics.after.headerTop === 'number' &&
    metrics.after.headerTop < metrics.before.headerTop - 12;

  const midgardMovedUp =
    typeof metrics.before.midgardTop === 'number' &&
    typeof metrics.after.midgardTop === 'number' &&
    metrics.after.midgardTop < metrics.before.midgardTop - 40;

  const contentMovedDown =
    typeof metrics.before.tokensTop === 'number' &&
    typeof metrics.after.tokensTop === 'number' &&
    metrics.after.tokensTop < metrics.before.tokensTop - 12;

  const didScroll =
    typeof metrics.before.scrollTop === 'number' &&
    typeof metrics.after.scrollTop === 'number' &&
    metrics.after.scrollTop > metrics.before.scrollTop + 12;

  if (!(metrics.before.containsHeader && didScroll && headerMovedUp && midgardMovedUp && contentMovedDown)) {
    throw new Error(`Popup scroll validation failed: ${JSON.stringify(metrics)}`);
  }

  console.log(`popup_scroll_validation=passed`);
  console.log(`popup_scroll_metrics=${JSON.stringify(metrics)}`);
};

const findExpandedAppPage = ({ context, extensionId }) => {
  const prefix = `chrome-extension://${extensionId}/app.html`;
  return context.pages().find((candidate) => !candidate.isClosed() && candidate.url().startsWith(prefix));
};

const findPopupPage = ({ context, extensionId }) => {
  const prefix = `chrome-extension://${extensionId}/popup.html`;
  return context.pages().find((candidate) => !candidate.isClosed() && candidate.url().startsWith(prefix));
};

const openExpandedAssetsPage = async ({ page, context, extensionId }) => {
  let popupPage = page && !page.isClosed() ? page : null;

  if (!popupPage || !popupPage.url().includes('/popup.html')) {
    popupPage = findPopupPage({ context, extensionId }) || null;
  }

  if (!popupPage) {
    popupPage = await context.newPage();
    setupPageListeners(popupPage);
  }

  if (!popupPage.url().includes('/popup.html#/assets')) {
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' });
  }

  await popupPage.waitForSelector('[data-testid="expand-button"]', { timeout: 20_000 });
  await clickWithFallback(popupPage.locator('[data-testid="expand-button"]'));

  let expandedPage = null;
  for (let index = 0; index < 40; index++) {
    expandedPage = findExpandedAppPage({ context, extensionId });
    if (expandedPage) break;
    await wait(250);
  }

  if (!expandedPage) {
    throw new Error('Fullscreen validation failed: expanded app view did not open.');
  }

  setupPageListeners(expandedPage);
  await expandedPage.bringToFront().catch(() => undefined);
  await expandedPage.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
  await expandedPage.waitForSelector('#main', { timeout: 20_000 });
  await expandedPage.waitForTimeout(1200);
  return expandedPage;
};

const verifyFullscreenLayoutScales = async ({ page, context, extensionId, artifacts }) => {
  const expandedPage = await openExpandedAssetsPage({ page, context, extensionId });

  const measureLayout = async () =>
    await expandedPage.evaluate(() => {
      const main = document.querySelector('#main');
      const rect = main?.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        mainWidth: rect ? Math.round(rect.width) : null
      };
    });

  await expandedPage.setViewportSize({ width: 1400, height: 900 });
  await expandedPage.waitForTimeout(600);
  const narrowMetrics = await measureLayout();

  const narrowPath = `${outputDir}/midgard-fullscreen-layout-1400.png`;
  await expandedPage.screenshot({ path: narrowPath, fullPage: true });
  artifacts.push(narrowPath);

  await expandedPage.setViewportSize({ width: 1900, height: 900 });
  await expandedPage.waitForTimeout(600);
  const wideMetrics = await measureLayout();

  const widePath = `${outputDir}/midgard-fullscreen-layout-1900.png`;
  await expandedPage.screenshot({ path: widePath, fullPage: true });
  artifacts.push(widePath);

  const widthGrowth =
    typeof narrowMetrics.mainWidth === 'number' && typeof wideMetrics.mainWidth === 'number'
      ? wideMetrics.mainWidth - narrowMetrics.mainWidth
      : null;

  const wideGap =
    typeof wideMetrics.mainWidth === 'number' && typeof wideMetrics.innerWidth === 'number'
      ? wideMetrics.innerWidth - wideMetrics.mainWidth
      : null;

  if (typeof widthGrowth !== 'number' || widthGrowth < 350 || typeof wideGap !== 'number' || wideGap > 180) {
    throw new Error(
      `Fullscreen layout validation failed: narrow=${JSON.stringify(narrowMetrics)}, wide=${JSON.stringify(
        wideMetrics
      )}, widthGrowth=${widthGrowth}, wideGap=${wideGap}`
    );
  }

  console.log('fullscreen_layout_validation=passed');
  console.log(
    `fullscreen_layout_metrics=${JSON.stringify({
      narrow: narrowMetrics,
      wide: wideMetrics,
      widthGrowth,
      wideGap
    })}`
  );
};

const verifyDepositDrawerMatchesShell = async ({ page, context, extensionId, artifacts }) => {
  page = asActiveExtensionPage(context, extensionId) || page;
  await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await wait(1000);
  await ensureMidgardEnabledAndOpenDeposit(page);

  const depositDrawer = page.locator('[data-testid="midgard-deposit-drawer"]');
  const confirmButton = page.locator('[data-testid="midgard-deposit-confirm-button"]');
  const cancelButton = page.locator('[data-testid="midgard-deposit-cancel-button"]');
  await depositDrawer.waitFor({ timeout: 30_000 });
  await confirmButton.waitFor({ timeout: 30_000 });
  await wait(800);

  const metrics = await page.evaluate(() => {
    const drawer = document.querySelector('[data-testid="midgard-deposit-drawer"]');
    const footer = document.querySelector('[data-testid="drawer-footer"]');
    const confirm = document.querySelector('[data-testid="midgard-deposit-confirm-button"]');
    const cancel = document.querySelector('[data-testid="midgard-deposit-cancel-button"]');
    const drawerRect = drawer?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    const confirmRect = confirm?.getBoundingClientRect();
    const cancelRect = cancel?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      drawerRect: drawerRect ? { width: drawerRect.width, height: drawerRect.height } : null,
      footerRect: footerRect ? { top: footerRect.top, bottom: footerRect.bottom } : null,
      confirmRect: confirmRect ? { top: confirmRect.top, bottom: confirmRect.bottom } : null,
      cancelRect: cancelRect ? { top: cancelRect.top, bottom: cancelRect.bottom } : null,
      title: document.querySelector('[data-testid="drawer-header-title"]')?.textContent?.trim() || ''
    };
  });

  const screenshotPath = `${outputDir}/midgard-deposit-layout.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  artifacts.push(screenshotPath);

  const confirmVisible = await safeVisible(confirmButton);
  const cancelVisible = await safeVisible(cancelButton);
  const footerWithinViewport =
    typeof metrics.footerRect?.bottom === 'number' && typeof metrics.viewport?.height === 'number'
      ? metrics.footerRect.bottom <= metrics.viewport.height + 2
      : false;

  if (!(confirmVisible && cancelVisible && footerWithinViewport)) {
    throw new Error(`Deposit drawer validation failed: ${JSON.stringify(metrics)}`);
  }

  await clickWithFallback(cancelButton);
  await wait(700);

  console.log('deposit_layout_validation=passed');
  console.log(`deposit_layout_metrics=${JSON.stringify(metrics)}`);
};

const verifySendDrawerShellMatchesPopup = async ({ page, context, extensionId, artifacts }) => {
  page = asActiveExtensionPage(context, extensionId) || page;
  const primaryWalletAddress = await getPrimaryWalletAddress({ page, extensionId });

  const collectMetrics = async () =>
    await page.evaluate(() => {
      const drawer = document.querySelector('[data-testid="custom-drawer"]');
      const footer = document.querySelector('[data-testid="drawer-footer"]');
      const next = document.querySelector('[data-testid="send-next-btn"]');
      const cancel = document.querySelector('[data-testid="send-cancel-btn"]');
      const scrollable = document.querySelector('[data-testid="drawer-scrollable-content"]');
      const rectToObject = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height)
        };
      };

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        drawerRect: rectToObject(drawer),
        footerRect: rectToObject(footer),
        nextRect: rectToObject(next),
        cancelRect: rectToObject(cancel),
        scrollableRect: rectToObject(scrollable),
        scrollTop: Math.round(scrollable?.scrollTop || 0),
        scrollHeight: Math.round(scrollable?.scrollHeight || 0),
        clientHeight: Math.round(scrollable?.clientHeight || 0),
        title: document.querySelector('[data-testid="drawer-navigation-title"]')?.textContent?.trim() || ''
      };
    });

  const validateMode = async ({ enabled, label }) => {
    await ensurePreprod(page);
    await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForSelector('[data-testid="midgard-mode-toggle"]', { timeout: 30_000 });
    await setMidgardModeOnAssetsPage(page, enabled);
    await page.goto(`chrome-extension://${extensionId}/popup.html#/send/1`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await wait(1000);

    const addressInput = page.locator('[data-testid="address-input"] input').first();
    const amountInput = page.locator('[data-testid="coin-configure-input"]').first();
    const nextButton = page.locator('[data-testid="send-next-btn"]');
    const cancelButton = page.locator('[data-testid="send-cancel-btn"]');
    const scrollableContent = page.locator('[data-testid="drawer-scrollable-content"]');

    await addressInput.waitFor({ timeout: 30_000 });
    await addressInput.fill(primaryWalletAddress);
    await wait(250);
    await amountInput.waitFor({ timeout: 30_000 });
    await amountInput.fill(sendAmountAda);
    await wait(700);
    await nextButton.waitFor({ timeout: 30_000 });

    const initialMetrics = await collectMetrics();
    await scrollableContent.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await wait(400);
    const scrolledMetrics = await collectMetrics();
    await scrollableContent.evaluate((node) => {
      node.scrollTop = 0;
    });
    await wait(300);
    const resetMetrics = await collectMetrics();

    const screenshotPath = `${outputDir}/midgard-send-shell-layout-${label}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push(screenshotPath);

    const nextVisible = await safeVisible(nextButton);
    const cancelVisible = await safeVisible(cancelButton);
    const footerWithinViewport = [initialMetrics, scrolledMetrics, resetMetrics].every(
      (metrics) =>
        typeof metrics.footerRect?.bottom === 'number' &&
        typeof metrics.viewport?.height === 'number' &&
        metrics.footerRect.top >= 0 &&
        metrics.footerRect.bottom <= metrics.viewport.height + 2
    );
    const nextWithinViewport = [initialMetrics, scrolledMetrics, resetMetrics].every(
      (metrics) =>
        typeof metrics.nextRect?.bottom === 'number' &&
        typeof metrics.viewport?.height === 'number' &&
        metrics.nextRect.top >= 0 &&
        metrics.nextRect.bottom <= metrics.viewport.height + 2
    );
    const footerPinned =
      Math.abs((initialMetrics.footerRect?.top || 0) - (scrolledMetrics.footerRect?.top || 0)) <= 2 &&
      Math.abs((initialMetrics.footerRect?.bottom || 0) - (scrolledMetrics.footerRect?.bottom || 0)) <= 2 &&
      Math.abs((initialMetrics.nextRect?.top || 0) - (scrolledMetrics.nextRect?.top || 0)) <= 2 &&
      Math.abs((initialMetrics.cancelRect?.top || 0) - (scrolledMetrics.cancelRect?.top || 0)) <= 2;

    if (!(nextVisible && cancelVisible && footerWithinViewport && nextWithinViewport && footerPinned)) {
      throw new Error(
        `Send shell validation failed (${label}): ${JSON.stringify({
          initialMetrics,
          scrolledMetrics,
          resetMetrics
        })}`
      );
    }

    await clickWithFallback(cancelButton).catch(() => undefined);
    await wait(700);

    return {
      initial: initialMetrics,
      scrolled: scrolledMetrics,
      reset: resetMetrics
    };
  };

  const standardMetrics = await validateMode({ enabled: false, label: 'standard' });
  const midgardMetrics = await validateMode({ enabled: true, label: 'midgard' });

  console.log('send_shell_validation=passed');
  console.log(
    `send_shell_metrics=${JSON.stringify({
      standard: standardMetrics,
      midgard: midgardMetrics
    })}`
  );
};

const verifySendDrawerFooterVisible = async ({ page, context, extensionId, artifacts }) => {
  const expandedPage = await openExpandedAssetsPage({ page, context, extensionId });
  await ensurePreprod(expandedPage);
  await expandedPage.goto(`chrome-extension://${extensionId}/app.html#/assets`, { waitUntil: 'domcontentloaded' });
  await expandedPage.waitForSelector('#main', { timeout: 20_000 });
  await expandedPage.waitForTimeout(1200);
  const primaryWalletAddress = await getPrimaryWalletAddress({ page: expandedPage, extensionId });

  const runViewportCheck = async ({ width, height, label, midgardEnabled }) => {
    const modeLabel = midgardEnabled ? 'midgard' : 'standard';
    console.log(`send_layout_step=start_${label}_${modeLabel}`);
    await expandedPage.setViewportSize({ width, height });
    await expandedPage.goto(`chrome-extension://${extensionId}/app.html#/assets`, { waitUntil: 'domcontentloaded' });
    await expandedPage.waitForSelector('[data-testid="transaction-ctas-container"]', { timeout: 30_000 });
    await setMidgardModeOnAssetsPage(expandedPage, midgardEnabled);
    await expandedPage.waitForTimeout(700);

    const sendButton = expandedPage.locator('[data-testid="send-button"]');
    const roleSendButton = expandedPage.getByRole('button', { name: /^Send$/i });

    if (await safeVisible(sendButton)) {
      await clickWithFallback(sendButton);
    } else if (await safeVisible(roleSendButton)) {
      await clickWithFallback(roleSendButton);
    } else {
      throw new Error(`Send layout validation failed: send CTA missing at ${label}_${modeLabel}`);
    }
    console.log(`send_layout_step=opened_drawer_${label}_${modeLabel}`);

    const addressInput = expandedPage.locator('[data-testid="address-input"] input').first();
    await addressInput.waitFor({ timeout: 30_000 });
    await addressInput.fill(primaryWalletAddress);
    await wait(300);

    const amountInput = expandedPage.locator('[data-testid="coin-configure-input"]').first();
    await amountInput.waitFor({ timeout: 30_000 });
    await amountInput.fill(sendAmountAda);
    await wait(500);

    const nextButton = expandedPage.locator('[data-testid="send-next-btn"]');
    const cancelButton = expandedPage.locator('[data-testid="send-cancel-btn"]');
    const scrollableContent = expandedPage.locator('[data-testid="drawer-scrollable-content"]');
    await nextButton.waitFor({ timeout: 30_000 });
    console.log(`send_layout_step=ready_${label}_${modeLabel}`);

    const collectMetrics = async () =>
      await expandedPage.evaluate(() => {
        const footer = document.querySelector('[data-testid="drawer-footer"]');
        const next = document.querySelector('[data-testid="send-next-btn"]');
        const cancel = document.querySelector('[data-testid="send-cancel-btn"]');
        const scrollable = document.querySelector('[data-testid="drawer-scrollable-content"]');
        const wrapper = document.querySelector('.ant-drawer-content-wrapper');
        const customDrawer = document.querySelector('[data-testid="custom-drawer"]');
        const rectToObject = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height)
          };
        };

        const nextRect = rectToObject(next);
        const cancelRect = rectToObject(cancel);
        const footerRect = rectToObject(footer);
        const wrapperRect = rectToObject(wrapper);
        const drawerRect = rectToObject(customDrawer);
        const scrollableRect = rectToObject(scrollable);

        return {
          innerHeight: window.innerHeight,
          nextRect,
          cancelRect,
          footerRect,
          wrapperRect,
          drawerRect,
          scrollableRect,
          scrollTop: Math.round(scrollable?.scrollTop || 0),
          scrollHeight: Math.round(scrollable?.scrollHeight || 0),
          clientHeight: Math.round(scrollable?.clientHeight || 0),
          nextButtonVisible:
            !!nextRect && nextRect.top >= 0 && nextRect.bottom <= window.innerHeight - 8 && nextRect.height > 0,
          cancelButtonVisible:
            !!cancelRect && cancelRect.top >= 0 && cancelRect.bottom <= window.innerHeight - 8 && cancelRect.height > 0,
          footerVisible:
            !!footerRect && footerRect.top >= 0 && footerRect.bottom <= window.innerHeight - 4 && footerRect.height > 0
        };
      });

    const initialMetrics = await collectMetrics();
    await scrollableContent.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await wait(400);
    const scrolledMetrics = await collectMetrics();
    await scrollableContent.evaluate((node) => {
      node.scrollTop = 0;
    });
    await wait(300);
    const resetMetrics = await collectMetrics();
    const resizedViewport = {
      width: Math.max(width, 1600),
      height: Math.max(height, 900)
    };
    await expandedPage.setViewportSize(resizedViewport);
    await wait(500);
    const resizedMetrics = await collectMetrics();

    const screenshotPath = `${outputDir}/midgard-send-layout-${label}-${modeLabel}.png`;
    await expandedPage.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push(screenshotPath);

    const footerPinned =
      Math.abs((initialMetrics.footerRect?.top || 0) - (scrolledMetrics.footerRect?.top || 0)) <= 2 &&
      Math.abs((initialMetrics.footerRect?.bottom || 0) - (scrolledMetrics.footerRect?.bottom || 0)) <= 2 &&
      Math.abs((initialMetrics.nextRect?.top || 0) - (scrolledMetrics.nextRect?.top || 0)) <= 2 &&
      Math.abs((initialMetrics.cancelRect?.top || 0) - (scrolledMetrics.cancelRect?.top || 0)) <= 2;

    if (
      !initialMetrics.nextButtonVisible ||
      !initialMetrics.cancelButtonVisible ||
      !initialMetrics.footerVisible ||
      !scrolledMetrics.nextButtonVisible ||
      !scrolledMetrics.cancelButtonVisible ||
      !scrolledMetrics.footerVisible ||
      !resizedMetrics.nextButtonVisible ||
      !resizedMetrics.cancelButtonVisible ||
      !resizedMetrics.footerVisible ||
      !footerPinned
    ) {
      throw new Error(
        `Send layout validation failed at ${label}_${modeLabel}: ${JSON.stringify({
          initialMetrics,
          scrolledMetrics,
          resetMetrics,
          resizedMetrics
        })}`
      );
    }

    await clickWithFallback(cancelButton).catch(() => undefined);
    await wait(400);

    return {
      initial: initialMetrics,
      scrolled: scrolledMetrics,
      reset: resetMetrics,
      resized: resizedMetrics
    };
  };

  const shortStandardMetrics = await runViewportCheck({ width: 1280, height: 620, label: '1280x620', midgardEnabled: false });
  const shortMidgardMetrics = await runViewportCheck({ width: 1280, height: 620, label: '1280x620', midgardEnabled: true });
  const compactStandardMetrics = await runViewportCheck({ width: 1360, height: 760, label: '1360x760', midgardEnabled: false });
  const compactMidgardMetrics = await runViewportCheck({ width: 1360, height: 760, label: '1360x760', midgardEnabled: true });
  const roomyStandardMetrics = await runViewportCheck({ width: 1600, height: 900, label: '1600x900', midgardEnabled: false });
  const roomyMidgardMetrics = await runViewportCheck({ width: 1600, height: 900, label: '1600x900', midgardEnabled: true });

  console.log('send_layout_validation=passed');
  console.log(
    `send_layout_metrics=${JSON.stringify({
      shortStandard: shortStandardMetrics,
      shortMidgard: shortMidgardMetrics,
      compactStandard: compactStandardMetrics,
      compactMidgard: compactMidgardMetrics,
      roomyStandard: roomyStandardMetrics,
      roomyMidgard: roomyMidgardMetrics
    })}`
  );
};

(async () => {
  if (withdrawalRequested) {
    throw new Error(
      'MIDGARD_INCLUDE_WITHDRAWAL is no longer supported. The demo only covers deposit and send until withdrawal is implemented.'
    );
  }

  await mkdir(outputDir, { recursive: true });
  const userDataDir = process.env.PW_USER_DATA_DIR || (await mkdtemp(join(tmpdir(), 'lace-pw-midgard-demo-')));
  let mnemonicWords = await loadMnemonicWords();
  const artifacts = [];
  const videoHandles = [];
  let mockMidgardServer;
  let context;

  const midgardHealthy = await isMidgardHealthy(midgardBaseUrl);
  if (!midgardHealthy) {
    if (!allowMockMidgard) {
      throw new Error(`Midgard backend is unavailable at ${midgardBaseUrl} and MIDGARD_USE_MOCK=0`);
    }
    mockMidgardServer = await startMockMidgardServer(midgardBaseUrl);
    console.log(`midgard_mock_server=${mockMidgardServer.baseUrl}`);
  } else {
    console.log(`midgard_server=${midgardBaseUrl}`);
  }

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
      viewport: contextViewport,
      ...(shouldRecordVideo
        ? {
            recordVideo: {
              dir: outputDir,
              size: popupViewport
            }
          }
        : {}),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...(shouldUseNativeWindowSizing ? [`--window-size=${popupViewport.width},${popupViewport.height}`] : []),
        ...(remoteDebuggingPort > 0 ? [`--remote-debugging-port=${remoteDebuggingPort}`] : [])
      ]
    });

    const registerVideo = (page) => {
      if (!shouldRecordVideo) return;
      const video = page.video();
      if (video) videoHandles.push(video);
    };

    context.on('page', (newPage) => {
      setupPageListeners(newPage);
      registerVideo(newPage);
    });

    const serviceWorker = context.serviceWorkers()[0];
    let extensionId;

    if (serviceWorker) {
      extensionId = new URL(serviceWorker.url()).host;
    } else {
      try {
        const registeredServiceWorker = await context.waitForEvent('serviceworker', {
          timeout: 30_000
        });
        extensionId = new URL(registeredServiceWorker.url()).host;
      } catch (error) {
        extensionId = await computeExtensionIdFromManifest();
        console.warn(`extension_serviceworker_timeout_using_manifest_id=${extensionId}`);
      }
    }

    console.log(`extension_id=${extensionId}`);
    console.log(`user_data_dir=${userDataDir}`);
    console.log(`mnemonic_file=${mnemonicFile}`);
    if (browserExecutablePath) console.log(`browser_executable=${browserExecutablePath}`);
    if (remoteDebuggingPort > 0) console.log(`remote_debugging_port=${remoteDebuggingPort}`);
    if (shouldUseNativeWindowSizing) {
      console.log(`native_window_size=${popupViewport.width}x${popupViewport.height}`);
      console.log('native_window_viewport=enabled');
    }

    const ready = await waitForWalletReady({ context, extensionId, mnemonicWords });
    let page = ready.page;
    mnemonicWords = ready.mnemonicWords;
    registerVideo(page);

    if (validatePopupScroll) {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await verifyPopupMidgardScroll({ page, artifacts });
      if (validateOnly && !validateFullscreenLayout) {
        console.log('validation_only_done=true');
        return;
      }
    }

    if (validateFullscreenLayout) {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await verifyFullscreenLayoutScales({ page, context, extensionId, artifacts });
      if (validateOnly && !validateDepositLayout && !validateSendLayout) {
        console.log('validation_only_done=true');
        return;
      }
    }

    if (validateDepositLayout) {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await verifyDepositDrawerMatchesShell({ page, context, extensionId, artifacts });
      if (validateOnly && !validateSendShell && !validateSendLayout) {
        console.log('validation_only_done=true');
        return;
      }
    }

    if (validateSendShell) {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await verifySendDrawerShellMatchesPopup({ page, context, extensionId, artifacts });
      if (validateOnly && !validateSendLayout) {
        console.log('validation_only_done=true');
        return;
      }
    }

    if (validateSendLayout) {
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await verifySendDrawerFooterVisible({ page, context, extensionId, artifacts });
      if (validateOnly) {
        console.log('validation_only_done=true');
        return;
      }
    }

    if (stopAfterLogin) {
      await ensurePreprod(page);
      await page.goto(`chrome-extension://${extensionId}/popup.html#/assets`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      const runtime = await readFetchProbe(page);
      console.log('manual_mode_ready=true');
      console.log(`manual_mode_midgard_url_override=${runtime.midgardUrlOverride}`);
      console.log('manual_mode_note=Wallet is open for manual interaction. Stop this process when finished.');
      // Keep the browser open for interactive debugging/demo usage.
      await new Promise(() => undefined);
    }

    const primaryWalletAddress = await getPrimaryWalletAddress({ page, extensionId });
    console.log(`wallet_address=${primaryWalletAddress}`);

    if (!skipDeposit) {
      await runDepositFlow({ page, primaryWalletAddress, artifacts, projectionExpected: !mockMidgardServer });
    }
    await runSendToSelfFlow({ page, primaryWalletAddress, context, extensionId, artifacts });

    console.log(`artifacts=${artifacts.join(',')}`);
    if (mnemonicWords.length > 0) console.log(`mnemonic_words_count=${mnemonicWords.length}`);
  } finally {
    if (context) {
      await context.close();
    }

    if (mockMidgardServer) {
      await new Promise((resolve) => mockMidgardServer.server.close(() => resolve(undefined)));
    }

    const resolvedVideoPaths = [];
    for (const video of videoHandles) {
      const videoPath = await video.path().catch(() => '');
      if (videoPath) resolvedVideoPaths.push(videoPath);
    }
    if (resolvedVideoPaths.length > 0) {
      console.log(`videos=${resolvedVideoPaths.join(',')}`);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
