import { MidgardClient } from './midgard-client';
import { Logger } from 'ts-log';
import { RateLimiter } from '@cardano-sdk/cardano-services-client';

// Mock logger
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn()
};

// Mock rate limiter
const mockRateLimiter = {
  schedule: jest.fn((fn) => fn())
};

// Mock fetch
global.fetch = jest.fn();

describe('MidgardClient', () => {
  let client: MidgardClient;

  beforeEach(() => {
    client = new MidgardClient(
      {
        baseUrl: 'https://api.midgard.example.com',
        rateLimiter: mockRateLimiter as unknown as RateLimiter
      },
      mockLogger
    );
    jest.clearAllMocks();
  });

  describe('UTxO endpoint', () => {
    it('should make real HTTP request for utxos/{address} endpoint', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      // Mock successful response
      // eslint-disable-next-line camelcase, unicorn/no-null
      const mockResponse = [
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

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await client.request<typeof mockResponse>(`utxos/${testAddress}`);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);

      // Verify fetch was called with correct URL
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.midgard.example.com/utxos/${testAddress}`,
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      // Check first UTxO
      const firstUtxo = result[0];
      expect(firstUtxo).toHaveProperty('tx_hash');
      expect(firstUtxo).toHaveProperty('output_index');
      expect(firstUtxo).toHaveProperty('amount');
      expect(firstUtxo).toHaveProperty('address', testAddress);
      // eslint-disable-next-line no-magic-numbers
      expect(firstUtxo.amount).toHaveLength(2); // lovelace + asset
    });

    it('should handle HTTP errors', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      await expect(client.request(`utxos/${testAddress}`)).rejects.toThrow('HTTP 404: Not Found');
    });

    it('should log debug message when making request', async () => {
      const testAddress =
        'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

      await client.request(`utxos/${testAddress}`);

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Making Midgard request to:'));
    });
  });
});
