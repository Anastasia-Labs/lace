/**
 * Shared constants for mocked Midgard data
 * These values are used across different Midgard providers for consistent mocking
 */

export const MOCKED_MIDGARD_CONSTANTS = {
  // Network constants
  NETWORK: {
    SUPPLY: {
      max: '45000000000000000',
      total: '35000000000000000',
      circulating: '34000000000000000',
      locked: '0'
    },
    STAKE: {
      live: '0',
      active: '0'
    }
  },

  // Epoch constants
  EPOCH: {
    CURRENT: 123,
    // eslint-disable-next-line no-magic-numbers
    START_TIME: 1_640_995_200,
    // eslint-disable-next-line no-magic-numbers
    END_TIME: 1_640_995_200 + 432_000, // 5 days in seconds
    BLOCK_COUNT: '0',
    TX_COUNT: '0',
    OUTPUT: '0',
    FEES: '0',
    ACTIVE_STAKE: '0'
  },

  // Block constants
  BLOCK: {
    SLOT_LEADER: 'pool1dummy',
    SIZE: '0',
    TX_COUNT: '0',
    FEES: '0',
    VRF_KEY: 'vrf_vkdummy',
    OP_CERT: 'op_certdummy',
    OP_CERT_COUNTER: '0',
    PREVIOUS_BLOCK: 'genesis',
    NEXT_BLOCK: 'genesis',
    CONFIRMATIONS: '0',
    EPOCH_SLOT: '0'
  },

  // Transaction constants
  TRANSACTION: {
    FEES: '0',
    DEPOSIT: '0',
    SIZE: '0',
    INVALID_BEFORE: undefined,
    INVALID_HEREAFTER: undefined,
    UTXO_COUNT: '0',
    WITHDRAWAL_COUNT: '0',
    MIR_CERT_COUNT: '0',
    DELEGATION_COUNT: '0',
    STAKE_CERT_COUNT: '0',
    POOL_UPDATE_COUNT: '0',
    POOL_RETIRE_COUNT: '0',
    ASSET_MINT_OR_BURN_COUNT: '0',
    REDEEMER_COUNT: '0',
    VALID_CONTRACT: true
  },

  // UTXO constants
  UTXO: {
    BLOCK: 'genesis',
    DATA_HASH: undefined,
    INLINE_DATUM: undefined,
    REFERENCE_SCRIPT_HASH: undefined
  }
} as const;
