import { logger } from '@lace/common';
import {
  MidgardPendingActivity,
  MidgardPendingDeposit,
  mergeMidgardPendingActivities,
  removeMidgardPendingActivitiesByTxIds
} from '@src/utils/midgard-pending-activities';
import {
  removeStoredMidgardPendingActivities,
  upsertStoredMidgardPendingActivity
} from '@src/utils/midgard-pending-activities-storage';
import { SliceCreator } from '../types';

export type {
  MidgardLegacyPendingActivity,
  MidgardNativePendingActivity,
  MidgardPendingActivity,
  MidgardPendingDeposit
} from '@src/utils/midgard-pending-activities';
export {
  getMidgardPendingActivityTxIds,
  isMidgardLegacyPendingActivityRecord,
  isMidgardNativePendingActivityRecord,
  midgardPendingActivityMatchesTxIds
} from '@src/utils/midgard-pending-activities';

export type MidgardActivationStatus = 'idle' | 'switching' | 'error';
export type MidgardHealthStatus = 'unknown' | 'healthy' | 'degraded';

const syncPendingActivities = (pendingActivities: MidgardPendingActivity[]) => ({
  midgardPendingActivities: pendingActivities,
  midgardPendingDeposits: pendingActivities
});

export interface MidgardSlice {
  isMidgardEnabled: boolean;
  midgardTargetEnabled?: boolean;
  midgardActivationStatus: MidgardActivationStatus;
  midgardActivationError?: string;
  midgardHealthStatus: MidgardHealthStatus;
  midgardHealthError?: string;
  midgardPendingActivities: MidgardPendingActivity[];
  midgardPendingDeposits: MidgardPendingActivity[];
  setMidgardMode: (enabled: boolean) => void;
  startMidgardModeSwitch: (enabled: boolean) => void;
  failMidgardModeSwitch: (error: string) => void;
  clearMidgardModeError: () => void;
  setMidgardHealthHealthy: () => void;
  setMidgardHealthDegraded: (error: string) => void;
  resetMidgardHealth: () => void;
  setMidgardPendingActivities: (pendingActivities: MidgardPendingActivity[]) => void;
  addMidgardPendingActivity: (pendingActivity: MidgardPendingActivity) => void;
  removeMidgardPendingActivities: (txIds: string[]) => void;
  addMidgardPendingDeposit: (pendingDeposit: MidgardPendingDeposit) => void;
  removeMidgardPendingDeposits: (txIds: string[]) => void;
}

export const isMidgardActionBlocked = ({
  isMidgardEnabled,
  midgardActivationStatus,
  midgardHealthStatus
}: Pick<MidgardSlice, 'isMidgardEnabled' | 'midgardActivationStatus' | 'midgardHealthStatus'>): boolean =>
  midgardActivationStatus === 'switching' || (isMidgardEnabled && midgardHealthStatus === 'degraded');

export const getMidgardSendBlockReason = ({
  isMidgardEnabled,
  midgardActivationStatus,
  midgardHealthStatus,
  isInMemoryWallet,
  isSharedWallet
}: Pick<MidgardSlice, 'isMidgardEnabled' | 'midgardActivationStatus' | 'midgardHealthStatus'> & {
  isInMemoryWallet: boolean;
  isSharedWallet: boolean;
}): string | undefined => {
  if (midgardActivationStatus === 'switching') {
    return 'Lace is still reloading the active wallet providers. Send will unlock automatically when Midgard is ready.';
  }

  if (!isMidgardEnabled) return undefined;

  if (midgardHealthStatus === 'degraded') {
    return 'Midgard is currently unavailable. Retry the health check or return to Cardano mode before sending.';
  }

  if (isSharedWallet) {
    return 'Midgard send is not available for shared wallets yet.';
  }

  if (!isInMemoryWallet) {
    return 'Midgard send currently supports password wallets only.';
  }

  return undefined;
};

const persistPendingActivityUpdate = async (pendingActivity: MidgardPendingActivity) => {
  try {
    await upsertStoredMidgardPendingActivity(pendingActivity);
  } catch (error) {
    logger.warn('[Midgard] Failed to persist pending activity update', error);
  }
};

const persistPendingActivityRemoval = async (txIds: string[]) => {
  try {
    await removeStoredMidgardPendingActivities(txIds);
  } catch (error) {
    logger.warn('[Midgard] Failed to persist pending activity removal', error);
  }
};

export const midgardSlice: SliceCreator<MidgardSlice, MidgardSlice> = ({ set }) => {
  const upsertPendingActivity = (pendingActivity: MidgardPendingActivity) =>
    set((state) => {
      const nextPendingActivities = mergeMidgardPendingActivities(state.midgardPendingActivities, pendingActivity);
      void persistPendingActivityUpdate(pendingActivity);
      return syncPendingActivities(nextPendingActivities);
    });

  const prunePendingActivities = (txIds: string[]) =>
    set((state) => {
      const nextPendingActivities = removeMidgardPendingActivitiesByTxIds(state.midgardPendingActivities, txIds);
      if (nextPendingActivities.length === state.midgardPendingActivities.length) {
        return state;
      }

      void persistPendingActivityRemoval(txIds);
      return syncPendingActivities(nextPendingActivities);
    });

  return {
    isMidgardEnabled: false,
    midgardTargetEnabled: undefined,
    midgardActivationStatus: 'idle',
    midgardActivationError: undefined,
    midgardHealthStatus: 'unknown',
    midgardHealthError: undefined,
    midgardPendingActivities: [],
    midgardPendingDeposits: [],

    setMidgardMode: (enabled: boolean) => {
      set({
        isMidgardEnabled: enabled,
        midgardTargetEnabled: undefined,
        midgardActivationStatus: 'idle',
        midgardActivationError: undefined,
        midgardHealthStatus: 'unknown',
        midgardHealthError: undefined
      });
    },

    startMidgardModeSwitch: (enabled) =>
      set({
        midgardTargetEnabled: enabled,
        midgardActivationStatus: 'switching',
        midgardActivationError: undefined
      }),

    failMidgardModeSwitch: (error) =>
      set({
        midgardTargetEnabled: undefined,
        midgardActivationStatus: 'error',
        midgardActivationError: error
      }),

    clearMidgardModeError: () =>
      set((state) =>
        state.midgardActivationStatus === 'error'
          ? {
              midgardActivationStatus: 'idle',
              midgardActivationError: undefined
            }
          : state
      ),

    setMidgardHealthHealthy: () =>
      set((state) =>
        !state.isMidgardEnabled
          ? state
          : {
              midgardHealthStatus: 'healthy',
              midgardHealthError: undefined
            }
      ),

    setMidgardHealthDegraded: (error) =>
      set((state) =>
        !state.isMidgardEnabled
          ? state
          : {
              midgardHealthStatus: 'degraded',
              midgardHealthError: error
            }
      ),

    resetMidgardHealth: () =>
      set({
        midgardHealthStatus: 'unknown',
        midgardHealthError: undefined
      }),

    setMidgardPendingActivities: (pendingActivities) => set(syncPendingActivities(pendingActivities)),
    addMidgardPendingActivity: upsertPendingActivity,
    removeMidgardPendingActivities: prunePendingActivities,
    addMidgardPendingDeposit: (pendingDeposit) =>
      upsertPendingActivity({
        ...pendingDeposit,
        ...(pendingDeposit.cardanoTxId ? {} : { cardanoTxId: pendingDeposit.txId }),
        kind: pendingDeposit.kind ?? 'deposit',
        schemaVersion: 1,
        txFormat: 'cardano-legacy'
      }),
    removeMidgardPendingDeposits: prunePendingActivities
  };
};
