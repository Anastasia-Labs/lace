import { Cardano } from '@cardano-sdk/core';
import contractDeploymentInfo from './contract-deployment-info.prototype.json';

export enum MidgardLayer1ActivityKind {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal'
}

type MidgardContractDeploymentInfo = {
  depositMint: { scriptHash: string };
  withdrawalMint: { scriptHash: string };
};

const { depositMint, withdrawalMint } = contractDeploymentInfo as MidgardContractDeploymentInfo;

export const MIDGARD_LAYER1_POLICY_IDS = {
  [MidgardLayer1ActivityKind.Deposit]: depositMint.scriptHash,
  [MidgardLayer1ActivityKind.Withdrawal]: withdrawalMint.scriptHash
} as const;

const getAssetPolicyIds = (mint?: Cardano.TokenMap): Set<string> => {
  const policyIds = new Set<string>();

  if (!mint) return policyIds;

  for (const assetId of mint.keys()) {
    policyIds.add(Cardano.AssetId.getPolicyId(assetId));
  }

  return policyIds;
};

export const getMidgardLayer1ActivityKind = (mint?: Cardano.TokenMap): MidgardLayer1ActivityKind | undefined => {
  const policyIds = getAssetPolicyIds(mint);

  if (policyIds.has(MIDGARD_LAYER1_POLICY_IDS.deposit)) {
    return MidgardLayer1ActivityKind.Deposit;
  }

  return policyIds.has(MIDGARD_LAYER1_POLICY_IDS.withdrawal) ? MidgardLayer1ActivityKind.Withdrawal : undefined;
};

export const isMidgardLayer1BridgeTx = (tx: Pick<Cardano.Tx, 'body'>): boolean =>
  getMidgardLayer1ActivityKind(tx.body.mint) !== undefined;
