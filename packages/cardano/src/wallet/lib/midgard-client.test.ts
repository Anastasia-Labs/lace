import { MidgardClient } from './midgard-client';
import { Logger } from 'ts-log';

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

describe('MidgardClient', () => {
  let client: MidgardClient;

  beforeEach(() => {
    client = new MidgardClient(
      {
        baseUrl: 'https://api.midgard.example.com',
        rateLimiter: mockRateLimiter as any
      },
      mockLogger
    );
  });

  describe('UTxO endpoint mock', () => {
    it('should return mock UTxO data for utxos/{address} endpoint', async () => {
      const testAddress = 'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';
      
      const result = await client.request<any[]>(`utxos/${testAddress}`);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);

      // Check first UTxO
      const firstUtxo = result[0];
      expect(firstUtxo).toHaveProperty('tx_hash');
      expect(firstUtxo).toHaveProperty('output_index');
      expect(firstUtxo).toHaveProperty('amount');
      expect(firstUtxo).toHaveProperty('address', testAddress);
      expect(firstUtxo.amount).toHaveLength(2); // lovelace + asset

      // Check second UTxO
      const secondUtxo = result[1];
      expect(secondUtxo).toHaveProperty('tx_hash');
      expect(secondUtxo).toHaveProperty('output_index');
      expect(secondUtxo).toHaveProperty('amount');
      expect(secondUtxo).toHaveProperty('address', testAddress);
      expect(secondUtxo.amount).toHaveLength(2); // lovelace + asset

      // Check third UTxO
      const thirdUtxo = result[2];
      expect(thirdUtxo).toHaveProperty('tx_hash');
      expect(thirdUtxo).toHaveProperty('output_index');
      expect(thirdUtxo).toHaveProperty('amount');
      expect(thirdUtxo).toHaveProperty('address', testAddress);
      expect(thirdUtxo.amount).toHaveLength(1); // only lovelace
    });

    it('should log debug message when returning mock data', async () => {
      const testAddress = 'addr_test1qq585l3hyxgj3nas2v3xymd23vvartfhceme6gv98aaeg9muzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475q2g7k3g';
      
      await client.request(`utxos/${testAddress}`);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Returning mock UTxO data for address:')
      );
    });
  });
}); 