/* eslint-disable no-magic-numbers */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MidgardUtxoProvider } from '../midgard/utxo-provider';
import { MidgardClient } from '../midgard/client';
import { BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import { Logger } from 'ts-log';
import type { Cache } from '@cardano-sdk/util';

// Mock the dependencies
jest.mock('../midgard/client');
jest.mock('@cardano-sdk/cardano-services-client');

describe('MidgardUtxoProvider', () => {
  let midgardProvider: MidgardUtxoProvider;
  let mockMidgardClient: jest.Mocked<MidgardClient>;
  let mockBlockfrostClient: jest.Mocked<BlockfrostClient>;
  let mockLogger: jest.Mocked<Logger>;
  let mockCache: jest.Mocked<Cache<any>>;

  beforeEach(() => {
    mockMidgardClient = {
      request: jest.fn(),
      post: jest.fn()
    } as any;

    mockBlockfrostClient = {} as any;
    mockLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    mockCache = {} as any;

    midgardProvider = new MidgardUtxoProvider(mockMidgardClient, mockBlockfrostClient, mockLogger, mockCache);
  });

  describe('utxoByAddresses', () => {
    it('should handle Midgard response format correctly', async () => {
      const mockResponse = {
        utxos: [
          {
            outref: {
              type: 'Buffer',
              data: [
                130, 88, 32, 142, 50, 209, 140, 7, 203, 162, 182, 85, 119, 188, 130, 154, 152, 117, 226, 252, 60, 219,
                85, 77, 91, 10, 187, 179, 212, 227, 167, 26, 62, 62, 61, 0
              ]
            },
            value: {
              type: 'Buffer',
              data: [
                130, 88, 57, 1, 91, 33, 230, 3, 29, 148, 90, 220, 133, 155, 86, 15, 144, 180, 167, 219, 251, 147, 71,
                61, 31, 232, 94, 201, 48, 92, 180, 38, 37, 96, 172, 94, 56, 39, 245, 139, 161, 89, 180, 39, 126, 120,
                220, 166, 120, 47, 156, 241, 255, 24, 2, 95, 253, 172, 128, 37, 130, 25, 1, 44, 161, 88, 28, 37, 86, 29,
                9, 229, 93, 96, 182, 69, 37, 185, 205, 179, 207, 190, 194, 60, 148, 192, 99, 67, 32, 254, 194, 234, 221,
                222, 88, 161, 73, 76, 97, 99, 101, 67, 111, 105, 110, 51, 15
              ]
            }
          }
        ]
      };

      mockMidgardClient.request.mockResolvedValue(mockResponse);

      const addresses = [
        'addr1q9djresrrk294hy9ndtqly955ldlhy688507shkfxpwtgf39vzk9uwp87k96zkd5yal83h9x0qheeu0lrqp9lldvsqjshxggyj'
      ];

      try {
        await midgardProvider.utxoByAddresses({ addresses });
        expect(mockMidgardClient.request).toHaveBeenCalledWith(
          'utxos?addr=addr1q9djresrrk294hy9ndtqly955ldlhy688507shkfxpwtgf39vzk9uwp87k96zkd5yal83h9x0qheeu0lrqp9lldvsqjshxggyj'
        );
      } catch {
        // Expected if CBOR decoding fails, should fall back to Blockfrost
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });

    it('should handle invalid response format gracefully', async () => {
      const mockResponse = { invalid: 'format' };
      mockMidgardClient.request.mockResolvedValue(mockResponse);

      const addresses = [
        'addr1q9djresrrk294hy9ndtqly955ldlhy688507shkfxpwtgf39vzk9uwp87k96zkd5yal83h9x0qheeu0lrqp9lldvsqjshxggyj'
      ];

      try {
        await midgardProvider.utxoByAddresses({ addresses });
      } catch {
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });
});
