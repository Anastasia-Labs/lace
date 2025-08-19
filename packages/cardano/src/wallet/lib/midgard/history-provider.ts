import { ChainHistoryProvider, Cardano, TransactionsByAddressesArgs, Paginated } from '@cardano-sdk/core';
import { Logger } from 'ts-log';
import { MidgardUtxoProvider } from './utxo-provider';

/**
 * Global variable to store current UTXOs for change detection
 */
let globalUtxoSet: Map<string, string> = new Map(); // address -> utxo hash
let pollingInterval: NodeJS.Timeout | null = null;
let lastCheckTime: number = 0;
const POLLING_INTERVAL_MS = 1000; // Check every 1 second

/**
 * MidgardChainHistoryProvider - Dummy transaction history provider for UI refresh
 * 
 * This provider monitors UTxO changes and generates dummy transactions to trigger
 * wallet UI refresh when balance changes are detected in Midgard Mode.
 */
export class MidgardChainHistoryProvider implements ChainHistoryProvider {
  private readonly utxoProvider: MidgardUtxoProvider;
  private readonly logger: Logger;
  private readonly addresses: Set<string> = new Set();

  constructor(utxoProvider: MidgardUtxoProvider, logger: Logger) {
    this.utxoProvider = utxoProvider;
    this.logger = logger;
    this.startPolling();
  }

  /**
   * Start polling for UTXO changes
   */
  private startPolling(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    
    pollingInterval = setInterval(async () => {
      await this.pollForUtxoChanges();
    }, POLLING_INTERVAL_MS);
    
    this.logger.info(`[MidgardChainHistoryProvider] Started polling for UTXO changes every ${POLLING_INTERVAL_MS}ms`);
  }

  /**
   * Poll for UTXO changes across all known addresses
   */
  private async pollForUtxoChanges(): Promise<void> {
    if (this.addresses.size === 0) {
      return;
    }

    const now = Date.now();
    if (now - lastCheckTime < POLLING_INTERVAL_MS) {
      return; // Avoid too frequent checks
    }
    lastCheckTime = now;

    try {
      const addresses = Array.from(this.addresses);
      const dummyTransactions = await this.checkUtxoChangesAndAddDummyTxs(addresses);
      
      if (dummyTransactions.length > 0) {
        this.logger.info(`[MidgardChainHistoryProvider] Polling detected ${dummyTransactions.length} UTXO changes`);
      }
    } catch (error) {
      this.logger.warn('[MidgardChainHistoryProvider] Error during polling:', error);
    }
  }

  /**
   * Generate a hash of the UTxO set for change detection
   */
  private generateUtxoHash(utxos: Cardano.Utxo[]): string {
    // Simple hash function that works in browser environment
    const utxoString = utxos
      .map(utxo => `${utxo[0].txId}#${utxo[0].index}`)
      .sort()
      .join('|');
    
    // Simple hash implementation that works in browser
    let hash = 0;
    for (let i = 0; i < utxoString.length; i++) {
      const char = utxoString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Create a dummy transaction for UI refresh
   */
  private createDummyTransaction(): Cardano.HydratedTx {
    const now = Date.now();
    // Generate a proper 64-character hex string for transaction ID
    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const txId = `${now.toString(16).padStart(32, '0')}${randomHex}`.substring(0, 64);
    
    // Generate a proper 64-character hex string for block hash
    const blockHashHex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    
    return {
      id: Cardano.TransactionId(txId),
      body: {
        inputs: [],
        outputs: [],
        fee: BigInt(0),
        validityInterval: {}
      },
      witness: {
        signatures: new Map()
      },
      txSize: 0,
      blockHeader: {
        blockNo: Cardano.BlockNo(0),
        slot: Cardano.Slot(0),
        hash: Cardano.BlockId(blockHashHex)
      },
      index: 0,
      inputSource: Cardano.InputSource.inputs,
      auxiliaryData: {
        blob: new Map()
      }
    } as Cardano.HydratedTx;
  }

  /**
   * Check UTxO changes and add dummy transactions if changes detected
   */
  private async checkUtxoChangesAndAddDummyTxs(addresses: string[]): Promise<Cardano.HydratedTx[]> {
    const dummyTransactions: Cardano.HydratedTx[] = [];

    for (const address of addresses) {
      try {
        // Get current UTxOs for this address
        const currentUtxos = await this.utxoProvider.utxoByAddresses({ addresses: [address] });
        const currentHash = this.generateUtxoHash(currentUtxos);
        const previousHash = globalUtxoSet.get(address);

        if (previousHash && previousHash !== currentHash) {
          this.logger.info(`[MidgardChainHistoryProvider] UTxO change detected for address ${address}`);
          
          const dummyTx = this.createDummyTransaction();
          dummyTransactions.push(dummyTx);
          
          this.logger.info(`[MidgardChainHistoryProvider] Added dummy transaction for UI refresh for address ${address}`);
        }

        // Update global UTxO set
        globalUtxoSet.set(address, currentHash);
      } catch (error) {
        this.logger.warn(`[MidgardChainHistoryProvider] Failed to check UTxO changes for address ${address}:`, error);
      }
    }

    return dummyTransactions;
  }

  /**
   * Main method to get transactions by addresses
   * Returns dummy transactions when UTxO changes are detected
   */
  async transactionsByAddresses(args: TransactionsByAddressesArgs): Promise<Paginated<Cardano.HydratedTx>> {
    this.logger.info(`[MidgardChainHistoryProvider] Fetching transactions for ${args.addresses.length} addresses...`);

    // Add addresses to our polling set
    args.addresses.forEach(address => this.addresses.add(address));

    try {
      // Check for UTxO changes and generate dummy transactions
      const dummyTransactions = await this.checkUtxoChangesAndAddDummyTxs(args.addresses);

      if (dummyTransactions.length > 0) {
        this.logger.info(`[MidgardChainHistoryProvider] Generated ${dummyTransactions.length} dummy transactions for UI refresh`);
        return {
          pageResults: dummyTransactions,
          totalResultCount: dummyTransactions.length
        };
      }

      // If no changes detected, return empty array or a default dummy transaction
      if (args.addresses.length > 0) {
        this.logger.info('[MidgardChainHistoryProvider] No transactions found, adding default dummy transaction');
        const defaultDummyTx = this.createDummyTransaction();
        return {
          pageResults: [defaultDummyTx],
          totalResultCount: 1
        };
      }

      return {
        pageResults: [],
        totalResultCount: 0
      };
    } catch (error) {
      this.logger.error('[MidgardChainHistoryProvider] Error in transactionsByAddresses:', error);
      return {
        pageResults: [],
        totalResultCount: 0
      };
    }
  }

  /**
   * Not implemented - returns empty array
   */
  async transactionsByHashes(): Promise<Cardano.HydratedTx[]> {
    this.logger.warn('[MidgardChainHistoryProvider] transactionsByHashes not implemented yet.');
    return [];
  }

  /**
   * Not implemented - returns empty array
   */
  async blocksByHashes(): Promise<Cardano.ExtendedBlockInfo[]> {
    this.logger.warn('[MidgardChainHistoryProvider] blocksByHashes not implemented yet.');
    return [];
  }

  /**
   * Health check - always returns true for dummy provider
   */
  async healthCheck(): Promise<{ ok: boolean }> {
    this.logger.debug('[MidgardChainHistoryProvider] Health check passed (dummy provider)');
    return { ok: true };
  }

  /**
   * Cleanup method to stop polling
   */
  destroy(): void {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      this.logger.info('[MidgardChainHistoryProvider] Stopped polling for UTXO changes');
    }
  }
} 