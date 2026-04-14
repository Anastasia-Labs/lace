import { createGetWalletActivities, mapWalletActivities, walletActivitiesSlice } from '../wallet-activities-slice';
import { renderHook, act } from '@testing-library/react-hooks';
import {
  WalletActivitiesSlice,
  StateStatus,
  AssetDetailsSlice,
  BlockchainProviderSlice,
  ActivityDetailSlice,
  UISlice,
  WalletInfoSlice
} from '@stores/types';
import '@testing-library/jest-dom';
import { waitFor } from '@testing-library/react';
import { mockBlockchainProviders } from '@src/utils/mocks/blockchain-providers';
import create, { SetState, GetState } from 'zustand';
import { cardanoCoin } from '@src/utils/constants';
import { mockInMemoryWallet, mockWalletInfoTestnet, mockWalletState } from '@src/utils/mocks/test-helpers';
import { currencyCode } from '@providers/currency/constants';
import { Serialization } from '@cardano-sdk/core';
import { Wallet } from '@lace/cardano';
import { MidgardSlice } from '../midgard-slice';

const FIRST_ACTIVITY_GROUP_INDEX = 0;
const FIRST_ACTIVITY_ITEM_INDEX = 0;
const PENDING_DEPOSIT_ASSET_ID = Wallet.Cardano.AssetId(`${Wallet.MIDGARD_LAYER1_POLICY_IDS.deposit}41`);
const INVALID_HEREAFTER_SLOT = 2;
const REGISTRATION_STAKE_CREDENTIAL = {
  type: Wallet.Cardano.CredentialType.KeyHash,
  hash: Wallet.Crypto.Hash28ByteBase16('0d94e174732ef9aae73f395ab44507bfa983d65023c11a951f0c32e4')
};

const createEmptyChainHistoryProvider = () =>
  ({
    transactionsByAddresses: jest.fn().mockResolvedValue({ pageResults: [], totalResultCount: 0 }),
    transactionsByHashes: jest.fn().mockResolvedValue([]),
    blocksByHashes: jest.fn().mockResolvedValue([]),
    healthCheck: jest.fn().mockResolvedValue({ ok: true })
  }) as unknown as Wallet.ChainHistoryProvider;

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const createWalletActivitiesLoaderHarness = ({
  mapWalletActivitiesImpl
}: {
  mapWalletActivitiesImpl?: (...args: Parameters<typeof mapWalletActivities>) => ReturnType<typeof mapWalletActivities>;
}) => {
  let state =
    {
      walletActivities: [],
      activitiesCount: 0,
      walletActivitiesStatus: StateStatus.IDLE,
      walletUI: { cardanoCoin },
      walletState: mockWalletState,
      setTransactionActivityDetail: jest.fn(),
      setRewardsActivityDetail: jest.fn(),
      assetDetails: undefined,
      blockchainProvider: mockBlockchainProviders(),
      midgardPendingActivities: [],
      isMidgardEnabled: false,
      environmentName: 'Preprod',
      isSharedWallet: false
    } as unknown as WalletInfoSlice &
      WalletActivitiesSlice &
      ActivityDetailSlice &
      AssetDetailsSlice &
      UISlice &
      BlockchainProviderSlice &
      MidgardSlice;

  const set: SetState<WalletActivitiesSlice> = (updater) => {
    const nextState =
      typeof updater === 'function' ? updater(state as WalletActivitiesSlice) : (updater as WalletActivitiesSlice);
    state = { ...state, ...nextState };
    return state as WalletActivitiesSlice;
  };
  const get: GetState<
    WalletInfoSlice &
      WalletActivitiesSlice &
      ActivityDetailSlice &
      AssetDetailsSlice &
      UISlice &
      BlockchainProviderSlice &
      MidgardSlice
  > = () => state;

  return {
    getWalletActivities: createGetWalletActivities({ set, get, mapWalletActivitiesImpl }),
    getState: () => state
  };
};

