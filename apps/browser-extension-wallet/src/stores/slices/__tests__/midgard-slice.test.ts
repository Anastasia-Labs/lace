import {
  getMidgardPendingActivityTxIds,
  midgardPendingActivityMatchesTxIds,
  MidgardNativePendingActivity
} from '../midgard-slice';

describe('midgard-slice helpers', () => {
  test('includes both native Midgard tx ids when matching pending activities', () => {
    const pendingActivity: MidgardNativePendingActivity = {
      address: 'addr_test1vr4example',
      cardanoPreviewCbor: '84a40081825820preview',
      cardanoTxId: 'cardano-preview-hash',
      createdAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      kind: 'send',
      nativeTxCbor: '84a40081825820native',
      schemaVersion: 2,
      txFormat: 'midgard-native',
      txId: 'midgard-native-hash'
    };

    expect(getMidgardPendingActivityTxIds(pendingActivity)).toEqual([
      'midgard-native-hash',
      'cardano-preview-hash'
    ]);
    expect(midgardPendingActivityMatchesTxIds(pendingActivity, ['cardano-preview-hash'])).toBe(true);
  });
});
