import { Storage, storage } from 'webextension-polyfill';
import {
  MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY,
  MidgardPendingActivity,
  mergeMidgardPendingActivities,
  readMidgardPendingActivities,
  removeMidgardPendingActivitiesByTxIds
} from './midgard-pending-activities';

type MidgardPendingActivitiesStorageShape = {
  [MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY]?: unknown;
};

export const getStoredMidgardPendingActivities = async (): Promise<MidgardPendingActivity[]> =>
  readMidgardPendingActivities(
    ((await storage.local.get(MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY)) as MidgardPendingActivitiesStorageShape)[
      MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY
    ]
  );

export const writeStoredMidgardPendingActivities = async (
  pendingActivities: MidgardPendingActivity[]
): Promise<MidgardPendingActivity[]> => {
  await storage.local.set({ [MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY]: pendingActivities });
  return pendingActivities;
};

export const upsertStoredMidgardPendingActivity = async (
  pendingActivity: MidgardPendingActivity
): Promise<MidgardPendingActivity[]> => {
  const currentPendingActivities = await getStoredMidgardPendingActivities();
  return writeStoredMidgardPendingActivities(mergeMidgardPendingActivities(currentPendingActivities, pendingActivity));
};

export const removeStoredMidgardPendingActivities = async (txIds: string[]): Promise<MidgardPendingActivity[]> => {
  const currentPendingActivities = await getStoredMidgardPendingActivities();
  return writeStoredMidgardPendingActivities(removeMidgardPendingActivitiesByTxIds(currentPendingActivities, txIds));
};

export const readMidgardPendingActivitiesStorageChange = (
  changes: Storage.StorageAreaOnChangedChangesType,
  areaName: string
): MidgardPendingActivity[] | undefined => {
  if (areaName !== 'local' || !(MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY in changes)) {
    return undefined;
  }

  return readMidgardPendingActivities(changes[MIDGARD_PENDING_ACTIVITIES_STORAGE_KEY]?.newValue);
};
