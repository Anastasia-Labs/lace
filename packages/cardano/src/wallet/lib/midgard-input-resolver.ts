/* eslint-disable unicorn/no-null, @typescript-eslint/no-non-null-assertion */
import { Cardano } from '@cardano-sdk/core';
import type { Cache } from '@cardano-sdk/util';
import { Logger } from 'ts-log';

/**
 * Converts a Cardano.TxIn object to a unique UTXO ID.
 *
 * @param txIn - The transaction input containing a transaction ID and index.
 * @returns A string representing the unique UTXO ID in the format `txId#index`.
 */
const txInToId = (txIn: Cardano.TxIn): string => `${txIn.txId}#${txIn.index}`;

/**
 * A resolver class to fetch and resolve transaction inputs using Midgard API.
 */
export class MidgardInputResolver implements Cardano.InputResolver {
  readonly #logger: Logger;
  readonly #txCache: Cache<Cardano.TxOut>;

  /**
   * Constructs a new MidgardInputResolver.
   *
   * @param cache - A caching interface.
   * @param logger - The logger instance to log messages to.
   */
  constructor({ cache, logger }: { cache: Cache<Cardano.TxOut>; logger: Logger }) {
    this.#txCache = cache;
    this.#logger = logger;
  }

  /**
   * Resolves a transaction input (`Cardano.TxIn`) to its corresponding output (`Cardano.TxOut`).
   *
   * @param input - The transaction input to resolve, including its transaction ID and index.
   * @param options - Optional resolution options (I.E hints for faster lookup).
   * @returns A promise that resolves to the corresponding `Cardano.TxOut` if found, or `null` if not.
   */
  public async resolveInput(input: Cardano.TxIn, options?: Cardano.ResolveOptions): Promise<Cardano.TxOut | null> {
    this.#logger.debug(`Resolving input ${input.txId}#${input.index}`);

    const cached = await this.#txCache.get(txInToId(input));
    if (cached) {
      this.#logger.debug(`Resolved input ${input.txId}#${input.index} from cache`);
      return cached;
    }

    const resolved = this.resolveFromHints(input, options);
    if (resolved) return resolved;

    const out = await this.fetchAndCacheTxOut(input);
    if (!out) return null;

    return out;
  }

  /**
   * Attempts to resolve the provided input from the hints provided in the resolution options.
   * @param input - The transaction input to resolve.
   * @param options - The resolution options containing hints.
   * @private
   */
  private resolveFromHints(input: Cardano.TxIn, options?: Cardano.ResolveOptions): Cardano.TxOut | null {
    if (options?.hints.transactions) {
      for (const hint of options.hints.transactions) {
        if (input.txId === hint.id && hint.body.outputs.length > input.index) {
          this.#logger.debug(`Resolved input ${input.txId}#${input.index} from hint`);
          void this.#txCache.set(txInToId(input), hint.body.outputs[input.index]);

          return hint.body.outputs[input.index];
        }
      }
    }

    if (options?.hints.utxos) {
      for (const utxo of options.hints.utxos) {
        if (input.txId === utxo[0].txId && input.index === utxo[0].index) {
          this.#logger.debug(`Resolved input ${input.txId}#${input.index} from hint`);
          void this.#txCache.set(txInToId(input), utxo[1]);

          return utxo[1];
        }
      }
    }

    return null;
  }

  /**
   * Fetches and caches the transaction output (`Cardano.TxOut`) for a given transaction input (`Cardano.TxIn`).
   *
   * @private
   * @param txIn - The transaction input to fetch and cache the output for.
   * @returns A promise that resolves to the corresponding `Cardano.TxOut` if found, or `null` if not.
   */
  private async fetchAndCacheTxOut(txIn: Cardano.TxIn): Promise<Cardano.TxOut | null> {
    try {
      // For now, we'll use a mock response since we don't have a real Midgard API
      // In a real implementation, this would call the Midgard API to get transaction details
      this.#logger.debug(`Fetching transaction ${txIn.txId} from Midgard`);
      
      // Since we don't have a real Midgard API endpoint for transaction details,
      // we'll return null for now. In a real implementation, this would be:
      // const response = await this.#client.request<any>(`txs/${txIn.txId}/utxos`);
      
      // For now, return null to indicate that the input couldn't be resolved
      // This prevents the destructuring error by ensuring we don't return undefined values
      this.#logger.warn(`Input ${txIn.txId}#${txIn.index} could not be resolved from Midgard - returning null`);
      return null;
    } catch (error: unknown) {
      this.#logger.error(`Failed to fetch transaction ${txIn.txId} from Midgard`, error);
      return null;
    }
  }
} 