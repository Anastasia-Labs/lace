import { Storage, storage as webStorage } from 'webextension-polyfill';
import { logger as commonLogger } from '@lace/common';
import { ExtensionStorage } from '@lib/scripts/types';
import { Wallet } from '@lace/cardano';
import { contextLogger } from '@cardano-sdk/util';
<<<<<<< HEAD:apps/browser-extension-wallet/src/lib/scripts/background/onStorageChange.ts
import { clearProviderCache } from './config';
=======
import { getNotificationsClient } from './notifications-center';
import { ExperimentName } from '../types/feature-flags';
>>>>>>> upstream/main:v1/apps/browser-extension-wallet/src/lib/scripts/background/onStorageChange.ts

const logger = contextLogger(commonLogger, 'Background:StorageListener');

type ExtensionStorageChange<T extends keyof ExtensionStorage = keyof ExtensionStorage> = {
  oldValue?: ExtensionStorage[T];
  newValue?: ExtensionStorage[T];
};

const hasStorageChangeForKey = <T extends keyof ExtensionStorage>(
  changes: Record<string, Storage.StorageChange>,
  key: T
): changes is Record<T, ExtensionStorageChange<T>> => key in changes;

/**
 * Extracts the fetchMissedMessagesIntervalMinutes value from a feature flag payload.
 *
 * @param payload - Feature flag payload
 * @returns Interval in minutes, or undefined if not found
 */
const extractIntervalFromPayload = (payload: unknown): number | undefined => {
  if (payload && typeof payload === 'object' && 'fetchMissedMessagesIntervalMinutes' in payload) {
    return (payload as { fetchMissedMessagesIntervalMinutes: number }).fetchMissedMessagesIntervalMinutes;
  }
  // eslint-disable-next-line consistent-return
  return undefined;
};

/**
 * Handles changes to the lace-messaging-center feature flag payload.
 * Updates the fetchMissedMessagesIntervalMinutes when the feature flag payload changes.
 *
 * @param oldPayload - Previous feature flag payload value
 * @param newPayload - New feature flag payload value
 */
const handleLaceMessagingCenterPayloadChange = (oldPayload: unknown, newPayload: unknown): void => {
  const oldInterval = extractIntervalFromPayload(oldPayload);
  const newInterval = extractIntervalFromPayload(newPayload);

  if (oldInterval !== newInterval && newInterval !== undefined) {
    const notificationsClient = getNotificationsClient();
    if (notificationsClient) {
      try {
        notificationsClient.updateFetchMissedMessagesInterval(newInterval);
        logger.debug(`Successfully called updateFetchMissedMessagesInterval(${newInterval}) on notifications client`);
      } catch (error) {
        logger.error('Failed to update fetch missed messages interval to newInterval', newInterval, error);
      }
    } else {
      logger.debug('Notifications client not available, cannot update interval from PostHog');
    }
  }
};

const handleBackgroundStorageChange = (changes: ExtensionStorageChange<'BACKGROUND_STORAGE'>) => {
  if (changes.newValue?.logLevel && changes.oldValue?.logLevel !== changes.newValue.logLevel) {
    commonLogger.setLogLevel(changes.newValue.logLevel);
  }

  if (changes.newValue?.featureFlags) {
    // this FF is not network specific, we always pick the mainnet value
    const networkMagic = Wallet.Cardano.NetworkMagics.Mainnet;
    const oldLoggerSentryIntegrationEnabled =
      changes.oldValue?.featureFlags?.[networkMagic]?.['send-console-errors-to-sentry'];
    const newLoggerSentryIntegrationEnabled =
      changes.newValue.featureFlags?.[networkMagic]?.['send-console-errors-to-sentry'];

    if (newLoggerSentryIntegrationEnabled !== oldLoggerSentryIntegrationEnabled) {
      commonLogger.setSentryIntegrationEnabled(newLoggerSentryIntegrationEnabled || false);
    }
  }

  // Handle changes to lace-messaging-center feature flag payload
  if (changes.newValue?.featureFlagPayloads) {
    const oldPayload = changes.oldValue?.featureFlagPayloads?.[ExperimentName.NOTIFICATIONS_CENTER];
    const newPayload = changes.newValue.featureFlagPayloads[ExperimentName.NOTIFICATIONS_CENTER];

    handleLaceMessagingCenterPayloadChange(oldPayload, newPayload);
  }
};

const handleMidgardStorageChange = (changes: Storage.StorageChange) => {
  logger.info('Midgard storage changed:', changes);
  
  // Force a provider refresh when Midgard setting changes
  // We need to re-initialize the providers with the new Midgard setting
  if (changes.newValue !== undefined) {
    logger.info('Midgard setting changed to:', changes.newValue);
    // Clear the provider cache to force recreation with new Midgard setting
    clearProviderCache();
    
    // The UI will listen for storage changes directly and trigger a refresh
    // No need to send messages to tabs
    logger.info('🔍 Debug: Storage change detected, UI will handle refresh via storage listener');
  }
};

const initializeStorageListener = () => {
  // set initial values from storage
  webStorage.local
    .get('BACKGROUND_STORAGE')
    .then((storage) => {
      handleBackgroundStorageChange({
        oldValue: undefined,
        newValue: storage.BACKGROUND_STORAGE
      });
    })
    .catch((error) => {
      logger.error('Failed to read the storage', error);
    });

  // listen for changes to the storage
  webStorage.onChanged.addListener((changes) => {
    if (hasStorageChangeForKey(changes, 'BACKGROUND_STORAGE')) {
      handleBackgroundStorageChange(changes.BACKGROUND_STORAGE);
    }
    
    // Listen for Midgard setting changes
    if ('midgardEnabled' in changes) {
      handleMidgardStorageChange(changes.midgardEnabled);
    }
  });
};

initializeStorageListener();
