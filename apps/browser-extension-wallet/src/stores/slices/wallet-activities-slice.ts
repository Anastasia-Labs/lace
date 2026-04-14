/* eslint-disable sonarjs/cognitive-complexity */
import flattenDeep from 'lodash/flattenDeep';
import uniq from 'lodash/uniq';
import { GetState, SetState } from 'zustand';
import BigNumber from 'bignumber.js';
import groupBy from 'lodash/groupBy';
import flatten from 'lodash/flatten';
import memoize from 'lodash/memoize';
import { logger } from '@lace/common';
import { Wallet } from '@lace/cardano';
import { Reward, Serialization, epochSlotsCalc } from '@cardano-sdk/core';
import {
  pendingTxTransformer,
  txHistoryTransformer,
  filterOutputsByTxDirection,
  isTxWithAssets,
  TransformedActivity,
  TransformedTransactionActivity
} from '@src/views/browser-view/features/activity/helpers';
import {
  ActivityAssetProp,
  ActivityStatus,
  AssetActivityItemProps,
  AssetActivityListProps,
  ConwayEraCertificatesTypes,
  DelegationActivityType,
  TransactionActivityType
} from '@lace/core';
import { CurrencyInfo, TxDirections } from '@src/types';
import { getTxDirection, inspectTxType } from '@src/utils/tx-inspection';
import { assetTransformer } from '@src/utils/assets-transformers';
import {
  WalletActivitiesSlice,
  StateStatus,
  WalletInfoSlice,
  AssetDetailsSlice,
  ActivityDetailSlice,
  UISlice,
  BlockchainProviderSlice,
  SliceCreator
} from '../types';
import { getAssetsInformation } from '@src/utils/get-assets-information';
import {
  enrichTransactionsWithMidgardDepositProvenance,
  loadMidgardCardanoDepositHistory
} from '@src/utils/midgard-cardano-deposit-history';
import { rewardHistoryTransformer } from '@src/views/browser-view/features/activity/helpers/reward-history-transformer';
import { isKeyHashAddress } from '@cardano-sdk/wallet';
import { ObservableWalletState } from '@hooks/useWalletState';
import { IBlockchainProvider } from './blockchain-provider-slice';
import {
  MIDGARD_PENDING_BROADCAST_NOT_OBSERVED_LABEL,
  MIDGARD_PENDING_BROADCAST_REQUESTED_LABEL,
  MIDGARD_PENDING_TRACKING_STATUS_KEY,
  getPendingMidgardActivityGroupTitle,
  getPendingMidgardActivityLabel,
  isMidgardActivity,
  isMidgardActivityLabel
} from '@src/views/browser-view/features/activity/helpers/midgard-activity';
import {
  MidgardPendingActivity,
  MidgardSlice,
  isMidgardLegacyPendingActivityRecord,
  isMidgardNativePendingActivityRecord,
  midgardPendingActivityMatchesTxIds
} from './midgard-slice';

export interface FetchWalletActivitiesProps {
  fiatCurrency: CurrencyInfo;
  cardanoFiatPrice: number;
  sendAnalytics?: () => void;
  withLimitedRewardsHistory?: boolean;
}

interface FetchWalletActivitiesPropsWithSetter extends FetchWalletActivitiesProps {
  get: GetState<
    WalletInfoSlice &
      WalletActivitiesSlice &
      ActivityDetailSlice &
      AssetDetailsSlice &
      UISlice &
      BlockchainProviderSlice &
      MidgardSlice
  >;
  set: SetState<WalletActivitiesSlice>;
}

type ExtendedActivityProps = TransformedActivity & AssetActivityItemProps;
type WalletActivitiesMapper = (...args: Parameters<typeof mapWalletActivities>) => ReturnType<typeof mapWalletActivities>;

type extendedDelegationActivityType =
  | DelegationActivityType
  | ConwayEraCertificatesTypes.Registration
  | ConwayEraCertificatesTypes.Unregistration;

type MidgardPendingActivityDetailTx = (Wallet.Cardano.HydratedTx | Wallet.Cardano.Tx) & {
  [MIDGARD_PENDING_TRACKING_STATUS_KEY]?: MidgardPendingActivity['trackingStatus'];
};

type DelegationActivityItemProps = Omit<ExtendedActivityProps, 'type'> & {
  type: extendedDelegationActivityType;
};

