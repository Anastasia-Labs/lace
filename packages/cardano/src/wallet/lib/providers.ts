/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-new, complexity, sonarjs/cognitive-complexity */
import { Storage } from 'webextension-polyfill';
import { AxiosAdapter } from 'axios';
import { Logger } from 'ts-log';
import {
  AssetProvider,
  ChainHistoryProvider,
  DRepProvider,
  Milliseconds,
  NetworkInfoProvider,
  Provider,
  RewardAccountInfoProvider,
  RewardsProvider,
  StakePoolProvider,
  TxSubmitProvider,
  UtxoProvider
} from '@cardano-sdk/core';

import {
  CardanoWsClient,
  CreateHttpProviderConfig,
  TxSubmitApiProvider,
  BlockfrostClientConfig,
  RateLimiter,
  BlockfrostClient,
  BlockfrostAssetProvider,
  BlockfrostChainHistoryProvider,
  BlockfrostDRepProvider,
  BlockfrostUtxoProvider,
  BlockfrostRewardsProvider,
  BlockfrostTxSubmitProvider,
  BlockfrostNetworkInfoProvider,
  BlockfrostRewardAccountInfoProvider
} from '@cardano-sdk/cardano-services-client';
import { RemoteApiProperties, RemoteApiPropertyType, createPersistentCacheStorage } from '@cardano-sdk/web-extension';
import type { Cache } from '@cardano-sdk/util';
import { BlockfrostAddressDiscovery } from '@wallet/lib/blockfrost-address-discovery';
import { WalletProvidersDependencies } from './cardano-wallet';
import { BlockfrostInputResolver } from './blockfrost-input-resolver';
import { initHandleService } from './handleService';
import { initStakePoolService } from './stakePoolService';
import { ChainName } from '../types';
import { MidgardClient, MidgardUtxoProvider, MidgardInputResolver, MidgardTxSubmitProvider, MidgardChainHistoryProvider } from './midgard/providers';

const createTxSubmitProvider = (
  blockfrostClient: BlockfrostClient,
  httpProviderConfig: CreateHttpProviderConfig<Provider>,
  customSubmitTxUrl?: string,
  midgardClient?: MidgardClient
): TxSubmitProvider => {
  if (customSubmitTxUrl) {
    httpProviderConfig.logger.debug(`Using custom TxSubmit api URL ${customSubmitTxUrl}`);

    const url = new URL(customSubmitTxUrl);

    return new TxSubmitApiProvider(
      { baseUrl: url, path: url.pathname },
      { logger: httpProviderConfig.logger, adapter: httpProviderConfig.adapter }
    );
  }

  // If Midgard is enabled, use Midgard provider
  if (midgardClient) {
    httpProviderConfig.logger.debug('Using Midgard TxSubmit provider');
    return new MidgardTxSubmitProvider(midgardClient, httpProviderConfig.logger);
  }

  // Default to Blockfrost provider
  return new BlockfrostTxSubmitProvider(blockfrostClient, httpProviderConfig.logger);
};

export type AllProviders = {
  assetProvider: AssetProvider;
  networkInfoProvider: NetworkInfoProvider;
  txSubmitProvider: TxSubmitProvider;
  stakePoolProvider: StakePoolProvider;
  utxoProvider: UtxoProvider;
  chainHistoryProvider: ChainHistoryProvider;
  rewardAccountInfoProvider: RewardAccountInfoProvider;
  rewardsProvider: RewardsProvider;
  drepProvider: DRepProvider;
};

export type RateLimiterConfig = {
  size: number;
  increaseInterval: Milliseconds;
  increaseAmount: number;
};

interface ProvidersConfig {
  axiosAdapter?: AxiosAdapter;
  chainName: ChainName;
  env: {
    baseCardanoServicesUrl: string;
    baseKoraLabsServicesUrl: string;
    customSubmitTxUrl?: string;
    blockfrostConfig: BlockfrostClientConfig & { rateLimiter: RateLimiter };
    midgardConfig?: { baseUrl: string; rateLimiter: RateLimiter };
    isMidgardEnabled?: boolean;
  };
  logger: Logger;
  experiments: {
    useWebSocket?: boolean;
  };
  extensionLocalStorage: Storage.LocalStorageArea;
}

