/* eslint-disable @typescript-eslint/no-explicit-any */
import { signExternalCardanoTx } from '../sign-external-cardano-tx';

const mockCreateTxInKeyPathMap = jest.fn();
const mockGetProviders = jest.fn();
const mockSerializeTx = jest.fn();
const mockSignTransaction = jest.fn();
const mockTransactionFromCbor = jest.fn();

jest.mock('@lib/scripts/background/config', () => ({
  getProviders: (...args: any[]) => mockGetProviders(...args)
}));

jest.mock('../wallet-api-ui', () => ({
  signingCoordinator: {
    signTransaction: (...args: any[]) => mockSignTransaction(...args)
  }
}));

jest.mock('@lace/cardano', () => ({
  Wallet: {
    Serialization: {
      TxCBOR: (value: string) => value
    },
    KeyManagement: {
      util: {
        createTxInKeyPathMap: (...args: any[]) => mockCreateTxInKeyPathMap(...args)
      }
    }
  }
}));

jest.mock('@cardano-sdk/core', () => ({
  Serialization: {
    BootstrapWitness: {
      fromCore: (value: any) => ({ toCbor: () => `bootstrap:${value.id}` })
    },
    PlutusData: {
      fromCore: (value: any) => ({ toCbor: () => `datum:${value.id}` })
    },
    Redeemer: {
      fromCore: (value: any) => ({ toCbor: () => `redeemer:${value.id}` })
    },
    Script: {
      fromCore: (value: any) => ({ toCbor: () => `script:${value.id}` })
    },
    Transaction: {
      fromCbor: (...args: any[]) => mockTransactionFromCbor(...args)
    },
    TxCBOR: {
      serialize: (...args: any[]) => mockSerializeTx(...args)
    }
  }
}));

describe('signExternalCardanoTx', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProviders.mockResolvedValue({ inputResolver: { resolveInput: jest.fn() } });
    mockCreateTxInKeyPathMap.mockResolvedValue({ 'input-1': { index: 0, role: 0 } });
    mockSignTransaction.mockResolvedValue(new Map([['pubkey-new', 'sig-new']]));
    mockSerializeTx.mockReturnValue('signed-tx-cbor');
    mockTransactionFromCbor.mockReturnValue({
      body: () => ({
        toCore: () => ({
          inputs: [{ index: 0, txId: 'input-1' }]
        })
      }),
      toCbor: () => 'parsed-tx-cbor',
      toCore: () => ({
        auxiliaryData: { label: 'aux' },
        body: { inputs: [{ index: 0, txId: 'input-1' }] },
        id: 'tx-id',
        isValid: true,
        witness: {
          bootstrap: [{ id: 'bootstrap-1' }],
          datums: [{ id: 'datum-1' }],
          redeemers: [{ id: 'redeemer-1' }],
          scripts: [{ id: 'script-1' }],
          signatures: new Map([['pubkey-existing', 'sig-existing']])
        }
      })
    });
  });

  test('signs an external Cardano tx with Cardano providers and preserves existing witness data', async () => {
    const knownAddresses = [{ address: 'addr_test1...', index: 0, type: 0 }] as any;
    const requestContext = {
      accountIndex: 0,
      chainId: { networkId: 0, networkMagic: 1 },
      purpose: 0,
      wallet: { walletId: 'wallet-1', type: 'InMemory' }
    } as any;

    const result = await signExternalCardanoTx({
      chainName: 'Preprod' as any,
      knownAddresses,
      requestContext,
      txCbor: 'unsigned-tx-cbor'
    });

    expect(mockGetProviders).toHaveBeenCalledWith('Preprod', { forceMidgardEnabled: false });
    expect(mockCreateTxInKeyPathMap).toHaveBeenCalledWith(
      { inputs: [{ index: 0, txId: 'input-1' }] },
      knownAddresses,
      expect.objectContaining({ resolveInput: expect.any(Function) })
    );
    expect(mockSignTransaction).toHaveBeenCalledWith(
      {
        signContext: {
          knownAddresses,
          scripts: [{ id: 'script-1' }],
          txInKeyPathMap: { 'input-1': { index: 0, role: 0 } }
        },
        tx: 'parsed-tx-cbor'
      },
      requestContext
    );
    expect(mockSerializeTx).toHaveBeenCalledWith({
      auxiliaryData: { label: 'aux' },
      body: { inputs: [{ index: 0, txId: 'input-1' }] },
      id: 'tx-id',
      isValid: true,
      witness: {
        bootstrap: [{ id: 'bootstrap-1' }],
        datums: [{ id: 'datum-1' }],
        redeemers: [{ id: 'redeemer-1' }],
        scripts: [{ id: 'script-1' }],
        signatures: new Map([
          ['pubkey-existing', 'sig-existing'],
          ['pubkey-new', 'sig-new']
        ])
      }
    });
    expect(result).toBe('signed-tx-cbor');
  });

  test('rejects signing when grouped wallet addresses are unavailable', async () => {
    await expect(
      signExternalCardanoTx({
        chainName: 'Preprod' as any,
        knownAddresses: [],
        requestContext: {} as any,
        txCbor: 'unsigned-tx-cbor'
      })
    ).rejects.toThrow('Wallet addresses are not available for Cardano signing');
  });
});
