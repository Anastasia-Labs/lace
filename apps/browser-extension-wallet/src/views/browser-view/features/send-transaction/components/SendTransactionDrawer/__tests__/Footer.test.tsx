/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Sections } from '../../../types';
import { Footer } from '../Footer';

const mockAddMidgardPendingActivity = jest.fn();
const mockSetBuiltTxData = jest.fn();
const mockSetMidgardHealthDegraded = jest.fn();
const mockSetSection = jest.fn();
const mockSetSubmitingTxState = jest.fn();
const mockSignMidgardTransaction = jest.fn();
const mockSubmitMidgardTx = jest.fn();
const mockUseBuiltTxState = jest.fn();
const mockUseSections = jest.fn();
const mockUseSubmitingState = jest.fn();
const mockUseWalletStore = jest.fn();
const mockWithSignMidgardTxConfirmation = jest.fn();

jest.mock('@lace/common', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');

  return {
    Button: ReactModule.forwardRef(({ children, disabled, onClick, 'data-testid': dataTestId }: any, ref: any) => (
      <button ref={ref} type="button" disabled={disabled} onClick={onClick} data-testid={dataTestId}>
        {children}
      </button>
    )),
    logger: {
      error: jest.fn()
    },
    useObservable: (): unknown[] => []
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value
  })
}));

jest.mock('../../../store', () => ({
  useSections: () => mockUseSections(),
  useBuiltTxState: () => mockUseBuiltTxState(),
  useSubmitingState: () => mockUseSubmitingState(),
  useTransactionProps: () => ({ hasInvalidOutputs: false }),
  useMetadata: (): unknown[][] => [[]],
  useAnalyticsSendFlowTriggerPoint: () => ({ triggerPoint: 'manual' })
}));

jest.mock('../Header', () => ({
  useHandleClose: () => ({
    onClose: jest.fn(),
    onCloseSubmitedTransaction: jest.fn()
  })
}));

jest.mock('@src/stores', () => ({
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@hooks', () => ({
  useCurrentWallet: () => ({ type: 'InMemory' }),
  useHandleResolver: () => jest.fn(),
  useNetwork: () => true,
  useWalletManager: () => ({
    walletRepository: {
      wallets$: {}
    }
  })
}));

jest.mock('@providers', () => ({
  useAnalyticsContext: () => ({
    sendEventToPostHog: jest.fn()
  })
}));

jest.mock('@providers/AnalyticsProvider/analyticsTracker', () => ({
  PostHogAction: new Proxy(
    {},
    {
      get: (_target, property) => property
    }
  ),
  TxCreationType: {
    Internal: 'Internal'
  },
  TX_CREATION_TYPE_KEY: 'txCreationType'
}));

jest.mock('@providers/AnalyticsProvider/onChain', () => ({
  txSubmitted$: {
    next: jest.fn()
  }
}));

jest.mock('@lace/core', () => ({
  exportMultisigTransaction: jest.fn(),
  useSecrets: () => ({
    password: { value: 'secret-password' },
    clearSecrets: jest.fn()
  }),
  useSignPolicy: (): undefined => undefined
}));

jest.mock('@src/features/address-book/context', () => ({
  withAddressBookContext: (component: any) => component,
  useAddressBookContext: () => ({
    list: [] as unknown[],
    utils: {
      updateRecord: jest.fn(),
      deleteRecord: jest.fn()
    }
  })
}));

jest.mock('@src/features/address-book/store', () => ({
  useAddressBookStore: () => ({
    addressToEdit: {
      address: 'addr_test1...'
    }
  })
}));

jest.mock('@src/utils/validators', () => ({
  getAddressToSave: jest.fn()
}));

jest.mock('@src/features/address-book/components/AddressActionsModal', () => ({
  ACTIONS: {
    UPDATE: 'UPDATE',
    DELETE: 'DELETE'
  },
  AddressActionsModal: () => <div data-testid="address-actions-modal" />
}));

jest.mock('../AddressFormFooter', () => ({
  AddressFormFooter: () => <div data-testid="address-form-footer" />
}));

jest.mock('../AssetPickerFooter', () => ({
  AssetPickerFooter: () => <div data-testid="asset-picker-footer" />
}));

jest.mock('@lib/wallet-api-ui', () => ({
  midgardSigningCoordinator: {
    signTransaction: (...args: any[]) => mockSignMidgardTransaction(...args)
  },
  withSignMidgardTxConfirmation: (...args: any[]) => mockWithSignMidgardTxConfirmation(...args),
  withSignTxConfirmation: jest.fn()
}));

jest.mock('@lib/scripts/background/util', () => ({
  getParentWalletForCIP1854Account: (): undefined => undefined
}));

jest.mock('@src/utils/midgard-url', () => ({
  getMidgardUrl: () => 'http://midgard.local'
}));

jest.mock('@src/utils/midgard-submit', () => ({
  submitMidgardTx: (...args: any[]) => mockSubmitMidgardTx(...args)
}));

jest.mock('@cardano-sdk/core', () => ({
  Serialization: {
    TxCBOR: {
      deserialize: () => ({
        id: {
          toString: () => 'preview-cardano-tx-id'
        }
      })
    }
  }
}));

jest.mock('@cardano-sdk/web-extension', () => ({
  WalletType: {
    InMemory: 'InMemory',
    Ledger: 'Ledger'
  }
}));

