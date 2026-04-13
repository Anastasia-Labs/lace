/* eslint-disable @typescript-eslint/no-explicit-any, no-magic-numbers, react/no-multi-comp */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MidgardBanner } from '../MidgardBanner';

const walletAddress =
  'addr_test1qqesh8e37pm7jdjsjgjcml876lzena02uuzy48j9n0t5dxcy35e4gqn68h3lgwvfxsqclape2tsy5a42rjchpjnj6xpss0sh82';
const groupedAddress = { address: { toString: () => walletAddress }, index: 0, type: 0 };
const alternateWalletAddress =
  'addr_test1qqnspn96f53w4myg47w2jnkspn6kgfflwy9mevwcxx4g2y7g0m8hd8rskqmqs3dlfdsdmej8ef2khf9h9m56qkzngpms0sdy8v';
const groupedAlternateAddress = { address: { toString: () => alternateWalletAddress }, index: 0, type: 0 };
const ADA_VALUE_PATTERN = /^\d+(?:\.\d+)?$/;
const ADA_LOVELACE_FACTOR = BigInt(1_000_000);

const mockAddMidgardPendingDeposit = jest.fn();
const mockBuildMidgardDeposit = jest.fn();
const mockGetMidgardDepositFundingSummary = jest.fn();
const mockGetMidgardUrl = jest.fn();
const mockSignExternalCardanoTx = jest.fn();
const mockSetMidgardHealthDegraded = jest.fn();
const mockSetMidgardHealthHealthy = jest.fn();
const mockSetMidgardMode = jest.fn();
const mockSetMidgardModeAndReload = jest.fn();
const mockSubmitSignedCardanoTx = jest.fn();
const mockToastNotify = jest.fn();
const mockUseObservable = jest.fn();
const mockUseWalletStore = jest.fn();
const mockWithSignTxConfirmation = jest.fn();

jest.mock('@src/stores', () => ({
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@hooks', () => ({
  useWalletManager: () => ({
    setMidgardModeAndReload: (...args: any[]) => mockSetMidgardModeAndReload(...args)
  })
}));

jest.mock('@src/config', () => ({
  config: () => ({
    MIDGARD_URLS: {
      Mainnet: '',
      Preprod: 'http://midgard.local',
      Preview: '',
      Sanchonet: ''
    }
  })
}));

jest.mock('@src/utils/midgard-url', () => ({
  MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY: 'midgardLastCardanoAvailableLovelace',
  getMidgardUrl: (...args: any[]) => mockGetMidgardUrl(...args),
  parseStoredLovelace: (value?: string | null) => {
    if (!value || !/^\d+$/.test(value)) return undefined;
    return BigInt(value);
  }
}));

jest.mock('@lace/common', () => ({
  useObservable: (...args: any[]) => mockUseObservable(...args),
  toast: {
    notify: (...args: any[]) => mockToastNotify(...args)
  },
  Button: ({ children, onClick, disabled, className, 'data-testid': dataTestId }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className} data-testid={dataTestId}>
      {children}
    </button>
  ),
  Drawer: ({ visible, children, footer, title, navigation }: any) =>
    visible ? (
      <div data-testid="midgard-deposit-drawer">
        {navigation}
        {title}
        {children}
        {footer}
      </div>
    ) : (
      <></>
    ),
  DrawerHeader: ({ title, subtitle }: any) => (
    <div>
      <div>{title}</div>
      <div>{subtitle}</div>
    </div>
  ),
  DrawerNavigation: ({ title, onCloseIconClick }: any) => (
    <div>
      <div>{title}</div>
      <button type="button" onClick={onCloseIconClick} data-testid="midgard-deposit-close-button">
        Close
      </button>
    </div>
  )
}));

jest.mock('antd', () => ({
  Input: ({ value, onChange, placeholder, disabled, type, 'data-testid': dataTestId }: any) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      type={type}
      data-testid={dataTestId}
    />
  ),
  Switch: ({ checked, 'data-testid': dataTestId }: any) => (
    <input type="checkbox" checked={checked} readOnly data-testid={dataTestId} />
  )
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value
  })
}));

jest.mock('@lib/wallet-api-ui', () => ({
  withSignTxConfirmation: (...args: any[]) => mockWithSignTxConfirmation(...args)
}));

jest.mock('@lib/sign-external-cardano-tx', () => ({
  signExternalCardanoTx: (...args: any[]) => mockSignExternalCardanoTx(...args)
}));

jest.mock('../deposit', () => ({
  buildMidgardDeposit: (...args: any[]) => mockBuildMidgardDeposit(...args),
  getMidgardDepositFundingSummary: (...args: any[]) => mockGetMidgardDepositFundingSummary(...args),
  submitSignedCardanoTx: (...args: any[]) => mockSubmitSignedCardanoTx(...args)
}));

