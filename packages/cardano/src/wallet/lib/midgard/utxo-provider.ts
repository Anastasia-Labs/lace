import { Logger } from 'ts-log';
import { BlockfrostUtxoProvider, BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
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
  private transformMidgardUtxo(midgardUtxo: {
    outref: { type: string; data: number[] };
    value: { type: string; data: number[] };
  }): Cardano.Utxo | undefined {
    try {
      const outrefBuffer = Buffer.from(midgardUtxo.outref.data);
      const valueBuffer = Buffer.from(midgardUtxo.value.data);

      const txInput = Serialization.TransactionInput.fromCbor(outrefBuffer);
      const txOutput = Serialization.TransactionOutput.fromCbor(valueBuffer);

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
   * Fetch UTxOs from Midgard
   */
async utxoByAddresses({ addresses }: { addresses: string[] }): Promise<Cardano.Utxo[]> {
  const allUtxosArrays = await Promise.all(
    addresses.map(async (address) => {
      try {
        const response = await this.midgardClient.request<{
          utxos: Array<{ outref: { type: string; data: number[] }; value: { type: string; data: number[] } }>;
        }>(`utxos?address=${address}`);

        if (!response?.utxos?.length) {
          throw new Error('Invalid response format from Midgard');
        }

        const transformedUtxos = response.utxos
          .map((utxo) => this.transformMidgardUtxo(utxo))
          .filter((utxo): utxo is Cardano.Utxo => utxo !== undefined);

        return transformedUtxos;
      } catch (error) {
        this.logger.error(`[Midgard] Failed for address ${address}:`, error);
        this.logger.info(`[Midgard] Falling back to Blockfrost for address ${address}`);

        try {
          const blockfrostUtxos = await super.utxoByAddresses({ addresses: [address] });
          return blockfrostUtxos;
        } catch (blockfrostError) {
          this.logger.error(`[Midgard] Blockfrost fallback also failed for address ${address}:`, blockfrostError);
          throw blockfrostError;
        }
      }
    })
  );

  return allUtxosArrays.flat();
}};