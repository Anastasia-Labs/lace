import { Logger } from 'ts-log';
import { BlockfrostUtxoProvider, BlockfrostClient } from '@cardano-sdk/cardano-services-client';
import type { Cache } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { MidgardClient } from './client';

/**
 * MidgardUtxoProvider - Fetches UTxOs from Midgard L2 with automatic fallback to Blockfrost.
 * When a Midgard request fails for an address, that address falls back to Blockfrost L1.
 */
export class MidgardUtxoProvider extends BlockfrostUtxoProvider {
  private readonly midgardClient: MidgardClient;
  private readonly midgardLogger: Logger;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(midgardClient: MidgardClient, blockfrostClient: BlockfrostClient, logger: Logger, cache: Cache<any>) {
    super({ client: blockfrostClient, cache, logger });
    this.midgardClient = midgardClient;
    this.midgardLogger = logger;
  }

  /**
   * Transform a raw Midgard UTxO (CBOR-encoded outref + value) into the Cardano SDK tuple format.
   */
  private transformMidgardUtxo(midgardUtxo: { outref: string; value: string }): Cardano.Utxo | undefined {
    let result: Cardano.Utxo | undefined;
    try {
      const coreInput = Serialization.TransactionInput.fromCbor(midgardUtxo.outref as unknown as HexBlob).toCore();
      const coreOutput = Serialization.TransactionOutput.fromCbor(midgardUtxo.value as unknown as HexBlob).toCore();

      const txIn: Cardano.HydratedTxIn = {
        txId: coreInput.txId,
        index: coreInput.index,
        address: coreOutput.address
      };

      result = [txIn, coreOutput];
    } catch (error) {
      this.midgardLogger.error('[Midgard] Failed to transform UTxO:', midgardUtxo, error);
    }
    return result;
  }

  /**
   * Fetch UTxOs by address from Midgard, falling back to Blockfrost if Midgard is unavailable.
   */
  async utxoByAddresses({ addresses }: { addresses: Cardano.PaymentAddress[] }): Promise<Cardano.Utxo[]> {
    const allUtxos: Cardano.Utxo[] = [];

    for (const address of addresses) {
      try {
        const response = await this.midgardClient.request<{
          utxos: Array<{ outref: string; value: string }>;
        }>(`utxos?address=${address}`);

        const transformed = (response?.utxos ?? [])
          .map((utxo) => this.transformMidgardUtxo(utxo))
          .filter((utxo): utxo is Cardano.Utxo => utxo !== undefined);

        allUtxos.push(...transformed);
      } catch (error) {
        this.midgardLogger.warn(`[Midgard] Request failed for address ${address}, falling back to Blockfrost:`, error);

        try {
          const blockfrostUtxos = await super.utxoByAddresses({ addresses: [address] });
          allUtxos.push(...blockfrostUtxos);
        } catch (blockfrostError) {
          this.midgardLogger.error(
            `[Midgard] Blockfrost fallback also failed for address ${address}:`,
            blockfrostError
          );
          throw blockfrostError;
        }
      }
    }

    return allUtxos;
  }
}