const getPendingMidgardActivityFallbacks = (
  pendingActivity: MidgardPendingActivity
): Pick<TransformedTransactionActivity, 'direction' | 'type'> & { label?: string } => {
  if (pendingActivity.kind === 'deposit') {
    if (pendingActivity.trackingStatus === 'broadcast_not_observed') {
      return {
        direction: TxDirections.Outgoing,
        label: MIDGARD_PENDING_BROADCAST_NOT_OBSERVED_LABEL,
        type: TransactionActivityType.outgoing
      };
    }

    if (pendingActivity.trackingStatus === 'broadcast_requested') {
      return {
        direction: TxDirections.Outgoing,
        label: MIDGARD_PENDING_BROADCAST_REQUESTED_LABEL,
        type: TransactionActivityType.outgoing
      };
    }
  }

  switch (pendingActivity.kind) {
    case 'deposit':
      return {
        direction: TxDirections.Outgoing,
        label: 'Depositing',
        type: TransactionActivityType.outgoing
      };
    case 'withdrawal':
      return {
        direction: TxDirections.Incoming,
        label: 'Withdrawing',
        type: TransactionActivityType.incoming
      };
    default:
      return {
        direction: TxDirections.Outgoing,
        type: TransactionActivityType.outgoing
      };
  }
};

const isDelegationActivity = (activity: ExtendedActivityProps): activity is DelegationActivityItemProps =>
  activity.type in DelegationActivityType ||
  activity.type === ConwayEraCertificatesTypes.Registration ||
  activity.type === ConwayEraCertificatesTypes.Unregistration;

const getDelegationAmount = (activity: DelegationActivityItemProps) => {
  const fee = new BigNumber(Number.parseFloat(activity.fee));

  if (
    activity.type === DelegationActivityType.delegationRegistration ||
    activity.type === ConwayEraCertificatesTypes.Registration
  ) {
    return fee.plus(activity.deposit).negated();
  }

  if (
    activity.type === DelegationActivityType.delegationDeregistration ||
    activity.type === ConwayEraCertificatesTypes.Unregistration
  ) {
    return new BigNumber(activity.depositReclaim).minus(fee);
  }

  return fee.negated();
};

const FIAT_PRICE_DECIMAL_PLACES = 2;

const getFiatAmount = (amount: BigNumber, fiatPrice: number) =>
  fiatPrice ? amount.times(new BigNumber(fiatPrice)).toFormat(FIAT_PRICE_DECIMAL_PLACES) : '';

export const REWARD_SPENDABLE_DELAY_EPOCHS = 2;

export const getRewardSpendableDate = (
  spendableEpoch: Wallet.Cardano.EpochNo,
  eraSummaries: Wallet.EraSummary[]
): Date => {
  const slotTimeCalc = Wallet.createSlotTimeCalc(eraSummaries);
  return slotTimeCalc(epochSlotsCalc(spendableEpoch, eraSummaries).firstSlot);
};

const initialState = {
  walletActivities: [] as AssetActivityListProps[],
  activitiesCount: 0,
  walletActivitiesStatus: StateStatus.IDLE
};

const dependencyIdentityCache = new WeakMap<object, number>();
let nextDependencyIdentity = 0;

const getDependencyIdentity = (dependency: object | undefined): string => {
  if (!dependency) return 'none';

  const cachedIdentity = dependencyIdentityCache.get(dependency);
  if (cachedIdentity) {
    return cachedIdentity.toString();
  }

  const nextIdentity = ++nextDependencyIdentity;
  dependencyIdentityCache.set(dependency, nextIdentity);
  return nextIdentity.toString();
};

const mergeTransactionsById = (
  primaryTransactions: Wallet.Cardano.HydratedTx[],
  secondaryTransactions: Wallet.Cardano.HydratedTx[] = []
): Wallet.Cardano.HydratedTx[] => {
  const transactionsById = new Map<string, Wallet.Cardano.HydratedTx>();

  for (const transaction of primaryTransactions) {
    transactionsById.set(transaction.id.toString(), transaction);
  }

  for (const transaction of secondaryTransactions) {
    const txId = transaction.id.toString();
    if (!transactionsById.has(txId)) {
      transactionsById.set(txId, transaction);
    }
  }

  return [...transactionsById.values()];
};

