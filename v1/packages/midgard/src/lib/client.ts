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
 */
export class MidgardClient {
  readonly #baseUrl: string;
  readonly #rateLimiter: RateLimiter;
  readonly #logger: Logger;

  constructor({ baseUrl, rateLimiter }: MidgardClientConfig, logger: Logger) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#rateLimiter = rateLimiter;
    this.#logger = logger;
  }

  /**
   * Makes a GET request to the Midgard API
   * @param endpoint - The API endpoint (e.g., 'utxos/{address}')
   * @returns Promise with the response data
   */
  async request<T>(endpoint: string): Promise<T> {
    return this.#doRequest<T>(endpoint, 'GET');
  }

  /**
   * Makes a POST request to the Midgard API
   * @param endpoint - The API endpoint
   * @param body - Optional JSON body
   * @returns Promise with the response data
   */
  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.#doRequest<T>(endpoint, 'POST', body);
  }

  async #doRequest<T>(endpoint: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const url = `${this.#baseUrl}/${endpoint}`;
    this.#logger.debug(`Midgard ${method} ${url}`);

    try {
      return await this.#rateLimiter.schedule(async () => {
        const res = await fetch(url, {
          method,
          ...(body !== undefined && {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
        });

        if (!res.ok) {
          throw new MidgardError(res.status, `HTTP ${res.status}: ${res.statusText}`);
        }

        return res.json() as Promise<T>;
      });
    } catch (error) {
      this.#logger.error(`Midgard ${method} failed for ${endpoint}:`, error);
      throw error;
    }
  }
}
