const mockStorageGet = jest.fn();
const mockStorageAddListener = jest.fn();

jest.mock('webextension-polyfill', () => ({
  storage: {
    local: {
      get: (...args: unknown[]) => mockStorageGet(...args)
    },
    onChanged: {
      addListener: (...args: unknown[]) => mockStorageAddListener(...args)
    }
  }
}));

jest.mock('@src/config', () => ({
  config: () => ({
    MIDGARD_URLS: {
      Preprod: 'http://configured.midgard'
    }
  })
}));

const importMidgardUrl = async () => import('../midgard-url');

describe('midgard-url utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    window.localStorage.clear();
  });

  test('prefers runtime override over configured Midgard URL', async () => {
    const { resolveMidgardUrl } = await importMidgardUrl();

    expect(
      resolveMidgardUrl({
        configuredUrl: 'http://configured.midgard',
        overrideUrl: 'http://override.midgard'
      })
    ).toBe('http://override.midgard');
  });

  test('falls back to configured Midgard URL when override is not set', async () => {
    const { resolveMidgardUrl } = await importMidgardUrl();

    expect(
      resolveMidgardUrl({
        configuredUrl: 'http://configured.midgard',
        overrideUrl: ''
      })
    ).toBe('http://configured.midgard');
  });

  test('hydrates the Midgard URL override mirror from extension storage', async () => {
    mockStorageGet.mockResolvedValue({
      midgardUrlOverride: 'http://override.midgard'
    });

    const { MIDGARD_URL_OVERRIDE_STORAGE_KEY, getMidgardUrl, getMidgardUrlOverride } = await importMidgardUrl();

    await expect(getMidgardUrlOverride()).resolves.toBe('http://override.midgard');
    expect(window.localStorage.getItem(MIDGARD_URL_OVERRIDE_STORAGE_KEY)).toBe('http://override.midgard');
    await expect(getMidgardUrl('Preprod')).resolves.toBe('http://override.midgard');
  });

  test('keeps the local mirror in sync when extension storage changes', async () => {
    mockStorageGet.mockResolvedValue({});

    const { getMidgardUrl, getMidgardUrlOverride } = await importMidgardUrl();

    await getMidgardUrlOverride();

    const listener = mockStorageAddListener.mock.calls[0][0] as (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string
    ) => void;

    listener(
      {
        midgardUrlOverride: { newValue: 'http://live-override.midgard' }
      },
      'local'
    );

    await expect(getMidgardUrl('Preprod')).resolves.toBe('http://live-override.midgard');
  });

  test('parses stored lovelace values and rejects invalid payloads', async () => {
    const { parseStoredLovelace } = await importMidgardUrl();

    expect(parseStoredLovelace('1500000')).toBe(BigInt(1_500_000));
    expect(parseStoredLovelace('')).toBeUndefined();
    expect(parseStoredLovelace('abc')).toBeUndefined();
  });

  test('exports stable storage keys used by Midgard UI/runtime override', async () => {
    const { MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY, MIDGARD_URL_OVERRIDE_STORAGE_KEY } = await importMidgardUrl();

    expect(MIDGARD_URL_OVERRIDE_STORAGE_KEY).toBe('midgardUrlOverride');
    expect(MIDGARD_LAST_CARDANO_BALANCE_STORAGE_KEY).toBe('midgardLastCardanoAvailableLovelace');
  });

  test('scopes the cached Cardano balance key by chain and address', async () => {
    const { getMidgardLastCardanoBalanceStorageKey } = await importMidgardUrl();

    expect(
      getMidgardLastCardanoBalanceStorageKey({
        activeAddress: 'addr_test1...',
        environmentName: 'Preprod'
      })
    ).toBe('midgardLastCardanoAvailableLovelace:Preprod:addr_test1...');
  });
});