export const mapWalletActivities = memoize(
  async (
    {
      addresses,
      transactions,
      eraSummaries,
      protocolParameters,
      assetInfo,
      delegation: { rewardsHistory }
    }: ObservableWalletState,
    { fiatCurrency, cardanoFiatPrice, sendAnalytics, withLimitedRewardsHistory = false }: FetchWalletActivitiesProps,
    {
      assetDetails,
      assetProvider,
      chainHistoryProvider,
      cardanoCoin,
      setRewardsActivityDetail,
      setTransactionActivityDetail,
      midgardPendingActivities,
      isMidgardEnabled,
      environmentName,
      isSharedWallet,
      inputResolver,
      supplementalCardanoDepositHistory = []
    }: Pick<UISlice['walletUI'], 'cardanoCoin'> &
      Pick<ActivityDetailSlice, 'setRewardsActivityDetail' | 'setTransactionActivityDetail'> &
      Pick<AssetDetailsSlice, 'assetDetails'> &
      Pick<IBlockchainProvider, 'chainHistoryProvider' | 'inputResolver'> &
      Pick<IBlockchainProvider, 'assetProvider'> &
      Pick<MidgardSlice, 'midgardPendingActivities' | 'isMidgardEnabled'> &
      Pick<WalletInfoSlice, 'environmentName' | 'isSharedWallet'> & {
        supplementalCardanoDepositHistory?: Wallet.Cardano.HydratedTx[];
      }
  ) => {
    const epochRewardsMapper = (earnedEpoch: Wallet.Cardano.EpochNo, rewards: Reward[]): ExtendedActivityProps => {
      const spendableEpoch = (earnedEpoch + REWARD_SPENDABLE_DELAY_EPOCHS) as Wallet.Cardano.EpochNo;
      const rewardSpendableDate = getRewardSpendableDate(spendableEpoch, eraSummaries);

      const transformedEpochRewards = rewardHistoryTransformer({
        rewards,
        fiatCurrency,
        fiatPrice: cardanoFiatPrice,
        cardanoCoin,
        date: rewardSpendableDate
      });

      return {
        ...transformedEpochRewards,
        onClick: () => {
          if (sendAnalytics) sendAnalytics();
          setRewardsActivityDetail({
            activity: {
              rewards,
              spendableEpoch,
              spendableDate: rewardSpendableDate
            }
          });
        }
      };
    };

    const { resolveInput } = inputResolver;

    // eslint-disable-next-line unicorn/no-array-callback-reference
    const keyHashAddresses = addresses.filter(isKeyHashAddress);
    if (keyHashAddresses.length !== addresses.length) {
      throw new Error('TODO: implement script address support');
    }

    const resolvePendingMidgardTransaction = async (
      pendingActivity: MidgardPendingActivity
    ): Promise<Wallet.Cardano.HydratedTx | Wallet.Cardano.Tx> => {
      if (isMidgardNativePendingActivityRecord(pendingActivity)) {
        return Wallet.decodeMidgardPendingTx(pendingActivity.nativeTxCbor);
      }

      try {
        const [resolvedTx] = await chainHistoryProvider.transactionsByHashes({
          ids: [Wallet.Cardano.TransactionId(pendingActivity.txId)]
        });
        if (resolvedTx) {
          return resolvedTx;
        }
      } catch {
        // Fall back to the locally persisted transaction below while the Midgard tx is not yet queryable.
      }

      if (isMidgardLegacyPendingActivityRecord(pendingActivity)) {
        return {
          ...Serialization.TxCBOR.deserialize(pendingActivity.txCbor),
          id: Wallet.Cardano.TransactionId(pendingActivity.txId)
        } as Wallet.Cardano.Tx;
      }

      throw new Error(`Unsupported Midgard pending activity format: ${(pendingActivity as MidgardPendingActivity).txFormat}`);
    };

    const historicTransactionMapper = async ({
      tx
    }: {
      tx: Wallet.Cardano.HydratedTx;
    }): Promise<ExtendedActivityProps[]> => {
      const slotTimeCalc = Wallet.createSlotTimeCalc(eraSummaries);
      const date = slotTimeCalc(tx.blockHeader.slot);
      const transformedTransaction = await txHistoryTransformer({
        tx,
        walletAddresses: keyHashAddresses,
        fiatCurrency,
        fiatPrice: cardanoFiatPrice,
        date,
        protocolParameters,
        cardanoCoin,
        resolveInput,
        environmentName,
        isSharedWallet
      });

      const extendWithClickHandler = (transformedTx: TransformedTransactionActivity) => ({
        ...transformedTx,
        onClick: () => {
          if (sendAnalytics) sendAnalytics();
          setTransactionActivityDetail({
            activity: tx,
            direction: transformedTx.direction,
            status: transformedTx.status,
            type: transformedTx.type
          });
        }
      });

      return transformedTransaction.map((tt) => extendWithClickHandler(tt));
    };

    const pendingTransactionMapper = async (
      tx: Wallet.TxInFlight | Wallet.KeyManagement.WitnessedTx,
      status?: Wallet.TransactionStatus
    ): Promise<ExtendedActivityProps[]> => {
      let date;
      if ('submittedAt' in tx) {
        try {
          const slotTimeCalc = Wallet.createSlotTimeCalc(eraSummaries);
          date = slotTimeCalc(tx.submittedAt);
        } catch {
          date = new Date();
        }
      }
      const transformedTransaction = await pendingTxTransformer({
        tx,
        walletAddresses: keyHashAddresses,
        fiatPrice: cardanoFiatPrice,
        fiatCurrency,
        protocolParameters,
        cardanoCoin,
        date,
        resolveInput,
        status,
        isSharedWallet
      });

      const extendWithClickHandler = (transformedTx: TransformedTransactionActivity) => ({
        ...transformedTx,
        onClick: () => {
          if (sendAnalytics) sendAnalytics();
          const deserializedTx: Wallet.Cardano.Tx = Serialization.TxCBOR.deserialize(tx.cbor);
          setTransactionActivityDetail({
            activity: deserializedTx,
            direction: TxDirections.Outgoing,
            status: ActivityStatus.PENDING,
            type: transformedTx.type
          });
        }
      });

      return transformedTransaction.map((tt) => extendWithClickHandler(tt));
    };

    const pendingMidgardActivityMapper = async (
      pendingActivity: MidgardPendingActivity
    ): Promise<ExtendedActivityProps[]> => {
      const resolvedTx = await resolvePendingMidgardTransaction(pendingActivity);
      const transformedTransaction = await pendingTxTransformer({
        tx: resolvedTx as unknown as Wallet.TxInFlight,
        walletAddresses: keyHashAddresses,
        fiatPrice: cardanoFiatPrice,
        fiatCurrency,
        protocolParameters,
        cardanoCoin,
        date: new Date(pendingActivity.createdAt),
        resolveInput,
        isSharedWallet
      });
      const resolvedTxWithTrackingStatus: MidgardPendingActivityDetailTx = {
        ...resolvedTx,
        [MIDGARD_PENDING_TRACKING_STATUS_KEY]: pendingActivity.trackingStatus
      };
      const fallbackMidgardActivity = getPendingMidgardActivityFallbacks(pendingActivity);
      const label =
        pendingActivity.kind === 'send'
          ? undefined
          : getPendingMidgardActivityLabel(resolvedTxWithTrackingStatus, environmentName) ?? fallbackMidgardActivity.label;
      const formattedDate =
        pendingActivity.kind === 'send'
          ? undefined
          : getPendingMidgardActivityGroupTitle(resolvedTxWithTrackingStatus, environmentName);
      const pendingActivityStatus =
        pendingActivity.trackingStatus === 'broadcast_not_observed' ? ActivityStatus.ERROR : ActivityStatus.PENDING;

      return transformedTransaction.map((transformedTx) => ({
        ...transformedTx,
        ...(pendingActivity.kind !== 'send' && {
          direction: fallbackMidgardActivity.direction,
          type: fallbackMidgardActivity.type
        }),
        id: pendingActivity.txId,
        ...(label && { label }),
        ...(formattedDate && { formattedDate }),
        status: pendingActivityStatus,
        onClick: () => {
          if (sendAnalytics) sendAnalytics();
          setTransactionActivityDetail({
            activity: resolvedTxWithTrackingStatus,
            direction: transformedTx.direction,
            status: pendingActivityStatus,
            type: transformedTx.type
          });
        }
      }));
    };

    const filterTransactionByAssetId = async (txs: Wallet.Cardano.HydratedTx[]) => {
      const txsWithType = await Promise.all(
        txs.map(async (tx) => {
          const type = await inspectTxType({ walletAddresses: keyHashAddresses, tx, inputResolver, isSharedWallet });
          return { tx, type };
        })
      );
      return txsWithType.filter(({ tx, type }) => {
        const direction = getTxDirection({ type });
        const paymentAddresses: Wallet.Cardano.PaymentAddress[] = addresses.map((addr) => addr.address);
        return filterOutputsByTxDirection(tx.body.outputs, direction, paymentAddresses).some((output) =>
          isTxWithAssets(Wallet.Cardano.AssetId(assetDetails.id), output?.value?.assets)
        );
      });
    };

    /**
     * Sanitizes historical transactions data
     */
    const getHistoricalTransactions = async () => {
      const combinedHistory = isMidgardEnabled
        ? mergeTransactionsById(transactions.history, supplementalCardanoDepositHistory)
        : transactions.history;
      const visibleHistory = isMidgardEnabled
        ? combinedHistory.filter((tx) => isMidgardActivity(tx, environmentName))
        : combinedHistory;

      const filtered =
        !assetDetails || assetDetails?.id === cardanoCoin.id
          ? visibleHistory.map((tx) => ({ tx }))
          : await filterTransactionByAssetId(visibleHistory);
      return flatten(await Promise.all(filtered.map((tx) => historicTransactionMapper(tx))));
    };

    /**
     * Sanitizes pending transactions data
     */
    const getPendingTransactions = async (): Promise<ExtendedActivityProps[]> => {
      const walletAddressSet = new Set(keyHashAddresses.map(({ address }) => address.toString()));
      const confirmedHistoryTxIds = new Set(transactions.history.map(({ id }) => id.toString()));
      const visibleMidgardPendingActivities = midgardPendingActivities.filter(
        (pendingActivity: MidgardPendingActivity) =>
          walletAddressSet.has(pendingActivity.address) &&
          !midgardPendingActivityMatchesTxIds(pendingActivity, confirmedHistoryTxIds)
      );

      return flatten([
        ...(await Promise.all(transactions.outgoing.inFlight.map((tx) => pendingTransactionMapper(tx)))),
        ...(isSharedWallet
          ? await Promise.all(
              transactions.outgoing.signed.map((tx) =>
                pendingTransactionMapper(tx, Wallet.TransactionStatus.AWAITING_COSIGNATURES)
              )
            )
          : []),
        ...(await Promise.all(
          visibleMidgardPendingActivities.map((pendingActivity: MidgardPendingActivity) =>
            pendingMidgardActivityMapper(pendingActivity)
          )
        ))
      ]);
    };

    /**
     * Sanitizes historical rewards data
     */
    const getRewardsHistory = (oldestHistoricalTxDate?: Date) =>
      Object.entries(groupBy(rewardsHistory.all, ({ epoch }) => epoch.toString()))
        .map(([epoch, rewards]) => epochRewardsMapper(Number(epoch) as Wallet.Cardano.EpochNo, rewards))
        .filter(
          (reward) =>
            reward.date.getTime() < Date.now() &&
            (!oldestHistoricalTxDate || reward.date.getTime() >= oldestHistoricalTxDate.getTime())
        );

    /**
     * Emits the lists combined and sets current state for Zustand
     */
    const [historicalTransactions, pendingTransactions] = await Promise.all([
      getHistoricalTransactions(),
      getPendingTransactions()
    ]);

    const oldestHistoricalTxDate = withLimitedRewardsHistory
      ? historicalTransactions[historicalTransactions.length - 1]?.date
      : undefined;
    const rewards = assetDetails || isMidgardEnabled ? [] : getRewardsHistory(oldestHistoricalTxDate);

    const confirmedTxs = historicalTransactions;
    const pendingTxs = pendingTransactions;
    /* After the transaction is confirmed is not being removed from pendingTransactions$, so we have to remove it manually from pending list
      this is a workaround, as it seems to be an issue on the sdk side
      */
    const filteredPendingTxs = pendingTxs.filter(
      (pending) => !confirmedTxs.some((confirmed) => confirmed?.id === pending?.id)
    );

    const allTransactions = [...filteredPendingTxs, ...confirmedTxs, ...rewards];

    const allAssetsIds = uniq(
      flattenDeep(
        allTransactions.map(({ assets }: AssetActivityItemProps) =>
          assets.map(({ id }: ActivityAssetProp) => Wallet.Cardano.AssetId(id))
        )
      )
    );

    const assetsInfo = await getAssetsInformation(allAssetsIds, assetInfo, {
      assetProvider,
      extraData: {
        nftMetadata: true,
        tokenMetadata: true
      }
    });

    const allTransactionsTransformed = allTransactions.map((activity) => ({
      ...activity,
      ...(isDelegationActivity(activity) &&
        !isMidgardActivityLabel(activity.label) && {
          amount: `${getDelegationAmount(activity)} ${cardanoCoin.symbol}`,
          fiatAmount: `${getFiatAmount(getDelegationAmount(activity), cardanoFiatPrice)} ${fiatCurrency.code}`
        }),
      assets: activity.assets.map((asset: ActivityAssetProp) => {
        const assetId = Wallet.Cardano.AssetId(asset.id);
        const token = assetsInfo.get(assetId);
        const assetData = !token
          ? undefined
          : assetTransformer({
              token,
              key: assetId,
              total: { coins: BigInt(0), assets: new Map([[assetId, BigInt(asset.val)]]) },
              fiatCurrency
            });
        return {
          id: asset.id,
          val: Wallet.util.calculateAssetBalance(asset.val, token),
          info: {
            ticker: (assetData?.name !== '-' && assetData?.name) || assetData?.ticker
          }
        };
      })
    }));

    const allTransactionsGrouped = groupBy(
      allTransactionsTransformed.sort((firstTx, secondTx) => {
        // ensure txs that are awaiting cosignatures always come first
        if (
          firstTx.status === ActivityStatus.AWAITING_COSIGNATURES &&
          secondTx.status !== ActivityStatus.AWAITING_COSIGNATURES
        )
          return -1;
        if (
          secondTx.status === ActivityStatus.AWAITING_COSIGNATURES &&
          firstTx.status !== ActivityStatus.AWAITING_COSIGNATURES
        )
          return 1;

        // ensure pending tx's always appear on top, separated from the condition above for readability
        if (firstTx.status === ActivityStatus.PENDING && secondTx.status !== ActivityStatus.PENDING) return -1;
        if (secondTx.status === ActivityStatus.PENDING && firstTx.status !== ActivityStatus.PENDING) return 1;

        // otherwise sort by date
        return (secondTx.date?.getTime() || 0) - (firstTx.date?.getTime() || 0);
      }),
      'formattedDate'
    );

    const walletActivities = Object.entries(allTransactionsGrouped).map(([listName, transactionsList]) => ({
      title: listName,
      items: transactionsList
    }));

    return {
      walletActivities,
      activitiesCount: allTransactions.length
    };
  },
  (
    { addresses, transactions, assetInfo, delegation: { rewardsHistory } },
    { cardanoFiatPrice, fiatCurrency },
    {
      assetProvider,
      chainHistoryProvider,
      cardanoCoin,
      assetDetails,
      environmentName,
      inputResolver,
      isSharedWallet,
      midgardPendingActivities,
      isMidgardEnabled,
      supplementalCardanoDepositHistory = []
    }
  ) => {
    const historyKey = transactions.history.map(({ id }) => id).join('');
    const supplementalHistoryKey = supplementalCardanoDepositHistory.map(({ id }) => id).join('');
    const inFlightKey = transactions.outgoing.inFlight.map(({ id, submittedAt }) => `${id}_${submittedAt}`).join('');
    const signedKey = transactions.outgoing.signed?.map(({ tx: { id } }) => id).join('') ?? '';
    const addressesKey = addresses.map(({ address }) => address.toString()).join('|');
    const providerKey = [
      getDependencyIdentity(assetProvider),
      getDependencyIdentity(chainHistoryProvider),
      getDependencyIdentity(inputResolver)
    ].join('_');
    const midgardPendingKey = midgardPendingActivities
      .map(
        (pendingActivity: MidgardPendingActivity) =>
          `${pendingActivity.txFormat}_${pendingActivity.txId}_${pendingActivity.cardanoTxId ?? ''}_${pendingActivity.address}_${pendingActivity.createdAt}_${pendingActivity.kind}_${
            isMidgardNativePendingActivityRecord(pendingActivity)
              ? pendingActivity.nativeTxCbor
              : pendingActivity.txCbor
          }`
      )
      .join('');

    return `${historyKey}_${supplementalHistoryKey}_${inFlightKey}_${signedKey}_${midgardPendingKey}_${assetInfo.size}_${rewardsHistory.all.length}_${cardanoFiatPrice}_${fiatCurrency.code}_${cardanoCoin?.id}_${assetDetails?.id}_${addressesKey}_${environmentName}_${isSharedWallet}_${isMidgardEnabled}_${providerKey}`;
  }
);

