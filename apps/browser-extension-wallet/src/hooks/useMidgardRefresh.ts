import { useEffect, useRef } from 'react';
import { useWalletManager } from './useWalletManager';

/**
 * Hook that listens for Midgard setting changes and triggers a wallet refresh
 */
export const useMidgardRefresh = () => {
  const { reloadWallet } = useWalletManager();
  const isReloading = useRef(false);

  useEffect(() => {
    console.log('🔍 Debug: useMidgardRefresh hook initialized');
    
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      // Only log if it's the midgardEnabled change
      if (changes.midgardEnabled) {
        console.log('🔍 Debug: Midgard setting changed in storage:', changes.midgardEnabled.newValue);
        
        // Prevent infinite loops by checking if we're already reloading
        if (isReloading.current) {
          console.log('🔍 Debug: Already reloading, skipping...');
          return;
        }
        
        isReloading.current = true;
        
        // Trigger a wallet reload to refresh providers
        reloadWallet().then(() => {
          console.log('🔍 Debug: Wallet reloaded after Midgard setting change');
        }).catch((error) => {
          console.error('🔍 Debug: Failed to reload wallet after Midgard setting change:', error);
        }).finally(() => {
          // Reset the flag after a short delay to allow the reload to complete
          setTimeout(() => {
            isReloading.current = false;
          }, 1000);
        });
      }
    };

    // Listen for storage changes
    console.log('🔍 Debug: Setting up storage change listener');
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      console.log('🔍 Debug: Cleaning up storage change listener');
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [reloadWallet]);
}; 