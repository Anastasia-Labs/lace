import { useEffect, useRef } from 'react';
import { useWalletStore } from '@src/stores';
import { WalletStore } from '@src/stores/types';
import { useWalletManager } from './useWalletManager';
import { getErrorMessage } from '@src/utils/get-error-message';

const MIDGARD_HEALTH_POLL_INTERVAL = 30_000;

const syncInitialMidgardMode = async ({
  isAlive,
  getCurrentState,
  queuePendingMidgardMode,
  startMidgardModeSwitch,
  setMidgardMode,
  clearMidgardModeError
}: {
  isAlive: () => boolean;
  getCurrentState: () => {
    isMidgardEnabled: boolean;
    isMidgardWalletReady: boolean;
    midgardActivationStatus: WalletStore['midgardActivationStatus'];
    midgardTargetEnabled?: boolean;
  };
  queuePendingMidgardMode: (enabled: boolean) => void;
  startMidgardModeSwitch: (enabled: boolean) => void;
  setMidgardMode: (enabled: boolean) => void;
  clearMidgardModeError: () => void;
}): Promise<void> => {
  try {
    const stored = await chrome.storage.local.get('midgardEnabled');
    if (!isAlive()) return;

    const nextEnabled = stored?.midgardEnabled === true;
    const { isMidgardEnabled, isMidgardWalletReady, midgardActivationStatus } = getCurrentState();

    if (midgardActivationStatus === 'switching') {
      return;
    }

    if (!isMidgardWalletReady && nextEnabled !== isMidgardEnabled) {
      queuePendingMidgardMode(nextEnabled);
      startMidgardModeSwitch(nextEnabled);
      return;
    }

    setMidgardMode(nextEnabled);
    clearMidgardModeError();
  } catch (error) {
    console.error('Failed to read initial Midgard mode from extension storage:', error);
  }
};

const finalizeMidgardTransition = ({
  enabled,
  isAlive,
  getCurrentState,
  queuePendingMidgardMode,
  setMidgardMode,
  clearMidgardModeError
}: {
  enabled: boolean;
  isAlive: () => boolean;
  getCurrentState: () => {
    isMidgardWalletReady: boolean;
  };
  queuePendingMidgardMode: (enabled: boolean) => void;
  setMidgardMode: (enabled: boolean) => void;
  clearMidgardModeError: () => void;
}): void => {
  if (!isAlive()) return;

  if (!getCurrentState().isMidgardWalletReady) {
    queuePendingMidgardMode(enabled);
    return;
  }

  setMidgardMode(enabled);
  clearMidgardModeError();
};

const applyExternalMidgardModeChange = async ({
  nextEnabled,
  isAlive,
  isLatestTransition,
  getCurrentState,
  queuePendingMidgardMode,
  startMidgardModeSwitch,
  reloadWallet,
  setMidgardMode,
  clearMidgardModeError,
  failMidgardModeSwitch
}: {
  nextEnabled: boolean;
  isAlive: () => boolean;
  isLatestTransition: () => boolean;
  getCurrentState: () => {
    isMidgardWalletReady: boolean;
  };
  queuePendingMidgardMode: (enabled: boolean) => void;
  startMidgardModeSwitch: (enabled: boolean) => void;
  reloadWallet: () => Promise<void>;
  setMidgardMode: (enabled: boolean) => void;
  clearMidgardModeError: () => void;
  failMidgardModeSwitch: (error: string) => void;
}): Promise<void> => {
  startMidgardModeSwitch(nextEnabled);

  try {
    await reloadWallet();
    if (!isAlive() || !isLatestTransition()) return;
    finalizeMidgardTransition({
      enabled: nextEnabled,
      isAlive,
      getCurrentState,
      queuePendingMidgardMode,
      setMidgardMode,
      clearMidgardModeError
    });
  } catch (error) {
    if (!isAlive() || !isLatestTransition()) return;
    failMidgardModeSwitch(getErrorMessage(error));
  }
};

