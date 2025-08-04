/* eslint-disable no-magic-numbers */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MidgardClient, MidgardError } from '../midgard/client';
import { RateLimiter } from '@cardano-sdk/cardano-services-client';

// Mock fetch
global.fetch = jest.fn();

describe('MidgardClient', () => {
  let midgardClient: MidgardClient;
  let mockRateLimiter: jest.Mocked<RateLimiter>;
  let mockLogger: jest.Mocked<any>;

  beforeEach(() => {
    mockRateLimiter = {
      schedule: jest.fn()
    } as any;

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn()
    };

    midgardClient = new MidgardClient(
      {
        baseUrl: 'http://localhost:3000',
        rateLimiter: mockRateLimiter
      },
      mockLogger
    );

    // Reset fetch mock
    (fetch as jest.Mock).mockClear();
  });

  describe('request', () => {
    it('should make a successful GET request', async () => {
      const mockResponse = { data: 'test' };
      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse)
      };

      (fetch as jest.Mock).mockResolvedValue(mockFetchResponse);
      mockRateLimiter.schedule.mockImplementation(async (fn) => fn());

      const result = await midgardClient.request('test-endpoint');

      expect(mockRateLimiter.schedule).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith('http://localhost:3000/test-endpoint', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw MidgardError on HTTP error', async () => {
      const mockFetchResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };

      (fetch as jest.Mock).mockResolvedValue(mockFetchResponse);
      mockRateLimiter.schedule.mockImplementation(async (fn) => fn());

      await expect(midgardClient.request('test-endpoint')).rejects.toThrow(MidgardError);
      await expect(midgardClient.request('test-endpoint')).rejects.toThrow('HTTP 404: Not Found');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      (fetch as jest.Mock).mockRejectedValue(networkError);
      mockRateLimiter.schedule.mockImplementation(async (fn) => fn());

      await expect(midgardClient.request('test-endpoint')).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith('Midgard request failed for endpoint test-endpoint:', networkError);
    });
  });

  describe('post', () => {
    it('should make a successful POST request', async () => {
      const mockResponse = { success: true };
      const mockFetchResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse)
      };

      (fetch as jest.Mock).mockResolvedValue(mockFetchResponse);
      mockRateLimiter.schedule.mockImplementation(async (fn) => fn());

      const postData = { key: 'value' };
      const result = await midgardClient.post('test-endpoint', postData);

      expect(mockRateLimiter.schedule).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith('http://localhost:3000/test-endpoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postData)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw MidgardError on HTTP error for POST', async () => {
      const mockFetchResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      };

      (fetch as jest.Mock).mockResolvedValue(mockFetchResponse);
      mockRateLimiter.schedule.mockImplementation(async (fn) => fn());

      await expect(midgardClient.post('test-endpoint', {})).rejects.toThrow(MidgardError);
      await expect(midgardClient.post('test-endpoint', {})).rejects.toThrow('HTTP 500: Internal Server Error');
    });
  });

  describe('MidgardError', () => {
    it('should create error with status and message', () => {
      const error = new MidgardError(404, 'Not Found');

      expect(error.name).toBe('MidgardError');
      expect(error.status).toBe(404);
      expect(error.message).toBe('Not Found');
    });
  });
});