jest.mock('@lace/cardano', () => {
  class AuthenticationError extends Error {}

  return {
    Wallet: {
      AVAILABLE_WALLETS: [],
      createMidgardNativeTxDraft: () => ({
        cardanoPreviewCbor: 'preview-cbor',
        signingHash: 'signing-hash'
      }),
      isKeyHashAddress: () => true,
      assembleMidgardSignedTx: () => ({
        txId: {
          toString: () => 'expected-midgard-tx-id'
        },
        cbor: 'signed-midgard-cbor'
      }),
      KeyManagement: {
        util: {
          createTxInKeyPathMap: jest.fn().mockResolvedValue({}),
          ownSignatureKeyPaths: jest.fn().mockReturnValue(['1852H/1815H/0H/0/0'])
        },
        errors: {
          AuthenticationError
        }
      }
    }
  };
});

const mockBuiltTx = {
  inspect: jest.fn().mockResolvedValue({
    auxiliaryData: { metadata: 'aux' },
    body: { tx: 'body' }
  })
};

const makeWalletStore = (overrides = {}) =>
  ({
    blockchainProvider: {
      inputResolver: {}
    },
    cardanoWallet: {
      source: {
        account: {
          accountIndex: 0
        }
      }
    },
    inMemoryWallet: {},
    isInMemoryWallet: true,
    walletType: 'InMemory',
    isSharedWallet: false,
    currentChain: {
      networkId: 0,
      networkMagic: 1
    },
    environmentName: 'Preprod',
    walletInfo: {
      addresses: [
        {
          address: {
            toString: () => 'addr_test1send'
          }
        }
      ]
    },
    isMidgardEnabled: true,
    midgardActivationStatus: 'idle',
    midgardHealthStatus: 'healthy',
    midgardHealthError: undefined,
    setMidgardHealthDegraded: mockSetMidgardHealthDegraded,
    addMidgardPendingActivity: mockAddMidgardPendingActivity,
    walletState: {
      addresses: [{ address: 'addr_test1send' }]
    },
    ...overrides
  } as any);

describe('SendTransactionDrawer Footer', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseBuiltTxState.mockReturnValue({
      builtTxData: {
        tx: mockBuiltTx
      },
      setBuiltTxData: mockSetBuiltTxData
    });
    mockUseSections.mockReturnValue({
      currentSection: {
        currentSection: Sections.CONFIRMATION
      },
      setSection: mockSetSection
    });
    mockUseSubmitingState.mockReturnValue({
      setSubmitingTxState: mockSetSubmitingTxState,
      isSubmitingTx: false,
      isPasswordValid: true
    });
    mockUseWalletStore.mockReturnValue(makeWalletStore());
    mockWithSignMidgardTxConfirmation.mockImplementation(async (action: () => Promise<void>) => await action());
    mockSignMidgardTransaction.mockResolvedValue(['witness']);
    mockSubmitMidgardTx.mockResolvedValue('expected-midgard-tx-id');
  });

  test('disables review while wallet providers are switching even before Midgard is enabled', () => {
    mockUseSections.mockReturnValue({
      currentSection: {
        currentSection: Sections.FORM
      },
      setSection: mockSetSection
    });
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        isMidgardEnabled: false,
        midgardActivationStatus: 'switching'
      })
    );

    const { getByTestId } = render(<Footer />);

    expect(getByTestId('send-next-btn')).toBeDisabled();
    expect(getByTestId('send-next-btn')).toHaveTextContent('Switching wallet providers...');
    expect(getByTestId('midgard-send-switching-hint')).toHaveTextContent(
      'Lace is still reloading the active wallet providers.'
    );
  });

  test('does not degrade Midgard health for local signing failures', async () => {
    mockSignMidgardTransaction.mockRejectedValue(new Error('Local signing failed'));

    const { getByTestId } = render(<Footer />);

    fireEvent.click(getByTestId('send-next-btn'));

    await waitFor(() => expect(mockSetSection).toHaveBeenCalledWith({ currentSection: Sections.FAIL_TX }));
    expect(mockSetMidgardHealthDegraded).not.toHaveBeenCalled();
    expect(mockSetBuiltTxData).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Local signing failed'
        })
      })
    );
  });

  test('degrades Midgard health when the backend submit path fails', async () => {
    mockSubmitMidgardTx.mockRejectedValue(new Error('HTTP 503'));

    const { getByTestId } = render(<Footer />);

    fireEvent.click(getByTestId('send-next-btn'));

    await waitFor(() => expect(mockSetMidgardHealthDegraded).toHaveBeenCalledWith('HTTP 503'));
    expect(mockSetSection).toHaveBeenCalledWith({ currentSection: Sections.FAIL_TX });
  });

  test('blocks Midgard send before confirmation for hardware-backed wallets', () => {
    mockUseSections.mockReturnValue({
      currentSection: {
        currentSection: Sections.FORM
      },
      setSection: mockSetSection
    });
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        isInMemoryWallet: false,
        walletType: 'Ledger'
      })
    );

    const { getByTestId } = render(<Footer />);

    expect(getByTestId('send-next-btn')).toBeDisabled();
    expect(getByTestId('send-next-btn')).toHaveTextContent('Midgard send unavailable');
    expect(getByTestId('midgard-send-switching-hint')).toHaveTextContent(
      'Midgard send currently supports password wallets only.'
    );
  });
});