const applyMidgardUrlOverrideChange = async ({
  isAlive,
  isLatestTransition,
  getCurrentState,
  queuePendingMidgardMode,
  startMidgardModeSwitch,
  reloadWallet,
  setMidgardMode,
  clearMidgardModeError,
  failMidgardModeSwitch
}: {
  isAlive: () => boolean;
  isLatestTransition: () => boolean;
  getCurrentState: () => {
    isMidgardEnabled: boolean;
    isMidgardWalletReady: boolean;
    midgardActivationStatus: WalletStore['midgardActivationStatus'];
  };
  queuePendingMidgardMode: (enabled: boolean) => void;
  startMidgardModeSwitch: (enabled: boolean) => void;
  reloadWallet: () => Promise<void>;
  setMidgardMode: (enabled: boolean) => void;
  clearMidgardModeError: () => void;
  failMidgardModeSwitch: (error: string) => void;
}): Promise<void> => {
  const { isMidgardEnabled, midgardActivationStatus } = getCurrentState();

  if (!isMidgardEnabled || midgardActivationStatus === 'switching') {
    return;
  }

  startMidgardModeSwitch(true);

  try {
    await reloadWallet();
    if (!isAlive() || !isLatestTransition()) return;
    finalizeMidgardTransition({
      enabled: true,
      isAlive,
      getCurrentState: () => ({ isMidgardWalletReady: getCurrentState().isMidgardWalletReady }),
      queuePendingMidgardMode,
      setMidgardMode,
      clearMidgardModeError
    });
  } catch (error) {
    if (!isAlive() || !isLatestTransition()) return;
    failMidgardModeSwitch(getErrorMessage(error));
  }
};

const probeMidgardHealth = async ({
  isAlive,
  blockchainProvider,
  setMidgardHealthHealthy,
  setMidgardHealthDegraded
}: {
  isAlive: () => boolean;
  blockchainProvider: Pick<WalletStore['blockchainProvider'], 'txSubmitProvider' | 'chainHistoryProvider'>;
  setMidgardHealthHealthy: () => void;
  setMidgardHealthDegraded: (error: string) => void;
}): Promise<void> => {
  try {
    const [submitHealth, historyHealth] = await Promise.all([
      blockchainProvider.txSubmitProvider.healthCheck(),
      blockchainProvider.chainHistoryProvider.healthCheck()
    ]);

    if (!isAlive()) return;

    if (submitHealth.ok && historyHealth.ok) {
      setMidgardHealthHealthy();
      return;
    }

    setMidgardHealthDegraded('Midgard is unavailable. Lace kept Layer 2 mode enabled, but actions are paused.');
  } catch (error) {
    if (!isAlive()) return;
    setMidgardHealthDegraded(getErrorMessage(error));
  }
};

/**
 * Keeps passive views in sync with the effective Midgard mode and refreshes
 * providers when the Midgard URL changes outside the current view.
 */
