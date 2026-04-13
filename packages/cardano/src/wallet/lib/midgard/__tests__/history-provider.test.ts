/* eslint-disable no-magic-numbers */
import { Cardano } from '@cardano-sdk/core';
import { MidgardChainHistoryProvider } from '../history-provider';
import { MIDGARD_LAYER1_POLICY_IDS } from '../l1-activity';
import { assembleMidgardSignedTx, createMidgardNativeTxDraft } from '../native-signing';
import { MidgardTxProvenance, getMidgardTxProvenance } from '../provenance';

const TWO_ADDRESSES = 2;
const SYNTHETIC_SLOT_NEWER = 20;
const SYNTHETIC_SLOT_OLDER = 19;
const MIDGARD_FEE = 170_000n;
const ADDRESS_A = Cardano.PaymentAddress(
  'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
);
const ADDRESS_B = Cardano.PaymentAddress(
  'addr_test1qpr3akacs72xelgd60ucdz0j4uw8dkg86jhntqd6gjpk84adv3qw0nafy8arl48xwhhnlzxre3cwx0xjnlwxfm77l00smqpvpz'
);

const makeHexHash = (byte: number) => Buffer.alloc(32, byte).toString('hex');

const createMidgardTx = ({
  inputTxHashByte,
  outputAddress,
  outputCoin,
  validityEnd,
  networkId = 0 as Cardano.NetworkId
}: {
  inputTxHashByte: number;
  networkId?: Cardano.NetworkId;
  outputAddress: Cardano.PaymentAddress;
  outputCoin: bigint;
  validityEnd: number;
}) => {
  const draft = createMidgardNativeTxDraft({
    body: {
      fee: MIDGARD_FEE,
      inputs: [{ index: 0, txId: Cardano.TransactionId(makeHexHash(inputTxHashByte)) }],
      networkId,
      outputs: [{ address: outputAddress, value: { coins: outputCoin } }],
      referenceInputs: [],
      validityInterval: { invalidHereafter: Cardano.Slot(validityEnd) }
    }
  });
  const signed = assembleMidgardSignedTx(draft, [{ publicKey: '88'.repeat(32), signature: '99'.repeat(64) }]);

  return { id: signed.txId, txHex: signed.cbor };
};

const createLayer1BridgeTx = ({
  idByte,
  slot
}: {
  idByte: number;
  slot: number;
}): Cardano.HydratedTx =>
  ({
    blockHeader: {
      blockNo: Cardano.BlockNo(slot),
      hash: `block-${slot}`,
      slot
    },
    body: {
      mint: new Map([[Cardano.AssetId(`${MIDGARD_LAYER1_POLICY_IDS.deposit}00`), BigInt(1)]]) as Cardano.TokenMap
    },
    id: Cardano.TransactionId(makeHexHash(idByte)),
    index: 0
  }) as Cardano.HydratedTx;

