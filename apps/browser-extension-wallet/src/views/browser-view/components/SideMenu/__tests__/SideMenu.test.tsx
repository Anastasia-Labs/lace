import * as React from 'react';
import { Wallet } from '@lace/cardano';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { i18n } from '../../../../../lib/i18n';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Switch, Route } from 'react-router-dom';
import { SideMenu } from '../SideMenu';
import { mockKeyAgentDataTestnet, mockWalletInfoTestnet, postHogClientMocks } from '@src/utils/mocks/test-helpers';

const mockUseWalletStore = jest.fn();

jest.mock('../../../../../stores', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...jest.requireActual<any>('../../../../../stores'),
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@providers/PostHogClientProvider', () => ({
  usePostHogClientContext: () => postHogClientMocks
}));

jest.mock('@providers', () => ({
  useAnalyticsContext: () => ({
    sendEventToPostHog: jest.fn()
  })
}));

jest.mock('@providers/AnalyticsProvider/analyticsTracker', () => ({
  PostHogAction: {
    TokenTokensClick: 'TokenTokensClick',
    StakingClick: 'StakingClick',
    ActivityActivityClick: 'ActivityActivityClick',
    VotingClick: 'VotingClick',
    NFTsClick: 'NFTsClick'
  }
}));

jest.mock('@src/config', () => ({
  config: () => ({
    GOV_TOOLS_URLS: {
      Preprod: 'https://gov.example.test'
    }
  })
}));

describe('Testing SideMenu component', () => {
  beforeEach(() => {
    process.env.DEFAULT_CHAIN = 'Preprod';
    jest.resetAllMocks();
    mockUseWalletStore.mockReturnValue({
      currentChain: Wallet.Cardano.ChainIds.Preprod,
      walletInfo: mockWalletInfoTestnet,
      keyAgentData: mockKeyAgentDataTestnet,
      environmentName: 'Preprod',
      isSharedWallet: false,
      isMidgardEnabled: false
    });
  });

  const TestSideMenu = () => (
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <SideMenu />
        <Switch>
          <Route path="/" component={() => <div>main</div>} />
          <Route path="/crypto/dashboard" component={() => <div>crypto-dashboard</div>} />
          <Route path="/address-book" component={() => <div>address-book</div>} />
          <Route path="/activity" component={() => <div>activity</div>} />
        </Switch>
      </BrowserRouter>
    </I18nextProvider>
  );

  test('should render side menu', async () => {
    const { findByTestId } = render(<TestSideMenu />);
    await findByTestId('side-menu');

    expect(await findByTestId('item-transactions')).toBeInTheDocument();
    expect(await findByTestId('item-staking')).toBeInTheDocument();
    expect(await findByTestId('item-nfts')).toBeInTheDocument();
    expect(await findByTestId('item-assets')).toBeInTheDocument();
    expect(await findByTestId('item-voting')).toBeInTheDocument();
  });

  test('hides staking and voting menu items in Midgard mode', async () => {
    mockUseWalletStore.mockReturnValue({
      currentChain: Wallet.Cardano.ChainIds.Preprod,
      walletInfo: mockWalletInfoTestnet,
      keyAgentData: mockKeyAgentDataTestnet,
      environmentName: 'Preprod',
      isSharedWallet: false,
      isMidgardEnabled: true
    });

    const { findByTestId, queryByTestId } = render(<TestSideMenu />);
    await findByTestId('side-menu');

    expect(queryByTestId('item-staking')).not.toBeInTheDocument();
    expect(queryByTestId('item-voting')).not.toBeInTheDocument();
  });
});
