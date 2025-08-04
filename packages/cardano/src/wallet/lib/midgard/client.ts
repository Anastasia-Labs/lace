import { Logger } from 'ts-log';
import { RateLimiter } from '@cardano-sdk/cardano-services-client';

export interface MidgardClientConfig {
  baseUrl: string;
  rateLimiter: RateLimiter;
}

export class MidgardError extends Error {
  // prettier-ignore
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'MidgardError';
  }
}

/**
 * MidgardClient - A client for making requests to Midgard API endpoints
 * This class implements a similar interface to BlockfrostClient for compatibility
 */
export class MidgardClient {
  readonly #config: MidgardClientConfig;
  readonly #logger: Logger;

  constructor(config: MidgardClientConfig, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  /**
   * Makes a request to the Midgard API
   * @param endpoint - The API endpoint (e.g., 'utxos/{address}')
   * @returns Promise with the response data
   */
  async request<T>(endpoint: string): Promise<T> {
    const url = `${this.#config.baseUrl}/${endpoint}`;

    this.#logger.debug(`Making Midgard request to: ${url}`);

    try {
      // Use the rate limiter to respect rate limits
      const response = await this.#config.rateLimiter.schedule(async () => {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!res.ok) {
          throw new MidgardError(res.status, `HTTP ${res.status}: ${res.statusText}`);
        }

        return res.json();
      });

      return response as T;
    } catch (error) {
      this.#logger.error(`Midgard request failed for endpoint ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Makes a POST request to the Midgard API
   * @param endpoint - The API endpoint
   * @param data - The data to send
   * @returns Promise with the response data
   */
  async post<T>(endpoint: string, data: Record<string, unknown>): Promise<T> {
    const url = `${this.#config.baseUrl}/${endpoint}`;

    this.#logger.debug(`Making Midgard POST request to: ${url}`);

    try {
      const response = await this.#config.rateLimiter.schedule(async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });

        if (!res.ok) {
          throw new MidgardError(res.status, `HTTP ${res.status}: ${res.statusText}`);
        }

        return res.json();
      });

      return response as T;
    } catch (error) {
      this.#logger.error(`Midgard POST request failed for endpoint ${endpoint}:`, error);
      throw error;
    }
  }
}
