const mockTransactionInputFromCbor = jest.fn();
const mockTransactionOutputFromCbor = jest.fn();

jest.mock('@cardano-sdk/cardano-services-client', () => ({
  BlockfrostUtxoProvider: class {
    constructor() {
      // No-op test double
    }
  }
}));

jest.mock('@cardano-sdk/core', () => ({
  Serialization: {
    TransactionInput: {
      fromCbor: (...args: unknown[]) => mockTransactionInputFromCbor(...args)
    },
    TransactionOutput: {
      fromCbor: (...args: unknown[]) => mockTransactionOutputFromCbor(...args)
    }
  }
}));

import { MidgardUtxoProvider } from '../utxo-provider';

describe('MidgardUtxoProvider', () => {
  const midgardClient = {
    request: jest.fn()
  } as const;
  const logger = {
    error: jest.fn()
  } as const;

  const createProvider = () => new MidgardUtxoProvider(midgardClient as never, {} as never, logger as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransactionInputFromCbor.mockReturnValue({
      toCore: () => ({
        index: 0,
        txId: 'tx-id'
      })
    });
    mockTransactionOutputFromCbor.mockReturnValue({
      toCore: () => ({
        address: 'addr_test1...',
        value: { coins: BigInt(2_000_000) }
      })
    });
  });

  test('returns decoded Midgard UTxOs for every requested address', async () => {
    midgardClient.request.mockResolvedValue({
      utxos: [{ outref: 'a1', value: 'b2' }]
    });

    const provider = createProvider();
    const result = await provider.utxoByAddresses({
      addresses: ['addr_test1...']
    });

    expect(result).toEqual([
      [
        { address: 'addr_test1...', index: 0, txId: 'tx-id' },
        { address: 'addr_test1...', value: { coins: BigInt(2_000_000) } }
      ]
    ]);
  });

  test('fails the provider when Midgard returns a malformed UTxO', async () => {
    midgardClient.request.mockResolvedValue({
      utxos: [{ outref: 'bad-outref', value: 'b2' }]
    });
    mockTransactionInputFromCbor.mockImplementation(() => {
      throw new Error('decode failure');
    });

    const provider = createProvider();

    await expect(
      provider.utxoByAddresses({
        addresses: ['addr_test1broken']
      })
    ).rejects.toThrow('Midgard returned a malformed UTxO for addr_test1broken');
  });
});
