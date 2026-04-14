import { useCurrencyStore } from '@providers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { logger } from '@lace/common';
import { useFetchCoinPrice } from './useFetchCoinPrice';
import { WalletActivitiesSlice, useWalletStore } from '@src/stores';
import noop from 'lodash/noop';
import { mapWalletActivities } from '@src/stores/slices';
import { Wallet } from '@lace/cardano';
import { AssetActivityListProps, useItemsPageSize } from '@lace/core';
import { UseTxHistoryLoader, useTxHistoryLoader } from './useTxHistoryLoader';
import { useAsyncSwitchMap } from '@hooks/useAsyncSwitchMap';
import { ObservableWalletState } from './useWalletState';
import { MidgardPendingActivity, midgardPendingActivityMatchesTxIds } from '@stores/slices/midgard-slice';
import {
  enrichTransactionsWithMidgardDepositProvenance,
  loadMidgardCardanoDepositHistory
} from '@src/utils/midgard-cardano-deposit-history';
import {
  getStoredMidgardPendingActivities,
  readMidgardPendingActivitiesStorageChange
} from '@src/utils/midgard-pending-activities-storage';
import { Storage, storage } from 'webextension-polyfill';

type UseWalletActivitiesProps = {
  sendAnalytics: () => void;
  withLimitedRewardsHistory?: boolean;
};
const noAnalyticsProps = { sendAnalytics: noop };
type WalletActivities = Omit<WalletActivitiesSlice, 'getWalletActivities'>;

const getConfirmedMidgardPendingActivityIds = ({
  walletState,
  midgardPendingActivities
}: {
  walletState: ObservableWalletState;
  midgardPendingActivities: MidgardPendingActivity[];
}): string[] => {
  const walletAddressSet = new Set(walletState.addresses.map(({ address }) => address.toString()));
  const confirmedHistoryTxIds = new Set(walletState.transactions.history.map(({ id }) => id.toString()));

  return midgardPendingActivities
    .filter(
      (pendingActivity) =>
        walletAddressSet.has(pendingActivity.address) &&
        midgardPendingActivityMatchesTxIds(pendingActivity, confirmedHistoryTxIds)
    )
    .map(({ txId }) => txId);
};

const usePruneConfirmedMidgardPendingActivities = ({
  walletState,
  midgardPendingActivities,
  removeMidgardPendingActivities
}: {
  walletState: ObservableWalletState | null;
  midgardPendingActivities: MidgardPendingActivity[];
  removeMidgardPendingActivities: (txIds: string[]) => void;
}) => {
  const confirmedMidgardPendingActivityIds = useMemo(
    () => (walletState ? getConfirmedMidgardPendingActivityIds({ walletState, midgardPendingActivities }) : []),
    [midgardPendingActivities, walletState]
  );

  useEffect(() => {
    if (confirmedMidgardPendingActivityIds.length > 0) {
      removeMidgardPendingActivities(confirmedMidgardPendingActivityIds);
    }
  }, [confirmedMidgardPendingActivityIds, removeMidgardPendingActivities]);
};

const useSyncMidgardPendingActivities = ({
  setMidgardPendingActivities
}: {
  setMidgardPendingActivities: (pendingActivities: MidgardPendingActivity[]) => void;
}) => {
  useEffect(() => {
    let alive = true;

    void getStoredMidgardPendingActivities()
      .then((pendingActivities) => {
        if (alive) {
          setMidgardPendingActivities(pendingActivities);
        }
      })
      .catch((error) => {
        logger.warn('Failed to load Midgard pending activities from extension storage', error);
      });

    const handleStorageChange = (changes: Storage.StorageAreaOnChangedChangesType, areaName: string) => {
      const pendingActivities = readMidgardPendingActivitiesStorageChange(changes, areaName);
      if (pendingActivities === undefined) {
        return;
      }

      setMidgardPendingActivities(pendingActivities);
    };

    storage.onChanged.addListener(handleStorageChange);

    return () => {
      alive = false;
      storage.onChanged.removeListener(handleStorageChange);
    };
  }, [setMidgardPendingActivities]);
};

