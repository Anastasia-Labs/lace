const mockCreateProviders = jest.fn();
const mockGetBackgroundStorage = jest.fn();
const mockGetMidgardUrlOverride = jest.fn();
const mockStorageGet = jest.fn();

jest.mock('@lace/cardano', () => ({
  Wallet: {
    createProviders: (...args: unknown[]) => mockCreateProviders(...args)
  }
}));

jest.mock('@lib/scripts/background/storage', () => ({
  getBackgroundStorage: (...args: unknown[]) => mockGetBackgroundStorage(...args)
}));

jest.mock('@src/utils/chain', () => ({
  getBaseKoraLabsUrlForChain: () => 'https://koralabs.example',
  getBaseUrlForChain: () => 'https://cardano.example',
  getMagicForChain: () => 0
}));

jest.mock('@src/config', () => ({
  config: () => ({
    BLOCKFROST_CONFIGS: {
      Preprod: {
        projectId: 'project-id'
      }
    },
    BLOCKFROST_RATE_LIMIT_CONFIG: {
      increaseAmount: 1,
      increaseInterval: 1000,
      size: 10
    },
    MIDGARD_URLS: {
      Preprod: 'https://configured.midgard'
    },
    SESSION_TIMEOUT: 1000
  })
}));

jest.mock('@src/utils/midgard-url', () => ({
  getMidgardUrlOverride: (...args: unknown[]) => mockGetMidgardUrlOverride(...args),
  resolveMidgardUrl: ({ configuredUrl, overrideUrl }: { configuredUrl?: string; overrideUrl?: string }) =>
    overrideUrl || configuredUrl
}));

jest.mock('webextension-polyfill', () => ({
  storage: {
    local: {
      get: (...args: unknown[]) => mockStorageGet(...args)
    }
  }
}));

import { clearProviderCache, getProviders } from '../config';

describe('background getProviders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearProviderCache();
    mockCreateProviders.mockResolvedValue({ id: Symbol('providers') });
    mockGetBackgroundStorage.mockResolvedValue({
      customSubmitTxUrl: 'https://submit-a.example',
      featureFlags: {}
    });
    mockGetMidgardUrlOverride.mockResolvedValue('https://override.midgard');
    mockStorageGet.mockResolvedValue({});
  });

  test('invalidates the provider cache when custom submit URL changes', async () => {
    await getProviders('Preprod' as never, { forceMidgardEnabled: false });

    mockGetBackgroundStorage.mockResolvedValue({
      customSubmitTxUrl: 'https://submit-b.example',
      featureFlags: {}
    });

    await getProviders('Preprod' as never, { forceMidgardEnabled: false });

    expect(mockCreateProviders).toHaveBeenCalledTimes(2);
    expect(mockCreateProviders.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          customSubmitTxUrl: 'https://submit-b.example'
        })
      })
    );
  });

  test('uses the shared Midgard override resolver when building providers', async () => {
    await getProviders('Preprod' as never, { forceMidgardEnabled: true });

    expect(mockGetMidgardUrlOverride).toHaveBeenCalledTimes(1);
    expect(mockCreateProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          midgardConfig: expect.objectContaining({
            baseUrl: 'https://override.midgard'
          })
        })
      })
    );
  });
});