export const createGetWalletActivities = ({
  set,
  get,
  mapWalletActivitiesImpl = mapWalletActivities
}: Pick<FetchWalletActivitiesPropsWithSetter, 'set' | 'get'> & {
  mapWalletActivitiesImpl?: WalletActivitiesMapper;
}): WalletActivitiesSlice['getWalletActivities'] => {
  let latestRequestId = 0;

  return async ({ fiatCurrency, cardanoFiatPrice, sendAnalytics, withLimitedRewardsHistory }): Promise<void> => {
    const requestId = ++latestRequestId;

    set({ walletActivitiesStatus: StateStatus.LOADING });

    const {
      walletUI: { cardanoCoin },
      walletState,
      setTransactionActivityDetail,
      setRewardsActivityDetail,
      assetDetails,
      blockchainProvider: { assetProvider, chainHistoryProvider, inputResolver },
      midgardPendingActivities,
      isMidgardEnabled,
      environmentName,
      isSharedWallet
    } = get();

    if (!walletState) {
      if (requestId !== latestRequestId) return;
      set(initialState);
      return;
    }

    try {
      const historyWithMidgardDeposits =
        environmentName && walletState.transactions.history.length > 0
          ? await enrichTransactionsWithMidgardDepositProvenance({
              environmentName,
              transactions: walletState.transactions.history
            }).catch((error) => {
              logger.warn('Failed to enrich Cardano history with confirmed Midgard deposits', error);
              return walletState.transactions.history;
            })
          : walletState.transactions.history;
      const walletStateWithMidgardDepositHistory =
        historyWithMidgardDeposits === walletState.transactions.history
          ? walletState
          : {
              ...walletState,
              transactions: {
                ...walletState.transactions,
                history: historyWithMidgardDeposits
              }
            };
      const supplementalCardanoDepositHistory =
        isMidgardEnabled && environmentName
          ? await loadMidgardCardanoDepositHistory({
              addresses: walletState.addresses,
              chainName: environmentName
            }).catch(
              (error) => {
                logger.warn('Failed to load supplemental Cardano Midgard deposit history', error);
                return [];
              }
            )
          : [];

      const { walletActivities, activitiesCount } = await mapWalletActivitiesImpl(
        walletStateWithMidgardDepositHistory,
        { fiatCurrency, cardanoFiatPrice, sendAnalytics, withLimitedRewardsHistory },
        {
          assetProvider,
          chainHistoryProvider,
          cardanoCoin,
          setRewardsActivityDetail,
          setTransactionActivityDetail,
          assetDetails,
          inputResolver,
          midgardPendingActivities,
          isMidgardEnabled,
          environmentName,
          isSharedWallet,
          supplementalCardanoDepositHistory
        }
      );

      if (requestId !== latestRequestId) return;

      set({
        walletActivities,
        activitiesCount,
        walletActivitiesStatus: StateStatus.LOADED
      });
    } catch (error) {
      if (requestId !== latestRequestId) return;

      logger.error('Failed to load wallet activities', error);
      set({ walletActivitiesStatus: StateStatus.ERROR });
    }
  };
};

/**
 * has all wallet activities related actions and states
 */
export const walletActivitiesSlice: SliceCreator<
  WalletInfoSlice &
    WalletActivitiesSlice &
    ActivityDetailSlice &
    AssetDetailsSlice &
    UISlice &
    BlockchainProviderSlice &
    MidgardSlice,
  WalletActivitiesSlice
> = ({ set, get }) => ({
  getWalletActivities: createGetWalletActivities({ set, get }),
  ...initialState
});
