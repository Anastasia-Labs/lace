import { ChainHistoryProvider, Cardano, TransactionsByAddressesArgs, Paginated, Serialization } from '@cardano-sdk/core';
import { Logger } from 'ts-log';
import { MidgardClient } from './client';

/**
 * MidgardChainHistoryProvider - Transaction history provider backed by Midgard
 *
 * It queries Midgard for transactions by address and transforms CBOR payloads
 * into minimal Cardano.HydratedTx objects sufficient for downstream consumers.
 */
export class MidgardChainHistoryProvider implements ChainHistoryProvider {
  private readonly client: MidgardClient;
  private readonly logger: Logger;

  constructor(client: MidgardClient, logger: Logger) {
    this.logger = logger;
    this.client = client;
  }

  /**
   * Transform a CBOR buffer (serialized transaction) into a minimal HydratedTx.
   * We decode with SDK Serialization and fill required fields conservatively.
   */
  private transformTxCborToHydratedTx(txCborBytes: Uint8Array): Cardano.HydratedTx | undefined {
    try {
      const tx = Serialization.Transaction.fromCbor(Buffer.from(txCborBytes));
      const coreTx = tx.toCore();

      // Compute a pseudo block header as Midgard doesn't expose block data yet
      const blockHeader = {
        blockNo: Cardano.BlockNo(0),
        slot: Cardano.Slot(0),
        // 64-char random hex as placeholder; replaced when Midgard exposes real headers
        hash: Cardano.BlockId(Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''))
      } as { blockNo: Cardano.BlockNo; slot: Cardano.Slot; hash: Cardano.BlockId };

      const hydrated: Cardano.HydratedTx = {
        id: coreTx.id,
        body: coreTx.body,
        witness: coreTx.witness,
        txSize: tx.toCbor().length,
        blockHeader,
        index: 0,
        inputSource: Cardano.InputSource.inputs,
        auxiliaryData: coreTx.auxiliaryData
      } as unknown as Cardano.HydratedTx;

      return hydrated;
    } catch (error) {
      this.logger.error('[Midgard] Failed to transform tx CBOR to HydratedTx:', error);
      return undefined;
    }
  }

  /**
   * Fetch transactions by addresses from Midgard.
   * For now, we query the first address to mirror how Blockfrost fetching typically paginates.
   */
  async transactionsByAddresses(args: TransactionsByAddressesArgs): Promise<Paginated<Cardano.HydratedTx>> {
    const { addresses } = args;
    if (!addresses || addresses.length === 0) {
      return { pageResults: [], totalResultCount: 0 };
    }

    const address = addresses[0];
    this.logger.info(`[MidgardChainHistoryProvider] Fetching txs for address ${address}`);

    try {
      const response = await this.client.request<{
        cbors: Array<{ type: string; data: number[] }> | Array<number[] | number>;
      }>(`txs?address=${encodeURIComponent(address)}`);

      const cborsList: Uint8Array[] = Array.isArray((response as any).cbors)
        ? ((response as any).cbors as Array<any>).map((entry) => {
            // Support both Buffer-like {type,data} and raw number[] encodings
            if (entry && typeof entry === 'object' && 'data' in entry) return Uint8Array.from(entry.data as number[]);
            if (Array.isArray(entry)) return Uint8Array.from(entry as number[]);
            // Fallback to empty
            return new Uint8Array();
          })
        : [];

      const hydrated = cborsList
        .map((bytes) => this.transformTxCborToHydratedTx(bytes))
        .filter((tx): tx is Cardano.HydratedTx => !!tx);

      // Midgard currently does not paginate; we return all we got
      return {
        pageResults: hydrated,
        totalResultCount: hydrated.length
      };
    } catch (error) {
      this.logger.error('[MidgardChainHistoryProvider] Error fetching transactionsByAddresses:', error);
      return { pageResults: [], totalResultCount: 0 };
    }
  }

  async transactionsByHashes(): Promise<Cardano.HydratedTx[]> {
    this.logger.warn('[MidgardChainHistoryProvider] transactionsByHashes not implemented yet.');
    return [];
  }

  async blocksByHashes(): Promise<Cardano.ExtendedBlockInfo[]> {
    this.logger.warn('[MidgardChainHistoryProvider] blocksByHashes not implemented yet.');
    return [];
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    this.logger.debug('[MidgardChainHistoryProvider] Health check');
    return { ok: true };
  }
} 