export const useMidgardRefresh = (): void => {
  const {
    cardanoWallet,
    isMidgardEnabled,
    midgardActivationStatus,
    midgardTargetEnabled,
    blockchainProvider,
    setMidgardMode,
    startMidgardModeSwitch,
    failMidgardModeSwitch,
    clearMidgardModeError,
    setMidgardHealthHealthy,
    setMidgardHealthDegraded,
    resetMidgardHealth,
    walletState
  } = useWalletStore();
  const { reloadWallet } = useWalletManager();
  const pendingMidgardModeRef = useRef<boolean>();
  const transitionIdRef = useRef(0);
  const isMidgardWalletReady = Boolean(cardanoWallet && walletState);
  const currentStateRef = useRef({
    isMidgardEnabled,
    isMidgardWalletReady,
    midgardActivationStatus,
    midgardTargetEnabled
  });

  currentStateRef.current = {
    isMidgardEnabled,
    isMidgardWalletReady,
    midgardActivationStatus,
    midgardTargetEnabled
  };

  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;
    const setMidgardModeAndSync = (enabled: boolean) => {
      currentStateRef.current = {
        ...currentStateRef.current,
        isMidgardEnabled: enabled,
        midgardActivationStatus: 'idle',
        midgardTargetEnabled: undefined
      };
      setMidgardMode(enabled);
    };
    const startMidgardModeSwitchAndSync = (enabled: boolean) => {
      currentStateRef.current = {
        ...currentStateRef.current,
        midgardActivationStatus: 'switching',
        midgardTargetEnabled: enabled
      };
      startMidgardModeSwitch(enabled);
    };
    const failMidgardModeSwitchAndSync = (error: string) => {
      currentStateRef.current = {
        ...currentStateRef.current,
        midgardActivationStatus: 'error',
        midgardTargetEnabled: undefined
      };
      failMidgardModeSwitch(error);
    };
    const clearMidgardModeErrorAndSync = () => {
      if (currentStateRef.current.midgardActivationStatus === 'error') {
        currentStateRef.current = {
          ...currentStateRef.current,
          midgardActivationStatus: 'idle',
          midgardTargetEnabled: undefined
        };
      }
      clearMidgardModeError();
    };
    const queuePendingMidgardMode = (enabled: boolean) => {
      pendingMidgardModeRef.current = enabled;
    };
    const getCurrentState = () => currentStateRef.current;
    const startTransition = () => {
      transitionIdRef.current += 1;
      return transitionIdRef.current;
    };
    const isLatestTransition = (transitionId: number) => transitionIdRef.current === transitionId;

    if (typeof chrome !== 'undefined') {
      void syncInitialMidgardMode({
        isAlive,
        getCurrentState,
        queuePendingMidgardMode,
        startMidgardModeSwitch: startMidgardModeSwitchAndSync,
        setMidgardMode: setMidgardModeAndSync,
        clearMidgardModeError: clearMidgardModeErrorAndSync
      });

      const handleExtensionStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
        const midgardEnabledChanged =
          Boolean(changes.midgardEnabled) && changes.midgardEnabled.oldValue !== changes.midgardEnabled.newValue;
        const midgardUrlOverrideChanged =
          Boolean(changes.midgardUrlOverride) &&
          changes.midgardUrlOverride.oldValue !== changes.midgardUrlOverride.newValue;

        if (midgardEnabledChanged) {
          const nextEnabled = changes.midgardEnabled.newValue === true;
          const currentState = getCurrentState();
          if (
            currentState.midgardActivationStatus === 'switching' &&
            currentState.midgardTargetEnabled === nextEnabled
          ) {
            return;
          }
          const transitionId = startTransition();

          void applyExternalMidgardModeChange({
            nextEnabled,
            isAlive,
            isLatestTransition: () => isLatestTransition(transitionId),
            getCurrentState: () => ({ isMidgardWalletReady: getCurrentState().isMidgardWalletReady }),
            queuePendingMidgardMode,
            startMidgardModeSwitch: startMidgardModeSwitchAndSync,
            reloadWallet,
            setMidgardMode: setMidgardModeAndSync,
            clearMidgardModeError: clearMidgardModeErrorAndSync,
            failMidgardModeSwitch: failMidgardModeSwitchAndSync
          });
        }

        if (midgardUrlOverrideChanged) {
          const currentState = getCurrentState();
          if (!currentState.isMidgardEnabled || currentState.midgardActivationStatus === 'switching') {
            return;
          }

          const transitionId = startTransition();
          void applyMidgardUrlOverrideChange({
            isAlive,
            isLatestTransition: () => isLatestTransition(transitionId),
            getCurrentState,
            queuePendingMidgardMode,
            startMidgardModeSwitch: startMidgardModeSwitchAndSync,
            reloadWallet,
            setMidgardMode: setMidgardModeAndSync,
            clearMidgardModeError: clearMidgardModeErrorAndSync,
            failMidgardModeSwitch: failMidgardModeSwitchAndSync
          });
        }
      };

      chrome.storage.onChanged.addListener(handleExtensionStorageChange);

      return () => {
        alive = false;
        chrome.storage.onChanged.removeListener(handleExtensionStorageChange);
      };
    }

    return () => {
      alive = false;
    };
  }, [
    clearMidgardModeError,
    failMidgardModeSwitch,
    reloadWallet,
    setMidgardMode,
    startMidgardModeSwitch
  ]);

  useEffect(() => {
    const pendingMidgardMode = pendingMidgardModeRef.current;
    if (!isMidgardWalletReady || typeof pendingMidgardMode !== 'boolean') {
      return;
    }

    pendingMidgardModeRef.current = undefined;
    currentStateRef.current = {
      ...currentStateRef.current,
      isMidgardEnabled: pendingMidgardMode,
      midgardActivationStatus: 'idle',
      midgardTargetEnabled: undefined
    };
    setMidgardMode(pendingMidgardMode);
    clearMidgardModeError();
  }, [clearMidgardModeError, isMidgardWalletReady, setMidgardMode]);

  useEffect(() => {
    let alive = true;
    let healthInterval: number | undefined;

    if (!isMidgardEnabled) {
      resetMidgardHealth();
    } else if (midgardActivationStatus !== 'switching') {
      const isAlive = () => alive;

      void probeMidgardHealth({
        isAlive,
        blockchainProvider,
        setMidgardHealthHealthy,
        setMidgardHealthDegraded
      });
      healthInterval = window.setInterval(() => {
        void probeMidgardHealth({
          isAlive,
          blockchainProvider,
          setMidgardHealthHealthy,
          setMidgardHealthDegraded
        });
      }, MIDGARD_HEALTH_POLL_INTERVAL);
    }

    return () => {
      alive = false;
      if (typeof healthInterval === 'number') {
        window.clearInterval(healthInterval);
      }
    };
  }, [
    blockchainProvider,
    isMidgardEnabled,
    midgardActivationStatus,
    resetMidgardHealth,
    setMidgardHealthDegraded,
    setMidgardHealthHealthy
  ]);
};
