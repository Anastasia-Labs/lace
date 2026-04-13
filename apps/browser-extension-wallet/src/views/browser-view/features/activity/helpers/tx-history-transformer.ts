import BigNumber from 'bignumber.js';
import { Wallet } from '@lace/cardano';
import { TransactionActivityType } from '@lace/core';
import { TxDirections } from '@src/types';
import { getTxDirection, inspectTxType, inspectTxValues } from '@src/utils/tx-inspection';
import { getFormattedFiatAmount, txTransformer, TxTransformerInput } from './common-tx-transformer';
import { getMidgardActivityDirection, getMidgardActivityLabel, isMidgardActivity } from './midgard-activity';
import type { TransformedTransactionActivity } from './types';

interface TxHistoryTransformerInput extends Omit<TxTransformerInput, 'tx'> {
  tx: Wallet.Cardano.HydratedTx;
  environmentName?: Wallet.ChainName;
  isSharedWallet?: boolean;
}

type MidgardBridgeActivityType = TransactionActivityType.incoming | TransactionActivityType.outgoing;

const getMidgardBridgeActivityType = (
  label?: string,
  direction?: TxDirections
): MidgardBridgeActivityType | undefined => {
  if (!label) return undefined;

  switch (direction) {
    case TxDirections.Incoming:
      return TransactionActivityType.incoming;
    case TxDirections.Outgoing:
      return TransactionActivityType.outgoing;
    default:
      return undefined;
  }
};

export const txHistoryTransformer = async ({
  tx,
  walletAddresses,
  fiatCurrency,
  fiatPrice,
  date,
  protocolParameters,
  cardanoCoin,
  resolveInput,
  environmentName,
  isSharedWallet
}: TxHistoryTransformerInput): Promise<TransformedTransactionActivity[]> => {
  const type = await inspectTxType({ walletAddresses, tx, inputResolver: { resolveInput } });
  const direction = getTxDirection({ type });
  const label = getMidgardActivityLabel(tx, environmentName);
  const isMidgardTx = isMidgardActivity(tx, environmentName);
  const resolvedDirection = getMidgardActivityDirection(tx, environmentName, direction);
  const midgardBridgeActivityType = getMidgardBridgeActivityType(label, resolvedDirection);

  const transformedTransactions = await txTransformer({
    tx,
    walletAddresses,
    fiatCurrency,
    fiatPrice,
    date,
    protocolParameters,
    cardanoCoin,
    status: Wallet.TransactionStatus.SUCCESS,
    direction: resolvedDirection,
    resolveInput,
    isSharedWallet
  });

  if (!isMidgardTx) return transformedTransactions;

  const value = await inspectTxValues({
    addresses: walletAddresses,
    tx,
    direction: resolvedDirection ?? TxDirections.Outgoing
  });
  const amount = Wallet.util.getFormattedAmount({ amount: value.coins.toString(), cardanoCoin });
  const fiatAmount = getFormattedFiatAmount({
    amount: new BigNumber(value.coins.toString()),
    fiatCurrency,
    fiatPrice: fiatPrice ?? 0
  });

  return transformedTransactions.map((activity) => ({
    ...activity,
    ...(label && { label }),
    ...(midgardBridgeActivityType && { type: midgardBridgeActivityType }),
    direction: resolvedDirection,
    amount,
    fiatAmount
  }));
};