/**
 * Only one instance must be alive.
 *
 * If a new one needs to be created (ex. on network change) the previous instance needs to be closed. */
let wsProvider: CardanoWsClient;

enum CacheName {
  chainHistoryProvider = 'chain-history-provider-cache',
  handleProvider = 'handle-provider-cache',
  inputResolver = 'input-resolver-cache',
  utxoProvider = 'utxo-provider-cache'
}

// eslint-disable-next-line no-magic-numbers
const sizeOf1mb = 1024 * 1024;

// The count values have been calculated by filling the cache by impersonating a few
// rich wallets and then getting the average size of a single item per each cache collection
const cacheAssignment: Record<CacheName, { count: number; size: number }> = {
  [CacheName.chainHistoryProvider]: {
    count: 5_180_160_021,
    // eslint-disable-next-line no-magic-numbers
    size: 30 * sizeOf1mb
  },
  [CacheName.handleProvider]: {
    count: 65_529_512_340,
    // eslint-disable-next-line no-magic-numbers
    size: 30 * sizeOf1mb
  },
  [CacheName.inputResolver]: {
    count: 65_529_512_340,
    // eslint-disable-next-line no-magic-numbers
    size: 30 * sizeOf1mb
  },
  [CacheName.utxoProvider]: {
    count: 6_530_251_302,
    // eslint-disable-next-line no-magic-numbers
    size: 30 * sizeOf1mb
  }
};

export const createProviders = ({
  axiosAdapter,
  chainName,
  env: { baseCardanoServicesUrl: baseUrl, baseKoraLabsServicesUrl, customSubmitTxUrl, blockfrostConfig, midgardConfig, isMidgardEnabled },
  logger,
  experiments: { useWebSocket },
  extensionLocalStorage
}: ProvidersConfig): WalletProvidersDependencies => {

  const createCache = <T>(cacheName: CacheName): Cache<T> => createPersistentCacheStorage({
    extensionLocalStorage,
    fallbackMaxCollectionItemsGuard: cacheAssignment[cacheName].count,
    resourceName: cacheName,
    quotaInBytes: cacheAssignment[cacheName].size
  })

  const httpProviderConfig: CreateHttpProviderConfig<Provider> = { baseUrl, logger, adapter: axiosAdapter };

  const blockfrostClient = new BlockfrostClient(blockfrostConfig, {
    rateLimiter: blockfrostConfig.rateLimiter
  });

  // Create Midgard client if enabled and configured
  const midgardClient = isMidgardEnabled && midgardConfig ? new MidgardClient(midgardConfig, logger) : undefined;

  // Choose which client to use based on Midgard availability
  const isUsingMidgard = !!midgardClient;

  logger.info(`Using ${isUsingMidgard ? 'Midgard' : 'Blockfrost'} providers`);

  // Create providers using the appropriate client
  const assetProvider = new BlockfrostAssetProvider(blockfrostClient, logger);

  const networkInfoProvider = new BlockfrostNetworkInfoProvider(blockfrostClient, logger);

  // Use Midgard chain history provider if enabled, otherwise use Blockfrost
  const chainHistoryProvider = isUsingMidgard
    ? new MidgardChainHistoryProvider(
        new MidgardUtxoProvider(
          midgardClient,
          blockfrostClient,
          logger,
          createPersistentCacheStorage({
            extensionLocalStorage,
            fallbackMaxCollectionItemsGuard: cacheAssignment[CacheName.utxoProvider].count,
            resourceName: CacheName.utxoProvider,
            quotaInBytes: cacheAssignment[CacheName.utxoProvider].size
          })
        ),
        logger
      )
    : new BlockfrostChainHistoryProvider({
        client: blockfrostClient,
        cache: createCache(CacheName.chainHistoryProvider),
        networkInfoProvider,
        logger
      });

  const rewardsProvider = new BlockfrostRewardsProvider(blockfrostClient, logger);
  const stakePoolProvider = initStakePoolService({
    blockfrostClient,
    chainName,
    extensionLocalStorage,
    networkInfoProvider
  });
  const txSubmitProvider = createTxSubmitProvider(blockfrostClient, httpProviderConfig, customSubmitTxUrl, midgardClient);
  const dRepProvider = new BlockfrostDRepProvider(blockfrostClient, logger);

  const addressDiscovery = new BlockfrostAddressDiscovery(blockfrostClient, logger);

  const rewardAccountInfoProvider = new BlockfrostRewardAccountInfoProvider({
    client: blockfrostClient,
    dRepProvider,
    logger,
    stakePoolProvider
  });

  // Use Midgard input resolver if Midgard is enabled, otherwise use Blockfrost
  const inputResolver = isUsingMidgard
    ? new MidgardInputResolver({
        cache: createCache(CacheName.inputResolver),
        logger
      })
    : new BlockfrostInputResolver({
        cache: createCache(CacheName.inputResolver),
        client: blockfrostClient,
        logger
      });

  const handleProvider = initHandleService({
    adapter: axiosAdapter,
    baseKoraLabsServicesUrl,
    cache: createCache(CacheName.handleProvider)
  });

  if (useWebSocket) {
    const url = new URL(baseUrl);

    url.pathname = '/ws';
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    // On network change this logs an error line as follows but it is expected as long as this function is called twice
    // 'Async error from WebSocket client' 'not-connected'
    if (wsProvider) wsProvider.close().catch((error) => logger.warn(error, 'While closing wsProvider'));

    wsProvider = new CardanoWsClient({ chainHistoryProvider, logger }, { url });

    return {
      assetProvider,
      networkInfoProvider: wsProvider.networkInfoProvider,
      txSubmitProvider,
      stakePoolProvider,
      utxoProvider: wsProvider.utxoProvider,
      chainHistoryProvider: wsProvider.chainHistoryProvider,
      rewardAccountInfoProvider,
      rewardsProvider,
      handleProvider,
      wsProvider,
      addressDiscovery,
      inputResolver,
      drepProvider: dRepProvider
    };
  }

  // Only use Midgard for UTxO provider if enabled, otherwise use Blockfrost
  const utxoProvider = isUsingMidgard
    ? new MidgardUtxoProvider(
        midgardClient,
        blockfrostClient,
        logger,
        createCache(CacheName.utxoProvider)
      )
    : new BlockfrostUtxoProvider({
        cache: createCache(CacheName.utxoProvider),
        client: blockfrostClient,
        logger
      });

  return {
    assetProvider,
    networkInfoProvider,
    txSubmitProvider,
    stakePoolProvider,
    utxoProvider,
    chainHistoryProvider,
    rewardAccountInfoProvider,
    rewardsProvider,
    handleProvider,
    addressDiscovery,
    inputResolver,
    drepProvider: dRepProvider
  };
};

