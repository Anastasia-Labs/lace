import { Logger } from 'ts-log';
import { TxSubmitProvider } from '@cardano-sdk/core';
import { MidgardClient } from './client';

/**
 * MidgardTxSubmitProvider - Uses Midgard client for transaction submission
 * Sends CBOR directly as hex string via query parameter (backend expects this format)
 */
export class MidgardTxSubmitProvider implements TxSubmitProvider {
  readonly #midgardClient: MidgardClient;
  readonly #logger: Logger;

  constructor(midgardClient: MidgardClient, logger: Logger) {
    this.#midgardClient = midgardClient;
    this.#logger = logger;
  }

  /**
   * Submit a signed transaction to the Midgard network
   * Sends CBOR directly as hex string via query parameter (backend expects this format)
   */
  async submitTx({ signedTransaction }: { signedTransaction: Uint8Array }): Promise<void> {
    // Note: Despite the Uint8Array type, this actually comes in as a hex string
    const cborHex = String(signedTransaction);

    // Backend expects: POST /submit?tx_cbor=<hex_string>
    // No request body needed, just the query parameter
    await this.#midgardClient.post(`submit?tx_cbor=${cborHex}`, {});

    this.#logger.info('[Midgard] Transaction submitted successfully to Midgard backend');
  }

  /**
   * Health check for the Midgard transaction submission service
   */
  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      // Try Midgard health check
      const midgardHealth = await this.#midgardClient.request<{ status: string }>('health');

      if (midgardHealth?.status === 'healthy') {
        this.#logger.debug('[Midgard] Health check passed');
        return { ok: true };
      }

      throw new Error('Midgard health check failed');
    } catch (error) {
      this.#logger.error('[Midgard] Health check failed:', error);
      return { ok: false };
    }
  }
}
