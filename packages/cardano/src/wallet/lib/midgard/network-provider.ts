import { Logger } from 'ts-log';
import { MidgardClient } from './client';
import { MOCKED_MIDGARD_CONSTANTS } from './constants';

/**
 * Midgard network provider that extends NetworkInfoProvider functionality
 * to provide network information from the Midgard backend
 */
export class MidgardNetworkProvider {
  readonly #midgardClient: MidgardClient;
  readonly #logger: Logger;

  constructor(midgardClient: MidgardClient, logger: Logger) {
    this.#midgardClient = midgardClient;
    this.#logger = logger;
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

  /**
   * Get latest block information from Midgard
   * @returns Promise with latest block data
   */
  async getLatestBlock(): Promise<{
    blockNo: number;
    slot: number;
    hash: string;
  }> {
    try {
      this.#logger.debug('[Midgard] Fetching latest block information');

      return await this.#midgardClient.request<{
        blockNo: number;
        slot: number;
        hash: string;
      }>('blocks/latest');
    } catch (error) {
      this.#logger.error('[Midgard] Failed to fetch latest block:', error);

      // Return mocked data as fallback
      return {
        blockNo: 3_114_963,
        slot: 43_905_372,
        hash: '0dbe461fb5f981c0d01615332b8666340eb1a692b3034f46bcb5f5ea4172b2ed'
      };
    }
  }

  /**
   * Map block response to include fallback values for missing fields
   * @param response - The block response from API
   * @returns Mapped block data with fallback values
   */
  // eslint-disable-next-line complexity
  private mapBlockResponse(response: {
    time: number;
    height: number;
    hash: string;
    slot: number;
    epoch: number;
    epochSlot?: string;
    slotLeader?: string;
    size?: string;
    txCount?: string;
    fees?: string;
    vrfKey?: string;
    opCert?: string;
    opCertCounter?: string;
    previousBlock?: string;
    nextBlock?: string;
    confirmations?: string;
  }) {
    return {
      time: response.time,
      height: response.height,
      hash: response.hash,
      slot: response.slot,
      epoch: response.epoch,
      epochSlot: response.epochSlot ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.EPOCH_SLOT,
      slotLeader: response.slotLeader ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.SLOT_LEADER,
      size: response.size ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.SIZE,
      txCount: response.txCount ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.TX_COUNT,
      fees: response.fees ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.FEES,
      vrfKey: response.vrfKey ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.VRF_KEY,
      opCert: response.opCert ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.OP_CERT,
      opCertCounter: response.opCertCounter ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.OP_CERT_COUNTER,
      previousBlock: response.previousBlock ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.PREVIOUS_BLOCK,
      nextBlock: response.nextBlock ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.NEXT_BLOCK,
      confirmations: response.confirmations ?? MOCKED_MIDGARD_CONSTANTS.BLOCK.CONFIRMATIONS
    };
  }

  /**
   * Get block information by hash or number from Midgard
   * @param hashOrNumber - Block hash or block number
   * @returns Promise with block data
   */
  async getBlock(hashOrNumber: string): Promise<{
    time: number;
    height: number;
    hash: string;
    slot: number;
    epoch: number;
    epochSlot: string;
    slotLeader: string;
    size: string;
    txCount: string;
    fees: string;
    vrfKey: string;
    opCert: string;
    opCertCounter: string;
    previousBlock: string;
    nextBlock: string;
    confirmations: string;
  }> {
    try {
      this.#logger.debug(`[Midgard] Fetching block information for: ${hashOrNumber}`);

      const response = await this.#midgardClient.request<{
        time: number;
        height: number;
        hash: string;
        slot: number;
        epoch: number;
        epochSlot?: string;
        slotLeader?: string;
        size?: string;
        txCount?: string;
        fees?: string;
        vrfKey?: string;
        opCert?: string;
        opCertCounter?: string;
        previousBlock?: string;
        nextBlock?: string;
        confirmations?: string;
      }>(`blocks/${hashOrNumber}`);

      return this.mapBlockResponse(response);
    } catch (error) {
      this.#logger.error(`[Midgard] Failed to fetch block ${hashOrNumber}:`, error);

      // Return mocked data as fallback
      return this.mapBlockResponse({
        time: MOCKED_MIDGARD_CONSTANTS.EPOCH.START_TIME,
        height: 3_114_963,
        hash: hashOrNumber,
        slot: 43_905_372,
        epoch: 123
      });
    }
  }
}
