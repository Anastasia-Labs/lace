/* eslint-disable @typescript-eslint/no-explicit-any */
const mockGetProviders = jest.fn();
const mockTransactionFromCbor = jest.fn();

jest.mock('@lib/scripts/background/config', () => ({
  getProviders: (...args: any[]) => mockGetProviders(...args)
}));

jest.mock('@lace/cardano', () => ({
  Wallet: {
    Serialization: {
      TxCBOR: (value: string) => value
    }
  }
}));

jest.mock('@cardano-sdk/core', () => ({
  Serialization: {
    Transaction: {
      fromCbor: (...args: any[]) => mockTransactionFromCbor(...args)
    }
  }
}));

import { buildMidgardDeposit, submitSignedCardanoTx } from '../deposit';

describe('Midgard deposit helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransactionFromCbor.mockReturnValue({
      toCore: () => ({
        id: {
          toString: () => 'local-tx-id'
        }
      })
    });
  });

  test('rejects when the Cardano submit provider returns a different tx id', async () => {
    mockGetProviders.mockResolvedValue({
      txSubmitProvider: {
        submitTx: jest.fn().mockResolvedValue('different-tx-id')
      }
    });

    await expect(
      submitSignedCardanoTx({
        chainName: 'Preprod' as never,
        signedTxCbor: 'deadbeef'
      })
    ).rejects.toThrow('Cardano submit tx id mismatch');
  });

  test('builds a deposit with the aggregate UTxO set when funds are split across addresses', async () => {
    mockGetProviders.mockResolvedValue({
      utxoProvider: {
        utxoByAddresses: jest.fn().mockImplementation(async ({ addresses }: { addresses: string[] }) => {
          const address = addresses[0];

          if (address === 'addr-a') {
            return [[{ index: 0, txId: 'a' }, { address, value: { coins: BigInt(1_500_000) } }]];
          }

          if (address === 'addr-b') {
            return [[{ index: 1, txId: 'b' }, { address, value: { coins: BigInt(1_500_000) } }]];
          }

          return [];
        })
      }
    });
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ unsignedTxCbor: 'unsigned-tx-cbor' }),
      ok: true
    } as unknown as Response);

    await expect(
      buildMidgardDeposit({
        amount: BigInt(2_000_000),
        chainName: 'Preprod' as never,
        fundingAddresses: ['addr-a', 'addr-b'],
        l2Address: 'l2-address',
        midgardUrl: 'http://midgard.local'
      })
    ).resolves.toEqual({ unsignedTxCbor: 'unsigned-tx-cbor' });

    const requestBody = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    expect(requestBody.fundingAddress).toBe('addr-a');
    expect(requestBody.fundingUtxos).toHaveLength(2);
    expect(requestBody.fundingUtxos.map((utxo: { address: string }) => utxo.address)).toEqual(['addr-a', 'addr-b']);
  });

  test('retries the build with alternate funding addresses while keeping the aggregate UTxO set', async () => {
    mockGetProviders.mockResolvedValue({
      utxoProvider: {
        utxoByAddresses: jest.fn().mockImplementation(async ({ addresses }: { addresses: string[] }) => {
          const address = addresses[0];

          if (address === 'addr-small') {
            return [[{ index: 0, txId: 'small' }, { address, value: { coins: BigInt(2_500_000) } }]];
          }

          if (address === 'addr-large') {
            return [[{ index: 1, txId: 'large' }, { address, value: { coins: BigInt(4_500_000) } }]];
          }

          return [];
        })
      }
    });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({ error: 'builder rejected addr-large' }),
        ok: false
      } as unknown as Response)
      .mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({ unsignedTxCbor: 'unsigned-tx-cbor' }),
        ok: true
      } as unknown as Response);

    await expect(
      buildMidgardDeposit({
        amount: BigInt(2_000_000),
        chainName: 'Preprod' as never,
        fundingAddresses: ['addr-small', 'addr-large'],
        l2Address: 'l2-address',
        midgardUrl: 'http://midgard.local'
      })
    ).resolves.toEqual({ unsignedTxCbor: 'unsigned-tx-cbor' });

    const firstRequestBody = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    const secondRequestBody = JSON.parse(String((global.fetch as jest.Mock).mock.calls[1][1].body));

    expect(firstRequestBody.fundingAddress).toBe('addr-small');
    expect(secondRequestBody.fundingAddress).toBe('addr-large');
    expect(firstRequestBody.fundingUtxos).toHaveLength(2);
    expect(secondRequestBody.fundingUtxos).toHaveLength(2);
  });
});
