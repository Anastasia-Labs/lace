import { renderHook, act } from '@testing-library/react-hooks';
import { waitFor } from '@testing-library/react';
import * as stores from '@src/stores';
import * as walletManagerModule from '../useWalletManager';
import { useMidgardRefresh } from '../useMidgardRefresh';
import { mockBlockchainProviders } from '@src/utils/mocks/blockchain-providers';
import { mockWalletState } from '@src/utils/mocks/test-helpers';

jest.mock('@src/stores');
jest.mock('../useWalletManager');

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('useMidgardRefresh', () => {
  let chromeStorageGetMock: jest.Mock;
  let addStorageListenerMock: jest.Mock;
  let removeStorageListenerMock: jest.Mock;
  let storageListener: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | undefined;
  let reloadWallet: jest.Mock;
  let storeState: ReturnType<typeof createStoreState>;

  const createStoreState = (overrides: Record<string, unknown> = {}) => ({
    cardanoWallet: { name: 'test-wallet' },
    walletState: mockWalletState,
    isMidgardEnabled: false,
    midgardActivationStatus: 'idle',
    midgardTargetEnabled: undefined as boolean | undefined,
    blockchainProvider: {
      ...mockBlockchainProviders(),
      txSubmitProvider: {
        ...mockBlockchainProviders().txSubmitProvider,
        healthCheck: jest.fn().mockResolvedValue({ ok: true })
      },
      chainHistoryProvider: {
        ...mockBlockchainProviders().chainHistoryProvider,
        healthCheck: jest.fn().mockResolvedValue({ ok: true })
      }
    },
    setMidgardMode: jest.fn(),
    startMidgardModeSwitch: jest.fn(),
    failMidgardModeSwitch: jest.fn(),
    clearMidgardModeError: jest.fn(),
    setMidgardHealthHealthy: jest.fn(),
    setMidgardHealthDegraded: jest.fn(),
    resetMidgardHealth: jest.fn(),
    ...overrides
  });

  beforeEach(() => {
    storageListener = undefined;
    chromeStorageGetMock = jest.fn();
    addStorageListenerMock = jest.fn((listener) => {
      storageListener = listener;
    });
    removeStorageListenerMock = jest.fn((listener) => {
      if (storageListener === listener) {
        storageListener = undefined;
      }
    });
    reloadWallet = jest.fn().mockResolvedValue(undefined);
    storeState = createStoreState();

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: chromeStorageGetMock
          },
          onChanged: {
            addListener: addStorageListenerMock,
            removeListener: removeStorageListenerMock
          }
        }
      }
    });

    jest.spyOn(stores, 'useWalletStore').mockImplementation(() => storeState as never);
    jest.spyOn(walletManagerModule, 'useWalletManager').mockReturnValue({
      reloadWallet
    } as never);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('keeps the switching state until the wallet is ready during bootstrap sync', async () => {
    chromeStorageGetMock.mockResolvedValue({ midgardEnabled: true });
    storeState = createStoreState({
      walletState: null,
      isMidgardEnabled: false,
      midgardActivationStatus: 'idle'
    });

    const { rerender } = renderHook(() => useMidgardRefresh());

    await waitFor(() => expect(storeState.startMidgardModeSwitch).toHaveBeenCalledWith(true));
    expect(storeState.setMidgardMode).not.toHaveBeenCalled();

    storeState = createStoreState({
      walletState: mockWalletState,
      isMidgardEnabled: false,
      midgardActivationStatus: 'switching',
      setMidgardMode: storeState.setMidgardMode,
      startMidgardModeSwitch: storeState.startMidgardModeSwitch,
      failMidgardModeSwitch: storeState.failMidgardModeSwitch,
      clearMidgardModeError: storeState.clearMidgardModeError,
      setMidgardHealthHealthy: storeState.setMidgardHealthHealthy,
      setMidgardHealthDegraded: storeState.setMidgardHealthDegraded,
      resetMidgardHealth: storeState.resetMidgardHealth
    });

    rerender();

    await waitFor(() => expect(storeState.setMidgardMode).toHaveBeenCalledWith(true));
  });

  test('does not let bootstrap sync clear a different in-flight Midgard transition', async () => {
    chromeStorageGetMock.mockResolvedValue({ midgardEnabled: false });
    storeState = createStoreState({
      isMidgardEnabled: false,
      midgardActivationStatus: 'switching',
      midgardTargetEnabled: true
    });

    renderHook(() => useMidgardRefresh());

    await waitFor(() => expect(chromeStorageGetMock).toHaveBeenCalledWith('midgardEnabled'));
    expect(storeState.setMidgardMode).not.toHaveBeenCalled();
    expect(storeState.startMidgardModeSwitch).not.toHaveBeenCalled();
  });

  test('waits for wallet readiness before completing a storage-driven Midgard switch', async () => {
    chromeStorageGetMock.mockResolvedValue({ midgardEnabled: false });

    const { rerender } = renderHook(() => useMidgardRefresh());
    await waitFor(() => expect(storeState.setMidgardMode).toHaveBeenCalledWith(false));

    jest.clearAllMocks();

    const reloadDeferred = createDeferred<void>();
    reloadWallet.mockReturnValueOnce(reloadDeferred.promise);

    act(() => {
      storageListener?.({
        midgardEnabled: {
          oldValue: false,
          newValue: true
        } as chrome.storage.StorageChange
      });
    });

    await waitFor(() => expect(storeState.startMidgardModeSwitch).toHaveBeenCalledWith(true));

    storeState = createStoreState({
      walletState: null,
      isMidgardEnabled: false,
      midgardActivationStatus: 'switching',
      setMidgardMode: storeState.setMidgardMode,
      startMidgardModeSwitch: storeState.startMidgardModeSwitch,
      failMidgardModeSwitch: storeState.failMidgardModeSwitch,
      clearMidgardModeError: storeState.clearMidgardModeError,
      setMidgardHealthHealthy: storeState.setMidgardHealthHealthy,
      setMidgardHealthDegraded: storeState.setMidgardHealthDegraded,
      resetMidgardHealth: storeState.resetMidgardHealth
    });
    rerender();

    reloadDeferred.resolve(undefined);
    await act(async () => {
      await reloadDeferred.promise;
    });

    expect(storeState.setMidgardMode).not.toHaveBeenCalled();

    storeState = createStoreState({
      walletState: mockWalletState,
      isMidgardEnabled: false,
      midgardActivationStatus: 'switching',
      setMidgardMode: storeState.setMidgardMode,
      startMidgardModeSwitch: storeState.startMidgardModeSwitch,
      failMidgardModeSwitch: storeState.failMidgardModeSwitch,
      clearMidgardModeError: storeState.clearMidgardModeError,
      setMidgardHealthHealthy: storeState.setMidgardHealthHealthy,
      setMidgardHealthDegraded: storeState.setMidgardHealthDegraded,
      resetMidgardHealth: storeState.resetMidgardHealth
    });
    rerender();

    await waitFor(() => expect(storeState.setMidgardMode).toHaveBeenCalledWith(true));
  });

  test('routes Midgard URL override reload failures through the switching error path', async () => {
    chromeStorageGetMock.mockResolvedValue({ midgardEnabled: true });
    storeState = createStoreState({
      isMidgardEnabled: true
    });

    renderHook(() => useMidgardRefresh());
    await waitFor(() => expect(storeState.setMidgardMode).toHaveBeenCalledWith(true));

    jest.clearAllMocks();
    reloadWallet.mockRejectedValueOnce(new Error('reload failed'));

    act(() => {
      storageListener?.({
        midgardUrlOverride: {
          oldValue: 'http://old.midgard',
          newValue: 'http://new.midgard'
        } as chrome.storage.StorageChange
      });
    });

    await waitFor(() => expect(storeState.startMidgardModeSwitch).toHaveBeenCalledWith(true));
    await waitFor(() => expect(storeState.failMidgardModeSwitch).toHaveBeenCalledWith('Error: reload failed'));
  });

  test('does not invalidate a Midgard mode transition when the URL override changes in the same storage event', async () => {
    chromeStorageGetMock.mockResolvedValue({ midgardEnabled: false });

    renderHook(() => useMidgardRefresh());
    await waitFor(() => expect(storeState.setMidgardMode).toHaveBeenCalledWith(false));

    jest.clearAllMocks();

    const reloadDeferred = createDeferred<void>();
    reloadWallet.mockReturnValueOnce(reloadDeferred.promise);

    act(() => {
      storageListener?.({
        midgardEnabled: {
          oldValue: false,
          newValue: true
        } as chrome.storage.StorageChange,
        midgardUrlOverride: {
          oldValue: 'http://old.midgard',
          newValue: 'http://new.midgard'
        } as chrome.storage.StorageChange
      });
    });

    await waitFor(() => expect(storeState.startMidgardModeSwitch).toHaveBeenCalledWith(true));

    reloadDeferred.resolve(undefined);
    await act(async () => {
      await reloadDeferred.promise;
    });

    await waitFor(() => expect(storeState.setMidgardMode).toHaveBeenCalledWith(true));
    expect(reloadWallet).toHaveBeenCalledTimes(1);
  });
});
