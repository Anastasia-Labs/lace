/* eslint-disable no-magic-numbers */
/* eslint-disable unicorn/no-useless-undefined */
import { MidgardInputResolver } from '../midgard/input-resolver';
import { Cardano } from '@cardano-sdk/core';
import type { Cache } from '@cardano-sdk/util';
import { Logger } from 'ts-log';

// Mock the dependencies
jest.mock('../midgard/client');

describe('MidgardInputResolver', () => {
  let midgardInputResolver: MidgardInputResolver;
  let mockCache: jest.Mocked<Cache<Cardano.TxOut>>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockCache = {
      get: jest.fn(),
      set: jest.fn()
    };

    mockLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    midgardInputResolver = new MidgardInputResolver({
      cache: mockCache,
      logger: mockLogger
    });
  });

  describe('resolveInput', () => {
    const mockTxIn: Cardano.TxIn = {
      txId: Cardano.TransactionId('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0'),
      index: 1
    };

    const mockTxOut: Cardano.TxOut = {
      address: Cardano.PaymentAddress(
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g'
      ),
      value: {
        coins: BigInt(1_000_000),
        assets: new Map()
      }
    };

    it('should resolve input from cache if available', async () => {
      mockCache.get.mockResolvedValue(mockTxOut);

      const result = await midgardInputResolver.resolveInput(mockTxIn);

      expect(mockCache.get).toHaveBeenCalledWith('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0#1');
      expect(result).toEqual(mockTxOut);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Resolved input bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0#1 from cache'
      );
    });

    it('should resolve input from hints if available', async () => {
      mockCache.get.mockResolvedValue(undefined);

      const mockTransaction: Cardano.HydratedTx = {
        id: Cardano.TransactionId('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0'),
        index: 0,
        blockHeader: {} as Cardano.PartialBlockHeader,
        txSize: 0,
        inputSource: Cardano.InputSource.inputs,
        body: {
          inputs: [],
          outputs: [mockTxOut],
          fee: BigInt(0),
          validityInterval: {}
        },
        witness: {
          signatures: new Map()
        }
      };

      const options: Cardano.ResolveOptions = {
        hints: {
          transactions: [mockTransaction]
        }
      };

      const result = await midgardInputResolver.resolveInput(mockTxIn, options);

      expect(result).toEqual(mockTxOut);
    });

    it('should return null if input not found in cache or hints', async () => {
      mockCache.get.mockResolvedValue(undefined);

      const result = await midgardInputResolver.resolveInput(mockTxIn);

      expect(result).toBeNull();
    });

    it('should return null if hints do not contain the transaction', async () => {
      mockCache.get.mockResolvedValue(undefined);

      const mockTransaction: Cardano.HydratedTx = {
        id: Cardano.TransactionId('different-tx-id'),
        index: 0,
        blockHeader: {} as Cardano.PartialBlockHeader,
        txSize: 0,
        inputSource: Cardano.InputSource.inputs,
        body: {
          inputs: [],
          outputs: [mockTxOut],
          fee: BigInt(0),
          validityInterval: {}
        },
        witness: {
          signatures: new Map()
        }
      };

      const options: Cardano.ResolveOptions = {
        hints: {
          transactions: [mockTransaction]
        }
      };

      const result = await midgardInputResolver.resolveInput(mockTxIn, options);

      expect(result).toBeNull();
    });

    it('should return null if transaction output index is out of bounds', async () => {
      mockCache.get.mockResolvedValue(undefined);

      const mockTransaction: Cardano.HydratedTx = {
        id: Cardano.TransactionId('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0'),
        index: 0,
        blockHeader: {} as Cardano.PartialBlockHeader,
        txSize: 0,
        inputSource: Cardano.InputSource.inputs,
        body: {
          inputs: [],
          outputs: [], // Empty outputs array
          fee: BigInt(0),
          validityInterval: {}
        },
        witness: {
          signatures: new Map()
        }
      };

      const options: Cardano.ResolveOptions = {
        hints: {
          transactions: [mockTransaction]
        }
      };

      const result = await midgardInputResolver.resolveInput(mockTxIn, options);

      expect(result).toBeNull();
    });

    it('should log debug message when resolving input', async () => {
      mockCache.get.mockResolvedValue(undefined);

      await midgardInputResolver.resolveInput(mockTxIn);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Resolving input bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0#1'
      );
    });
  });
});
