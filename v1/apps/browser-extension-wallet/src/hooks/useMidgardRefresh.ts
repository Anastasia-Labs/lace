import { useEffect, useRef } from 'react';
import { storage } from 'webextension-polyfill';
import { useWalletManager } from './useWalletManager';

const RELOAD_DEBOUNCE_MS = 1000;

/**
 * Hook that listens for Midgard setting changes and triggers a wallet refresh
 */
export const useMidgardRefresh = (): void => {
  const { reloadWallet } = useWalletManager();
  const isReloading = useRef(false);
  const reloadWalletRef = useRef(reloadWallet);
  reloadWalletRef.current = reloadWallet;

  useEffect(() => {
    const handleStorageChange = async (changes: { [key: string]: { newValue?: unknown } }) => {
      if (!changes.midgardEnabled || isReloading.current) return;

      isReloading.current = true;
      try {
        await reloadWalletRef.current();
      } catch (error) {
        console.error('Failed to reload wallet after Midgard setting change:', error);
      } finally {
        setTimeout(() => {
          isReloading.current = false;
        }, RELOAD_DEBOUNCE_MS);
      }
    };

    storage.onChanged.addListener(handleStorageChange);

    return () => {
      storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);
};