const useMidgardCardanoDepositHistory = ({
  walletState,
  environmentName,
  isMidgardEnabled
}: {
  walletState: ObservableWalletState | null;
  environmentName?: Wallet.ChainName;
  isMidgardEnabled: boolean;
}): {
  isReady: boolean;
  supplementalCardanoDepositHistory: Wallet.Cardano.HydratedTx[];
} => {
  const [supplementalCardanoDepositHistory, setSupplementalCardanoDepositHistory] = useState<
    Wallet.Cardano.HydratedTx[] | undefined
  >([]);

  const addressesKey = useMemo(
    () => walletState?.addresses.map(({ address }) => address.toString()).join('|') ?? '',
    [walletState?.addresses]
  );

  useEffect(() => {
    let alive = true;

    if (!isMidgardEnabled || !environmentName || !walletState || addressesKey.length === 0) {
      setSupplementalCardanoDepositHistory([]);
      return () => {
        alive = false;
      };
    }

    setSupplementalCardanoDepositHistory(undefined);

    void loadMidgardCardanoDepositHistory({
      addresses: walletState.addresses,
      chainName: environmentName
    })
      .then((history) => {
        if (alive) {
          setSupplementalCardanoDepositHistory(history);
        }
      })
      .catch((error) => {
        logger.warn('Failed to load supplemental Cardano Midgard deposit history', error);
        if (alive) {
          setSupplementalCardanoDepositHistory([]);
        }
      });

    return () => {
      alive = false;
    };
  }, [addressesKey, environmentName, isMidgardEnabled, walletState]);

  return {
    isReady: supplementalCardanoDepositHistory !== undefined,
    supplementalCardanoDepositHistory: supplementalCardanoDepositHistory ?? []
  };
};

export const useWalletActivities = ({
  sendAnalytics,
  withLimitedRewardsHistory
}: UseWalletActivitiesProps = noAnalyticsProps): WalletActivities => {
  const { fiatCurrency } = useCurrencyStore();
  const { priceResult } = useFetchCoinPrice();
  const {
    getWalletActivities,
    walletActivitiesStatus,
    walletActivities,
    activitiesCount,
    walletState,
    midgardPendingActivities,
    setMidgardPendingActivities,
    removeMidgardPendingActivities
  } = useWalletStore();

  const cardanoFiatPrice = priceResult?.cardano?.price;
  useSyncMidgardPendingActivities({ setMidgardPendingActivities });
  usePruneConfirmedMidgardPendingActivities({
    walletState,
    midgardPendingActivities,
    removeMidgardPendingActivities
  });

  const fetchWalletActivities = useCallback(async () => {
    fiatCurrency &&
      cardanoFiatPrice &&
      getWalletActivities({
        fiatCurrency,
        cardanoFiatPrice,
        sendAnalytics,
        withLimitedRewardsHistory
      });
  }, [fiatCurrency, cardanoFiatPrice, getWalletActivities, withLimitedRewardsHistory, sendAnalytics]);

  useEffect(() => {
    fetchWalletActivities();
  }, [
    fetchWalletActivities,
    walletState?.transactions.history,
    walletState?.transactions.outgoing.inFlight,
    walletState?.transactions.outgoing.signed,
    walletState?.addresses,
    walletState?.assetInfo,
    walletState?.delegation.rewardsHistory,
    walletState?.eraSummaries,
    midgardPendingActivities
  ]);

  return {
    walletActivitiesStatus,
    walletActivities,
    activitiesCount
  };
};

export type WalletActivitiesPaginated = Pick<WalletActivities, 'walletActivities'> &
  Pick<UseTxHistoryLoader, 'error' | 'retry'> & {
    loadMore: () => void;
    mightHaveMore: boolean;
    loadedTxLength?: number;
  };

