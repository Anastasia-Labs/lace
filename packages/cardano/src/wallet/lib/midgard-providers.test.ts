import { MidgardUtxoProvider } from './midgard-providers';
import { MidgardClient } from './midgard-client';

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
} as unknown as MidgardClient;

describe('MidgardUtxoProvider', () => {
  let provider: MidgardUtxoProvider;

  beforeEach(() => {
    provider = new MidgardUtxoProvider(mockMidgardClient, mockLogger, mockCache);
    jest.clearAllMocks();
  });

  describe('utxoByAddresses', () => {
    it('should transform Blockfrost-style UTxO data to Cardano SDK format', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock Blockfrost-style UTxO response from real backend
      // eslint-disable-next-line camelcase, unicorn/no-null
      const mockBlockfrostUtxos = [
        {
          // eslint-disable-next-line camelcase, unicorn/no-null
          tx_hash: 'bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0',
          // eslint-disable-next-line camelcase
          tx_index: 1,
          // eslint-disable-next-line camelcase
          output_index: 1,
          amount: [
            {
              unit: 'lovelace',
              quantity: '4027026465'
            },
            {
              unit: '25561d09e55d60b64525b9cdb3cfbec23c94c0634320fec2eaddde584c616365436f696e33',
              quantity: '10000'
            }
          ],
          block: 'd4e03128b4284d0c855ccf6bd2f414a6c8a5e7d39d9b8a8e8e8e8e8e8e8e8e8e8',
          address: testAddress,
          // eslint-disable-next-line camelcase, unicorn/no-null
          data_hash: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          inline_datum: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          reference_script_hash: null,
          collateral: false,
          reference: false
        }
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValue(mockBlockfrostUtxos);

      const result = await provider.utxoByAddresses({ addresses: [testAddress] });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);

      const [txIn, txOut] = result[0];

      // Check TxIn structure
      expect(txIn).toHaveProperty('txId');
      expect(txIn).toHaveProperty('index');
      expect(txIn.txId).toBe('bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0');
      expect(txIn.index).toBe(1);

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
      // eslint-disable-next-line camelcase, unicorn/no-null
      const mockBlockfrostUtxos = [
        {
          // eslint-disable-next-line camelcase, unicorn/no-null
          tx_hash: 'ea1517b8c36fea3148df9aa1f49bbee66ff59a5092331a67bd8b3c427e1d79d7',
          // eslint-disable-next-line camelcase
          tx_index: 2,
          // eslint-disable-next-line camelcase
          output_index: 2,
          amount: [
            {
              unit: 'lovelace',
              quantity: '9825963'
            }
          ],
          block: 'd4e03128b4284d0c855ccf6bd2f414a6c8a5e7d39d9b8a8e8e8e8e8e8e8e8e8e8',
          address: testAddress,
          // eslint-disable-next-line camelcase, unicorn/no-null
          data_hash: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          inline_datum: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          reference_script_hash: null,
          collateral: false,
          reference: false
        }
      ];

      mockMidgardClient.request = jest.fn().mockResolvedValue(mockBlockfrostUtxos);

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

      // eslint-disable-next-line camelcase, unicorn/no-null
      const mockUtxos1 = [
        {
          // eslint-disable-next-line camelcase, unicorn/no-null
          tx_hash: 'bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0',
          // eslint-disable-next-line camelcase
          tx_index: 1,
          // eslint-disable-next-line camelcase
          output_index: 1,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          address: addresses[0],
          // eslint-disable-next-line camelcase, unicorn/no-null
          data_hash: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          inline_datum: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          reference_script_hash: null,
          collateral: false,
          reference: false
        }
      ];

      // eslint-disable-next-line camelcase, unicorn/no-null
      const mockUtxos2 = [
        {
          // eslint-disable-next-line camelcase, unicorn/no-null
          tx_hash: 'c7c0973c6bbf1a04a9f306da7814b4fa564db649bf48b0bd93c273bd03143547',
          // eslint-disable-next-line camelcase
          tx_index: 0,
          // eslint-disable-next-line camelcase
          output_index: 0,
          amount: [{ unit: 'lovelace', quantity: '2000000' }],
          address: addresses[1],
          // eslint-disable-next-line camelcase, unicorn/no-null
          data_hash: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          inline_datum: null,
          // eslint-disable-next-line camelcase, unicorn/no-null
          reference_script_hash: null,
          collateral: false,
          reference: false
        }
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

    it('should handle errors and re-throw them', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';
      const error = new Error('Midgard API error');

      mockMidgardClient.request = jest.fn().mockRejectedValue(error);

      await expect(provider.utxoByAddresses({ addresses: [testAddress] })).rejects.toThrow('Midgard API error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch UTxOs from Midgard for address'),
        error
      );
    });
  });
});
