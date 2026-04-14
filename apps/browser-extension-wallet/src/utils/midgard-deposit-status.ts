import { logger } from '@lace/common';
import { MidgardPendingActivity } from '@stores/slices/midgard-slice';
import { trimTrailingSlashes } from './midgard-url';
import {
  MidgardPendingDepositTrackingStatus,
  isMidgardLegacyPendingActivityRecord
} from './midgard-pending-activities';
import { getMidgardDepositEventIdFromTxCbor } from './midgard-deposit-event-id';

type MidgardDepositStatusValue = 'awaiting' | 'projected' | 'consumed';

export type MidgardDepositStatusResponse = {
  cardanoTxHash: string;
  eventId: string;
  ledgerAddress: string;
  ledgerOutput: string;
  ledgerTxId: string;
  projectedHeaderHash: string | null;
  status: MidgardDepositStatusValue;
};

type MidgardPendingDeposit = MidgardPendingActivity & { kind: 'deposit' };

type MidgardPendingDepositReconciliation = {
  completedTxIds: string[];
  pendingUpdates: MidgardPendingDeposit[];
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();

    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    // Fall through to the HTTP status below when the response body is not JSON.
  }

  return `HTTP ${response.status}`;
};

const isDepositStatusResponse = (value: unknown): value is MidgardDepositStatusResponse =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as MidgardDepositStatusResponse).eventId === 'string' &&
  typeof (value as MidgardDepositStatusResponse).cardanoTxHash === 'string' &&
  typeof (value as MidgardDepositStatusResponse).ledgerTxId === 'string' &&
  typeof (value as MidgardDepositStatusResponse).ledgerOutput === 'string' &&
  typeof (value as MidgardDepositStatusResponse).ledgerAddress === 'string' &&
  ((value as MidgardDepositStatusResponse).projectedHeaderHash === null ||
    typeof (value as MidgardDepositStatusResponse).projectedHeaderHash === 'string') &&
  ['awaiting', 'projected', 'consumed'].includes((value as MidgardDepositStatusResponse).status);

const getDerivedDepositEventId = (pendingDeposit: MidgardPendingDeposit): string | undefined =>
  pendingDeposit.eventId ??
  (isMidgardLegacyPendingActivityRecord(pendingDeposit)
    ? getMidgardDepositEventIdFromTxCbor(pendingDeposit.txCbor)
    : undefined);

const getDepositStatusQuery = (pendingDeposit: MidgardPendingDeposit): string => {
  const params = new URLSearchParams();
  const eventId = getDerivedDepositEventId(pendingDeposit);

  if (eventId) {
    params.set('eventId', eventId);
  } else {
    params.set('cardanoTxHash', pendingDeposit.cardanoTxId ?? pendingDeposit.txId);
  }

  return params.toString();
};

const fetchMidgardDepositStatus = async ({
  midgardUrl,
  query
}: {
  midgardUrl: string;
  query: string;
}): Promise<MidgardDepositStatusResponse | undefined> => {
  const response = await fetch(`${trimTrailingSlashes(midgardUrl)}/deposit-status?${query}`);

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as unknown;
  if (!isDepositStatusResponse(payload)) {
    throw new Error('Midgard deposit status endpoint returned an invalid response');
  }

  return payload;
};

export const getMidgardDepositStatus = async ({
  eventId,
  midgardUrl,
  cardanoTxHash
}: {
  eventId?: string;
  midgardUrl: string;
  cardanoTxHash?: string;
}): Promise<MidgardDepositStatusResponse | undefined> => {
  const query = new URLSearchParams();
  if (eventId) {
    query.set('eventId', eventId);
  } else if (cardanoTxHash) {
    query.set('cardanoTxHash', cardanoTxHash);
  } else {
    throw new Error('Midgard deposit status lookup requires an event id or Cardano transaction hash');
  }

  return fetchMidgardDepositStatus({
    midgardUrl,
    query: query.toString()
  });
};

export const getMidgardDepositStatusByCardanoTxHash = async ({
  midgardUrl,
  cardanoTxHash
}: {
  midgardUrl: string;
  cardanoTxHash: string;
}): Promise<MidgardDepositStatusResponse | undefined> =>
  getMidgardDepositStatus({
    midgardUrl,
    cardanoTxHash
  });

export const getMidgardDepositStatusByEventId = async ({
  eventId,
  midgardUrl
}: {
  eventId: string;
  midgardUrl: string;
}): Promise<MidgardDepositStatusResponse | undefined> =>
  getMidgardDepositStatus({
    eventId,
    midgardUrl
  });

export const getTrackingStatusFromDepositStatus = (
  status?: MidgardDepositStatusResponse
): MidgardPendingDepositTrackingStatus | undefined => {
  if (!status) return undefined;

  switch (status.status) {
    case 'awaiting':
      return 'on_chain_pending';
    case 'projected':
      return 'projected';
    case 'consumed':
      return 'consumed';
    default:
      return undefined;
  }
};

export const reconcileMidgardPendingDeposits = async ({
  midgardUrl,
  pendingDeposits
}: {
  midgardUrl: string;
  pendingDeposits: MidgardPendingDeposit[];
}): Promise<MidgardPendingDepositReconciliation> => {
  const completedTxIds = new Set<string>();
  const pendingUpdates: MidgardPendingDeposit[] = [];

  await Promise.all(
    pendingDeposits.map(async (pendingDeposit) => {
      try {
        const derivedEventId = getDerivedDepositEventId(pendingDeposit);
        const status = await fetchMidgardDepositStatus({
          midgardUrl,
          query: getDepositStatusQuery(pendingDeposit)
        });
        if (!status) return;

        if (status.status === 'projected' || status.status === 'consumed') {
          completedTxIds.add(pendingDeposit.txId);
          return;
        }

        if (status.eventId !== pendingDeposit.eventId || (derivedEventId && derivedEventId !== pendingDeposit.eventId)) {
          pendingUpdates.push({
            ...pendingDeposit,
            eventId: status.eventId || derivedEventId
          });
        }
      } catch (error) {
        logger.warn(`[Midgard] Failed to resolve pending deposit status for ${pendingDeposit.txId}`, error);
      }
    })
  );

  return {
    completedTxIds: [...completedTxIds],
    pendingUpdates
  };
};
