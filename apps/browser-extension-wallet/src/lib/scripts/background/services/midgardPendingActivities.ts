import { Wallet } from '@lace/cardano';
import { logger } from '@lace/common';
import { storage } from 'webextension-polyfill';
import { getProviders } from '../config';
import { getMidgardDepositStatus, getTrackingStatusFromDepositStatus } from '@src/utils/midgard-deposit-status';
import {
  MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY,
  MidgardPendingActivity,
  isMidgardDepositPendingActivity,
  isMidgardLegacyPendingActivityRecord
} from '@src/utils/midgard-pending-activities';
import {
  getStoredMidgardPendingActivities,
  readMidgardPendingActivitiesStorageChange,
  writeStoredMidgardPendingActivities
} from '@src/utils/midgard-pending-activities-storage';
import { getMidgardUrl } from '@src/utils/midgard-url';
import { getMidgardDepositEventIdFromTxCbor } from '@src/utils/midgard-deposit-event-id';

const MIDGARD_PENDING_ACTIVITY_RECONCILE_INTERVAL_MS = 30_000;
const MIDGARD_DEPOSIT_BROADCAST_OBSERVATION_TIMEOUT_MS = 10 * 60 * 1000;
const MIDGARD_PENDING_ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MIDGARD_BROADCAST_NOT_OBSERVED_ERROR =
  'Lace could not observe this deposit on Cardano or Midgard after requesting broadcast.';

let trackerInitialized = false;
let activeReconcile: Promise<void> | undefined;

const toTimestamp = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const getPendingActivityStartTimestamp = (pendingActivity: MidgardPendingActivity): number | undefined =>
  toTimestamp(pendingActivity.broadcastRequestedAt ?? pendingActivity.createdAt);

const shouldPruneByAge = (pendingActivity: MidgardPendingActivity, nowMs: number): boolean => {
  const createdAtMs = getPendingActivityStartTimestamp(pendingActivity);
  return createdAtMs !== undefined && nowMs - createdAtMs > MIDGARD_PENDING_ACTIVITY_RETENTION_MS;
};

const getPendingDepositEventId = (pendingActivity: MidgardPendingActivity): string | undefined => {
  if (pendingActivity.eventId) {
    return pendingActivity.eventId;
  }

  return isMidgardLegacyPendingActivityRecord(pendingActivity)
    ? getMidgardDepositEventIdFromTxCbor(pendingActivity.txCbor)
    : undefined;
};

const resolveCardanoVisibility = async (pendingActivity: MidgardPendingActivity): Promise<boolean> => {
  if (!pendingActivity.chainName) {
    return false;
  }

  try {
    const { chainHistoryProvider } = await getProviders(pendingActivity.chainName, { forceMidgardEnabled: false });
    const [resolvedTx] = await chainHistoryProvider.transactionsByHashes({
      ids: [Wallet.Cardano.TransactionId(pendingActivity.cardanoTxId ?? pendingActivity.txId)]
    });
    return !!resolvedTx;
  } catch (error) {
    logger.warn(`[Midgard] Failed to resolve Cardano visibility for ${pendingActivity.txId}`, error);
    return false;
  }
};

const resolveMidgardDepositStatus = async (pendingActivity: MidgardPendingActivity) => {
  if (!pendingActivity.chainName) {
    return undefined;
  }

  try {
    const midgardUrl = await getMidgardUrl(pendingActivity.chainName);
    if (!midgardUrl) {
      return undefined;
    }

    const eventId = getPendingDepositEventId(pendingActivity);

    return await getMidgardDepositStatus({
      eventId,
      midgardUrl,
      cardanoTxHash: pendingActivity.cardanoTxId ?? pendingActivity.txId
    });
  } catch (error) {
    logger.warn(`[Midgard] Failed to resolve deposit status for ${pendingActivity.txId}`, error);
    return undefined;
  }
};

export const reconcileMidgardPendingActivities = async (
  pendingActivities: MidgardPendingActivity[],
  now = new Date()
): Promise<MidgardPendingActivity[]> => {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  return (
    await Promise.all(
      pendingActivities.map(async (pendingActivity): Promise<MidgardPendingActivity | undefined> => {
        if (shouldPruneByAge(pendingActivity, nowMs)) {
          return undefined;
        }

        if (!isMidgardDepositPendingActivity(pendingActivity)) {
          return pendingActivity;
        }

        const nextPendingActivity: MidgardPendingActivity = {
          ...pendingActivity,
          ...(getPendingDepositEventId(pendingActivity) ? { eventId: getPendingDepositEventId(pendingActivity) } : {}),
          lastCheckedAt: nowIso
        };

        const [isVisibleOnCardano, midgardDepositStatus] = await Promise.all([
          resolveCardanoVisibility(pendingActivity),
          resolveMidgardDepositStatus(pendingActivity)
        ]);

        if (midgardDepositStatus?.eventId && midgardDepositStatus.eventId !== pendingActivity.eventId) {
          nextPendingActivity.eventId = midgardDepositStatus.eventId;
        }

        const midgardTrackingStatus = getTrackingStatusFromDepositStatus(midgardDepositStatus);
        if (midgardTrackingStatus === 'projected' || midgardTrackingStatus === 'consumed') {
          return undefined;
        }

        if (isVisibleOnCardano || midgardTrackingStatus === 'on_chain_pending') {
          return {
            ...nextPendingActivity,
            lastError: undefined,
            onChainSeenAt: pendingActivity.onChainSeenAt ?? nowIso,
            trackingStatus: 'on_chain_pending'
          };
        }

        const createdAtMs = getPendingActivityStartTimestamp(pendingActivity) ?? nowMs;
        if (nowMs - createdAtMs >= MIDGARD_DEPOSIT_BROADCAST_OBSERVATION_TIMEOUT_MS) {
          return {
            ...nextPendingActivity,
            lastError: MIDGARD_BROADCAST_NOT_OBSERVED_ERROR,
            trackingStatus: 'broadcast_not_observed'
          };
        }

        return {
          ...nextPendingActivity,
          trackingStatus: pendingActivity.trackingStatus ?? 'broadcast_requested'
        };
      })
    )
  ).filter((pendingActivity): pendingActivity is MidgardPendingActivity => pendingActivity !== undefined);
};

const reconcileStoredMidgardPendingActivities = async (): Promise<void> => {
  const currentPendingActivities = await getStoredMidgardPendingActivities();
  const reconciledPendingActivities = await reconcileMidgardPendingActivities(currentPendingActivities);

  if (JSON.stringify(currentPendingActivities) === JSON.stringify(reconciledPendingActivities)) {
    return;
  }

  await writeStoredMidgardPendingActivities(reconciledPendingActivities);
};

const triggerReconcile = (): Promise<void> => {
  if (!activeReconcile) {
    activeReconcile = reconcileStoredMidgardPendingActivities().finally(() => {
      activeReconcile = undefined;
    });
  }

  return activeReconcile;
};

export const initializeMidgardPendingActivitiesTracker = (): void => {
  if (trackerInitialized) {
    return;
  }

  trackerInitialized = true;
  void triggerReconcile();
  setInterval(() => void triggerReconcile(), MIDGARD_PENDING_ACTIVITY_RECONCILE_INTERVAL_MS);
  storage.onChanged.addListener((changes, areaName) => {
    const nextPendingActivities = readMidgardPendingActivitiesStorageChange(changes, areaName);
    if (nextPendingActivities === undefined) {
      return;
    }

    if (changes[MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY]?.newValue === undefined && nextPendingActivities.length === 0) {
      return;
    }

    void triggerReconcile();
  });
};
