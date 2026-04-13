import { storage } from 'webextension-polyfill';
import { Wallet } from '@lace/cardano';
import { config } from '@src/config';

export const MIDGARD_URL_OVERRIDE_STORAGE_KEY = 'midgardUrlOverride';
export const MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY = 'midgardLastCardanoAvailableLovelace';

const normalizeNonEmpty = (value?: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

let midgardUrlOverrideMirror =
  typeof window === 'undefined' ? undefined : normalizeNonEmpty(window.localStorage.getItem(MIDGARD_URL_OVERRIDE_STORAGE_KEY));
let midgardUrlOverrideListenerRegistered = false;
let midgardUrlOverrideHydrated = false;
let midgardUrlOverrideLoadPromise: Promise<string | undefined> | undefined;

const syncMidgardUrlOverrideMirror = (value?: string): void => {
  midgardUrlOverrideMirror = normalizeNonEmpty(value);

  if (typeof window === 'undefined') return;

  if (midgardUrlOverrideMirror) {
    window.localStorage.setItem(MIDGARD_URL_OVERRIDE_STORAGE_KEY, midgardUrlOverrideMirror);
    return;
  }

  window.localStorage.removeItem(MIDGARD_URL_OVERRIDE_STORAGE_KEY);
};

const readMidgardUrlOverrideFromStoragePayload = (stored: Record<string, unknown> | undefined): string | undefined => {
  const overrideValue =
    stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[MIDGARD_URL_OVERRIDE_STORAGE_KEY] : undefined;

  return typeof overrideValue === 'string' ? normalizeNonEmpty(overrideValue) : undefined;
};

const ensureMidgardUrlOverrideListener = (): void => {
  if (midgardUrlOverrideListenerRegistered) return;

  storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(MIDGARD_URL_OVERRIDE_STORAGE_KEY in changes)) return;

    const overrideValue = changes[MIDGARD_URL_OVERRIDE_STORAGE_KEY]?.newValue;
    syncMidgardUrlOverrideMirror(typeof overrideValue === 'string' ? overrideValue : undefined);
  });

  midgardUrlOverrideListenerRegistered = true;
};

export const resolveMidgardUrl = ({
  configuredUrl,
  overrideUrl
}: {
  configuredUrl?: string | null;
  overrideUrl?: string | null;
}): string | undefined => normalizeNonEmpty(overrideUrl) || normalizeNonEmpty(configuredUrl);

export const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

export const getMidgardLastCardanoBalanceStorageKey = ({
  activeAddress,
  environmentName
}: {
  activeAddress?: string;
  environmentName?: Wallet.ChainName;
}): string => {
  const normalizedAddress = normalizeNonEmpty(activeAddress) ?? 'unknown-address';
  const normalizedEnvironment = normalizeNonEmpty(environmentName) ?? 'unknown-chain';
  return `${MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY}:${normalizedEnvironment}:${normalizedAddress}`;
};

export const getMidgardUrlOverride = async (): Promise<string | undefined> => {
  ensureMidgardUrlOverrideListener();

  if (midgardUrlOverrideHydrated) {
    return midgardUrlOverrideMirror;
  }

  if (!midgardUrlOverrideLoadPromise) {
    midgardUrlOverrideLoadPromise = storage.local
      .get(MIDGARD_URL_OVERRIDE_STORAGE_KEY)
      .then((stored) => {
        const overrideUrl = readMidgardUrlOverrideFromStoragePayload(stored as Record<string, unknown>);
        syncMidgardUrlOverrideMirror(overrideUrl);
        midgardUrlOverrideHydrated = true;
        return overrideUrl;
      })
      .catch(() => {
        midgardUrlOverrideHydrated = true;
        return midgardUrlOverrideMirror;
      });
  }

  return midgardUrlOverrideLoadPromise;
};

export const getMidgardUrl = async (environmentName?: Wallet.ChainName): Promise<string | undefined> => {
  if (!environmentName) return undefined;

  const configuredUrl = config().MIDGARD_URLS[environmentName];
  const overrideUrl = await getMidgardUrlOverride();

  return resolveMidgardUrl({ configuredUrl, overrideUrl });
};

export const parseStoredLovelace = (value?: string | null): bigint | undefined => {
  const normalized = normalizeNonEmpty(value);
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;

  try {
    return BigInt(normalized);
  } catch {
    return undefined;
  }
};
