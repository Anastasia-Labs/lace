/* eslint-disable unicorn/no-null */
import { Cardano, Serialization } from '@cardano-sdk/core';
import type { Cache } from '@cardano-sdk/util';
import { Logger } from 'ts-log';
import { MidgardClient, MidgardError } from './client';

const MIDGARD_NOT_FOUND_STATUS = 404;

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
  readonly #midgardClient: MidgardClient;

  constructor({
    cache,
    logger,
    midgardClient
  }: {
    cache: Cache<Cardano.TxOut>;
    logger: Logger;
    midgardClient: MidgardClient;
  }) {
    this.#txCache = cache;
    this.#logger = logger;
    this.#midgardClient = midgardClient;
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
        if (output) return output;
      }
    }

    if (!options?.hints?.utxos) return null;

    const utxo = options.hints.utxos.find(([txIn]) => txIn.txId === input.txId && txIn.index === input.index);
    return utxo ? utxo[1] : null;
  }

  /**
   * Fetches the transaction output from the Midgard API and caches it.
   * @param input - The transaction input to resolve.
   * @private
   */
  private async fetchAndCacheTxOut(input: Cardano.TxIn): Promise<Cardano.TxOut | null> {
    try {
      this.#logger.debug(`Fetching UTxO ${input.txId}#${input.index} from Midgard`);
      const response = await this.#midgardClient.post<{
        utxos?: Array<{ outref: string; value: string }>;
      }>('utxos?by-outrefs', [`${input.txId}#${input.index}`]);
      const encodedTxOut = response?.utxos?.[0]?.value;
      if (typeof encodedTxOut !== 'string') return null;

      const txOut = Serialization.TransactionOutput.fromCbor(Buffer.from(encodedTxOut, 'hex')).toCore();
      if (!txOut) {
        this.#logger.warn(`Midgard UTxO ${input.txId}#${input.index} could not be decoded`);
        return null;
      }

      await this.#txCache.set(txInToId(input), txOut);
      return txOut;
    } catch (error) {
      if (error instanceof MidgardError && error.status === MIDGARD_NOT_FOUND_STATUS) {
        this.#logger.warn(`Midgard UTxO ${input.txId}#${input.index} was not found during input resolution`);
        return null;
      }

      this.#logger.error(`Failed to fetch UTxO ${input.txId}#${input.index} from Midgard:`, error);
      return null;
    }
  }
}
