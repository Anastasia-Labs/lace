import { Logger } from 'ts-log';
import { MidgardClient } from './client';
import { MOCKED_MIDGARD_CONSTANTS } from './constants';

/**
 * Midgard epoch provider that extends NetworkInfoProvider functionality
 * to provide epoch information from the Midgard backend
 */
export class MidgardEpochProvider {
  readonly #midgardClient: MidgardClient;
  readonly #logger: Logger;

  constructor(midgardClient: MidgardClient, logger: Logger) {
    this.#midgardClient = midgardClient;
    this.#logger = logger;
  }

  /**
   * Get the latest epoch information from Midgard
   * @returns Promise with the latest epoch data
   */
  async getLatestEpoch(): Promise<{
    epoch: number;
    startTime: number;
    endTime: number;
    firstBlockTime: number;
    lastBlockTime: number;
    blockCount: string;
    txCount: string;
    output: string;
    fees: string;
    activeStake: string;
  }> {
    try {
      this.#logger.debug('[Midgard] Fetching latest epoch information');

      const response = await this.#midgardClient.request<{
        epoch: number;
        startTime: number;
        endTime: number;
        firstBlockTime?: number;
        lastBlockTime?: number;
        blockCount?: string;
        txCount?: string;
        output?: string;
        fees?: string;
        activeStake?: string;
      }>('epochs/latest');

      // Return response with mocked values for missing fields
      return {
        epoch: response.epoch,
        startTime: response.startTime,
        endTime: response.endTime,
        firstBlockTime: response.firstBlockTime ?? response.startTime,
        lastBlockTime: response.lastBlockTime ?? response.endTime,
        blockCount: response.blockCount ?? MOCKED_MIDGARD_CONSTANTS.EPOCH.BLOCK_COUNT,
        txCount: response.txCount ?? MOCKED_MIDGARD_CONSTANTS.EPOCH.TX_COUNT,
        output: response.output ?? MOCKED_MIDGARD_CONSTANTS.EPOCH.OUTPUT,
        fees: response.fees ?? MOCKED_MIDGARD_CONSTANTS.EPOCH.FEES,
        activeStake: response.activeStake ?? MOCKED_MIDGARD_CONSTANTS.EPOCH.ACTIVE_STAKE
      };
    } catch (error) {
      this.#logger.error('[Midgard] Failed to fetch latest epoch:', error);

      // Return mocked data as fallback
      return {
        epoch: MOCKED_MIDGARD_CONSTANTS.EPOCH.CURRENT,
        startTime: MOCKED_MIDGARD_CONSTANTS.EPOCH.START_TIME,
        endTime: MOCKED_MIDGARD_CONSTANTS.EPOCH.END_TIME,
        firstBlockTime: MOCKED_MIDGARD_CONSTANTS.EPOCH.START_TIME,
        lastBlockTime: MOCKED_MIDGARD_CONSTANTS.EPOCH.END_TIME,
        blockCount: MOCKED_MIDGARD_CONSTANTS.EPOCH.BLOCK_COUNT,
        txCount: MOCKED_MIDGARD_CONSTANTS.EPOCH.TX_COUNT,
        output: MOCKED_MIDGARD_CONSTANTS.EPOCH.OUTPUT,
        fees: MOCKED_MIDGARD_CONSTANTS.EPOCH.FEES,
        activeStake: MOCKED_MIDGARD_CONSTANTS.EPOCH.ACTIVE_STAKE
      };
    }
  }

  /**
   * Get network information from Midgard
   * @returns Promise with network data
   */
  async getNetworkInfo(): Promise<{
    supply: {
      max: string;
      total: string;
      circulating: string;
      locked: string;
    };
    stake: {
      live: string;
      active: string;
    };
  }> {
    try {
      this.#logger.debug('[Midgard] Fetching network information');

      return await this.#midgardClient.request<{
        supply: {
          max: string;
          total: string;
          circulating: string;
          locked: string;
        };
        stake: {
          live: string;
          active: string;
        };
      }>('network');
    } catch (error) {
      this.#logger.error('[Midgard] Failed to fetch network info:', error);

      // Return mocked data as fallback
      return {
        supply: MOCKED_MIDGARD_CONSTANTS.NETWORK.SUPPLY,
        stake: MOCKED_MIDGARD_CONSTANTS.NETWORK.STAKE
      };
    }
  }
}
