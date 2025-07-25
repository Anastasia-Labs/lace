import { Logger } from 'ts-log';
import { 
  BlockfrostUtxoProvider
} from '@cardano-sdk/cardano-services-client';
import { MidgardClient } from './midgard-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano } from '@cardano-sdk/core';

/**
 * MidgardUtxoProvider - Uses Midgard client ONLY for UTxO-related requests
 * All other functionality remains the same as Blockfrost
 */
export class MidgardUtxoProvider extends BlockfrostUtxoProvider {
  readonly #midgardClient: MidgardClient;
  readonly #logger: Logger;

  constructor(midgardClient: MidgardClient, logger: Logger, cache: Cache<any>) {
    // Pass a dummy client to the parent constructor since we'll override the methods
    super({
      client: {} as any,
      cache,
      logger
    });
    this.#midgardClient = midgardClient;
    this.#logger = logger;
  }

  /**
   * Transform Blockfrost-style UTxO data to Cardano SDK format
   */
  private transformBlockfrostUtxo(blockfrostUtxo: any): Cardano.TxOut | undefined {
    this.#logger.debug('[Midgard] Transforming Blockfrost UTxO:', blockfrostUtxo);
    try {
      // Extract lovelace amount
      const lovelaceAmount = blockfrostUtxo.amount.find((item: any) => item.unit === 'lovelace');
      const coins = lovelaceAmount ? BigInt(lovelaceAmount.quantity) : BigInt(0);

      // Extract other assets
      const assets = new Map<Cardano.AssetId, bigint>();
      for (const item of blockfrostUtxo.amount) {
        if (item.unit !== 'lovelace') {
          const assetId = Cardano.AssetId(item.unit);
          assets.set(assetId, BigInt(item.quantity));
        }
      }

      const txOut = {
        address: Cardano.PaymentAddress(blockfrostUtxo.address),
        value: {
          coins,
          assets
        }
      };
      this.#logger.debug('[Midgard] Transformed TxOut:', txOut);
      return txOut;
    } catch (e) {
      this.#logger.error('[Midgard] Failed to transform Blockfrost UTxO', blockfrostUtxo, e);
      return undefined;
    }
  }

  /**
   * Override the UTxO fetching to use Midgard instead of Blockfrost
   */
  async utxoByAddresses({ addresses }: { addresses: string[] }): Promise<Cardano.Utxo[]> {
    this.#logger.debug(`[Midgard] Fetching UTxOs from Midgard for ${addresses.length} addresses`, addresses);
    const allUtxos: Cardano.Utxo[] = [];
    for (const address of addresses) {
      try {
        const response = await this.#midgardClient.request<any[]>(`utxos/${address}`);
        this.#logger.debug(`[Midgard] Raw response for address ${address}:`, response);
        if (!Array.isArray(response)) {
          this.#logger.error('[Midgard] Invalid response from Midgard:', response);
          throw new Error('Invalid response format from Midgard');
        }
        const transformedUtxos = response
          .map((blockfrostUtxo) => {
            const txIn: Cardano.TxIn = {
              txId: Cardano.TransactionId(blockfrostUtxo.tx_hash),
              index: blockfrostUtxo.output_index
            };
            const txOut = this.transformBlockfrostUtxo(blockfrostUtxo);
            if (!txOut) {
              this.#logger.error('[Midgard] Skipping invalid UTxO (txOut undefined)', blockfrostUtxo);
              return undefined;
            }
            if (!txOut.value) {
              this.#logger.error('[Midgard] Skipping UTxO with undefined value', blockfrostUtxo, txOut);
              return undefined;
            }
            return [txIn, txOut] as Cardano.Utxo;
          })
          .filter((x): x is Cardano.Utxo => Boolean(x));
        this.#logger.debug(`[Midgard] Transformed UTxOs for address ${address}:`, transformedUtxos);
        allUtxos.push(...transformedUtxos);
      } catch (error) {
        this.#logger.error(`[Midgard] Failed to fetch UTxOs from Midgard for address ${address}:`, error);
        throw error;
      }
    }
    this.#logger.debug(`[Midgard] Successfully fetched ${allUtxos.length} UTxOs from Midgard`);
    return allUtxos;
  }

  /**
   * Override other UTxO-related methods as needed
   * For now, we'll delegate to the parent implementation for other methods
   */
} 