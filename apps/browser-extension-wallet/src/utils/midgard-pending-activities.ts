import { Wallet } from '@lace/cardano';

export const MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY = 'MIDGARD_PENDING_ACTIVITIES';

export type MidgardPendingActivityKind = 'deposit' | 'send' | 'withdrawal';
export type MidgardPendingActivityFormat = 'cardano-legacy' | 'midgard-native';
export type MidgardPendingDepositTrackingStatus =
  | 'broadcast_requested'
  | 'on_chain_pending'
  | 'projected'
  | 'consumed'
  | 'broadcast_not_observed';

type MidgardPendingActivityBase = {
  accountIndex?: number;
  address: string;
  broadcastRequestedAt?: string;
  cardanoTxId?: string;
  chainName?: Wallet.ChainName;
  createdAt: string;
  eventId?: string;
  kind: MidgardPendingActivityKind;
  lastCheckedAt?: string;
  lastError?: string;
  onChainSeenAt?: string;
  projectedAt?: string;
  trackingStatus?: MidgardPendingDepositTrackingStatus;
  txId: string;
  walletId?: string;
};

export type MidgardLegacyPendingActivity = MidgardPendingActivityBase & {
  schemaVersion?: 1;
  txCbor: string;
  txFormat: 'cardano-legacy';
};

export type MidgardNativePendingActivity = MidgardPendingActivityBase & {
  cardanoPreviewCbor?: string;
  nativeTxCbor: string;
  schemaVersion: 2;
  txFormat: 'midgard-native';
};

export type MidgardPendingActivity = MidgardLegacyPendingActivity | MidgardNativePendingActivity;

export type MidgardPendingDeposit = Omit<MidgardLegacyPendingActivity, 'kind' | 'schemaVersion' | 'txFormat'> & {
  kind?: 'deposit';
};

const MIDGARD_PENDING_ACTIVITY_KINDS: MidgardPendingActivityKind[] = ['deposit', 'send', 'withdrawal'];
const MIDGARD_PENDING_DEPOSIT_TRACKING_STATUSES: MidgardPendingDepositTrackingStatus[] = [
  'broadcast_requested',
  'on_chain_pending',
  'projected',
  'consumed',
  'broadcast_not_observed'
];

const isMidgardPendingActivityKind = (value: unknown): value is MidgardPendingActivityKind =>
  typeof value === 'string' && MIDGARD_PENDING_ACTIVITY_KINDS.includes(value as MidgardPendingActivityKind);

const isMidgardPendingDepositTrackingStatus = (value: unknown): value is MidgardPendingDepositTrackingStatus =>
  typeof value === 'string' &&
  MIDGARD_PENDING_DEPOSIT_TRACKING_STATUSES.includes(value as MidgardPendingDepositTrackingStatus);

const normalizeOptionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const normalizeOptionalNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

const normalizeOptionalChainName = (value: unknown): Wallet.ChainName | undefined =>
  typeof value === 'string' ? (value as Wallet.ChainName) : undefined;

const isPendingActivityBase = (item: unknown): item is MidgardPendingActivityBase =>
  !!item &&
  typeof item === 'object' &&
  typeof (item as MidgardPendingActivityBase).txId === 'string' &&
  typeof (item as MidgardPendingActivityBase).address === 'string' &&
  typeof (item as MidgardPendingActivityBase).createdAt === 'string' &&
  isMidgardPendingActivityKind((item as MidgardPendingActivityBase).kind);

const toPendingActivityBase = (item: MidgardPendingActivityBase): MidgardPendingActivityBase => ({
  accountIndex: normalizeOptionalNumber(item.accountIndex),
  address: item.address,
  broadcastRequestedAt: normalizeOptionalString(item.broadcastRequestedAt),
  cardanoTxId: normalizeOptionalString(item.cardanoTxId),
  chainName: normalizeOptionalChainName(item.chainName),
  createdAt: item.createdAt,
  eventId: normalizeOptionalString(item.eventId),
  kind: item.kind,
  lastCheckedAt: normalizeOptionalString(item.lastCheckedAt),
  lastError: normalizeOptionalString(item.lastError),
  onChainSeenAt: normalizeOptionalString(item.onChainSeenAt),
  projectedAt: normalizeOptionalString(item.projectedAt),
  trackingStatus: isMidgardPendingDepositTrackingStatus(item.trackingStatus) ? item.trackingStatus : undefined,
  txId: item.txId,
  walletId: normalizeOptionalString(item.walletId)
});