const mockActivitiesSlice = (
  set: SetState<WalletActivitiesSlice>,
  get: GetState<
    WalletInfoSlice &
      WalletActivitiesSlice &
      ActivityDetailSlice &
      AssetDetailsSlice &
      UISlice &
      BlockchainProviderSlice &
      MidgardSlice
  >
): WalletActivitiesSlice => {
  get = () =>
    ({
      blockchainProvider: mockBlockchainProviders(),
      walletUI: { cardanoCoin },
      inMemoryWallet: mockInMemoryWallet,
      walletState: mockWalletState,
      environmentName: 'Preprod',
      isMidgardEnabled: false,
      setMidgardMode: jest.fn(),
      startMidgardModeSwitch: jest.fn(),
      failMidgardModeSwitch: jest.fn(),
      clearMidgardModeError: jest.fn(),
      midgardActivationStatus: 'idle',
      midgardHealthStatus: 'healthy',
      setMidgardHealthHealthy: jest.fn(),
      setMidgardHealthDegraded: jest.fn(),
      resetMidgardHealth: jest.fn(),
      addMidgardPendingActivity: jest.fn(),
      addMidgardPendingDeposit: jest.fn(),
      walletInfo: mockWalletInfoTestnet,
      midgardPendingActivities: [],
      midgardPendingDeposits: [],
      removeMidgardPendingActivities: jest.fn(),
      removeMidgardPendingDeposits: jest.fn()
    } as unknown as WalletInfoSlice &
      WalletActivitiesSlice &
      ActivityDetailSlice &
      AssetDetailsSlice &
      UISlice &
      BlockchainProviderSlice &
      MidgardSlice);
  return walletActivitiesSlice({ set, get });
};

