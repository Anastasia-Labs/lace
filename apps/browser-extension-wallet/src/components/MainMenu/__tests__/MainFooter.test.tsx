import React from 'react';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { MainFooter } from '../MainFooter';

const mockUseWalletStore = jest.fn();

jest.mock('@stores', () => ({
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@providers', () => ({
  useAnalyticsContext: () => ({
    sendEventToPostHog: jest.fn()
  }),
  useBackgroundServiceAPIContext: () => ({
    handleOpenBrowser: jest.fn()
  })
}));

jest.mock('@providers/PostHogClientProvider', () => ({
  usePostHogClientContext: () => ({
    isFeatureFlagEnabled: jest.fn().mockReturnValue(false)
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

describe('MainFooter', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockUseWalletStore.mockReturnValue({
      isSharedWallet: false,
      environmentName: 'Preprod',
      isMidgardEnabled: false
    });
  });

  test('renders staking and voting actions outside Midgard mode', () => {
    const { getByTestId } = render(
      <BrowserRouter>
        <MainFooter />
      </BrowserRouter>
    );

    expect(getByTestId('main-footer-staking')).toBeInTheDocument();
    expect(getByTestId('main-footer-voting')).toBeInTheDocument();
  });

  test('hides staking and voting actions in Midgard mode', () => {
    mockUseWalletStore.mockReturnValue({
      isSharedWallet: false,
      environmentName: 'Preprod',
      isMidgardEnabled: true
    });

    const { queryByTestId } = render(
      <BrowserRouter>
        <MainFooter />
      </BrowserRouter>
    );

    expect(queryByTestId('main-footer-staking')).not.toBeInTheDocument();
    expect(queryByTestId('main-footer-voting')).not.toBeInTheDocument();
  });
});