const isMidgardLegacyPendingActivity = (item: unknown): item is MidgardLegacyPendingActivity =>
  isPendingActivityBase(item) &&
  typeof (item as MidgardLegacyPendingActivity).txCbor === 'string' &&
  (((item as MidgardLegacyPendingActivity).schemaVersion ?? 1) === 1 &&
    (item as MidgardLegacyPendingActivity).txFormat === 'cardano-legacy');

const isMidgardNativePendingActivity = (item: unknown): item is MidgardNativePendingActivity =>
  isPendingActivityBase(item) &&
  typeof (item as MidgardNativePendingActivity).nativeTxCbor === 'string' &&
  ((item as MidgardNativePendingActivity).cardanoPreviewCbor === undefined ||
    typeof (item as MidgardNativePendingActivity).cardanoPreviewCbor === 'string') &&
  (item as MidgardNativePendingActivity).schemaVersion === 2 &&
  (item as MidgardNativePendingActivity).txFormat === 'midgard-native';

const migrateLegacyPendingActivity = (item: unknown): MidgardLegacyPendingActivity | undefined => {
  if (!item || typeof item !== 'object') return undefined;

  const legacy = item as {
    accountIndex?: number;
    address?: string;
    broadcastRequestedAt?: string;
    cardanoTxId?: string;
    chainName?: Wallet.ChainName;
    createdAt?: string;
    eventId?: string;
    kind?: MidgardPendingActivityKind;
    lastCheckedAt?: string;
    lastError?: string;
    onChainSeenAt?: string;
    projectedAt?: string;
    trackingStatus?: MidgardPendingDepositTrackingStatus;
    txCbor?: string;
    txId?: string;
    walletId?: string;
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
    ...toPendingActivityBase({
      accountIndex: legacy.accountIndex,
      address: legacy.address,
      broadcastRequestedAt: legacy.broadcastRequestedAt,
      cardanoTxId: legacy.cardanoTxId,
      chainName: legacy.chainName,
      createdAt: legacy.createdAt,
      eventId: legacy.eventId,
      kind: legacy.kind ?? 'deposit',
      lastCheckedAt: legacy.lastCheckedAt,
      lastError: legacy.lastError,
      onChainSeenAt: legacy.onChainSeenAt,
      projectedAt: legacy.projectedAt,
      trackingStatus: legacy.trackingStatus,
      txId: legacy.txId,
      walletId: legacy.walletId
    }),
    schemaVersion: 1,
    txCbor: legacy.txCbor,
    txFormat: 'cardano-legacy'
  };
};

export const normalizeMidgardPendingActivity = (item: unknown): MidgardPendingActivity | undefined => {
  if (isMidgardNativePendingActivity(item)) {
    return {
      ...toPendingActivityBase(item),
      cardanoPreviewCbor: normalizeOptionalString(item.cardanoPreviewCbor),
      nativeTxCbor: item.nativeTxCbor,
      schemaVersion: 2,
      txFormat: 'midgard-native'
    };
  }

  if (isMidgardLegacyPendingActivity(item)) {
    return {
      ...toPendingActivityBase(item),
      schemaVersion: 1,
      txCbor: item.txCbor,
      txFormat: 'cardano-legacy'
    };
  }

  return migrateLegacyPendingActivity(item);
};

export const readMidgardPendingActivities = (value: unknown): MidgardPendingActivity[] =>
  Array.isArray(value)
    ? value
        .map((item) => normalizeMidgardPendingActivity(item))
        .filter((item): item is MidgardPendingActivity => item !== undefined)
    : [];

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

export const isMidgardDepositPendingActivity = (
  pendingActivity: MidgardPendingActivity
): pendingActivity is MidgardPendingActivity & { kind: 'deposit' } => pendingActivity.kind === 'deposit';

export const mergeMidgardPendingActivities = (
  currentPendingActivities: MidgardPendingActivity[],
  nextPendingActivity: MidgardPendingActivity
): MidgardPendingActivity[] => {
  const pendingTxIds = new Set(getMidgardPendingActivityTxIds(nextPendingActivity));
  return [
    ...currentPendingActivities.filter(
      (currentPendingActivity) => !midgardPendingActivityMatchesTxIds(currentPendingActivity, pendingTxIds)
    ),
    nextPendingActivity
  ];
};

export const removeMidgardPendingActivitiesByTxIds = (
  currentPendingActivities: MidgardPendingActivity[],
  txIds: string[]
): MidgardPendingActivity[] => {
  if (txIds.length === 0) return currentPendingActivities;

  const idsToRemove = new Set(txIds);
  return currentPendingActivities.filter(
    (pendingActivity) => !midgardPendingActivityMatchesTxIds(pendingActivity, idsToRemove)
  );
};
