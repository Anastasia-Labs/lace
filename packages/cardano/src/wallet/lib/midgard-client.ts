import { Logger } from 'ts-log';
import { RateLimiter } from '@cardano-sdk/cardano-services-client';

export interface MidgardClientConfig {
  baseUrl: string;
  rateLimiter: RateLimiter;
}

export class MidgardError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'MidgardError';
  }
}

/**
 * Mock UTxO response for testing purposes
 * This mimics the Blockfrost address UTxOs endpoint response format
 */
const createMockUtxoResponse = (address: string) => [
  {
    tx_hash: "bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0",
    tx_index: 1,
    output_index: 1,
    amount: [
      {
        unit: "lovelace",
        quantity: "4027026465"
      },
      {
        unit: "25561d09e55d60b64525b9cdb3cfbec23c94c0634320fec2eaddde584c616365436f696e33",
        quantity: "10000"
      }
    ],
    block: "d4e03128b4284d0c855ccf6bd2f414a6c8a5e7d39d9b8a8e8e8e8e8e8e8e8e8e8",
    address: address,
    data_hash: null,
    inline_datum: null,
    reference_script_hash: null,
    collateral: false,
    reference: false
  },
  {
    tx_hash: "c7c0973c6bbf1a04a9f306da7814b4fa564db649bf48b0bd93c273bd03143547",
    tx_index: 0,
    output_index: 0,
    amount: [
      {
        unit: "lovelace",
        quantity: "3289566"
      },
      {
        unit: "5c677ba4dd295d9286e0e22786fea9ed735a6ae9c07e7a45ae4d95c84372696d696e616c50756e6b73204c6f6f74",
        quantity: "1"
      }
    ],
    block: "d4e03128b4284d0c855ccf6bd2f414a6c8a5e7d39d9b8a8e8e8e8e8e8e8e8e8e8",
    address: address,
    data_hash: null,
    inline_datum: null,
    reference_script_hash: null,
    collateral: false,
    reference: false
  },
  {
    tx_hash: "ea1517b8c36fea3148df9aa1f49bbee66ff59a5092331a67bd8b3c427e1d79d7",
    tx_index: 2,
    output_index: 2,
    amount: [
      {
        unit: "lovelace",
        quantity: "9825963"
      }
    ],
    block: "d4e03128b4284d0c855ccf6bd2f414a6c8a5e7d39d9b8a8e8e8e8e8e8e8e8e8e8",
    address: address,
    data_hash: null,
    inline_datum: null,
    reference_script_hash: null,
    collateral: false,
    reference: false
  }
];

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
        // For now, return mock data for UTxO requests
        if (endpoint.startsWith('utxos/')) {
          const address = endpoint.replace('utxos/', '');
          this.#logger.debug(`Returning mock UTxO data for address: ${address}`);
          return createMockUtxoResponse(address);
        }

        // For other endpoints, make actual HTTP requests
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
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
  async post<T>(endpoint: string, data: any): Promise<T> {
    const url = `${this.#config.baseUrl}/${endpoint}`;
    
    this.#logger.debug(`Making Midgard POST request to: ${url}`);

    try {
      const response = await this.#config.rateLimiter.schedule(async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
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