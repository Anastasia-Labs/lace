/* eslint-disable no-magic-numbers */
import { Cardano } from '@cardano-sdk/core';
import { assembleMidgardSignedTx, createMidgardNativeTxDraft } from '../native-signing';
import { decodeMidgardHistoryTx, decodeMidgardPendingTx } from '../native-history-decoder';
import { MidgardTxProvenance, getMidgardTxProvenance } from '../provenance';

const ADDRESS_A = Cardano.PaymentAddress(
  'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
);
const SCRIPT_WITHDRAWAL = {
  quantity: 0n,
  stakeAddress: Cardano.RewardAccount.fromCredential(
    {
      hash: '66'.repeat(28) as Cardano.Credential['hash'],
      type: Cardano.CredentialType.ScriptHash
    },
    0
  )
};

const createSignedMidgardTx = (bodyOverrides?: Partial<Cardano.TxBody>) =>
  assembleMidgardSignedTx(
    createMidgardNativeTxDraft({
      body: {
        fee: 170_000n,
        inputs: [{ index: 0, txId: Cardano.TransactionId('66'.repeat(32)) }],
        networkId: 0 as Cardano.NetworkId,
        outputs: [{ address: ADDRESS_A, value: { coins: 3_000_000n } }],
        referenceInputs: [],
        validityInterval: { invalidHereafter: Cardano.Slot(21) },
        ...bodyOverrides
      }
    }),
    [{ publicKey: '77'.repeat(32), signature: '88'.repeat(64) }]
  );

describe('midgard native history decoder', () => {
  test('decodes locally assembled pending native txs with the Midgard tx id preserved', () => {
    const signed = createSignedMidgardTx();
    const decoded = decodeMidgardPendingTx(signed.cbor);

    expect(decoded.id).toBe(signed.txId);
    expect(getMidgardTxProvenance(decoded)).toBe(MidgardTxProvenance.Layer2Native);
    expect(decoded.body.outputs[0].address).toBe(ADDRESS_A);
    expect(decoded.body.fee).toBe(170_000n);
    expect(decoded.blockHeader.blockNo).toBe(Cardano.BlockNo(0));
  });

  test('keeps pending and history decode aligned for the same native payload', () => {
    const signed = createSignedMidgardTx();

    expect(decodeMidgardPendingTx(signed.cbor)).toEqual(decodeMidgardHistoryTx(signed.cbor, 0));
  });

  test('decodes required observers back into zero-ADA script withdrawals', () => {
    const signed = createSignedMidgardTx({ withdrawals: [SCRIPT_WITHDRAWAL] });
    const decoded = decodeMidgardPendingTx(signed.cbor);

    expect(decoded.body.withdrawals).toEqual([SCRIPT_WITHDRAWAL]);
  });
});
