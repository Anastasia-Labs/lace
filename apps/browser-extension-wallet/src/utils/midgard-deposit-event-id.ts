import { Serialization } from '@cardano-sdk/core';

export const getMidgardDepositEventIdFromInput = (txId: string, index: number): string => {
  const items = new Serialization.PlutusList();
  items.add(Serialization.PlutusData.newBytes(Buffer.from(txId, 'hex')));
  items.add(Serialization.PlutusData.newInteger(BigInt(index)));

  return Serialization.PlutusData.newConstrPlutusData(new Serialization.ConstrPlutusData(BigInt(0), items)).toCbor();
};

export const getMidgardDepositEventIdFromTxCbor = (txCbor?: string): string | undefined => {
  if (!txCbor) return undefined;

  try {
    const [input] = Serialization.Transaction.fromCbor(txCbor).toCore().body.inputs ?? [];
    if (!input) return undefined;

    return getMidgardDepositEventIdFromInput(input.txId, input.index);
  } catch {
    return undefined;
  }
};
