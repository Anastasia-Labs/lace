import {
  BlocksByIdsArgs,
  Cardano,
  ChainHistoryProvider,
  Paginated,
  TransactionsByAddressesArgs,
  TransactionsByIdsArgs
} from '@cardano-sdk/core';
import { Logger } from 'ts-log';
import { MidgardClient, MidgardError } from './client';
import { isMidgardLayer1BridgeTx } from './l1-activity';
import { decodeMidgardHistoryTx } from './native-history-decoder';
import { MidgardTxProvenance, withMidgardTxProvenance } from './provenance';

const MIDGARD_NOT_FOUND_STATUS = 404;
const LAYER1_HISTORY_PAGE_SIZE_FLOOR = 25;

type TransactionsOrder = TransactionsByAddressesArgs['pagination']['order'];

/**
 * MidgardChainHistoryProvider combines Midgard L2 history with the subset of
 * Cardano L1 history that represents Midgard bridge activity.
 */
export class MidgardChainHistoryProvider implements ChainHistoryProvider {
  private readonly client: MidgardClient;
  private readonly logger: Logger;
  private readonly layer1ChainHistoryProvider: ChainHistoryProvider;

  constructor(client: MidgardClient, layer1ChainHistoryProvider: ChainHistoryProvider, logger: Logger) {
    this.logger = logger;
    this.client = client;
    this.layer1ChainHistoryProvider = layer1ChainHistoryProvider;
  }

  private transformTxHexToHydratedTx(txHex: string, syntheticBlockNo = 1): Cardano.HydratedTx | undefined {
    let hydratedTx: Cardano.HydratedTx | undefined;

    try {
      hydratedTx = decodeMidgardHistoryTx(txHex, syntheticBlockNo);
    } catch (error) {
      this.logger.error('[MidgardChainHistoryProvider] Failed to transform tx hex to HydratedTx:', error);
    }

    return hydratedTx;
  }

  private filterMidgardTransactionsByBlockRange(
    transactions: Cardano.HydratedTx[],
    blockRange?: TransactionsByAddressesArgs['blockRange']
  ): Cardano.HydratedTx[] {
    if (!blockRange) return transactions;

    return transactions.filter(({ blockHeader }) => {
      const blockNo = Number(blockHeader.blockNo);
      const withinLowerBound = blockRange.lowerBound === undefined ? true : blockNo >= Number(blockRange.lowerBound);
      const withinUpperBound = blockRange.upperBound === undefined ? true : blockNo <= Number(blockRange.upperBound);

      return withinLowerBound && withinUpperBound;
    });
  }

  private async fetchMidgardTransactions(
    addresses: TransactionsByAddressesArgs['addresses'],
    blockRange?: TransactionsByAddressesArgs['blockRange']
  ): Promise<Cardano.HydratedTx[]> {
    const responses = await Promise.all(
      addresses.map(async (address) => ({
        address,
        response: await this.client.request<{ txs?: string[] }>(`txs?address=${encodeURIComponent(address)}`)
      }))
    );

    const uniqueTxHexes = new Map<string, string>();
    for (const { response } of responses) {
      for (const txHex of response?.txs ?? []) {
        if (!uniqueTxHexes.has(txHex)) {
          uniqueTxHexes.set(txHex, txHex);
        }
      }
    }

    const orderedTxHexes = [...uniqueTxHexes.values()];
    const totalTransactions = orderedTxHexes.length;
    const transactions = orderedTxHexes
      .map((txHex, index) => this.transformTxHexToHydratedTx(txHex, totalTransactions - index))
      .filter((tx): tx is Cardano.HydratedTx => tx !== undefined);

    return this.filterMidgardTransactionsByBlockRange(transactions, blockRange);
  }

  private async fetchMidgardTransaction(txId: Cardano.TransactionId): Promise<Cardano.HydratedTx | undefined> {
    let midgardTx: Cardano.HydratedTx | undefined;

    try {
      const response = await this.client.request<{ tx: string }>(`tx?tx_hash=${encodeURIComponent(txId)}`);
      midgardTx = typeof response?.tx === 'string' ? this.transformTxHexToHydratedTx(response.tx) : undefined;
    } catch (error) {
      if (error instanceof MidgardError && error.status === MIDGARD_NOT_FOUND_STATUS) {
        return midgardTx;
      }

      this.logger.warn(`[MidgardChainHistoryProvider] Failed to fetch Midgard tx ${txId}:`, error);
    }

    return midgardTx;
  }