describe('MidgardChainHistoryProvider', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  } as const;

  const layer1ChainHistoryProvider = {
    transactionsByAddresses: jest.fn(),
    transactionsByHashes: jest.fn(),
    blocksByHashes: jest.fn()
  } as const;

  const midgardClient = {
    request: jest.fn()
  } as const;

  const createProvider = () =>
    new MidgardChainHistoryProvider(midgardClient as never, layer1ChainHistoryProvider as never, logger as never);

  beforeEach(() => {
    jest.clearAllMocks();
    layer1ChainHistoryProvider.transactionsByAddresses.mockResolvedValue({
      pageResults: [],
      totalResultCount: 0
    });
    layer1ChainHistoryProvider.transactionsByHashes.mockResolvedValue([]);
    layer1ChainHistoryProvider.blocksByHashes.mockResolvedValue([]);
  });

  test('queries Midgard history for every address and deduplicates overlapping txs by Midgard tx id', async () => {
    const txA = createMidgardTx({
      inputTxHashByte: 1,
      outputAddress: ADDRESS_A,
      outputCoin: 3_000_000n,
      validityEnd: SYNTHETIC_SLOT_NEWER
    });
    const txB = createMidgardTx({
      inputTxHashByte: 2,
      outputAddress: ADDRESS_B,
      outputCoin: 2_000_000n,
      validityEnd: SYNTHETIC_SLOT_OLDER
    });

    midgardClient.request.mockImplementation(async (endpoint: string) => {
      if (endpoint === `txs?address=${encodeURIComponent(ADDRESS_A)}`) return { txs: [txA.txHex, txB.txHex] };
      if (endpoint === `txs?address=${encodeURIComponent(ADDRESS_B)}`) return { txs: [txB.txHex] };
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const provider = createProvider();

    const result = await provider.transactionsByAddresses({
      addresses: [ADDRESS_A, ADDRESS_B],
      pagination: { limit: 25, order: 'desc', startAt: 0 }
    });

    expect(midgardClient.request).toHaveBeenCalledTimes(TWO_ADDRESSES);
    expect(result.pageResults.map((tx) => tx.id.toString())).toEqual([txA.id.toString(), txB.id.toString()]);
    expect(getMidgardTxProvenance(result.pageResults[0])).toBe(MidgardTxProvenance.Layer2Native);
    expect(result.pageResults[0].body.outputs[0].address).toBe(ADDRESS_A);
    expect(result.pageResults[1].body.outputs[0].address).toBe(ADDRESS_B);
  });

  test('keeps Midgard history available on blockRange fetches and preserves the Midgard tx id', async () => {
    const tx = createMidgardTx({
      inputTxHashByte: 9,
      outputAddress: ADDRESS_A,
      outputCoin: 1_500_000n,
      validityEnd: SYNTHETIC_SLOT_OLDER
    });

    midgardClient.request.mockResolvedValue({ txs: [tx.txHex] });

    const provider = createProvider();
    const filteredOut = await provider.transactionsByAddresses({
      addresses: [ADDRESS_A],
      blockRange: { upperBound: Cardano.BlockNo(0) },
      pagination: { limit: 25, order: 'desc', startAt: 0 }
    });
    const included = await provider.transactionsByAddresses({
      addresses: [ADDRESS_A],
      blockRange: { upperBound: Cardano.BlockNo(1) },
      pagination: { limit: 25, order: 'desc', startAt: 0 }
    });

    expect(filteredOut.pageResults).toEqual([]);
    expect(included.pageResults).toHaveLength(1);
    expect(included.pageResults[0].id).toBe(tx.id);
  });

  test('honors pagination startAt/limit and ascending order across Midgard and layer 1 bridge history', async () => {
    const newestMidgardTx = createMidgardTx({
      inputTxHashByte: 3,
      outputAddress: ADDRESS_A,
      outputCoin: 4_000_000n,
      validityEnd: SYNTHETIC_SLOT_NEWER
    });
    const olderMidgardTx = createMidgardTx({
      inputTxHashByte: 4,
      outputAddress: ADDRESS_B,
      outputCoin: 2_500_000n,
      validityEnd: SYNTHETIC_SLOT_OLDER
    });
    const oldestBridgeTx = createLayer1BridgeTx({ idByte: 5, slot: 18 });

    midgardClient.request.mockResolvedValue({ txs: [newestMidgardTx.txHex, olderMidgardTx.txHex] });
    layer1ChainHistoryProvider.transactionsByAddresses.mockResolvedValue({
      pageResults: [oldestBridgeTx],
      totalResultCount: 1
    });

    const provider = createProvider();
    const result = await provider.transactionsByAddresses({
      addresses: [ADDRESS_A],
      pagination: { limit: 1, order: 'asc', startAt: 1 }
    });

    expect(layer1ChainHistoryProvider.transactionsByAddresses).toHaveBeenCalledWith({
      addresses: [ADDRESS_A],
      pagination: { limit: 25, order: 'asc', startAt: 0 }
    });
    expect(result.totalResultCount).toBe(3);
    expect(result.pageResults.map((tx) => tx.id.toString())).toEqual([olderMidgardTx.id.toString()]);
  });

  test('propagates Midgard history failures instead of returning an empty page', async () => {
    const failure = new Error('midgard unavailable');
    midgardClient.request.mockRejectedValue(failure);

    const provider = createProvider();

    await expect(
      provider.transactionsByAddresses({
        addresses: [ADDRESS_A],
        pagination: { limit: 25, order: 'desc', startAt: 0 }
      })
    ).rejects.toThrow('midgard unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      '[MidgardChainHistoryProvider] Error fetching transactionsByAddresses:',
      failure
    );
  });
});
