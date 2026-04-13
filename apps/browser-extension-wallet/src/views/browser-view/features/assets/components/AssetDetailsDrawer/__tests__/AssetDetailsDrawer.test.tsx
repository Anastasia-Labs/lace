/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/react';
import { AssetDetailsDrawer } from '../AssetDetailsDrawer';

const mockSendEventToPostHog = jest.fn();
const mockSetAssetDetails = jest.fn();
const mockUseWalletStore = jest.fn();

jest.mock('@src/stores', () => ({
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@providers', () => ({
  useAnalyticsContext: () => ({
    sendEventToPostHog: (...args: any[]) => mockSendEventToPostHog(...args)
  })
}));

jest.mock('@providers/AnalyticsProvider/analyticsTracker', () => ({
  PostHogAction: {
    TokenTokenDetailXClick: 'TokenTokenDetailXClick'
  }
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value
  })
}));

jest.mock('@lace/common', () => ({
  Button: ({ children, disabled, onClick, 'data-testid': dataTestId }: any) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={dataTestId}>
      {children}
    </button>
  ),
  Drawer: ({ children, footer, navigation, open }: any) =>
    open ? (
      <div>
        {navigation}
        {children}
        {footer}
      </div>
    ) : (
      <></>
    ),
  DrawerNavigation: ({ title, onCloseIconClick }: any) => (
    <div>
      <span>{title}</span>
      <button type="button" onClick={onCloseIconClick}>
        Close
      </button>
    </div>
  )
}));

jest.mock('../AssetDetailsContainer', () => ({
  ASSET_DRAWER_BODY_ID: 'asset-details-body',
  AssetDetailsContainer: () => <div data-testid="asset-details-container" />
}));

jest.mock('../AssetDrawerTitle', () => ({
  AssetDrawerTitle: ({ title }: { title?: string }) => <div>{title}</div>
}));

const makeWalletStore = (overrides = {}) =>
  ({
    blockchainProvider: {},
    assetDetails: {
      id: 'asset-1',
      name: 'Asset One',
      ticker: 'AST'
    },
    setAssetDetails: mockSetAssetDetails,
    isInMemoryWallet: true,
    isMidgardEnabled: true,
    midgardActivationStatus: 'idle',
    midgardHealthStatus: 'healthy',
    isSharedWallet: false,
    ...overrides
  } as any);

describe('AssetDetailsDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWalletStore.mockReturnValue(makeWalletStore());
  });

  test('disables asset send while Midgard providers are switching and explains why', () => {
    mockUseWalletStore.mockReturnValue(
      makeWalletStore({
        midgardActivationStatus: 'switching'
      })
    );

    const openSendDrawer = jest.fn();
    const { getByRole, getByTestId } = render(
      <AssetDetailsDrawer
        fiatCode="USD"
        openSendDrawer={openSendDrawer}
        popupView={false}
        isBalanceDataFetchedCorrectly
      />
    );

    expect(getByRole('button', { name: 'browserView.assets.send' })).toBeDisabled();
    expect(getByTestId('asset-details-send-status')).toHaveTextContent(
      'Lace is still reloading the active wallet providers. Send will unlock automatically when Midgard is ready.'
    );
    fireEvent.click(getByRole('button', { name: 'browserView.assets.send' }));
    expect(openSendDrawer).not.toHaveBeenCalled();
  });

  test('opens the send drawer for the selected asset when send is available', () => {
    const openSendDrawer = jest.fn();
    const { getByRole, queryByTestId } = render(
      <AssetDetailsDrawer
        fiatCode="USD"
        openSendDrawer={openSendDrawer}
        popupView={false}
        isBalanceDataFetchedCorrectly
      />
    );

    expect(queryByTestId('asset-details-send-status')).not.toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'browserView.assets.send' }));

    expect(openSendDrawer).toHaveBeenCalledWith('asset-1');
  });
});