describe('Testing wallet activities slice', () => {
  test('should create store hook with wallet activities slice', () => {
    const useActivitiesHook = create(mockActivitiesSlice);
    const { result } = renderHook(() => useActivitiesHook());

    expect(result.current.getWalletActivities).toBeDefined();
    expect(result.current.walletActivitiesStatus).toBe(StateStatus.IDLE);
  });

  test('should change wallet activities state', async () => {
    const useActivitiesHook = create(mockActivitiesSlice);
    const { result } = renderHook(() => useActivitiesHook());

    await act(async () => {
      await result.current.getWalletActivities({
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      });
    });

    await waitFor(() => {
      expect(result.current.walletActivities.length).toEqual(1);
    });
  });

  test('should include pending Midgard deposits in a confirming activity section', async () => {
    const sendingAddress = mockWalletInfoTestnet.addresses[0].address;
    const pendingDepositTx: Wallet.Cardano.Tx = {
      id: Wallet.Cardano.TransactionId('6804edf9712d2b619edb6ac86861fe93a730693183a262b165fcc1ba1bc99cad'),
      body: {
        mint: new Map([[PENDING_DEPOSIT_ASSET_ID, BigInt(1)]]) as Wallet.Cardano.TokenMap,
        inputs: [
          {
            txId: Wallet.Cardano.TransactionId('4123d70f66414cc921f6ffc29a899aafc7137a99a0fd453d6b200863ef5702d6'),
            index: 1
          }
        ],
        outputs: [
          {
            address: Wallet.Cardano.PaymentAddress(
              'addr_test1qz7xvvc30qghk00sfpzcfhsw3s2nyn7my0r8hq8c2jj47zsxu2hyfhlkwuxupa9d5085eunq2qywy7hvmvej456flkns6sjg2v'
            ),
            value: {
              assets: new Map([[PENDING_DEPOSIT_ASSET_ID, BigInt(1)]]) as Wallet.Cardano.TokenMap,
              coins: BigInt('1000000')
            }
          }
        ],
        fee: BigInt('1000000'),
        validityInterval: {
          invalidBefore: Wallet.Cardano.Slot(1),
          invalidHereafter: Wallet.Cardano.Slot(INVALID_HEREAFTER_SLOT)
        }
      },
      witness: {
        signatures: new Map([
          [
            Wallet.Crypto.Ed25519PublicKeyHex('6199186adb51974690d7247d2646097d2c62763b767b528816fb7ed3f9f55d39'),
            Wallet.Crypto.Ed25519SignatureHex(
              '709f937c4ce152c81f8406c03279ff5a8556a12a8657e40a578eaaa6223d2e6a2fece39733429e3ec73a6c798561b5c2d47d82224d656b1d964cfe8b5fdffe09'
            )
          ]
        ])
      }
    };
    const pendingDepositTxCbor = Serialization.TxCBOR.serialize(pendingDepositTx);
    const chainHistoryProvider = createEmptyChainHistoryProvider();

    const { walletActivities } = await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      {
        assetProvider: mockBlockchainProviders().assetProvider,
        assetDetails: undefined,
        cardanoCoin,
        chainHistoryProvider,
        environmentName: 'Preprod',
        inputResolver: {
          resolveInput: jest.fn().mockResolvedValue({
            address: sendingAddress,
            value: { coins: BigInt('3000000') }
          })
        },
        isMidgardEnabled: true,
        isSharedWallet: false,
        midgardPendingActivities: [
          {
            schemaVersion: 1,
            txId: pendingDepositTx.id.toString(),
            txCbor: pendingDepositTxCbor,
            txFormat: 'cardano-legacy',
            address: sendingAddress.toString(),
            createdAt: new Date().toISOString(),
            kind: 'deposit'
          }
        ],
        setRewardsActivityDetail: jest.fn(),
        setTransactionActivityDetail: jest.fn()
      }
    );

    expect(walletActivities[FIRST_ACTIVITY_GROUP_INDEX].title).toBe('Confirming');
    expect(walletActivities[FIRST_ACTIVITY_GROUP_INDEX].items[FIRST_ACTIVITY_ITEM_INDEX]).toEqual(
      expect.objectContaining({
        label: 'Depositing',
        status: 'sending'
      })
    );
  });

  test('should keep pending Midgard deposits labeled as Depositing when chain history resolves them without mint metadata', async () => {
    const sendingAddress = mockWalletInfoTestnet.addresses[0].address;
    const pendingDepositTx: Wallet.Cardano.Tx = {
      id: Wallet.Cardano.TransactionId('956779250fac75430360c1a6efbaed77ceea49fa4d2aff988cadcc2294ce41f0'),
      body: {
        inputs: [
          {
            txId: Wallet.Cardano.TransactionId('4123d70f66414cc921f6ffc29a899aafc7137a99a0fd453d6b200863ef5702d6'),
            index: 1
          }
        ],
        outputs: [
          {
            address: Wallet.Cardano.PaymentAddress(
              'addr_test1qz7xvvc30qghk00sfpzcfhsw3s2nyn7my0r8hq8c2jj47zsxu2hyfhlkwuxupa9d5085eunq2qywy7hvmvej456flkns6sjg2v'
            ),
            value: {
              coins: BigInt('1000000')
            }
          }
        ],
        certificates: [
          ({
            __typename: Wallet.Cardano.CertificateType.Registration,
            deposit: BigInt(2000000),
            stakeCredential: REGISTRATION_STAKE_CREDENTIAL
          } as unknown as Wallet.Cardano.Certificate)
        ],
        fee: BigInt('1000000'),
        validityInterval: {
          invalidBefore: Wallet.Cardano.Slot(1),
          invalidHereafter: Wallet.Cardano.Slot(INVALID_HEREAFTER_SLOT)
        }
      },
      witness: {
        signatures: new Map([
          [
            Wallet.Crypto.Ed25519PublicKeyHex('6199186adb51974690d7247d2646097d2c62763b767b528816fb7ed3f9f55d39'),
            Wallet.Crypto.Ed25519SignatureHex(
              '709f937c4ce152c81f8406c03279ff5a8556a12a8657e40a578eaaa6223d2e6a2fece39733429e3ec73a6c798561b5c2d47d82224d656b1d964cfe8b5fdffe09'
            )
          ]
        ])
      }
    };
    const pendingDepositTxCbor = Serialization.TxCBOR.serialize(pendingDepositTx);
    const chainHistoryProvider = {
      ...createEmptyChainHistoryProvider(),
      transactionsByHashes: jest.fn().mockResolvedValue([
        {
          ...pendingDepositTx,
          blockHeader: {
            blockNo: Wallet.Cardano.BlockNo(1),
            hash: Wallet.Cardano.BlockId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
            slot: Wallet.Cardano.Slot(1)
          },
          index: 0,
          midgardTxProvenance: Wallet.MidgardTxProvenance.Layer1Bridge
        } as unknown as Wallet.Cardano.HydratedTx
      ])
    } as unknown as Wallet.ChainHistoryProvider;

    const { walletActivities } = await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      {
        assetProvider: mockBlockchainProviders().assetProvider,
        assetDetails: undefined,
        cardanoCoin,
        chainHistoryProvider,
        environmentName: 'Preprod',
        inputResolver: {
          resolveInput: jest.fn().mockResolvedValue({
            address: sendingAddress,
            value: { coins: BigInt('3000000') }
          })
        },
        isMidgardEnabled: true,
        isSharedWallet: false,
        midgardPendingActivities: [
          {
            schemaVersion: 1,
            txId: pendingDepositTx.id.toString(),
            txCbor: pendingDepositTxCbor,
            txFormat: 'cardano-legacy',
            address: sendingAddress.toString(),
            createdAt: new Date().toISOString(),
            kind: 'deposit'
          }
        ],
        setRewardsActivityDetail: jest.fn(),
        setTransactionActivityDetail: jest.fn()
      }
    );

    expect(walletActivities[FIRST_ACTIVITY_GROUP_INDEX].items[FIRST_ACTIVITY_ITEM_INDEX]).toEqual(
      expect.objectContaining({
        direction: 'Outgoing',
        label: 'Depositing',
        type: 'outgoing'
      })
    );
  });

  test('should filter out non-midgard layer1 history while keeping bridge and midgard l2 txs in midgard mode', async () => {
    const sendingAddress = mockWalletInfoTestnet.addresses[0].address;
    const plainLayer1TxId = Wallet.Cardano.TransactionId(
      '1111111111111111111111111111111111111111111111111111111111111111'
    );
    const depositTxId = Wallet.Cardano.TransactionId(
      '2222222222222222222222222222222222222222222222222222222222222222'
    );
    const midgardLayer2TxId = Wallet.Cardano.TransactionId(
      '3333333333333333333333333333333333333333333333333333333333333333'
    );

    const plainLayer1Tx = {
      ...mockWalletState.transactions.history[0],
      id: plainLayer1TxId
    } as Wallet.Cardano.HydratedTx;

    const depositBridgeTx = {
      ...mockWalletState.transactions.history[0],
      id: depositTxId,
      body: {
        ...mockWalletState.transactions.history[0].body,
        certificates: [
          {
            __typename: Wallet.Cardano.CertificateType.Registration,
            stakeCredential: REGISTRATION_STAKE_CREDENTIAL
          }
        ],
        mint: new Map([[PENDING_DEPOSIT_ASSET_ID, BigInt(1)]]) as Wallet.Cardano.TokenMap
      }
    } as Wallet.Cardano.HydratedTx;

    const midgardLayer2Tx = {
      ...mockWalletState.transactions.history[0],
      id: midgardLayer2TxId,
      blockHeader: {
        blockNo: 17,
        hash: Wallet.Cardano.BlockId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        slot: 123_456
      },
      midgardTxProvenance: Wallet.MidgardTxProvenance.Layer2Native
    } as Wallet.Cardano.HydratedTx;

    const { walletActivities } = await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses,
        transactions: {
          ...mockWalletState.transactions,
          history: [plainLayer1Tx, depositBridgeTx, midgardLayer2Tx]
        }
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      {
        assetProvider: mockBlockchainProviders().assetProvider,
        assetDetails: undefined,
        cardanoCoin,
        chainHistoryProvider: mockBlockchainProviders().chainHistoryProvider,
        environmentName: 'Preprod',
        inputResolver: {
          resolveInput: jest.fn().mockResolvedValue({
            address: sendingAddress,
            value: { coins: BigInt('3000000') }
          })
        },
        isMidgardEnabled: true,
        isSharedWallet: false,
        midgardPendingActivities: [],
        setRewardsActivityDetail: jest.fn(),
        setTransactionActivityDetail: jest.fn()
      }
    );

    const flattenedActivities = walletActivities.flatMap(({ items }) => items);
    const renderedIds = flattenedActivities.map(({ id }) => id);

    expect(renderedIds).toContain(depositTxId.toString());
    expect(renderedIds).toContain(midgardLayer2TxId.toString());
    expect(renderedIds).not.toContain(plainLayer1TxId.toString());
    expect(flattenedActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: depositTxId.toString(),
          label: 'Midgard L2 Deposit',
          amount: expect.not.stringContaining('NaN'),
          fiatAmount: expect.not.stringContaining('NaN')
        })
      ])
    );
  });

  test('should backfill Midgard deposit history from plain Cardano history while keeping non-deposit Cardano txs hidden', async () => {
    const sendingAddress = mockWalletInfoTestnet.addresses[0].address;
    const plainLayer1TxId = Wallet.Cardano.TransactionId(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    const depositTxId = Wallet.Cardano.TransactionId(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
    const midgardLayer2TxId = Wallet.Cardano.TransactionId(
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );

    const plainLayer1Tx = {
      ...mockWalletState.transactions.history[0],
      id: plainLayer1TxId
    } as Wallet.Cardano.HydratedTx;

    const supplementalDepositTx = {
      ...mockWalletState.transactions.history[0],
      id: depositTxId,
      body: {
        ...mockWalletState.transactions.history[0].body,
        mint: new Map([[PENDING_DEPOSIT_ASSET_ID, BigInt(1)]]) as Wallet.Cardano.TokenMap
      }
    } as Wallet.Cardano.HydratedTx;

    const midgardLayer2Tx = {
      ...mockWalletState.transactions.history[0],
      id: midgardLayer2TxId,
      blockHeader: {
        blockNo: 17,
        hash: Wallet.Cardano.BlockId('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        slot: 123_456
      },
      midgardTxProvenance: Wallet.MidgardTxProvenance.Layer2Native
    } as Wallet.Cardano.HydratedTx;

    const { walletActivities } = await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses,
        transactions: {
          ...mockWalletState.transactions,
          history: [plainLayer1Tx, midgardLayer2Tx]
        }
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      {
        assetProvider: mockBlockchainProviders().assetProvider,
        assetDetails: undefined,
        cardanoCoin,
        chainHistoryProvider: mockBlockchainProviders().chainHistoryProvider,
        environmentName: 'Preprod',
        inputResolver: {
          resolveInput: jest.fn().mockResolvedValue({
            address: sendingAddress,
            value: { coins: BigInt('3000000') }
          })
        },
        isMidgardEnabled: true,
        isSharedWallet: false,
        midgardPendingActivities: [],
        setRewardsActivityDetail: jest.fn(),
        setTransactionActivityDetail: jest.fn(),
        supplementalCardanoDepositHistory: [supplementalDepositTx]
      }
    );

    const flattenedActivities = walletActivities.flatMap(({ items }) => items);
    const renderedIds = flattenedActivities.map(({ id }) => id);

    expect(renderedIds).toContain(depositTxId.toString());
    expect(renderedIds).toContain(midgardLayer2TxId.toString());
    expect(renderedIds).not.toContain(plainLayer1TxId.toString());
    expect(flattenedActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: depositTxId.toString(),
          label: 'Midgard L2 Deposit'
        })
      ])
    );
  });

  test('should include pending Midgard sends in a pending activity section', async () => {
    const sendingAddress = mockWalletInfoTestnet.addresses[0].address;
    const pendingSendTx: Wallet.Cardano.Tx = {
      id: Wallet.Cardano.TransactionId('4444444444444444444444444444444444444444444444444444444444444444'),
      body: {
        inputs: [
          {
            txId: Wallet.Cardano.TransactionId('5555555555555555555555555555555555555555555555555555555555555555'),
            index: 0
          }
        ],
        outputs: [
          {
            address: Wallet.Cardano.PaymentAddress(
              'addr_test1qz7xvvc30qghk00sfpzcfhsw3s2nyn7my0r8hq8c2jj47zsxu2hyfhlkwuxupa9d5085eunq2qywy7hvmvej456flkns6sjg2v'
            ),
            value: {
              coins: BigInt('1500000')
            }
          }
        ],
        fee: BigInt('200000')
      },
      witness: {
        signatures: new Map([
          [
            Wallet.Crypto.Ed25519PublicKeyHex('6199186adb51974690d7247d2646097d2c62763b767b528816fb7ed3f9f55d39'),
            Wallet.Crypto.Ed25519SignatureHex(
              '709f937c4ce152c81f8406c03279ff5a8556a12a8657e40a578eaaa6223d2e6a2fece39733429e3ec73a6c798561b5c2d47d82224d656b1d964cfe8b5fdffe09'
            )
          ]
        ])
      }
    };
    const pendingSendTxCbor = Serialization.TxCBOR.serialize(pendingSendTx);
    const chainHistoryProvider = createEmptyChainHistoryProvider();

    const { walletActivities } = await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      {
        assetProvider: mockBlockchainProviders().assetProvider,
        assetDetails: undefined,
        cardanoCoin,
        chainHistoryProvider,
        environmentName: 'Preprod',
        inputResolver: {
          resolveInput: jest.fn().mockResolvedValue({
            address: sendingAddress,
            value: { coins: BigInt('3000000') }
          })
        },
        isMidgardEnabled: true,
        isSharedWallet: false,
        midgardPendingActivities: [
          {
            schemaVersion: 1,
            txId: pendingSendTx.id.toString(),
            txCbor: pendingSendTxCbor,
            txFormat: 'cardano-legacy',
            address: sendingAddress.toString(),
            createdAt: new Date().toISOString(),
            kind: 'send'
          }
        ],
        setRewardsActivityDetail: jest.fn(),
        setTransactionActivityDetail: jest.fn()
      }
    );

    expect(walletActivities[FIRST_ACTIVITY_GROUP_INDEX].title).toBe('Sending');
    expect(walletActivities[FIRST_ACTIVITY_GROUP_INDEX].items[FIRST_ACTIVITY_ITEM_INDEX]).toEqual(
      expect.objectContaining({
        status: 'sending'
      })
    );
  });

  test('should keep the canonical Midgard tx id on pending send activities and detail views', async () => {
    const sendingAddress = mockWalletInfoTestnet.addresses[0].address;
    const cardanoTxId = Wallet.Cardano.TransactionId(
      '6666666666666666666666666666666666666666666666666666666666666666'
    );
    const pendingSendTx: Wallet.Cardano.Tx = {
      id: cardanoTxId,
      body: {
        inputs: [
          {
            txId: Wallet.Cardano.TransactionId('8888888888888888888888888888888888888888888888888888888888888888'),
            index: 0
          }
        ],
        outputs: [
          {
            address: Wallet.Cardano.PaymentAddress(
              'addr_test1qz7xvvc30qghk00sfpzcfhsw3s2nyn7my0r8hq8c2jj47zsxu2hyfhlkwuxupa9d5085eunq2qywy7hvmvej456flkns6sjg2v'
            ),
            value: {
              coins: BigInt('1500000')
            }
          }
        ],
        fee: BigInt('200000')
      },
      witness: {
        signatures: new Map()
      }
    };
    const draft = Wallet.createMidgardNativeTxDraft({ body: pendingSendTx.body });
    const signedMidgardTx = Wallet.assembleMidgardSignedTx(draft, [
      {
        publicKey: Wallet.Crypto.Ed25519PublicKeyHex('6199186adb51974690d7247d2646097d2c62763b767b528816fb7ed3f9f55d39'),
        signature: Wallet.Crypto.Ed25519SignatureHex(
          '709f937c4ce152c81f8406c03279ff5a8556a12a8657e40a578eaaa6223d2e6a2fece39733429e3ec73a6c798561b5c2d47d82224d656b1d964cfe8b5fdffe09'
        )
      }
    ]);
    const setTransactionActivityDetail = jest.fn();
    const chainHistoryProvider = {
      transactionsByAddresses: jest.fn().mockResolvedValue({ pageResults: [], totalResultCount: 0 }),
      transactionsByHashes: jest.fn().mockResolvedValue([]),
      blocksByHashes: jest.fn().mockResolvedValue([]),
      healthCheck: jest.fn().mockResolvedValue({ ok: true })
    } as unknown as Wallet.ChainHistoryProvider;

    const { walletActivities } = await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      {
        assetProvider: mockBlockchainProviders().assetProvider,
        assetDetails: undefined,
        cardanoCoin,
        chainHistoryProvider,
        environmentName: 'Preprod',
        inputResolver: {
          resolveInput: jest.fn().mockResolvedValue({
            address: sendingAddress,
            value: { coins: BigInt('3000000') }
          })
        },
        isMidgardEnabled: true,
        isSharedWallet: false,
        midgardPendingActivities: [
          {
            txId: signedMidgardTx.txId.toString(),
            cardanoTxId: cardanoTxId.toString(),
            cardanoPreviewCbor: draft.cardanoPreviewCbor,
            nativeTxCbor: signedMidgardTx.cbor,
            address: sendingAddress.toString(),
            createdAt: new Date().toISOString(),
            kind: 'send',
            schemaVersion: 2,
            txFormat: 'midgard-native'
          }
        ],
        setRewardsActivityDetail: jest.fn(),
        setTransactionActivityDetail
      }
    );

    const pendingActivity = walletActivities[FIRST_ACTIVITY_GROUP_INDEX].items[FIRST_ACTIVITY_ITEM_INDEX];
    expect(pendingActivity.id).toBe(signedMidgardTx.txId.toString());

    act(() => {
      pendingActivity.onClick();
    });

    expect(setTransactionActivityDetail).toHaveBeenCalledTimes(1);
    expect(setTransactionActivityDetail.mock.calls[0][0].activity.id.toString()).toBe(signedMidgardTx.txId.toString());
    expect(chainHistoryProvider.transactionsByHashes).not.toHaveBeenCalled();
  });

  test('should ignore stale activity loads from older requests', async () => {
    const firstResponse = createDeferred<Pick<WalletActivitiesSlice, 'walletActivities' | 'activitiesCount'>>();
    const secondResponse = {
      walletActivities: [{ title: 'Latest', items: [] }] as WalletActivitiesSlice['walletActivities'],
      activitiesCount: 2
    };
    const mapWalletActivitiesImpl = jest
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(secondResponse) as unknown as (
      ...args: Parameters<typeof mapWalletActivities>
    ) => ReturnType<typeof mapWalletActivities>;
    const harness = createWalletActivitiesLoaderHarness({ mapWalletActivitiesImpl });
    const fetchWalletActivitiesProps = {
      fiatCurrency: { code: currencyCode.USD, symbol: '$' },
      cardanoFiatPrice: 1
    };

    const firstRequest = harness.getWalletActivities(fetchWalletActivitiesProps);
    await harness.getWalletActivities({ ...fetchWalletActivitiesProps, cardanoFiatPrice: 2 });

    firstResponse.resolve({
      walletActivities: [{ title: 'Stale', items: [] }] as WalletActivitiesSlice['walletActivities'],
      activitiesCount: 1
    });
    await firstRequest;

    expect(harness.getState().walletActivitiesStatus).toBe(StateStatus.LOADED);
    expect(harness.getState().walletActivities).toEqual(secondResponse.walletActivities);
    expect(harness.getState().activitiesCount).toBe(2);
  });

  test('should surface an error status when the latest activity load fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mapWalletActivitiesImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('activity load failed')) as unknown as (
      ...args: Parameters<typeof mapWalletActivities>
    ) => ReturnType<typeof mapWalletActivities>;
    const harness = createWalletActivitiesLoaderHarness({ mapWalletActivitiesImpl });

    await harness.getWalletActivities({
      fiatCurrency: { code: currencyCode.USD, symbol: '$' },
      cardanoFiatPrice: 1
    });

    expect(harness.getState().walletActivitiesStatus).toBe(StateStatus.ERROR);
    expect(harness.getState().walletActivities).toEqual([]);
    expect(harness.getState().activitiesCount).toBe(0);
    consoleErrorSpy.mockRestore();
  });

  test('should recompute memoized activities when providers change', async () => {
    const firstResolveInput = jest.fn().mockResolvedValue({
      address: mockWalletInfoTestnet.addresses[0].address,
      value: { coins: BigInt('3000000') }
    });
    const secondResolveInput = jest.fn().mockResolvedValue({
      address: mockWalletInfoTestnet.addresses[0].address,
      value: { coins: BigInt('3000000') }
    });
    const commonParams = [
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      }
    ] as const;

    await mapWalletActivities(...commonParams, {
      assetProvider: mockBlockchainProviders().assetProvider,
      assetDetails: undefined,
      cardanoCoin,
      chainHistoryProvider: createEmptyChainHistoryProvider(),
      environmentName: 'Preprod',
      inputResolver: { resolveInput: firstResolveInput },
      isMidgardEnabled: false,
      isSharedWallet: false,
      midgardPendingActivities: [],
      setRewardsActivityDetail: jest.fn(),
      setTransactionActivityDetail: jest.fn()
    });

    await mapWalletActivities(...commonParams, {
      assetProvider: mockBlockchainProviders().assetProvider,
      assetDetails: undefined,
      cardanoCoin,
      chainHistoryProvider: createEmptyChainHistoryProvider(),
      environmentName: 'Preprod',
      inputResolver: { resolveInput: secondResolveInput },
      isMidgardEnabled: false,
      isSharedWallet: false,
      midgardPendingActivities: [],
      setRewardsActivityDetail: jest.fn(),
      setTransactionActivityDetail: jest.fn()
    });

    expect(firstResolveInput).toHaveBeenCalled();
    expect(secondResolveInput).toHaveBeenCalled();
  });

  test('should recompute memoized activities when new wallet addresses are discovered', async () => {
    const resolveInput = jest.fn().mockResolvedValue({
      address: mockWalletInfoTestnet.addresses[0].address,
      value: { coins: BigInt('3000000') }
    });
    const inputResolver = { resolveInput };
    const baseDeps: Parameters<typeof mapWalletActivities>[2] = {
      assetProvider: mockBlockchainProviders().assetProvider,
      assetDetails: undefined,
      cardanoCoin,
      chainHistoryProvider: createEmptyChainHistoryProvider(),
      environmentName: 'Preprod',
      inputResolver,
      isMidgardEnabled: false,
      isSharedWallet: false,
      midgardPendingActivities: [],
      setRewardsActivityDetail: jest.fn(),
      setTransactionActivityDetail: jest.fn()
    };

    await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: mockWalletInfoTestnet.addresses
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      baseDeps
    );
    const callCountAfterFirstMapping = resolveInput.mock.calls.length;

    await mapWalletActivities(
      {
        ...mockWalletState,
        addresses: [...mockWalletInfoTestnet.addresses, ...mockWalletInfoTestnet.addresses]
      },
      {
        fiatCurrency: { code: currencyCode.USD, symbol: '$' },
        cardanoFiatPrice: 1
      },
      baseDeps
    );

    expect(resolveInput.mock.calls.length).toBeGreaterThan(callCountAfterFirstMapping);
  });
});
