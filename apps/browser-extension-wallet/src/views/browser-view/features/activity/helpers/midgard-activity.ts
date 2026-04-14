import { Wallet } from '@lace/cardano';
import { MidgardPendingDepositTrackingStatus } from '@src/utils/midgard-pending-activities';
import { getMidgardLayer1PolicyIds } from '@src/utils/midgard-config';
import { TxDirections } from '@src/types';

enum MidgardLayer1ActivityKind {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal'
}

export const MIDGARD_ACTIVITY_LABELS = {
  [MidgardLayer1ActivityKind.Deposit]: 'Midgard L2 Deposit',
  [MidgardLayer1ActivityKind.Withdrawal]: 'Midgard L2 Withdrawal'
} as const;

export const MIDGARD_PENDING_ACTIVITY_LABELS = {
  [MidgardLayer1ActivityKind.Deposit]: 'Depositing',
  [MidgardLayer1ActivityKind.Withdrawal]: 'Withdrawing'
} as const;

export const MIDGARD_PENDING_ACTIVITY_GROUP_TITLE = 'Confirming';
export const MIDGARD_ATTENTION_ACTIVITY_GROUP_TITLE = 'Needs attention';
export const MIDGARD_PENDING_BROADCAST_REQUESTED_LABEL = 'Broadcast requested';
export const MIDGARD_PENDING_BROADCAST_NOT_OBSERVED_LABEL = 'Broadcast not observed';
export const MIDGARD_PENDING_TRACKING_STATUS_KEY = 'laceMidgardTrackingStatus';

const MIDGARD_ACTIVITY_LABEL_SET = new Set<string>([
  ...Object.values(MIDGARD_ACTIVITY_LABELS),
  ...Object.values(MIDGARD_PENDING_ACTIVITY_LABELS),
  MIDGARD_PENDING_BROADCAST_REQUESTED_LABEL,
  MIDGARD_PENDING_BROADCAST_NOT_OBSERVED_LABEL
]);

const getPendingTrackingStatus = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx
): MidgardPendingDepositTrackingStatus | undefined => {
  const trackingStatus =
    tx && MIDGARD_PENDING_TRACKING_STATUS_KEY in tx
      ? (tx as Wallet.Cardano.HydratedTx & { [MIDGARD_PENDING_TRACKING_STATUS_KEY]?: MidgardPendingDepositTrackingStatus })[
          MIDGARD_PENDING_TRACKING_STATUS_KEY
        ]
      : undefined;

  return trackingStatus;
};

const getMidgardLayer1ActivityKindFromMint = (
  mint?: Wallet.Cardano.TokenMap,
  environmentName?: Wallet.ChainName
): MidgardLayer1ActivityKind | undefined => {
  let activityKind: MidgardLayer1ActivityKind | undefined;
  const policyIds = getMidgardLayer1PolicyIds(environmentName);

  if (mint && policyIds) {
    for (const assetId of mint.keys()) {
      const policyId = Wallet.Cardano.AssetId.getPolicyId(assetId);

      if (policyId === policyIds.deposit) {
        activityKind = MidgardLayer1ActivityKind.Deposit;
        break;
      }

      if (policyId === policyIds.withdrawal) {
        activityKind = MidgardLayer1ActivityKind.Withdrawal;
        break;
      }
    }
  }

  return activityKind;
};

const getMidgardLayer1ActivityKindFromBridgeCertificate = (
  certificates?: Wallet.Cardano.Certificate[]
): MidgardLayer1ActivityKind | undefined => {
  if (!certificates || certificates.length === 0) return undefined;

  for (const certificate of certificates) {
    switch (certificate.__typename) {
      case Wallet.Cardano.CertificateType.Registration:
      case Wallet.Cardano.CertificateType.StakeRegistrationDelegation:
      case Wallet.Cardano.CertificateType.VoteRegistrationDelegation:
      case Wallet.Cardano.CertificateType.StakeVoteRegistrationDelegation:
        return MidgardLayer1ActivityKind.Deposit;
      case Wallet.Cardano.CertificateType.Unregistration:
        return MidgardLayer1ActivityKind.Withdrawal;
      default:
        break;
    }
  }

  return undefined;
};

