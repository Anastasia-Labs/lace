/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/react';
import { Assets } from '../Assets';

const mockOpenTransactionDrawer = jest.fn();
const mockRedirectToSend = jest.fn();
const mockSendEventToPostHog = jest.fn();
const mockResetActivityState = jest.fn();
const mockSetAssetDetails = jest.fn();
const mockGetHiddenBalancePlaceholder = jest.fn().mockReturnValue('***');
const mockSetPickedCoin = jest.fn();
const mockSetTriggerPoint = jest.fn();
const mockUseObservable = jest.fn();
const mockUseWalletStore = jest.fn();

const assetInfo$ = {};
const total$ = {};
const rewards$ = {};
const stableAssetInfo = new Map();
const stableUtxoTotal = { coins: BigInt(0), assets: new Map() };
const stablePriceResult = {
  cardano: {
    price: 1,
    getTokenPrice: jest.fn()
  },
  tokens: new Map()
};
const stableBalance = {
  total: {
    fiatBalance: '0'
  }
};
const stableFiatCurrency = {
  code: 'USD'
};
let currentWalletStore: any;

jest.mock('@src/stores', () => ({
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@lace/common', () => ({
  useObservable: (...args: any[]) => mockUseObservable(...args)
}));

jest.mock('@hooks', () => ({
  useBalances: () => ({
    balance: stableBalance
  }),
  useFetchCoinPrice: () => ({
    priceResult: stablePriceResult,
    status: 'success'
  }),
  useRedirection: () => (...args: any[]) => mockRedirectToSend(...args)
}));

jest.mock('@providers', () => ({
  useAnalyticsContext: () => ({
    sendEventToPostHog: (...args: any[]) => mockSendEventToPostHog(...args)
  })
}));

jest.mock('@providers/AnalyticsProvider/analyticsTracker', () => ({
  PostHogAction: {
    SendClick: 'SendClick',
    TokenTokensTokenRowClick: 'TokenTokensTokenRowClick'
  }
}));

jest.mock('@providers/currency', () => ({
  useCurrencyStore: () => ({
    fiatCurrency: stableFiatCurrency
  })
}));

jest.mock('../../../send-transaction', () => ({
  SendFlowTriggerPoints: {
    TOKENS: 'TOKENS'
  },
  useAnalyticsSendFlowTriggerPoint: () => ({
    setTriggerPoint: (...args: any[]) => mockSetTriggerPoint(...args)
  }),
  useCoinStateSelector: () => ({
    setPickedCoin: (...args: any[]) => mockSetPickedCoin(...args)
  }),
  useOpenTransactionDrawer: () => (...args: any[]) => mockOpenTransactionDrawer(...args)
}));

jest.mock('../AssetDetailsDrawer/AssetDetailsDrawer', () => ({
  AssetDetailsDrawer: ({ openSendDrawer }: { openSendDrawer: (id: string) => void }) => (
    <button type="button" onClick={() => openSendDrawer('asset-1')} data-testid="asset-details-send-trigger">
      open send
    </button>
  )
}));

jest.mock('../AssetsPortfolio/AssetsPortfolio', () => ({
  AssetsPortfolio: () => <div data-testid="assets-portfolio" />
}));

jest.mock('../AssetActivityDetails/AssetActivityDetails', () => ({
  AssetActivityDetails: () => <div data-testid="asset-activity-details" />
}));

jest.mock('../AssetEducationalList/AssetEducationalList', () => ({
  AssetEducationalList: () => <div data-testid="asset-educational-list" />
}));

jest.mock('../MidnightEventBanner', () => ({
  MidnightEventBanner: () => <div data-testid="midnight-event-banner" />
}));

jest.mock('@src/views/browser-view/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TopUpWalletCard: () => <div />
}));

jest.mock('@src/views/browser-view/components/Drawer', () => ({
  DrawerContent: {
    SEND_TRANSACTION: 'SEND_TRANSACTION'
  }
}));

jest.mock('@routes', () => ({
  walletRoutePaths: {
    send: '/send'
  }
}));

jest.mock('@src/utils/constants', () => ({
  APP_MODE_POPUP: 'popup'
}));

jest.mock('@components/Layout', () => ({
  ContentLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

jest.mock('@hooks/useIsSmallerScreenWidthThan', () => ({
  useIsSmallerScreenWidthThan: () => false
}));

jest.mock('@src/multichain', () => ({
  useCurrentBlockchain: () => ({
    blockchain: 'cardano'
  })
}));

jest.mock('@src/views/browser-view/components/TopUpWallet/config', () => ({
  USE_FOOR_TOPUP: false
}));

jest.mock('@src/styles/constants', () => ({
  BREAKPOINT_SMALL: 640
}));

jest.mock('@input-output-hk/lace-ui-toolkit', () => ({
  Flex: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: {
    Body: {
      Normal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
    },
    Label: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  }
}));

jest.mock('@src/utils/get-network-name', () => ({
  getNetworkName: () => 'Preprod'
}));

jest.mock('@lace/core', () => ({
  useItemsPageSize: () => 10
}));

jest.mock('@src/utils/assets-transformers', () => ({
  assetTransformer: ({ key }: { key: string }) => ({
    id: key
  }),
  cardanoTransformer: () => ({
    id: '1'
  })
}));

jest.mock('../../utils', () => ({
  getTotalWalletBalance: () => '0',
  sortAssets: () => 0
}));

jest.mock('@lace/cardano', () => ({
  Wallet: {
    util: {
      isNFT: () => false,
      mayBeNFT: () => false
    }
  }
}));

const makeWalletStore = (overrides = {}) =>
  ({
    inMemoryWallet: {
      assetInfo$,
      balance: {
        utxo: {
          total$
        },
        rewardAccounts: {
          rewards$
        }
      }
    },
    walletUI: {
      cardanoCoin: {
        id: '1'
      },
      appMode: 'browser',
      areBalancesVisible: true,
      getHiddenBalancePlaceholder: mockGetHiddenBalancePlaceholder
    },
    setAssetDetails: mockSetAssetDetails,
    assetDetails: undefined,
    activityDetail: undefined,
    resetActivityState: mockResetActivityState,
    blockchainProvider: {},
    environmentName: 'Preprod',
    isMidgardEnabled: true,
    midgardActivationStatus: 'idle',
    midgardHealthStatus: 'healthy',
    ...overrides
  } as any);

describe('Assets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentWalletStore = makeWalletStore();
    mockUseWalletStore.mockImplementation(() => currentWalletStore);
    mockUseObservable.mockImplementation((observable: unknown) => {
      if (observable === assetInfo$) return stableAssetInfo;
      if (observable === total$) return stableUtxoTotal;
      if (observable === rewards$) return BigInt(0);
      return undefined;
    });
  });

  test('does not open the asset send flow while Midgard send actions are blocked', () => {
    currentWalletStore = makeWalletStore({
      midgardHealthStatus: 'degraded'
    });

    const { getByTestId } = render(<Assets />);

    fireEvent.click(getByTestId('asset-details-send-trigger'));

    expect(mockOpenTransactionDrawer).not.toHaveBeenCalled();
    expect(mockRedirectToSend).not.toHaveBeenCalled();
    expect(mockSetPickedCoin).not.toHaveBeenCalled();
    expect(mockSendEventToPostHog).not.toHaveBeenCalledWith('SendClick', expect.anything());
  });
});
