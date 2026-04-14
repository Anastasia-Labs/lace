import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { useObservable, toast, Button, Drawer, DrawerHeader, DrawerNavigation } from '@lace/common';
import { Switch, Input } from 'antd';
import { Password as PasswordInput, useSecrets } from '@lace/core';
import SwitchIcon from '@src/assets/icons/switch.component.svg';
import styles from './MidgardBanner.module.scss';
import { Wallet } from '@lace/cardano';
import { getMidgardUrl, MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY, parseStoredLovelace } from '@src/utils/midgard-url';
import { getMidgardDepositEventIdFromTxCbor } from '@src/utils/midgard-deposit-event-id';
import { withSignTxConfirmation } from '@lib/wallet-api-ui';
import { signExternalCardanoTx } from '@lib/sign-external-cardano-tx';
import { buildMidgardDeposit, getMidgardDepositFundingSummary, submitSignedCardanoTx } from './deposit';
import { useWalletManager } from '@hooks';
import { isMidgardSupportedChain } from '@src/utils/midgard-config';

const TX_HASH_PREVIEW_LENGTH = 8;
const ADA_DECIMALS = 6;
const SHORT_ADDRESS_THRESHOLD = 28;
const SHORT_ADDRESS_PREFIX_LENGTH = 14;
const SHORT_ADDRESS_SUFFIX_LENGTH = 10;
const ADA_INPUT_REGEX = new RegExp(`^\\d*(?:[.,]\\d{0,${ADA_DECIMALS}})?$`);
const DEPOSIT_PASSWORD_INPUT_ID = 'midgard-deposit-password';
const MIDGARD_CARDANO_BALANCE_CACHE_PREFIX = 'midgardCardanoAvailableLovelace/v2';
let midgardBannerIdCounter = 0;
const visuallyHiddenStyle: React.CSSProperties = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px'
};

/* eslint-disable camelcase */

const normalizeAdaInput = (value: string): string => value.replace(',', '.').trim();