export const walletProvidersChannel = (walletName: string): string => `${walletName}-providers`;
export const walletProvidersProperties: RemoteApiProperties<WalletProvidersDependencies> = {
  stakePoolProvider: {
    queryStakePools: RemoteApiPropertyType.MethodReturningPromise,
    stakePoolStats: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  assetProvider: {
    getAsset: RemoteApiPropertyType.MethodReturningPromise,
    getAssets: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  txSubmitProvider: {
    submitTx: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  networkInfoProvider: {
    ledgerTip: RemoteApiPropertyType.MethodReturningPromise,
    protocolParameters: RemoteApiPropertyType.MethodReturningPromise,
    genesisParameters: RemoteApiPropertyType.MethodReturningPromise,
    lovelaceSupply: RemoteApiPropertyType.MethodReturningPromise,
    stake: RemoteApiPropertyType.MethodReturningPromise,
    eraSummaries: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  utxoProvider: {
    utxoByAddresses: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  rewardAccountInfoProvider: {
    delegationPortfolio: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise,
    rewardAccountInfo: RemoteApiPropertyType.MethodReturningPromise
  },
  rewardsProvider: {
    rewardsHistory: RemoteApiPropertyType.MethodReturningPromise,
    rewardAccountBalance: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  chainHistoryProvider: {
    transactionsByAddresses: RemoteApiPropertyType.MethodReturningPromise,
    transactionsByHashes: RemoteApiPropertyType.MethodReturningPromise,
    blocksByHashes: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  drepProvider: {
    getDRepInfo: RemoteApiPropertyType.MethodReturningPromise,
    getDRepsInfo: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  inputResolver: {
    resolveInput: RemoteApiPropertyType.MethodReturningPromise
  },
  handleProvider: {
    getPolicyIds: RemoteApiPropertyType.MethodReturningPromise,
    resolveHandles: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  }
};