  private async fetchLayer1BridgeTransactions(args: TransactionsByAddressesArgs): Promise<Cardano.HydratedTx[]> {
    const targetLimit = Math.max(args.pagination.limit, LAYER1_HISTORY_PAGE_SIZE_FLOOR);
    const pageSize = targetLimit;
    const collected: Cardano.HydratedTx[] = [];
    let startAt = 0;

    while (true) {
      const response = await this.layer1ChainHistoryProvider.transactionsByAddresses({
        ...args,
        pagination: {
          ...args.pagination,
          startAt,
          limit: pageSize
        }
      });

      const bridgeTransactions = response.pageResults
        .filter((tx) => isMidgardLayer1BridgeTx(tx))
        .map((tx) => withMidgardTxProvenance(tx, MidgardTxProvenance.Layer1Bridge));
      collected.push(...bridgeTransactions);

      const reachedEnd =
        response.pageResults.length < pageSize || startAt + response.pageResults.length >= response.totalResultCount;
      if (reachedEnd) {
        break;
      }

      startAt += pageSize;
    }

    return collected;
  }

  private sortTransactions(
    transactions: Cardano.HydratedTx[],
    order: TransactionsOrder = 'desc'
  ): Cardano.HydratedTx[] {
    return [...transactions].sort((lhs, rhs) => {
      const slotDelta = Number(lhs.blockHeader.slot) - Number(rhs.blockHeader.slot);
      const indexDelta = lhs.index - rhs.index;
      const direction = order === 'asc' ? 1 : -1;

      return (slotDelta || indexDelta) * direction;
    });
  }

  private applyPagination(
    transactions: Cardano.HydratedTx[],
    pagination: TransactionsByAddressesArgs['pagination']
  ): Paginated<Cardano.HydratedTx> {
    const startAt = Math.max(0, pagination.startAt);
    const pageResults = transactions.slice(startAt, startAt + pagination.limit);

    return {
      pageResults,
      totalResultCount: transactions.length
    };
  }

  async transactionsByAddresses(args: TransactionsByAddressesArgs): Promise<Paginated<Cardano.HydratedTx>> {
    const { addresses, blockRange } = args;
    if (!addresses || addresses.length === 0) {
      return { pageResults: [], totalResultCount: 0 };
    }

    try {
      const [midgardResponse, layer1BridgeTransactions] = await Promise.all([
        this.fetchMidgardTransactions(addresses, blockRange),
        this.fetchLayer1BridgeTransactions(args)
      ]);

      const midgardTransactions = midgardResponse;

      const deduplicated = new Map<string, Cardano.HydratedTx>();
      for (const tx of [...midgardTransactions, ...layer1BridgeTransactions]) {
        deduplicated.set(tx.id.toString(), tx);
      }

      const sortedTransactions = this.sortTransactions([...deduplicated.values()], args.pagination.order);

      this.logger.info(
        `[MidgardChainHistoryProvider] Found ${midgardTransactions.length} Midgard txs and ${layer1BridgeTransactions.length} bridge txs for ${addresses.length} addresses`
      );

      return this.applyPagination(sortedTransactions, args.pagination);
    } catch (error) {
      this.logger.error('[MidgardChainHistoryProvider] Error fetching transactionsByAddresses:', error);
      throw error;
    }
  }

  async transactionsByHashes({ ids }: TransactionsByIdsArgs): Promise<Cardano.HydratedTx[]> {
    const resolved = new Map<Cardano.TransactionId, Cardano.HydratedTx>();

    for (const id of ids) {
      const midgardTx = await this.fetchMidgardTransaction(id);
      if (midgardTx) {
        resolved.set(id, midgardTx);
      }
    }

    const unresolvedIds = ids.filter((id) => !resolved.has(id));
    if (unresolvedIds.length > 0) {
      const layer1Transactions = await this.layer1ChainHistoryProvider.transactionsByHashes({ ids: unresolvedIds });
      for (const tx of layer1Transactions) {
        resolved.set(
          tx.id,
          isMidgardLayer1BridgeTx(tx) ? withMidgardTxProvenance(tx, MidgardTxProvenance.Layer1Bridge) : tx
        );
      }
    }

    return ids.map((id) => resolved.get(id)).filter((tx): tx is Cardano.HydratedTx => !!tx);
  }

  async blocksByHashes(args: BlocksByIdsArgs): Promise<Cardano.ExtendedBlockInfo[]> {
    return this.layer1ChainHistoryProvider.blocksByHashes(args);
  }

  async healthCheck(): Promise<{ ok: boolean }> {
    try {
      const midgardHealth = await this.client.request<{ status?: string }>('healthz');
      return { ok: midgardHealth?.status === 'ok' };
    } catch (error) {
      this.logger.warn('[MidgardChainHistoryProvider] Health check failed:', error);
      return { ok: false };
    }
  }
}
