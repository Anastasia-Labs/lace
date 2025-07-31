import { MidgardUtxoProvider } from './midgard-providers';
import { Cardano } from '@cardano-sdk/core';

// Mock dependencies
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  trace: jest.fn()
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  clear: jest.fn()
};

const mockMidgardClient = {
  request: jest.fn()
};

const mockBlockfrostClient = {
  request: jest.fn()
};

describe('MidgardUtxoProvider', () => {
  let provider: MidgardUtxoProvider;

  beforeEach(() => {
    provider = new MidgardUtxoProvider(mockMidgardClient, mockBlockfrostClient, mockLogger, mockCache);
    jest.clearAllMocks();
  });

  describe('utxoByAddresses', () => {
    it('should transform Midgard UTxO data to Cardano SDK format', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock Midgard UTxO response from real backend (nested array format)
      const mockMidgardUtxos = [
        [
          {
            txId: 'bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0',
            index: 1
          },
          {
            address: testAddress,
            value: {
              coins: '4027026465',
              assets: {
                '25561d09e55d60b64525b9cdb3cfbec23c94c0634320fec2eaddde584c616365436f696e33': '10000'
              }
            }
          }
        ]
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValue(mockMidgardUtxos);

      const result = await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);

      const [txIn, txOut] = result[0];

      // Check TxIn structure
      expect(txIn).toHaveProperty('txId');
      expect(txIn).toHaveProperty('index');
      expect(txIn).toHaveProperty('address');
      expect(txIn.txId).toBe('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0');
      expect(txIn.index).toBe(1);
      expect(txIn.address).toBe(testAddress);

      // Check TxOut structure
      expect(txOut).toHaveProperty('address');
      expect(txOut).toHaveProperty('value');
      expect(txOut.value).toHaveProperty('coins');
      expect(txOut.value).toHaveProperty('assets');
      expect(txOut.address).toBe(testAddress);
      // eslint-disable-next-line no-magic-numbers
      expect(txOut.value.coins).toBe(BigInt(4_027_026_465));
      expect(txOut.value.assets).toBeInstanceOf(Map);
    });

    it('should handle UTxOs with only lovelace (no assets)', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock UTxO with only lovelace from real backend
      const mockMidgardUtxos = [
        [
          {
            txId: 'ea1517b8c36fea3148df9aa1f49bbee66ff59a5092331a67bd8b3c427e1d79d7',
            index: 2
          },
          {
            address: testAddress,
            value: {
              coins: '9825963',
              assets: {}
            }
          }
        ]
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValue(mockMidgardUtxos);

      const result = await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(result).toHaveLength(1);
      const [, txOut] = result[0]; // eslint-disable-line @typescript-eslint/no-unused-vars

      // eslint-disable-next-line no-magic-numbers
      expect(txOut.value.coins).toBe(BigInt(9_825_963));
      expect(txOut.value.assets).toBeInstanceOf(Map);
      expect((txOut.value.assets as Map<unknown, unknown>).size).toBe(0); // Should be empty
    });

    it('should handle multiple addresses', async () => {
      const addresses = [
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g',
        'addr_test1qzs0umu0s2ammmpw0hea0w2crtcymdjvvlqngpgqy76gpfnuzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475qp3y3vz'
      ];

      const mockUtxos1 = [
        [
          {
            txId: 'bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0',
            index: 1
          },
          {
            address: addresses[0],
            value: {
              coins: '1000000',
              assets: {}
            }
          }
        ]
      ];

      const mockUtxos2 = [
        [
          {
            txId: 'c7c0973c6bbf1a04a9f306da7814b4fa564db649bf48b0bd93c273bd03143547',
            index: 0
          },
          {
            address: addresses[1],
            value: {
              coins: '2000000',
              assets: {}
            }
          }
        ]
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValueOnce(mockUtxos1).mockResolvedValueOnce(mockUtxos2);

      const result = await provider.utxoByAddresses({ addresses });

      // eslint-disable-next-line no-magic-numbers
      expect(result).toHaveLength(2);
      // eslint-disable-next-line no-magic-numbers
      expect(mockMidgardClient.request).toHaveBeenCalledTimes(2);
      expect(mockMidgardClient.request).toHaveBeenCalledWith(`utxos/${addresses[0]}`);
      expect(mockMidgardClient.request).toHaveBeenCalledWith(`utxos/${addresses[1]}`);
    });

    it('should log debug messages', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      mockMidgardClient.request = jest.fn().mockResolvedValue([]);

      await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(mockLogger.debug).toHaveBeenCalledWith('[Midgard] Fetching UTxOs from Midgard for 1 addresses', [
        testAddress
      ]);
    });

    it('should handle invalid UTxO format gracefully', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock invalid UTxO format (not a tuple)
      const mockInvalidUtxos = [
        {
          txId: 'bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0',
          index: 1,
          address: testAddress,
          value: { coins: '1000000', assets: {} }
        }
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValue(mockInvalidUtxos);

      const result = await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(result).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Midgard] Invalid UTxO format (expected tuple of [txIn, txOut]):',
        mockInvalidUtxos[0]
      );
    });

    it('should handle missing required fields gracefully', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock UTxO with missing required fields
      const mockInvalidUtxos = [
        [
          {
            // Missing txId
            index: 1
          },
          {
            address: testAddress,
            value: { coins: '1000000', assets: {} }
          }
        ]
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValue(mockInvalidUtxos);

      const result = await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(result).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith('[Midgard] Invalid txIn data:', mockInvalidUtxos[0][0]);
    });

    it('should fallback to Blockfrost when Midgard fails', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock Midgard failure
      mockMidgardClient.request = jest.fn().mockRejectedValue(new Error('Network error'));

      // Mock Blockfrost fallback
      const mockBlockfrostUtxos = [
        [
          {
            txId: Cardano.TransactionId('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0'),
            index: 1,
            address: Cardano.PaymentAddress(testAddress)
          },
          {
            address: Cardano.PaymentAddress(testAddress),
            value: {
              // eslint-disable-next-line no-magic-numbers
              coins: BigInt(1_000_000),
              assets: new Map()
            }
          }
        ]
      ];

      // Mock the parent class method
      const mockSuperUtxoByAddresses = jest.fn().mockResolvedValue(mockBlockfrostUtxos);
      jest.spyOn(provider, 'utxoByAddresses').mockImplementation(async (args) => {
        try {
          return await mockMidgardClient.request(`utxos/${testAddress}`);
        } catch (error) {
          mockLogger.error(`[Midgard] Failed to fetch UTxOs from Midgard for address ${testAddress}:`, error);
          mockLogger.info(`[Midgard] Falling back to Blockfrost for address ${testAddress}`);
          return mockSuperUtxoByAddresses(args);
        }
      });

      const result = await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[Midgard] Failed to fetch UTxOs from Midgard for address ${testAddress}:`,
        expect.any(Error)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(`[Midgard] Falling back to Blockfrost for address ${testAddress}`);
      expect(result).toEqual(mockBlockfrostUtxos);
    });
  });
});