jest.mock('@lace/core', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');

  return {
    Password: ({ onChange, dataTestId, disabled }: any) => (
      <input
        type="password"
        data-testid={dataTestId}
        disabled={disabled}
        onChange={(event) => onChange({ value: event.target.value })}
      />
    ),
    useSecrets: () => {
      const [password, setPassword] = ReactModule.useState({ value: '' });
      return {
        password,
        setPassword,
        clearSecrets: () => setPassword({ value: '' })
      };
    }
  };
});

jest.mock('@lace/cardano', () => {
  class AuthenticationError extends Error {}

  return {
    Wallet: {
      util: {
        adaToLovelacesString: (value: string) => {
          const normalized = String(value).trim();
          if (!ADA_VALUE_PATTERN.test(normalized)) throw new Error('Invalid ADA value');
          const [whole, fraction = ''] = normalized.split('.');
          const paddedFraction = `${fraction}000000`.slice(0, 6);
          return (BigInt(whole || '0') * ADA_LOVELACE_FACTOR + BigInt(paddedFraction || '0')).toString();
        },
        lovelacesToAdaString: (value: string) => {
          const amount = BigInt(value || '0');
          const whole = amount / ADA_LOVELACE_FACTOR;
          const fraction = (amount % ADA_LOVELACE_FACTOR).toString().padStart(6, '0').replace(/0+$/, '');
          return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
        }
      },
      Serialization: {
        TxCBOR: (value: string) => value
      },
      KeyManagement: {
        errors: {
          AuthenticationError
        }
      }
    }
  };
});

const makeWalletStore = (overrides = {}) =>
  ({
    environmentName: 'Preprod',
    isMidgardEnabled: true,
    midgardTargetEnabled: undefined,
    midgardActivationStatus: 'idle',
    midgardActivationError: undefined,
    midgardHealthStatus: 'healthy',
    midgardHealthError: undefined,
    setMidgardHealthHealthy: mockSetMidgardHealthHealthy,
    setMidgardHealthDegraded: mockSetMidgardHealthDegraded,
    isInMemoryWallet: true,
    isSharedWallet: false,
    addMidgardPendingDeposit: mockAddMidgardPendingDeposit,
    setMidgardMode: mockSetMidgardMode,
    currentChain: {
      networkId: 0,
      networkMagic: 1
    },
    blockchainProvider: {
      txSubmitProvider: {
        healthCheck: jest.fn().mockResolvedValue({ ok: true })
      },
      chainHistoryProvider: {
        healthCheck: jest.fn().mockResolvedValue({ ok: true })
      }
    },
    walletInfo: {
      addresses: [groupedAddress]
    },
    cardanoWallet: {
      source: {
      account: {
        accountIndex: 0,
        purpose: 0
      },
      wallet: {
        walletId: 'wallet-1',
        type: 'InMemory'
      }
    }
  },
    walletUI: {
      appMode: 'browser'
    },
    inMemoryWallet: {
      balance: {
        utxo: {
          available$: {}
        }
      }
    },
    ...overrides
  } as any);

