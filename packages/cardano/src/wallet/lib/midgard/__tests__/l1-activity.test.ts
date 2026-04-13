import { Cardano } from '@cardano-sdk/core';
import {
  MIDGARD_LAYER1_POLICY_IDS,
  getMidgardLayer1ActivityKind,
  isMidgardLayer1BridgeTx,
  MidgardLayer1ActivityKind
} from '../l1-activity';

describe('midgard l1 activity helpers', () => {
  test('detects deposit bridge transactions from minted policy id', () => {
    const mint = new Map([
      [Cardano.AssetId(`${MIDGARD_LAYER1_POLICY_IDS.deposit}00`), BigInt(1)]
    ]) as Cardano.TokenMap;

    expect(getMidgardLayer1ActivityKind(mint)).toBe(MidgardLayer1ActivityKind.Deposit);
    expect(isMidgardLayer1BridgeTx({ body: { mint } as Cardano.TxBody })).toBe(true);
  });

  test('ignores non-bridge mint policies', () => {
    const mint = new Map([
      [Cardano.AssetId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00'), BigInt(1)]
    ]) as Cardano.TokenMap;

    expect(getMidgardLayer1ActivityKind(mint)).toBeUndefined();
    expect(isMidgardLayer1BridgeTx({ body: { mint } as Cardano.TxBody })).toBe(false);
  });
});
