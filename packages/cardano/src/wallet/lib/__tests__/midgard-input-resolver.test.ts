/* eslint-disable no-magic-numbers */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable max-len */
/* eslint-disable sonarjs/no-identical-functions */
import '@testing-library/jest-dom';
import { MidgardInputResolver } from '../midgard-input-resolver';
import { MidgardClient } from '../midgard-client';
import { Cardano } from '@cardano-sdk/core';

describe('MidgardInputResolver', () => {
  let clientMock: jest.Mocked<MidgardClient>;
  let loggerMock: jest.Mocked<any>;
  let resolver: MidgardInputResolver;

  beforeEach(() => {
    clientMock = {
      request: jest.fn()
    } as unknown as jest.Mocked<MidgardClient>;

    loggerMock = {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    } as unknown as jest.Mocked<any>;

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const createProviderCache = () => {
      const cache = new Map();
      return {
        async get(key: string) {
          return cache.get(key);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async set(key: string, val: any) {
          cache.set(key, val);
        }
      };
    };

    resolver = new MidgardInputResolver({
      cache: createProviderCache(),
      logger: loggerMock
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should resolve input using hints if available', async () => {
    const txIn: Cardano.TxIn = { txId: 'txId1' as Cardano.TransactionId, index: 0 };
    const hint = {
      id: 'txId1' as Cardano.TransactionId,
      body: {
        outputs: [{ address: 'addr1' as Cardano.PaymentAddress, value: { coins: BigInt(1000) } }]
      }
    } as Cardano.Tx;

    const result = await resolver.resolveInput(txIn, { hints: { transactions: [hint] } });

    expect(result).toEqual(hint.body.outputs[0]);
    expect(loggerMock.debug).toHaveBeenCalledWith('Resolved input txId1#0 from hint');
  });

  it('should resolve input using UTxO hints if available', async () => {
    const txIn: Cardano.TxIn = { txId: 'txId1' as Cardano.TransactionId, index: 0 };
    const utxoHint: Cardano.Utxo = [
      { txId: 'txId1' as Cardano.TransactionId, index: 0, address: 'addr1' as Cardano.PaymentAddress },
      { address: 'addr1' as Cardano.PaymentAddress, value: { coins: BigInt(1000) } }
    ];

    const result = await resolver.resolveInput(txIn, { hints: { utxos: [utxoHint] } });

    expect(result).toEqual(utxoHint[1]);
    expect(loggerMock.debug).toHaveBeenCalledWith('Resolved input txId1#0 from hint');
  });

  it('should return null when input cannot be resolved', async () => {
    const txIn: Cardano.TxIn = { txId: 'txId1' as Cardano.TransactionId, index: 0 };

    const result = await resolver.resolveInput(txIn);

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith('Input txId1#0 could not be resolved from Midgard - returning null');
  });

  it('should cache resolved inputs', async () => {
    const txIn: Cardano.TxIn = { txId: 'txId1' as Cardano.TransactionId, index: 0 };
    const hint = {
      id: 'txId1' as Cardano.TransactionId,
      body: {
        outputs: [{ address: 'addr1' as Cardano.PaymentAddress, value: { coins: BigInt(1000) } }]
      }
    } as Cardano.Tx;

    // First call should resolve from hint
    const result1 = await resolver.resolveInput(txIn, { hints: { transactions: [hint] } });
    expect(result1).toEqual(hint.body.outputs[0]);

    // Second call should resolve from cache
    const result2 = await resolver.resolveInput(txIn);
    expect(result2).toEqual(hint.body.outputs[0]);
    expect(loggerMock.debug).toHaveBeenCalledWith('Resolved input txId1#0 from cache');
  });

  it('should handle errors gracefully and return null', async () => {
    const txIn: Cardano.TxIn = { txId: 'txId1' as Cardano.TransactionId, index: 0 };
    
    // Mock client to throw an error
    clientMock.request = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await resolver.resolveInput(txIn);

    expect(result).toBeNull();
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to fetch transaction txId1 from Midgard', expect.any(Error));
  });
}); 