const parseAdaToLovelace = (adaAmount: string): bigint | undefined => {
  const normalizedValue = normalizeAdaInput(adaAmount);
  let lovelaceValue: bigint | undefined;

  if (!normalizedValue || normalizedValue === '.' || !ADA_INPUT_REGEX.test(normalizedValue)) {
    return lovelaceValue;
  }

  try {
    const fixedValue = normalizedValue.endsWith('.') ? `${normalizedValue}0` : normalizedValue;
    const lovelace = BigInt(Wallet.util.adaToLovelacesString(fixedValue));
    lovelaceValue = lovelace > BigInt(0) ? lovelace : undefined;
  } catch {
    lovelaceValue = undefined;
  }

  return lovelaceValue;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const shortenAddress = (value: string): string =>
  value.length > SHORT_ADDRESS_THRESHOLD
    ? `${value.slice(0, SHORT_ADDRESS_PREFIX_LENGTH)}...${value.slice(-SHORT_ADDRESS_SUFFIX_LENGTH)}`
    : value;

const getScopedMidgardCardanoBalanceCacheKey = ({
  activeAddress,
  accountIndex,
  environmentName,
  walletId
}: {
  activeAddress?: string;
  accountIndex?: number;
  environmentName?: Wallet.ChainName;
  walletId?: string;
}): string | undefined => {
  if (!activeAddress || accountIndex === undefined || !environmentName || !walletId) return undefined;

  return [MIDGARD_CARDANO_BALANCE_CACHE_PREFIX, environmentName, walletId, String(accountIndex), activeAddress].join(
    ':'
  );
};

const getStoredCardanoAvailableLovelace = (cacheKey?: string): bigint | undefined => {
  if (typeof window === 'undefined' || !cacheKey) return undefined;

  return parseStoredLovelace(window.localStorage.getItem(cacheKey));
};

const getValidatedDepositContext = ({
  activeAddress,
  environmentName,
  midgardUrl,
  isSharedWallet,
  isMidgardDegraded,
  depositAmountLovelace,
  depositAvailableLovelace
}: {
  activeAddress: string;
  environmentName?: Wallet.ChainName;
  midgardUrl?: string;
  isSharedWallet: boolean;
  isMidgardDegraded: boolean;
  depositAmountLovelace?: bigint;
  depositAvailableLovelace: bigint;
}): { chainName: Wallet.ChainName; l2Address: string; midgardUrl: string; amount: bigint } => {
  if (!activeAddress) {
    throw new Error('Wallet address not available');
  }

  if (!environmentName || !isMidgardSupportedChain(environmentName) || !midgardUrl) {
    throw new Error(`Midgard deposit is not configured for ${environmentName ?? 'the active chain'}`);
  }

  if (isSharedWallet) {
    throw new Error('Midgard deposit is not available for shared wallets');
  }

  if (isMidgardDegraded) {
    throw new Error('Midgard is currently unavailable. Retry the health check or return to Cardano mode first.');
  }

  if (!depositAmountLovelace) {
    throw new Error('Enter a valid deposit amount');
  }

  if (depositAmountLovelace > depositAvailableLovelace) {
    throw new Error('Deposit amount exceeds available balance');
  }

  return {
    chainName: environmentName,
    l2Address: activeAddress,
    midgardUrl,
    amount: depositAmountLovelace
  };
};

// eslint-disable-next-line complexity, max-statements, sonarjs/cognitive-complexity
export const MidgardBanner = (): React.ReactElement => {
  const { t } = useTranslation();
  const {
    environmentName,
    isMidgardEnabled,
    midgardActivationStatus,
    midgardActivationError,
    midgardTargetEnabled,
    midgardHealthStatus,
    midgardHealthError,
    blockchainProvider,
    setMidgardHealthHealthy,
    setMidgardHealthDegraded,
    addMidgardPendingDeposit,
    walletInfo,
    walletUI,
    inMemoryWallet,
    cardanoWallet,
    currentChain,
    isInMemoryWallet,
    isSharedWallet
  } = useWalletStore();
  const { password, setPassword, clearSecrets } = useSecrets();
  const { setMidgardModeAndReload } = useWalletManager();

  const [isDepositSubmitting, setIsDepositSubmitting] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositAmountAda, setDepositAmountAda] = useState('');
  const [isDepositPasswordValid, setIsDepositPasswordValid] = useState(true);
  const [isRetryingMidgardHealth, setIsRetryingMidgardHealth] = useState(false);
  const [depositFundingSummary, setDepositFundingSummary] = useState<{
    fundingAddressCount: number;
    maxSingleAddress?: string;
    maxSingleAddressCoins: bigint;
    totalAvailableCoins: bigint;
  }>();
  const [depositFundingSummaryError, setDepositFundingSummaryError] = useState<string>();
  const [depositFundingSummaryStatus, setDepositFundingSummaryStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    'idle'
  );
  const [midgardUrl, setMidgardUrl] = useState<string | undefined>();
  const bannerId = useMemo(() => {
    midgardBannerIdCounter += 1;
    return `midgard-banner-${midgardBannerIdCounter}`;
  }, []);

  const availableBalance = useObservable(inMemoryWallet?.balance.utxo.available$);
  const isMidgardSupportedEnvironment = !!environmentName && isMidgardSupportedChain(environmentName);
  const isMidgardSwitching = midgardActivationStatus === 'switching';
  const isMidgardDegraded = isMidgardEnabled && midgardHealthStatus === 'degraded';
  const isMidgardUrlMissing = isMidgardEnabled && !midgardUrl;
  const shouldRenderMidgard =
    isMidgardSupportedEnvironment || isMidgardEnabled || midgardActivationStatus === 'switching' || midgardActivationStatus === 'error';
  const isProcessing = isDepositSubmitting || isMidgardSwitching || isRetryingMidgardHealth;
  const popupView = walletUI?.appMode === 'popup';

  const activeAddress = walletInfo?.addresses?.[0]?.address?.toString() || '';
  const cardanoBalanceCacheKey = useMemo(
    () =>
      getScopedMidgardCardanoBalanceCacheKey({
        activeAddress,
        accountIndex: cardanoWallet?.source.account?.accountIndex,
        environmentName,
        walletId: cardanoWallet?.source.wallet?.walletId
      }),
    [activeAddress, cardanoWallet?.source.account?.accountIndex, cardanoWallet?.source.wallet?.walletId, environmentName]
  );
  const fundingAddresses = useMemo(
    () => [
      ...new Set(
        [activeAddress, ...(walletInfo?.addresses || []).map((entry) => entry.address?.toString?.() || '')].filter(
          Boolean
        )
      )
    ],
    [activeAddress, walletInfo?.addresses]
  );
  const availableLovelace = useMemo(
    () => BigInt(availableBalance?.coins?.toString() || '0'),
    [availableBalance?.coins]
  );
  const [cachedCardanoAvailableLovelace, setCachedCardanoAvailableLovelace] = useState<bigint | undefined>(() =>
    getStoredCardanoAvailableLovelace(cardanoBalanceCacheKey)
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY);
  }, []);

  useEffect(() => {
    let alive = true;

    const syncMidgardUrl = async () => {
      const nextUrl =
        environmentName && isMidgardSupportedChain(environmentName) ? await getMidgardUrl(environmentName) : undefined;

      if (alive) {
        setMidgardUrl(nextUrl);
      }
    };

    void syncMidgardUrl();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.midgardUrlOverride) {
        void syncMidgardUrl();
      }
    };

    if (typeof chrome !== 'undefined') {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      alive = false;
      if (typeof chrome !== 'undefined') {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, [environmentName]);

  useEffect(() => {
    setCachedCardanoAvailableLovelace(getStoredCardanoAvailableLovelace(cardanoBalanceCacheKey));
  }, [cardanoBalanceCacheKey]);

  useEffect(() => {
    if (isMidgardEnabled || !cardanoBalanceCacheKey || typeof window === 'undefined') return;

    setCachedCardanoAvailableLovelace(availableLovelace);
    window.localStorage.setItem(cardanoBalanceCacheKey, availableLovelace.toString());
  }, [availableLovelace, cardanoBalanceCacheKey, isMidgardEnabled]);

  useEffect(() => {
    let alive = true;

    if (!isMidgardEnabled || !isDepositModalOpen || !environmentName) {
      setDepositFundingSummaryStatus('idle');
      setDepositFundingSummaryError(undefined);
      return () => {
        alive = false;
      };
    }

    setDepositFundingSummaryStatus('loading');
    setDepositFundingSummaryError(undefined);

    void getMidgardDepositFundingSummary({ chainName: environmentName, fundingAddresses })
      .then((summary) => {
        if (!alive) return;
        setDepositFundingSummary(summary);
        setDepositFundingSummaryStatus('loaded');
      })
      .catch((error) => {
        if (!alive) return;
        setDepositFundingSummaryStatus('error');
        setDepositFundingSummaryError(toErrorMessage(error));
      });

    return () => {
      alive = false;
    };
  }, [environmentName, fundingAddresses, isDepositModalOpen, isMidgardEnabled]);

  const depositAvailableLovelace = useMemo(
    () => (isMidgardEnabled ? cachedCardanoAvailableLovelace ?? availableLovelace : availableLovelace),
    [availableLovelace, cachedCardanoAvailableLovelace, isMidgardEnabled]
  );
  const depositFundingCapLovelace = useMemo(() => {
    if (!isMidgardEnabled) {
      return depositAvailableLovelace;
    }

    return depositFundingSummary?.totalAvailableCoins ?? BigInt(0);
  }, [depositAvailableLovelace, depositFundingSummary?.totalAvailableCoins, isMidgardEnabled]);
  const depositAvailableAda = useMemo(
    () => Wallet.util.lovelacesToAdaString(depositAvailableLovelace.toString()),
    [depositAvailableLovelace]
  );
  const depositFundingCapAda = useMemo(
    () => Wallet.util.lovelacesToAdaString(depositFundingCapLovelace.toString()),
    [depositFundingCapLovelace]
  );
  const depositAmountLovelace = useMemo(() => parseAdaToLovelace(depositAmountAda), [depositAmountAda]);
  const hasInvalidDepositAmount = !!depositAmountAda && !depositAmountLovelace;
  const exceedsAvailableBalance = !!depositAmountLovelace && depositAmountLovelace > depositFundingCapLovelace;
  const isDepositPasswordMissing = isInMemoryWallet && !password.value;
  const isDepositFundingSummaryLoading = isMidgardEnabled && isDepositModalOpen && depositFundingSummaryStatus === 'loading';
  const isDepositFundingSummaryUnavailable = depositFundingSummaryStatus === 'error';
  const canDeposit =
    !!depositAmountLovelace &&
    !exceedsAvailableBalance &&
    !isDepositPasswordMissing &&
    !isSharedWallet &&
    !isMidgardDegraded &&
    !isMidgardUrlMissing &&
    !isDepositFundingSummaryLoading &&
    !isDepositFundingSummaryUnavailable;
  const bannerLabelId = `${bannerId}-label`;
  const bannerSubtitleId = `${bannerId}-subtitle`;
  const bannerLiveRegionId = `${bannerId}-live-region`;

  const handleToggle = async () => {
    if (isMidgardSwitching) return;

    const nextState = !isMidgardEnabled;
    try {
      await setMidgardModeAndReload(nextState);

      if (!nextState) {
        setIsDepositModalOpen(false);
        setDepositAmountAda('');
        setDepositFundingSummaryError(undefined);
        setDepositFundingSummaryStatus('idle');
        clearSecrets();
      }

      toast.notify({
        text: nextState ? 'Midgard Layer 2 enabled' : 'Midgard Layer 2 disabled',
        withProgressBar: true,
        icon: SwitchIcon
      });
    } catch (error) {
      toast.notify({
        text: `Failed to switch Midgard mode: ${toErrorMessage(error)}`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    }
  };

  const retryMidgardHealth = async () => {
    if (!isMidgardEnabled || isMidgardSwitching) return;

    setIsRetryingMidgardHealth(true);

    try {
      const [submitHealth, historyHealth] = await Promise.all([
        blockchainProvider.txSubmitProvider.healthCheck(),
        blockchainProvider.chainHistoryProvider.healthCheck()
      ]);

      if (!submitHealth.ok || !historyHealth.ok) {
        throw new Error('Midgard is still unavailable. Lace kept Layer 2 mode enabled, but actions remain paused.');
      }

      setMidgardHealthHealthy();
      toast.notify({
        text: 'Midgard connection restored',
        withProgressBar: true,
        icon: SwitchIcon
      });
    } catch (error) {
      setMidgardHealthDegraded(toErrorMessage(error));
      toast.notify({
        text: `Midgard is still unavailable: ${toErrorMessage(error)}`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    } finally {
      setIsRetryingMidgardHealth(false);
    }
  };

  const handleDepositAmountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = normalizeAdaInput(event.target.value);
    if (nextValue === '' || ADA_INPUT_REGEX.test(nextValue)) {
      setDepositAmountAda(nextValue);
    }
  };

  const handleSetMaxDeposit = () => {
    setDepositAmountAda(depositFundingCapAda);
  };

  const handleToggleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    void handleToggle();
  };

  const resetDepositModalState = () => {
    setIsDepositModalOpen(false);
    setDepositAmountAda('');
    setIsDepositPasswordValid(true);
    setDepositFundingSummaryError(undefined);
    setDepositFundingSummaryStatus('idle');
    clearSecrets();
  };

  const closeDepositModal = () => {
    if (isProcessing) return;
    resetDepositModalState();
  };

  const submitDeposit = async () => {
    setIsDepositSubmitting(true);
    setIsDepositPasswordValid(true);

    try {
      const depositContext = getValidatedDepositContext({
        activeAddress,
        environmentName,
        midgardUrl,
        isSharedWallet,
        isMidgardDegraded: isMidgardDegraded || isMidgardUrlMissing,
        depositAmountLovelace,
        depositAvailableLovelace: depositFundingCapLovelace
      });

      const { unsignedTxCbor } = await buildMidgardDeposit({
        amount: depositContext.amount,
        chainName: depositContext.chainName,
        fundingAddresses,
        l2Address: depositContext.l2Address,
        midgardUrl: depositContext.midgardUrl
      });

      if (!walletInfo?.addresses?.length) {
        throw new Error('Wallet addresses are not available for Cardano signing');
      }
      if (!cardanoWallet?.source.wallet) {
        throw new Error('Active wallet metadata is not available for Cardano signing');
      }
      if (!cardanoWallet?.source.account) {
        throw new Error('Active account metadata is not available for Cardano signing');
      }
      if (!currentChain) {
        throw new Error('Active chain metadata is not available for Cardano signing');
      }

      const signedTxCbor = await withSignTxConfirmation(
        async () =>
          await signExternalCardanoTx({
            chainName: depositContext.chainName,
            knownAddresses: walletInfo.addresses,
            requestContext: {
              accountIndex: cardanoWallet.source.account.accountIndex,
              chainId: currentChain,
              purpose: cardanoWallet.source.account.purpose ?? Wallet.KeyManagement.KeyPurpose.STANDARD,
              wallet: cardanoWallet.source.wallet
            },
            txCbor: unsignedTxCbor
          }),
        isInMemoryWallet ? password.value : undefined
      );
      const txId = await submitSignedCardanoTx({
        chainName: depositContext.chainName,
        signedTxCbor
      });
      const eventId = getMidgardDepositEventIdFromTxCbor(signedTxCbor);
      const broadcastRequestedAt = new Date().toISOString();

      addMidgardPendingDeposit({
        accountIndex: cardanoWallet.source.account.accountIndex,
        txId,
        broadcastRequestedAt,
        cardanoTxId: txId,
        chainName: depositContext.chainName,
        txCbor: signedTxCbor,
        address: depositContext.l2Address,
        createdAt: broadcastRequestedAt,
        eventId,
        trackingStatus: 'broadcast_requested',
        walletId: cardanoWallet.source.wallet.walletId
      });

      resetDepositModalState();

      toast.notify({
        text: `Cardano broadcast requested for deposit. TX: ${txId.slice(
          0,
          TX_HASH_PREVIEW_LENGTH
        )}... Activity will update after Cardano or Midgard observes it.`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    } catch (error) {
      if (error instanceof Wallet.KeyManagement.errors.AuthenticationError) {
        setIsDepositPasswordValid(false);
      }
      toast.notify({
        text: `Deposit failed: ${toErrorMessage(error)}`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    } finally {
      clearSecrets();
      setIsDepositSubmitting(false);
    }
  };

  if (!shouldRenderMidgard) {
    return <></>;
  }

  const isMidgardSwitchFailed = midgardActivationStatus === 'error';
  let bannerStatus = 'Layer 2 Inactive';
  if (isMidgardSwitching) {
    bannerStatus = midgardTargetEnabled ? 'Activating Layer 2...' : 'Returning to Cardano...';
  } else if (isMidgardUrlMissing) {
    bannerStatus = 'Layer 2 Misconfigured';
  } else if (isMidgardSwitchFailed) {
    bannerStatus = 'Mode switch failed';
  } else if (isMidgardDegraded) {
    bannerStatus = 'Layer 2 Degraded';
  } else if (isMidgardEnabled) {
    bannerStatus = 'Layer 2 Active';
  }

  let bannerSubtitle = 'Shows your Midgard balance and routes Send transactions through Midgard Layer 2.';
  if (isMidgardSwitching) {
    bannerSubtitle = midgardTargetEnabled
      ? 'Reloading the wallet against Midgard so your balance, inputs, and Send path move to Layer 2 together.'
      : 'Rebinding the wallet to Cardano so Send and balance queries return to Layer 1.';
  } else if (isMidgardUrlMissing) {
    bannerSubtitle =
      'Midgard stayed enabled, but Lace could not resolve the active Midgard endpoint. Return to Cardano or restore the URL override.';
  } else if (isMidgardSwitchFailed) {
    bannerSubtitle = 'The last mode change did not complete. Your wallet stayed on the last confirmed provider set.';
  } else if (isMidgardDegraded) {
    bannerSubtitle =
      'Midgard stayed enabled, but Lace paused Layer 2 actions until the Midgard node becomes healthy again.';
  }

  let statePanelTitle = 'Mode switch did not complete';
  if (isMidgardSwitching) {
    statePanelTitle = midgardTargetEnabled ? 'Preparing Midgard providers' : 'Restoring Cardano providers';
  } else if (isMidgardUrlMissing) {
    statePanelTitle = 'Midgard endpoint unavailable';
  } else if (isMidgardDegraded) {
    statePanelTitle = 'Midgard connection degraded';
  }

  let statePanelBody =
    midgardActivationError ||
    'Retry the switch when you are ready. Lace will keep using the last confirmed provider set until then.';
  if (isMidgardSwitching) {
    statePanelBody = midgardTargetEnabled
      ? 'Send is locked until Lace finishes loading Midgard-backed UTxOs and the Midgard submit provider.'
      : 'Send is locked until Lace finishes restoring the Cardano wallet providers and input resolver.';
  } else if (isMidgardUrlMissing) {
    statePanelBody =
      'Lace could not resolve the Midgard URL from extension storage. Layer 2 actions are paused until the URL is restored or Midgard mode is disabled.';
  } else if (isMidgardDegraded) {
    statePanelBody =
      midgardHealthError ||
      'Lace kept your last Midgard balance and activity visible, but Layer 2 actions are paused until connectivity recovers.';
  }

  let statePanelMeta = 'Still using Cardano';
  if (isMidgardSwitching) {
    statePanelMeta = 'Send temporarily locked';
  } else if (isMidgardUrlMissing) {
    statePanelMeta = 'Return to Cardano recommended';
  } else if (isMidgardDegraded) {
    statePanelMeta = 'Balance and activity may be stale';
  } else if (isMidgardEnabled) {
    statePanelMeta = 'Still using Midgard';
  }

  let bannerToneClass = styles.disabled;
  if (isMidgardSwitching) {
    bannerToneClass = styles.switching;
  } else if (isMidgardUrlMissing) {
    bannerToneClass = styles.error;
  } else if (isMidgardSwitchFailed) {
    bannerToneClass = styles.error;
  } else if (isMidgardDegraded) {
    bannerToneClass = styles.degraded;
  } else if (isMidgardEnabled) {
    bannerToneClass = styles.enabled;
  }
  const bannerLiveRegionMessage = [
    bannerStatus,
    bannerSubtitle,
    (isMidgardSwitching || isMidgardUrlMissing || isMidgardSwitchFailed || isMidgardDegraded) &&
      `${statePanelTitle}. ${statePanelBody}`
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className={styles.container}>
        <div
          id={bannerLiveRegionId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={visuallyHiddenStyle}
          data-testid="midgard-mode-live-region"
        >
          {bannerLiveRegionMessage}
        </div>
        <div
          className={`${styles.banner} ${bannerToneClass}`}
          onClick={() => {
            void handleToggle();
          }}
          onKeyDown={handleToggleKeyDown}
          role="switch"
          tabIndex={0}
          aria-checked={isMidgardEnabled}
          aria-disabled={isMidgardSwitching}
          aria-busy={isMidgardSwitching}
          aria-labelledby={bannerLabelId}
          aria-describedby={`${bannerSubtitleId} ${bannerLiveRegionId}`}
          data-testid="midgard-mode-toggle"
        >
          <div className={styles.bannerTextGroup}>
            <div className={styles.bannerHeadingRow}>
              <span id={bannerLabelId} className={styles.text}>
                {t('general.networks.midgard')} mode
              </span>
              <span className={`${styles.statusPill} ${isMidgardSwitching ? styles.statusPillLoading : ''}`}>
                {isMidgardSwitching && <span className={styles.statusDot} aria-hidden="true" />}
                {bannerStatus}
              </span>
            </div>
            <span id={bannerSubtitleId} className={styles.bannerSubtitle}>
              {bannerSubtitle}
            </span>
          </div>
          <Switch
            checked={isMidgardEnabled}
            disabled={isMidgardSwitching}
            loading={isMidgardSwitching}
            size="default"
            aria-hidden="true"
            tabIndex={-1}
            data-testid="midgard-mode-switch"
          />
        </div>

        {(isMidgardSwitching || isMidgardUrlMissing || isMidgardSwitchFailed || isMidgardDegraded) && (
          <div
            className={`${styles.statePanel} ${
              isMidgardSwitching ? styles.statePanelSwitching : styles.statePanelError
            }`}
            aria-live="polite"
            aria-atomic="true"
            data-testid="midgard-mode-state-panel"
          >
            <div className={styles.statePanelHeader}>
              <div className={styles.statePanelHeadingGroup}>
                <span className={styles.statePanelTitle}>{statePanelTitle}</span>
                <span className={styles.statePanelBody}>{statePanelBody}</span>
              </div>
              <span className={styles.statePanelMeta}>{statePanelMeta}</span>
            </div>
            {(isMidgardDegraded || isMidgardUrlMissing) && (
              <div className={styles.statePanelActions}>
                {isMidgardDegraded && (
                  <Button
                    color="primary"
                    size="small"
                    onClick={() => {
                      void retryMidgardHealth();
                    }}
                    disabled={isProcessing}
                    data-testid="midgard-retry-health-button"
                  >
                    {isRetryingMidgardHealth ? 'Retrying...' : 'Retry Midgard'}
                  </Button>
                )}
                <Button
                  color="secondary"
                  size="small"
                  onClick={() => {
                    void handleToggle();
                  }}
                  disabled={isProcessing}
                  data-testid="midgard-return-cardano-button"
                >
                  Return to Cardano
                </Button>
              </div>
            )}
          </div>
        )}

        {isMidgardEnabled && (
          <div className={styles.actionPanel}>
            <div className={styles.actionIntro}>
              <span className={styles.actionTitle}>Midgard actions</span>
              <span className={styles.actionHint}>
                Deposit funds to your Midgard wallet. 
              </span>
              {isSharedWallet && (
                <span className={styles.errorText}>Deposit is currently unavailable for shared wallets.</span>
              )}
              {isMidgardUrlMissing && (
                <span className={styles.errorText}>Midgard actions are paused until the active Midgard URL is restored.</span>
              )}
              {isMidgardDegraded && (
                <span className={styles.errorText}>Midgard is unavailable. Balance and activity may be stale.</span>
              )}
            </div>
            <div className={styles.actionButtons}>
              <Button
                color="gradient"
                size="medium"
                className={styles.actionButton}
                onClick={() => setIsDepositModalOpen(true)}
                disabled={isProcessing || isSharedWallet || isMidgardDegraded || isMidgardUrlMissing}
                data-testid="midgard-deposit-action-button"
              >
                Deposit ADA
              </Button>
              <Button
                color="secondary"
                size="medium"
                className={styles.withdrawButton}
                disabled
                data-testid="midgard-withdraw-action-button"
              >
                Withdraw ADA
              </Button>
            </div>
          </div>
        )}
      </div>
      <Drawer
        visible={isMidgardEnabled && isDepositModalOpen}
        onClose={closeDepositModal}
        popupView={popupView}
        dataTestId="midgard-deposit-drawer"
        navigation={
          <DrawerNavigation title={!popupView ? <div>Midgard</div> : undefined} onCloseIconClick={closeDepositModal} />
        }
        title={
          <DrawerHeader
            popupView={popupView}
            title="Deposit ADA"
            subtitle="Move ADA from your Cardano balance into Midgard so it is available while Layer 2 mode is enabled."
          />
        }
        footer={
          <div className={styles.drawerFooter}>
            <Button
              color="primary"
              size="medium"
              className={styles.footerButton}
              onClick={submitDeposit}
              disabled={isProcessing || !canDeposit}
              data-testid="midgard-deposit-confirm-button"
            >
              {isDepositSubmitting ? 'Depositing...' : 'Confirm Deposit'}
            </Button>
            <Button
              color="secondary"
              size="medium"
              className={styles.footerButton}
              onClick={closeDepositModal}
              disabled={isProcessing}
              data-testid="midgard-deposit-cancel-button"
            >
              Cancel
            </Button>
          </div>
        }
        maskClosable={!isProcessing}
        destroyOnClose
        keyboard={!isProcessing}
      >
        <div className={styles.drawerBody}>
          <div className={styles.drawerCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeadingGroup}>
                <span className={styles.cardEyebrow}>Midgard destination</span>
                <span className={styles.cardTitle}>Deposit into your active Layer 2 wallet</span>
              </div>
              <span className={styles.cardBadge}>Cardano to Midgard</span>
            </div>
            <div className={styles.destinationValue}>{shortenAddress(activeAddress)}</div>
            <p className={styles.destinationHint}>
              The deposit is built by Midgard, signed locally in Lace, and broadcast on Cardano L1.
            </p>
          </div>

          <div className={styles.formCard}>
            <div className={styles.formCardHeader}>
              <div className={styles.formCardCopy}>
                <span className={styles.fieldLabel}>Deposit amount</span>
                <span className={styles.fieldHint}>Choose how much ADA to move from Cardano into Midgard.</span>
              </div>
              <span className={styles.balancePill}>
                {isMidgardEnabled ? `${depositFundingCapAda} ADA depositable now` : `${depositAvailableAda} ADA available`}
              </span>
            </div>

            <div className={styles.depositInputRow}>
              <Input
                className={styles.depositInput}
                value={depositAmountAda}
                onChange={handleDepositAmountChange}
                onPressEnter={() => {
                  if (canDeposit && !isProcessing) void submitDeposit();
                }}
                placeholder="0.00"
                disabled={isProcessing}
                inputMode="decimal"
                data-testid="midgard-deposit-amount-input"
              />
              <div className={styles.inputSideControls}>
                <span className={styles.inputAsset}>ADA</span>
                <Button
                  color="secondary"
                  size="small"
                  className={styles.maxButton}
                  onClick={handleSetMaxDeposit}
                  disabled={isProcessing || isDepositFundingSummaryLoading || depositFundingCapLovelace === BigInt(0)}
                  data-testid="midgard-deposit-max-button"
                >
                  Max
                </Button>
              </div>
            </div>

            <div className={styles.depositMeta}>
              <span className={styles.availableText}>Cardano balance snapshot: {depositAvailableAda} ADA</span>
              {isDepositFundingSummaryLoading && (
                <span className={styles.availableText}>Checking which Cardano address can currently fund this deposit…</span>
              )}
              {isDepositFundingSummaryUnavailable && depositFundingSummaryError && (
                <span className={styles.errorText}>{depositFundingSummaryError}</span>
              )}
              {hasInvalidDepositAmount && <span className={styles.errorText}>Enter a valid ADA amount</span>}
              {exceedsAvailableBalance && <span className={styles.errorText}>Amount exceeds available balance</span>}
            </div>
          </div>

          {isInMemoryWallet && (
            <div className={styles.formCard}>
              <span className={styles.fieldLabel}>Authorize deposit</span>
              <span className={styles.fieldHint}>
                Enter your Lace password to sign the Cardano deposit transaction.
              </span>
              <PasswordInput
                onChange={(nextPassword) => {
                  if (!isDepositPasswordValid) {
                    setIsDepositPasswordValid(true);
                  }
                  setPassword(nextPassword);
                }}
                label="Password"
                dataTestId="midgard-deposit-password-input"
                error={!isDepositPasswordValid}
                errorMessage={!isDepositPasswordValid ? 'Invalid password' : undefined}
                wrapperClassName={styles.passwordWrapper}
                id={DEPOSIT_PASSWORD_INPUT_ID}
              />
            </div>
          )}

          <div className={styles.noticeCard}>
            Activity will show this deposit as <strong>Broadcast requested</strong> until Cardano or Midgard observes it.
          </div>
        </div>
      </Drawer>
    </>
  );
};
