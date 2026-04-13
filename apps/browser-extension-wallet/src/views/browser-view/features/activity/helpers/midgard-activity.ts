import { Wallet } from '@lace/cardano';
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

const MIDGARD_ACTIVITY_LABEL_SET = new Set<string>([
  ...Object.values(MIDGARD_ACTIVITY_LABELS),
  ...Object.values(MIDGARD_PENDING_ACTIVITY_LABELS)
]);

const getMidgardLayer1ActivityKind = (
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

export const getMidgardActivityLabel = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): string | undefined => {
  const activityKind = tx ? getMidgardLayer1ActivityKind(tx.body.mint, environmentName) : undefined;
  return activityKind ? MIDGARD_ACTIVITY_LABELS[activityKind] : undefined;
};

export const getPendingMidgardActivityLabel = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): string | undefined => {
  const activityKind = tx ? getMidgardLayer1ActivityKind(tx.body.mint, environmentName) : undefined;
  return activityKind ? MIDGARD_PENDING_ACTIVITY_LABELS[activityKind] : undefined;
};

export const getPendingMidgardActivityGroupTitle = (
  tx?: Pick<Wallet.Cardano.Tx, 'body'> | Wallet.Cardano.HydratedTx,
  environmentName?: Wallet.ChainName
): string | undefined =>
  tx && getMidgardLayer1ActivityKind(tx.body.mint, environmentName) ? MIDGARD_PENDING_ACTIVITY_GROUP_TITLE : undefined;

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
  const activityKind = tx ? getMidgardLayer1ActivityKind(tx.body.mint, environmentName) : undefined;

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
