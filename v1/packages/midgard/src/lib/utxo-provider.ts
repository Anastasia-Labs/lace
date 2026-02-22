import { Logger } from 'ts-log';
import { BlockfrostUtxoProvider, BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { MidgardClient } from './client';

/**
 * MidgardUtxoProvider - Uses Midgard client with automatic fallback to Blockfrost
 * When Midgard requests fail, it automatically falls back to Blockfrost
 */
export class MidgardUtxoProvider extends BlockfrostUtxoProvider {
  private readonly midgardClient: MidgardClient;
  protected readonly logger: Logger;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(midgardClient: MidgardClient, blockfrostClient: BlockfrostClient, logger: Logger, cache: Cache<any>) {
    super({
      client: blockfrostClient,
      cache,
      logger
    });
    this.midgardClient = midgardClient;
    this.logger = logger;
  }

  /**
   * Transform Midgard UTxO data to Cardano SDK format using CBOR decoding
   */
  private transformMidgardUtxo(midgardUtxo: { outref: string; value: string }): Cardano.Utxo | undefined {
    try {
      const txInput = Serialization.TransactionInput.fromCbor(midgardUtxo.outref as unknown as HexBlob);
      const txOutput = Serialization.TransactionOutput.fromCbor(midgardUtxo.value as unknown as HexBlob);

      const txIn: Cardano.HydratedTxIn = {
        txId: txInput.toCore().txId,
        index: txInput.toCore().index,
        address: txOutput.toCore().address
      };

      const txOut: Cardano.TxOut = {
        address: txOutput.toCore().address,
        value: txOutput.toCore().value
      };

      return [txIn, txOut] as Cardano.Utxo | undefined;
    } catch (error) {
      this.logger.error('[Midgard] Failed to transform UTxO:', midgardUtxo, error);
      return undefined as Cardano.Utxo | undefined;
    }
  }

  /**
   * Fetch UTxOs from Midgard with automatic fallback to Blockfrost
   */
  async utxoByAddresses({ addresses }: { addresses: string[] }): Promise<Cardano.Utxo[]> {
    const allUtxos: Cardano.Utxo[] = [];

    for (const address of addresses) {
      try {
        const response = await this.midgardClient.request<{
          utxos: Array<{ outref: string; value: string }>;
        }>(`utxos?address=${address}`);

        const transformedUtxos = (response?.utxos ?? [])
          .map((utxo) => this.transformMidgardUtxo(utxo))
          .filter((utxo): utxo is Cardano.Utxo => utxo !== undefined);

        allUtxos.push(...transformedUtxos);
      } catch (error) {
        this.logger.warn(`[Midgard] Request failed for address ${address}, falling back to Blockfrost:`, error);

        try {
          const blockfrostUtxos = await super.utxoByAddresses({ addresses: [address] });
          allUtxos.push(...blockfrostUtxos);
        } catch (blockfrostError) {
          this.logger.error(`[Midgard] Blockfrost fallback also failed for address ${address}:`, blockfrostError);
          throw blockfrostError;
        }
      }
    }

    return allUtxos;
  }
}
