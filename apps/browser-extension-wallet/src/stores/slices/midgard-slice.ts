import { SliceCreator } from '../types';

const MIDGARD_PENDING_ACTIVITIES_KEY = 'midgardPendingActivities';
const LEGACY_MIDGARD_PENDING_DEPOSITS_KEY = 'midgardPendingDeposits';

export type MidgardActivationStatus = 'idle' | 'switching' | 'error';
export type MidgardHealthStatus = 'unknown' | 'healthy' | 'degraded';
export type MidgardPendingActivityKind = 'deposit' | 'send' | 'withdrawal';
export type MidgardPendingActivityFormat = 'cardano-legacy' | 'midgard-native';

type MidgardPendingActivityBase = {
  address: string;
  createdAt: string;
  kind: MidgardPendingActivityKind;
  txId: string;
};

export type MidgardLegacyPendingActivity = MidgardPendingActivityBase & {
  cardanoTxId?: string;
  schemaVersion?: 1;
  txCbor: string;
  txFormat: 'cardano-legacy';
};

export type MidgardNativePendingActivity = MidgardPendingActivityBase & {
  cardanoPreviewCbor?: string;
  cardanoTxId?: string;
  nativeTxCbor: string;
  schemaVersion: 2;
  txFormat: 'midgard-native';
};

export type MidgardPendingActivity = MidgardLegacyPendingActivity | MidgardNativePendingActivity;

export type MidgardPendingDeposit = Omit<MidgardLegacyPendingActivity, 'kind' | 'schemaVersion' | 'txFormat'> & {
  kind?: 'deposit';
};

const isPendingActivityBase = (item: unknown): item is MidgardPendingActivityBase =>
  !!item &&
  typeof item === 'object' &&
  typeof (item as MidgardPendingActivityBase).txId === 'string' &&
  typeof (item as MidgardPendingActivityBase).address === 'string' &&
  typeof (item as MidgardPendingActivityBase).createdAt === 'string' &&
  ['deposit', 'send', 'withdrawal'].includes((item as MidgardPendingActivityBase).kind);

const isMidgardLegacyPendingActivity = (item: unknown): item is MidgardLegacyPendingActivity =>
  isPendingActivityBase(item) &&
  typeof (item as MidgardLegacyPendingActivity).txCbor === 'string' &&
  ((item as MidgardLegacyPendingActivity).cardanoTxId === undefined ||
    typeof (item as MidgardLegacyPendingActivity).cardanoTxId === 'string') &&
  (((item as MidgardLegacyPendingActivity).schemaVersion ?? 1) === 1 &&
    (item as MidgardLegacyPendingActivity).txFormat === 'cardano-legacy');

const isMidgardNativePendingActivity = (item: unknown): item is MidgardNativePendingActivity =>
  isPendingActivityBase(item) &&
  typeof (item as MidgardNativePendingActivity).nativeTxCbor === 'string' &&
  ((item as MidgardNativePendingActivity).cardanoPreviewCbor === undefined ||
    typeof (item as MidgardNativePendingActivity).cardanoPreviewCbor === 'string') &&
  ((item as MidgardNativePendingActivity).cardanoTxId === undefined ||
    typeof (item as MidgardNativePendingActivity).cardanoTxId === 'string') &&
  (item as MidgardNativePendingActivity).schemaVersion === 2 &&
  (item as MidgardNativePendingActivity).txFormat === 'midgard-native';

const migrateLegacyPendingActivity = (item: unknown): MidgardLegacyPendingActivity | undefined => {
  if (!item || typeof item !== 'object') return undefined;

  const legacy = item as {
    address?: string;
    cardanoTxId?: string;
    createdAt?: string;
    kind?: MidgardPendingActivityKind;
    txCbor?: string;
    txId?: string;
  };
  if (
    typeof legacy.txId !== 'string' ||
    typeof legacy.txCbor !== 'string' ||
    typeof legacy.address !== 'string' ||
    typeof legacy.createdAt !== 'string'
  ) {
    return undefined;
  }

  return {
    address: legacy.address,
    cardanoTxId: typeof legacy.cardanoTxId === 'string' ? legacy.cardanoTxId : undefined,
    createdAt: legacy.createdAt,
    kind: legacy.kind ?? 'deposit',
    schemaVersion: 1,
    txCbor: legacy.txCbor,
    txFormat: 'cardano-legacy',
    txId: legacy.txId
  };
};

const normalizePendingActivity = (item: unknown): MidgardPendingActivity | undefined => {
  if (isMidgardNativePendingActivity(item)) return item;
  if (isMidgardLegacyPendingActivity(item)) return item;

  return migrateLegacyPendingActivity(item);
};

