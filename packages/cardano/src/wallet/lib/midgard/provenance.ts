import { Cardano } from '@cardano-sdk/core';

export enum MidgardTxProvenance {
  Layer1Bridge = 'midgard-layer1-bridge',
  Layer2Native = 'midgard-layer2-native'
}

export type MidgardProvenanceBearingTx<T extends Cardano.Tx | Cardano.HydratedTx> = T & {
  midgardTxProvenance?: MidgardTxProvenance;
};

export const withMidgardTxProvenance = <T extends Cardano.Tx | Cardano.HydratedTx>(
  tx: T,
  provenance: MidgardTxProvenance
): MidgardProvenanceBearingTx<T> => ({
  ...tx,
  midgardTxProvenance: provenance
});

export const getMidgardTxProvenance = (
  tx?: Cardano.Tx | Cardano.HydratedTx
): MidgardTxProvenance | undefined => {
  if (!tx || !('midgardTxProvenance' in tx)) return undefined;

  return (tx as MidgardProvenanceBearingTx<Cardano.Tx | Cardano.HydratedTx>).midgardTxProvenance;
};
