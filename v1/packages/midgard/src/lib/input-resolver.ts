/* eslint-disable unicorn/no-null */
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
 * This class implements the Cardano.InputResolver interface and provides
 * functionality to resolve transaction inputs to their corresponding outputs.
 */
export class MidgardInputResolver implements Cardano.InputResolver {
  readonly #logger: Logger;
  readonly #txCache: Cache<Cardano.TxOut>;

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
    if (options?.hints?.transactions) {
      const tx = options.hints.transactions.find((t) => t.id === input.txId);
      if (tx) {
        const output = tx.body.outputs[input.index];
        if (output) {
          this.#logger.debug(`Resolved input ${input.txId}#${input.index} from hint transactions`);
          void this.#txCache.set(txInToId(input), output);
          return output;
        }
      }
    }

    if (options?.hints?.utxos) {
      for (const utxo of options.hints.utxos) {
        if (input.txId === utxo[0].txId && input.index === utxo[0].index) {
          this.#logger.debug(`Resolved input ${input.txId}#${input.index} from hint utxos`);
          void this.#txCache.set(txInToId(input), utxo[1]);
          return utxo[1];
        }
      }
    }

    return null;
  }

  /**
   * Fetches the transaction output from the Midgard API and caches it.
   * @param input - The transaction input to resolve.
   * @private
   * TODO: Implement actual Midgard API call to fetch transaction output by txId
   */
  private async fetchAndCacheTxOut(input: Cardano.TxIn): Promise<Cardano.TxOut | null> {
    this.#logger.debug(`No remote fetch implemented for ${input.txId}#${input.index}`);
    return null;
  }
}