export const isMidgardDepositCertificateCandidate = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx
): boolean => getMidgardLayer1ActivityKindFromBridgeCertificate(tx?.body.certificates) === MidgardLayer1ActivityKind.Deposit;

const getMidgardLayer1ActivityKind = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): MidgardLayer1ActivityKind | undefined => {
  const activityKindFromMint = getMidgardLayer1ActivityKindFromMint(tx?.body.mint, environmentName);
  if (activityKindFromMint) return activityKindFromMint;

  const txProvenance =
    tx && 'midgardTxProvenance' in tx ? Wallet.getMidgardTxProvenance(tx as Wallet.Cardano.HydratedTx) : undefined;
  if (!tx || txProvenance !== Wallet.MidgardTxProvenance.Layer1Bridge) return undefined;

  return getMidgardLayer1ActivityKindFromBridgeCertificate(tx.body.certificates);
};

export const isMidgardDepositActivity = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): boolean => getMidgardLayer1ActivityKind(tx, environmentName) === MidgardLayer1ActivityKind.Deposit;

export const getMidgardActivityLabel = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): string | undefined => {
  const activityKind = getMidgardLayer1ActivityKind(tx, environmentName);
  return activityKind ? MIDGARD_ACTIVITY_LABELS[activityKind] : undefined;
};

export const getPendingMidgardActivityLabel = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): string | undefined => {
  const trackingStatus = getPendingTrackingStatus(tx);
  if (trackingStatus === 'broadcast_requested') {
    return MIDGARD_PENDING_BROADCAST_REQUESTED_LABEL;
  }
  if (trackingStatus === 'broadcast_not_observed') {
    return MIDGARD_PENDING_BROADCAST_NOT_OBSERVED_LABEL;
  }

  const activityKind = getMidgardLayer1ActivityKind(tx, environmentName);
  return activityKind ? MIDGARD_PENDING_ACTIVITY_LABELS[activityKind] : undefined;
};

export const getPendingMidgardActivityGroupTitle = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): string | undefined =>
  getPendingTrackingStatus(tx) === 'broadcast_not_observed'
    ? MIDGARD_ATTENTION_ACTIVITY_GROUP_TITLE
    : getMidgardLayer1ActivityKind(tx, environmentName)
      ? MIDGARD_PENDING_ACTIVITY_GROUP_TITLE
      : undefined;

export const isMidgardLayer2Activity = (tx?: Wallet.Cardano.HydratedTx): boolean => {
  if (!tx) return false;

  return Wallet.getMidgardTxProvenance(tx) === Wallet.MidgardTxProvenance.Layer2Native;
};

export const isMidgardActivity = (tx: Wallet.Cardano.HydratedTx, environmentName?: Wallet.ChainName): boolean =>
  !!getMidgardActivityLabel(tx, environmentName) ||
  Wallet.getMidgardTxProvenance(tx) === Wallet.MidgardTxProvenance.Layer1Bridge ||
  isMidgardLayer2Activity(tx);

export const getMidgardActivityDirection = (
  tx: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx | undefined,
  environmentName?: Wallet.ChainName,
  fallbackDirection?: TxDirections
): TxDirections | undefined => {
  const activityKind = getMidgardLayer1ActivityKind(tx, environmentName);

  switch (activityKind) {
    case MidgardLayer1ActivityKind.Deposit:
      return TxDirections.Outgoing;
    case MidgardLayer1ActivityKind.Withdrawal:
      return TxDirections.Incoming;
    default:
      return fallbackDirection;
  }
};

export const isMidgardActivityLabel = (label?: string): boolean => !!label && MIDGARD_ACTIVITY_LABEL_SET.has(label);
