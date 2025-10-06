import { Logger } from 'ts-log';
import { BlockfrostUtxoProvider, BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { MidgardClient } from './client';

/**
 * MidgardUtxoProvider - Uses Midgard client only (no Blockfrost fallback)
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
    outref: string;
    value: string;
  }): Cardano.Utxo | undefined {
    try {
      const outrefBuffer = Buffer.from(midgardUtxo.outref, 'hex')
      const valueBuffer = Buffer.from(midgardUtxo.value, 'hex')

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
      const response = await this.midgardClient.request<{
        utxos: Array<{ outref: string; value: string }>;
      }>(`utxos?address=${address}`);

      const transformedUtxos = (response?.utxos ?? [])
        .map((utxo) => this.transformMidgardUtxo(utxo))
        .filter((utxo): utxo is Cardano.Utxo => utxo !== undefined);

      return transformedUtxos;
    })
  );

  return allUtxosArrays.flat();
}};