export const useWalletActivitiesPaginated = ({
  sendAnalytics
}: UseWalletActivitiesProps = noAnalyticsProps): WalletActivitiesPaginated => {
  const [walletActivities, setWalletActivities] = useState<AssetActivityListProps[] | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const { fiatCurrency } = useCurrencyStore();
  const { priceResult } = useFetchCoinPrice();
  const {
    walletUI: { cardanoCoin },
    walletState,
    setTransactionActivityDetail,
    setRewardsActivityDetail,
    assetDetails,
    blockchainProvider: { assetProvider, chainHistoryProvider, inputResolver },
    environmentName,
    midgardPendingActivities,
    setMidgardPendingActivities,
    removeMidgardPendingActivities,
    isMidgardEnabled,
    isSharedWallet
  } = useWalletStore();

  const cardanoFiatPrice = priceResult?.cardano?.price;

  const pageSize = useItemsPageSize();
  useSyncMidgardPendingActivities({ setMidgardPendingActivities });
  usePruneConfirmedMidgardPendingActivities({
    walletState,
    midgardPendingActivities,
    removeMidgardPendingActivities
  });
  const { isReady: isSupplementalCardanoDepositHistoryReady, supplementalCardanoDepositHistory } =
    useMidgardCardanoDepositHistory({
      walletState,
      environmentName,
      isMidgardEnabled
    });

  const { loadMore: txHistoryLoaderLoadMore, retry, error, loadedHistory } = useTxHistoryLoader(pageSize);

  const fetchActivitiesProps = useMemo(
    () => ({
      fiatCurrency,
      cardanoFiatPrice,
      sendAnalytics,
      withLimitedRewardsHistory: true
    }),
    [cardanoFiatPrice, fiatCurrency, sendAnalytics]
  );

  const fetchActivitiesDeps = useMemo(
    () => ({
      assetProvider,
      chainHistoryProvider,
      cardanoCoin,
      setRewardsActivityDetail,
      setTransactionActivityDetail,
      assetDetails,
      inputResolver,
      midgardPendingActivities,
      environmentName,
      isMidgardEnabled,
      isSharedWallet,
      supplementalCardanoDepositHistory
    }),
    [
      assetProvider,
      chainHistoryProvider,
      cardanoCoin,
      setRewardsActivityDetail,
      setTransactionActivityDetail,
      assetDetails,
      inputResolver,
      midgardPendingActivities,
      environmentName,
      isMidgardEnabled,
      isSharedWallet,
      supplementalCardanoDepositHistory
    ]
  );

  const mapActivities = useCallback(
    async (history: Wallet.Cardano.HydratedTx[]) => {
      const { transactions } = walletState;
      const historyWithMidgardDeposits =
        environmentName && history.length > 0
          ? await enrichTransactionsWithMidgardDepositProvenance({
              environmentName,
              transactions: history
            }).catch((error) => {
              logger.warn('Failed to enrich paginated Cardano history with confirmed Midgard deposits', error);
              return history;
            })
          : history;

      return (
        await mapWalletActivities(
          {
            ...walletState,
            transactions: { ...transactions, history: historyWithMidgardDeposits }
          },
          fetchActivitiesProps,
          fetchActivitiesDeps
        )
      ).walletActivities;
    },
    [environmentName, fetchActivitiesDeps, fetchActivitiesProps, walletState]
  );

  const handleUpdateWalletActivities = useAsyncSwitchMap(mapActivities, setWalletActivities);

  useEffect(() => {
    (async () => {
      if (
        loadedHistory?.transactions === undefined ||
        !fiatCurrency ||
        !cardanoFiatPrice ||
        !isSupplementalCardanoDepositHistoryReady
      )
        return;

      handleUpdateWalletActivities(loadedHistory.transactions.slice(0, currentPage * pageSize));
    })();
  }, [
    cardanoFiatPrice,
    currentPage,
    fetchActivitiesDeps,
    fetchActivitiesProps,
    fiatCurrency,
    handleUpdateWalletActivities,
    isSupplementalCardanoDepositHistoryReady,
    loadedHistory?.transactions,
    mapActivities,
    pageSize,
    walletState
  ]);

  const loadMore = useCallback(() => {
    if (currentPage * pageSize >= (loadedHistory?.transactions?.length ?? 0)) {
      txHistoryLoaderLoadMore();
    }
    setCurrentPage((prevPage) => prevPage + 1);
  }, [currentPage, loadedHistory?.transactions?.length, pageSize, txHistoryLoaderLoadMore]);

  return {
    walletActivities,
    mightHaveMore: loadedHistory?.mightHaveMore,
    loadedTxLength: loadedHistory?.transactions?.slice(0, currentPage * pageSize).length,
    loadMore,
    retry,
    error
  };
};
