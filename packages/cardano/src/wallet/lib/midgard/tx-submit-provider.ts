import { Logger } from 'ts-log';
import { Serialization, TxSubmitProvider } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { MidgardClient } from './client';

const HEX_PATTERN = /^[\da-f]+$/i;

type CborCarrier = { cbor: string };
type CborSerializable = { toCbor: () => string };

const hasCborString = (value: unknown): value is CborCarrier =>
  !!value && typeof value === 'object' && 'cbor' in value && typeof (value as CborCarrier).cbor === 'string';

const hasToCbor = (value: unknown): value is CborSerializable =>
  !!value && typeof value === 'object' && 'toCbor' in value && typeof (value as CborSerializable).toCbor === 'function';

const toHex = (signedTransaction: unknown): string => {
  if (typeof signedTransaction === 'string') {
    const normalized = signedTransaction.trim();
    if (!HEX_PATTERN.test(normalized) || normalized.length % 2 !== 0) {
      throw new TypeError('Signed transaction string must be hex-encoded CBOR');
    }

    return normalized.toLowerCase();
  }

  if (signedTransaction instanceof Uint8Array) {
    return Buffer.from(signedTransaction).toString('hex');
  }

  if (hasCborString(signedTransaction)) {
    return toHex(signedTransaction.cbor);
  }

  if (hasToCbor(signedTransaction)) {
    return toHex(signedTransaction.toCbor());
  }

  throw new TypeError('Unsupported signed transaction payload for Midgard submission');
};

const getTxIdFromCborHex = (cborHex: string): string =>
  Serialization.Transaction.fromCbor(HexBlob(cborHex)).toCore().id.toString();

/**
 * MidgardTxSubmitProvider - Uses Midgard client for transaction submission
 * Sends tx CBOR as a hex string in the request body.
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
   */
  async submitTx({ signedTransaction }: { signedTransaction: Uint8Array | unknown }): Promise<void> {
    const cborHex = toHex(signedTransaction);
    const expectedTxId = getTxIdFromCborHex(cborHex);
    const response = await this.#midgardClient.post<{ txId?: string; status?: string }>('submit', {
      // eslint-disable-next-line camelcase
      tx_cbor: cborHex
    });

    if (response?.status !== 'queued') {
      throw new Error(`Unexpected Midgard submit status: ${String(response?.status)}`);
    }

    if (typeof response?.txId !== 'string' || response.txId.length === 0) {
      throw new Error('Midgard submit endpoint returned an invalid transaction id');
    }

    if (response.txId !== expectedTxId) {
      throw new Error(`Midgard submit tx id mismatch: expected ${expectedTxId}, got ${response.txId}`);
    }

    this.#logger.info(`[Midgard] Transaction submitted successfully to Midgard backend (txId=${response.txId})`);

    return response.txId as unknown as void;
  }

  /**
   * Health check for the Midgard transaction submission service
   */
  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const midgardHealth = await this.#midgardClient.request<{ status: string }>('healthz');

      if (midgardHealth?.status === 'ok') {
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
