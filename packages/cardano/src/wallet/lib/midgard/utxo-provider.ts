import { Logger } from 'ts-log';
import { BlockfrostUtxoProvider, BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { MidgardClient } from './client';

type MidgardUtxoResponse = { outref: string; value: string };

class MidgardUtxoDecodeError extends Error {
  constructor(address: string, utxo: MidgardUtxoResponse, cause: unknown) {
    super(`Midgard returned a malformed UTxO for ${address} (outref=${utxo.outref})`);
    this.name = 'MidgardUtxoDecodeError';
    this.cause = cause;
  }
}

/**
 * MidgardUtxoProvider - fetches UTxOs from Midgard only.
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
  private transformMidgardUtxo(address: string, midgardUtxo: MidgardUtxoResponse): Cardano.Utxo {
    try {
      const outrefBuffer = Buffer.from(midgardUtxo.outref, 'hex');
      const valueBuffer = Buffer.from(midgardUtxo.value, 'hex');

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

      return [txIn, txOut] as Cardano.Utxo;
    } catch (error) {
      const decodeError = new MidgardUtxoDecodeError(address, midgardUtxo, error);
      this.logger.error('[Midgard] Failed to decode UTxO from Midgard', decodeError);
      throw decodeError;
    }
  }

  /**
   * Fetch UTxOs from Midgard only. Midgard mode should never silently show L1 data.
   */
  async utxoByAddresses({ addresses }: { addresses: string[] }): Promise<Cardano.Utxo[]> {
    try {
      const allUtxosArrays = await Promise.all(
        addresses.map(async (address) => {
          const response = await this.midgardClient.request<{
            utxos: MidgardUtxoResponse[];
          }>(`utxos?address=${encodeURIComponent(address)}`);

          return (response?.utxos ?? []).map((utxo) => this.transformMidgardUtxo(address, utxo));
        })
      );

      return allUtxosArrays.flat();
    } catch (error) {
      this.logger.error('[Midgard] Failed to fetch UTxOs from Midgard', error);
      throw error;
    }
  }
}
