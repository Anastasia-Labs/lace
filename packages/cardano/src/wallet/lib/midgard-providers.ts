import { Logger } from 'ts-log';
import { BlockfrostUtxoProvider, BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import { MidgardClient } from './midgard-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano } from '@cardano-sdk/core';

/**
 * MidgardUtxoProvider - Uses Midgard client with automatic fallback to Blockfrost
 * When Midgard requests fail, it automatically falls back to Blockfrost
 */
export class MidgardUtxoProvider extends BlockfrostUtxoProvider {
  readonly #midgardClient: MidgardClient;
  readonly #logger: Logger;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(midgardClient: MidgardClient, blockfrostClient: BlockfrostClient, logger: Logger, cache: Cache<any>) {
    // Pass the blockfrost client to the parent constructor for fallback
    super({
      client: blockfrostClient,
      cache,
      logger
    });
    this.#midgardClient = midgardClient;
    this.#logger = logger;
  }

  /**
   * Transform Blockfrost-style UTxO data to Cardano SDK format
   */
  /* eslint-disable consistent-return */
  private transformBlockfrostUtxo(blockfrostUtxo: Record<string, unknown>): Cardano.TxOut | undefined {
    this.#logger.debug('[Midgard] Transforming Blockfrost UTxO:', blockfrostUtxo);
    try {
      // Extract lovelace amount
      const amount = blockfrostUtxo.amount as Array<{ unit: string; quantity: string }>;
      const lovelaceAmount = amount.find((item) => item.unit === 'lovelace');
      const coins = lovelaceAmount ? BigInt(lovelaceAmount.quantity) : BigInt(0);

      // Extract other assets
      const assets = new Map<Cardano.AssetId, bigint>();
      for (const item of amount) {
        if (item.unit !== 'lovelace') {
          const assetId = Cardano.AssetId(item.unit);
          assets.set(assetId, BigInt(item.quantity));
        }
      }

      const txOut = {
        address: Cardano.PaymentAddress(blockfrostUtxo.address as string),
        value: {
          coins,
          assets
        }
      };
      this.#logger.debug('[Midgard] Transformed TxOut:', txOut);
      return txOut;
    } catch (error) {
      this.#logger.error('[Midgard] Failed to transform Blockfrost UTxO', blockfrostUtxo, error);
      return undefined;
    }
  }
  /* eslint-enable consistent-return */

  /**
   * Transform Midgard UTxO data to Cardano SDK format
   */
  /* eslint-disable consistent-return */
  private transformMidgardUtxo(
    midgardUtxo: [Record<string, unknown>, Record<string, unknown>]
  ): Cardano.Utxo | undefined {
    this.#logger.debug('[Midgard] Transforming Midgard UTxO:', midgardUtxo);
    try {
      const [txInData, txOutData] = midgardUtxo;

      // Extract transaction input data
      const txId = txInData.txId as string;
      const index = txInData.index as number;

      if (!txId || typeof index !== 'number') {
        this.#logger.error('[Midgard] Invalid txIn data:', txInData);
        return undefined;
      }

      // Extract transaction output data
      const address = txOutData.address as string;
      const value = txOutData.value as Record<string, unknown>;

      if (!address || !value) {
        this.#logger.error('[Midgard] Invalid txOut data:', txOutData);
        return undefined;
      }

      // Extract coins (lovelace)
      const coins = BigInt((value.coins as string) || '0');

      // Extract assets
      const assets = new Map<Cardano.AssetId, bigint>();
      const assetsData = (value.assets as Record<string, string>) || {};

      for (const [assetId, quantity] of Object.entries(assetsData)) {
        assets.set(Cardano.AssetId(assetId), BigInt(quantity));
      }

      const txIn: Cardano.HydratedTxIn = {
        txId: Cardano.TransactionId(txId),
        index,
        address: Cardano.PaymentAddress(address)
      };

      const txOut: Cardano.TxOut = {
        address: Cardano.PaymentAddress(address),
        value: {
          coins,
          assets
        }
      };

      this.#logger.debug('[Midgard] Transformed UTxO:', [txIn, txOut]);
      return [txIn, txOut];
    } catch (error) {
      this.#logger.error('[Midgard] Failed to transform Midgard UTxO', midgardUtxo, error);
      return undefined;
    }
  }
  /* eslint-enable consistent-return */

  /**
   * Override the UTxO fetching to use Midgard with automatic fallback to Blockfrost
   */
  async utxoByAddresses({ addresses }: { addresses: string[] }): Promise<Cardano.Utxo[]> {
    this.#logger.debug(`[Midgard] Fetching UTxOs from Midgard for ${addresses.length} addresses`, addresses);
    const allUtxos: Cardano.Utxo[] = [];

    for (const address of addresses) {
      try {
        // Try Midgard first
        const response = await this.#midgardClient.request<Array<[Record<string, unknown>, Record<string, unknown>]>>(
          `utxos/${address}`
        );
        this.#logger.debug(`[Midgard] Raw response for address ${address}:`, response);

        if (!Array.isArray(response)) {
          this.#logger.error('[Midgard] Invalid response from Midgard:', response);
          throw new Error('Invalid response format from Midgard');
        }

        const transformedUtxos = response
          .map((midgardUtxo) => {
            // eslint-disable-next-line no-magic-numbers
            if (!Array.isArray(midgardUtxo) || midgardUtxo.length !== 2) {
              this.#logger.error('[Midgard] Invalid UTxO format (expected tuple of [txIn, txOut]):', midgardUtxo);
              return;
            }

            const utxo = this.transformMidgardUtxo(midgardUtxo as [Record<string, unknown>, Record<string, unknown>]);
            if (!utxo) {
              this.#logger.error('[Midgard] Skipping invalid UTxO (transformation failed)', midgardUtxo);
              return;
            }

            // eslint-disable-next-line consistent-return
            return utxo;
          })
          .filter((x): x is Cardano.Utxo => Boolean(x));

        this.#logger.debug(`[Midgard] Transformed UTxOs for address ${address}:`, transformedUtxos);
        allUtxos.push(...transformedUtxos);
      } catch (error) {
        this.#logger.error(`[Midgard] Failed to fetch UTxOs from Midgard for address ${address}:`, error);
        this.#logger.info(`[Midgard] Falling back to Blockfrost for address ${address}`);

        try {
          // Fallback to Blockfrost
          const blockfrostUtxos = await super.utxoByAddresses({ addresses: [address] });
          this.#logger.debug(
            `[Midgard] Blockfrost fallback returned ${blockfrostUtxos.length} UTxOs for address ${address}`
          );
          allUtxos.push(...blockfrostUtxos);
        } catch (blockfrostError) {
          this.#logger.error(`[Midgard] Blockfrost fallback also failed for address ${address}:`, blockfrostError);
          // Re-throw the original Midgard error to maintain the expected behavior
          throw error;
        }
      }
    }

    this.#logger.debug(`[Midgard] Successfully fetched ${allUtxos.length} UTxOs (Midgard + Blockfrost fallback)`);
    return allUtxos;
  }

  /**
   * Override other UTxO-related methods as needed
   * For now, we'll delegate to the parent implementation for other methods
   */
}
