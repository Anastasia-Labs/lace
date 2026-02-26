import { Logger } from 'ts-log';
import { TxSubmitProvider } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
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
   * Submit a signed transaction to the Midgard network.
   * The SDK passes a HexBlob (hex string) as signedTransaction despite the Uint8Array type in the interface.
   * The Midgard backend expects the CBOR as a query parameter: POST /submit?tx_cbor=<hex>
   */
  async submitTx({ signedTransaction }: { signedTransaction: Uint8Array }): Promise<void> {
    const cborHex = signedTransaction as unknown as HexBlob;
    await this.#midgardClient.post(`submit?tx_cbor=${cborHex}`);
    this.#logger.info('[Midgard] Transaction submitted successfully');
  }

  /**
   * Health check for the Midgard transaction submission service
   */
  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const { status } = await this.#midgardClient.request<{ status: string }>('health');

      if (status === 'healthy') {
        this.#logger.debug('[Midgard] Health check passed');
        return { ok: true };
      }

      this.#logger.warn('[Midgard] Health check returned non-healthy status:', status);
      return { ok: false };
    } catch (error) {
      this.#logger.error('[Midgard] Health check failed:', error);
      return { ok: false };
    }
  }
}