describe('MidgardBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    global.chrome = {
      storage: {
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      }
    } as unknown as typeof chrome;
    mockUseObservable.mockReturnValue({ coins: BigInt(8_000_000) });
    mockUseWalletStore.mockReturnValue(makeWalletStore());
    mockSetMidgardModeAndReload.mockResolvedValue(true);
    mockBuildMidgardDeposit.mockResolvedValue({ unsignedTxCbor: 'unsigned-tx-cbor' });
    mockGetMidgardDepositFundingSummary.mockResolvedValue({
      fundingAddressCount: 1,
      maxSingleAddress: walletAddress,
      maxSingleAddressCoins: BigInt(8_000_000),
      totalAvailableCoins: BigInt(8_000_000)
    });
    mockGetMidgardUrl.mockResolvedValue('http://midgard.local');
    mockSignExternalCardanoTx.mockResolvedValue('signed-tx-cbor');
    mockWithSignTxConfirmation.mockImplementation(async (action: () => Promise<string>) => await action());
    mockSubmitSignedCardanoTx.mockResolvedValue('abc12345deadbeef');
  });

  test('does not render outside Preprod', async () => {
    mockUseWalletStore.mockReturnValue(makeWalletStore({ environmentName: 'Preview', isMidgardEnabled: false }));
    const { queryByTestId } = render(<MidgardBanner />);

    expect(queryByTestId('midgard-mode-toggle')).not.toBeInTheDocument();
  });

  test('toggles Midgard mode and notifies user', async () => {
    mockUseWalletStore.mockReturnValue(makeWalletStore({ isMidgardEnabled: false }));
    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-mode-toggle')).toBeInTheDocument());

    fireEvent.keyDown(getByTestId('midgard-mode-toggle'), { key: 'Enter' });

    expect(mockSetMidgardModeAndReload).toHaveBeenCalledWith(true);

    return waitFor(() =>
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Midgard Layer 2 enabled'
        })
      )
    );
  });

  test('requires a password before confirming an in-memory-wallet deposit', async () => {
    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });

    expect(getByTestId('midgard-deposit-confirm-button')).toBeDisabled();
  });

  test('shows a switching state panel and locks actions while Midgard providers reload', async () => {
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        isMidgardEnabled: true,
        midgardTargetEnabled: true,
        midgardActivationStatus: 'switching'
      })
    );

    const { getByTestId, getByText, getAllByText } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-mode-state-panel')).toBeInTheDocument());

    expect(getByTestId('midgard-mode-state-panel')).toBeInTheDocument();
    expect(getByTestId('midgard-mode-toggle')).toHaveAttribute('role', 'switch');
    expect(getByTestId('midgard-mode-toggle')).toHaveAttribute('aria-busy', 'true');
    expect(getByTestId('midgard-mode-live-region')).toHaveTextContent('Preparing Midgard providers');
    expect(getByText('Preparing Midgard providers')).toBeInTheDocument();
    expect(getAllByText(/send is locked until lace finishes loading midgard-backed utxos/i)).toHaveLength(2);
    expect(getByTestId('midgard-deposit-action-button')).toBeDisabled();
  });

  test('shows the last activation error inline without changing the effective mode', async () => {
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        isMidgardEnabled: false,
        midgardActivationStatus: 'error',
        midgardActivationError: 'Timed out waiting for Midgard wallet providers to become active'
      })
    );

    const { getByTestId, getByText } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-mode-state-panel')).toBeInTheDocument());

    expect(getByTestId('midgard-mode-state-panel')).toBeInTheDocument();
    expect(getByText('Mode switch failed')).toBeInTheDocument();
    expect(getByText('Timed out waiting for Midgard wallet providers to become active')).toBeInTheDocument();
  });

  test('shows degraded Midgard state and pauses deposit actions until health recovers', async () => {
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        isMidgardEnabled: true,
        midgardHealthStatus: 'degraded',
        midgardHealthError: 'Midgard health check failed'
      })
    );

    const { getByTestId, getByText } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-mode-state-panel')).toBeInTheDocument());

    expect(getByTestId('midgard-mode-state-panel')).toBeInTheDocument();
    expect(getByText('Midgard connection degraded')).toBeInTheDocument();
    expect(getByText('Midgard health check failed')).toBeInTheDocument();
    expect(getByTestId('midgard-deposit-action-button')).toBeDisabled();
  });

  test('submits deposit through Midgard build and Cardano L1 submit', async () => {
    const { getByTestId, queryByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(mockGetMidgardDepositFundingSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });
    fireEvent.click(getByTestId('midgard-deposit-confirm-button'));

    await waitFor(() => expect(mockBuildMidgardDeposit).toHaveBeenCalledTimes(1));
    expect(mockBuildMidgardDeposit).toHaveBeenCalledWith({
      amount: BigInt(1_500_000),
      chainName: 'Preprod',
      fundingAddresses: [walletAddress],
      l2Address: walletAddress,
      midgardUrl: 'http://midgard.local'
    });

    await waitFor(() => expect(mockWithSignTxConfirmation).toHaveBeenCalledTimes(1));
    expect(mockWithSignTxConfirmation).toHaveBeenCalledWith(expect.any(Function), 'secret-password');
    expect(mockSignExternalCardanoTx).toHaveBeenCalledWith(
      expect.objectContaining({
        chainName: 'Preprod',
        knownAddresses: [groupedAddress],
        requestContext: {
          accountIndex: 0,
          chainId: {
            networkId: 0,
            networkMagic: 1
          },
          purpose: 0,
          wallet: {
            walletId: 'wallet-1',
            type: 'InMemory'
          }
        },
        txCbor: 'unsigned-tx-cbor'
      })
    );

    await waitFor(() =>
      expect(mockSubmitSignedCardanoTx).toHaveBeenCalledWith({
        chainName: 'Preprod',
        signedTxCbor: 'signed-tx-cbor'
      })
    );
    expect(mockAddMidgardPendingDeposit).toHaveBeenCalledWith({
      txId: 'abc12345deadbeef',
      txCbor: 'signed-tx-cbor',
      address: walletAddress,
      createdAt: expect.any(String)
    });

    expect(mockToastNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(/deposit submitted on cardano/i)
      })
    );
    await waitFor(() => expect(queryByTestId('midgard-deposit-drawer')).not.toBeInTheDocument());
  });

  test('does not use wallet addSignatures for Midgard deposits', async () => {
    const addSignatures = jest.fn();
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        inMemoryWallet: {
          addSignatures,
          balance: {
            utxo: {
              available$: {}
            }
          }
        }
      })
    );

    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(mockGetMidgardDepositFundingSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });
    fireEvent.click(getByTestId('midgard-deposit-confirm-button'));

    await waitFor(() => expect(mockSignExternalCardanoTx).toHaveBeenCalledTimes(1));
    expect(addSignatures).not.toHaveBeenCalled();
  });

  test('prefers runtime Midgard URL override for deposit requests', async () => {
    mockGetMidgardUrl.mockResolvedValue('http://override.midgard');
    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(mockGetMidgardDepositFundingSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });
    fireEvent.click(getByTestId('midgard-deposit-confirm-button'));

    await waitFor(() => expect(mockBuildMidgardDeposit).toHaveBeenCalledTimes(1));

    expect(mockBuildMidgardDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        midgardUrl: 'http://override.midgard'
      })
    );
  });

  test('ignores the removed global Cardano balance cache key', async () => {
    window.localStorage.setItem('midgardLastCardanoAvailableLovelace', '5000000');
    mockUseObservable.mockReturnValue({ coins: BigInt(0) });
    mockGetMidgardDepositFundingSummary.mockResolvedValue({
      fundingAddressCount: 1,
      maxSingleAddress: walletAddress,
      maxSingleAddressCoins: BigInt(0),
      totalAvailableCoins: BigInt(0)
    });

    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(window.localStorage.getItem('midgardLastCardanoAvailableLovelace')).toBeNull());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(mockGetMidgardDepositFundingSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });

    expect(getByTestId('midgard-deposit-confirm-button')).toBeDisabled();
  });

  test('reuses the scoped Cardano balance cache for the same wallet after switching into Midgard', async () => {
    mockUseWalletStore.mockReturnValue(makeWalletStore({ isMidgardEnabled: false }));
    const initialRender = render(<MidgardBanner />);

    initialRender.unmount();

    mockUseObservable.mockReturnValue({ coins: BigInt(0) });
    mockUseWalletStore.mockReturnValue(makeWalletStore({ isMidgardEnabled: true }));
    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(mockGetMidgardDepositFundingSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });

    expect(getByTestId('midgard-deposit-confirm-button')).not.toBeDisabled();
  });

  test('does not leak the scoped Cardano balance cache across wallet scopes', async () => {
    mockUseWalletStore.mockReturnValue(makeWalletStore({ isMidgardEnabled: false }));
    const initialRender = render(<MidgardBanner />);

    initialRender.unmount();

    mockUseObservable.mockReturnValue({ coins: BigInt(0) });
    mockGetMidgardDepositFundingSummary.mockResolvedValue({
      fundingAddressCount: 1,
      maxSingleAddress: alternateWalletAddress,
      maxSingleAddressCoins: BigInt(0),
      totalAvailableCoins: BigInt(0)
    });
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        isMidgardEnabled: true,
        walletInfo: {
          addresses: [groupedAlternateAddress]
        },
        cardanoWallet: {
          source: {
            account: {
              accountIndex: 0,
              purpose: 0
            },
            wallet: {
              walletId: 'wallet-2',
              type: 'InMemory'
            }
          }
        }
      })
    );
    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(mockGetMidgardDepositFundingSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });

    expect(getByTestId('midgard-deposit-confirm-button')).toBeDisabled();
  });

  test('uses the aggregate Cardano funding summary for deposit validation and Max', async () => {
    mockGetMidgardDepositFundingSummary.mockResolvedValue({
      fundingAddressCount: 2,
      maxSingleAddress: groupedAlternateAddress.address.toString(),
      maxSingleAddressCoins: BigInt(1_000_000),
      totalAvailableCoins: BigInt(8_000_000)
    });

    const { getByTestId, getByText } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-deposit-action-button')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-action-button'));
    await waitFor(() => expect(getByText('8 ADA depositable now')).toBeInTheDocument());

    fireEvent.click(getByTestId('midgard-deposit-max-button'));
    expect(getByTestId('midgard-deposit-amount-input')).toHaveValue('8');

    fireEvent.change(getByTestId('midgard-deposit-amount-input'), { target: { value: '1.5' } });
    fireEvent.change(getByTestId('midgard-deposit-password-input'), { target: { value: 'secret-password' } });
    expect(getByTestId('midgard-deposit-confirm-button')).not.toBeDisabled();
  });

  test('disables withdrawal until it is wired to a real endpoint', async () => {
    const { getByTestId } = render(<MidgardBanner />);
    await waitFor(() => expect(getByTestId('midgard-withdraw-action-button')).toBeInTheDocument());

    expect(getByTestId('midgard-withdraw-action-button')).toBeDisabled();
  });
});
