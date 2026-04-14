import { reconcileMidgardPendingActivities } from '../services/midgardPendingActivities';
import { MidgardPendingActivity } from '@src/utils/midgard-pending-activities';

const mockGetProviders = jest.fn();
const mockGetMidgardUrl = jest.fn();
const mockGetMidgardDepositStatus = jest.fn();
const mockGetMidgardDepositEventIdFromTxCbor = jest.fn();

jest.mock('../config', () => ({
  getProviders: (...args: unknown[]) => mockGetProviders(...args)
}));

jest.mock('@src/utils/midgard-url', () => ({
  getMidgardUrl: (...args: unknown[]) => mockGetMidgardUrl(...args)
}));

jest.mock('@src/utils/midgard-deposit-status', () => ({
  getMidgardDepositStatus: (...args: unknown[]) => mockGetMidgardDepositStatus(...args),
  getTrackingStatusFromDepositStatus: (status?: { status?: string }) => {
    switch (status?.status) {
      case 'awaiting':
        return 'on_chain_pending';
      case 'projected':
        return 'projected';
      case 'consumed':
        return 'consumed';
      default:
        return undefined;
    }
  }
}));

jest.mock('@src/utils/midgard-deposit-event-id', () => ({
  getMidgardDepositEventIdFromTxCbor: (...args: unknown[]) => mockGetMidgardDepositEventIdFromTxCbor(...args)
}));

const makePendingDeposit = (overrides: Partial<MidgardPendingActivity> = {}): MidgardPendingActivity => ({
  address: 'addr_test1vr4example',
  broadcastRequestedAt: '2026-04-13T00:00:00.000Z',
  cardanoTxId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf',
  chainName: 'Preprod',
  createdAt: '2026-04-13T00:00:00.000Z',
  kind: 'deposit',
  schemaVersion: 1,
  trackingStatus: 'broadcast_requested',
  txCbor: '84a40081825820deposit',
  txFormat: 'cardano-legacy',
  txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf',
  ...overrides
}) as MidgardPendingActivity;

describe('reconcileMidgardPendingActivities', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetProviders.mockResolvedValue({
      chainHistoryProvider: {
        transactionsByHashes: jest.fn().mockResolvedValue([])
      }
    });
    mockGetMidgardUrl.mockResolvedValue('http://localhost:3000');
    mockGetMidgardDepositStatus.mockResolvedValue(undefined);
    mockGetMidgardDepositEventIdFromTxCbor.mockReturnValue(undefined);
  });

  test('marks deposits as broadcast_not_observed when neither Cardano nor Midgard sees them before timeout', async () => {
    await expect(
      reconcileMidgardPendingActivities([makePendingDeposit()], new Date('2026-04-13T00:11:00.000Z'))
    ).resolves.toEqual([
      expect.objectContaining({
        lastError: expect.stringContaining('could not observe this deposit'),
        trackingStatus: 'broadcast_not_observed'
      })
    ]);
  });

  test('marks deposits as on_chain_pending once Cardano can resolve the tx hash', async () => {
    mockGetProviders.mockResolvedValue({
      chainHistoryProvider: {
        transactionsByHashes: jest.fn().mockResolvedValue([{}])
      }
    });

    await expect(
      reconcileMidgardPendingActivities([makePendingDeposit()], new Date('2026-04-13T00:01:00.000Z'))
    ).resolves.toEqual([
      expect.objectContaining({
        lastError: undefined,
        onChainSeenAt: '2026-04-13T00:01:00.000Z',
        trackingStatus: 'on_chain_pending'
      })
    ]);
  });

  test('drops deposits once Midgard reports them as projected', async () => {
    mockGetMidgardDepositStatus.mockResolvedValue({
      cardanoTxHash: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf',
      eventId: 'event-1',
      ledgerAddress: 'addr_test1vr4example',
      ledgerOutput: '4f5554505554',
      ledgerTxId: 'ledger-tx-1',
      projectedHeaderHash: 'header-1',
      status: 'projected'
    });

    await expect(
      reconcileMidgardPendingActivities([makePendingDeposit()], new Date('2026-04-13T00:01:00.000Z'))
    ).resolves.toEqual([]);
  });

  test('derives the Midgard event id from tx cbor before reconciling deposits', async () => {
    mockGetMidgardDepositEventIdFromTxCbor.mockReturnValue('derived-event-1');

    await expect(
      reconcileMidgardPendingActivities([makePendingDeposit()], new Date('2026-04-13T00:01:00.000Z'))
    ).resolves.toEqual([
      expect.objectContaining({
        eventId: 'derived-event-1',
        trackingStatus: 'broadcast_requested'
      })
    ]);

    expect(mockGetMidgardDepositStatus).toHaveBeenCalledWith({
      eventId: 'derived-event-1',
      midgardUrl: 'http://localhost:3000',
      cardanoTxHash: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
    });
  });
});