export const isMidgardNativePendingActivityRecord = (
  pendingActivity: MidgardPendingActivity
): pendingActivity is MidgardNativePendingActivity => pendingActivity.txFormat === 'midgard-native';

export const isMidgardLegacyPendingActivityRecord = (
  pendingActivity: MidgardPendingActivity
): pendingActivity is MidgardLegacyPendingActivity => pendingActivity.txFormat === 'cardano-legacy';

export const getMidgardPendingActivityTxIds = (pendingActivity: MidgardPendingActivity): string[] =>
  [...new Set([pendingActivity.txId, pendingActivity.cardanoTxId].filter((value): value is string => !!value))];

export const midgardPendingActivityMatchesTxIds = (
  pendingActivity: MidgardPendingActivity,
  txIds: Iterable<string>
): boolean => {
  const knownTxIds = new Set(txIds);
  return getMidgardPendingActivityTxIds(pendingActivity).some((txId) => knownTxIds.has(txId));
};

const getLegacyMidgardPendingDeposits = (): MidgardPendingActivity[] => {
  try {
    const stored = localStorage.getItem(LEGACY_MIDGARD_PENDING_DEPOSITS_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => migrateLegacyPendingActivity({ ...item, kind: 'deposit' }))
      .filter((item): item is MidgardLegacyPendingActivity => item !== undefined);
  } catch {
    return [];
  }
};

const getInitialMidgardPendingActivities = (): MidgardPendingActivity[] => {
  try {
    const stored = localStorage.getItem(MIDGARD_PENDING_ACTIVITIES_KEY);
    if (!stored) {
      const migratedPendingDeposits = getLegacyMidgardPendingDeposits();
      if (migratedPendingDeposits.length > 0) {
        localStorage.setItem(MIDGARD_PENDING_ACTIVITIES_KEY, JSON.stringify(migratedPendingDeposits));
        localStorage.removeItem(LEGACY_MIDGARD_PENDING_DEPOSITS_KEY);
      }

      return migratedPendingDeposits;
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizePendingActivity(item))
      .filter((item): item is MidgardPendingActivity => item !== undefined);
  } catch {
    return getLegacyMidgardPendingDeposits();
  }
};

const persistMidgardPendingActivities = (pendingActivities: MidgardPendingActivity[]) => {
  localStorage.setItem(MIDGARD_PENDING_ACTIVITIES_KEY, JSON.stringify(pendingActivities));
  localStorage.removeItem(LEGACY_MIDGARD_PENDING_DEPOSITS_KEY);
};

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

export const midgardSlice: SliceCreator<MidgardSlice, MidgardSlice> = ({ set }) => {
  const initialMidgardPendingActivities = getInitialMidgardPendingActivities();

  const upsertPendingActivity = (pendingActivity: MidgardPendingActivity) =>
    set((state) => {
      const pendingTxIds = new Set(getMidgardPendingActivityTxIds(pendingActivity));
      const nextPendingActivities = [
        ...state.midgardPendingActivities.filter(
          (currentPendingActivity) => !midgardPendingActivityMatchesTxIds(currentPendingActivity, pendingTxIds)
        ),
        pendingActivity
      ];
      persistMidgardPendingActivities(nextPendingActivities);

      return syncPendingActivities(nextPendingActivities);
    });

  const prunePendingActivities = (txIds: string[]) =>
    set((state) => {
      if (txIds.length === 0) return state;

      const idsToRemove = new Set(txIds);
      const nextPendingActivities = state.midgardPendingActivities.filter(
        (pendingActivity) => !midgardPendingActivityMatchesTxIds(pendingActivity, idsToRemove)
      );
      if (nextPendingActivities.length === state.midgardPendingActivities.length) {
        return state;
      }

      persistMidgardPendingActivities(nextPendingActivities);

      return syncPendingActivities(nextPendingActivities);
    });

  return {
    isMidgardEnabled: false,
    midgardTargetEnabled: undefined,
    midgardActivationStatus: 'idle',
    midgardActivationError: undefined,
    midgardHealthStatus: 'unknown',
    midgardHealthError: undefined,
    midgardPendingActivities: initialMidgardPendingActivities,
    midgardPendingDeposits: initialMidgardPendingActivities,

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

    addMidgardPendingActivity: upsertPendingActivity,
    removeMidgardPendingActivities: prunePendingActivities,
    addMidgardPendingDeposit: (pendingDeposit) =>
      upsertPendingActivity({
        ...pendingDeposit,
        kind: pendingDeposit.kind ?? 'deposit',
        schemaVersion: 1,
        txFormat: 'cardano-legacy'
      }),
    removeMidgardPendingDeposits: prunePendingActivities
  };
};
