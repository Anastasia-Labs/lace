import { reconcileMidgardPendingDeposits } from '../midgard-deposit-status';

const mockGetMidgardDepositEventIdFromTxCbor = jest.fn();

jest.mock('../midgard-deposit-event-id', () => ({
  getMidgardDepositEventIdFromTxCbor: (...args: unknown[]) => mockGetMidgardDepositEventIdFromTxCbor(...args)
}));

describe('reconcileMidgardPendingDeposits', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetMidgardDepositEventIdFromTxCbor.mockReturnValue(undefined);
  });

  test('stores the returned event id for awaiting deposits', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        cardanoTxHash: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf',
        eventId: 'd8799fd8799f581c1234ff',
        ledgerAddress: 'addr_test1vr4example',
        ledgerOutput: '4f5554505554',
        ledgerTxId: 'abcd',
        projectedHeaderHash: null,
        status: 'awaiting'
      }),
      ok: true,
      status: 200
    } as unknown as Response);

    await expect(
      reconcileMidgardPendingDeposits({
        midgardUrl: 'http://localhost:3000',
        pendingDeposits: [
          {
            address: 'addr_test1vr4example',
            createdAt: '2026-04-13T00:00:00.000Z',
            kind: 'deposit',
            schemaVersion: 1,
            txCbor: '84a40081825820deposit',
            txFormat: 'cardano-legacy',
            txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
          }
        ]
      })
    ).resolves.toEqual({
      completedTxIds: [],
      pendingUpdates: [
        expect.objectContaining({
          eventId: 'd8799fd8799f581c1234ff',
          txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
        })
      ]
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/deposit-status?cardanoTxHash=23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
    );
  });

  test('uses the cached event id on subsequent lookups', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        cardanoTxHash: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf',
        eventId: 'd8799fd8799f581c1234ff',
        ledgerAddress: 'addr_test1vr4example',
        ledgerOutput: '4f5554505554',
        ledgerTxId: 'abcd',
        projectedHeaderHash: '1234',
        status: 'projected'
      }),
      ok: true,
      status: 200
    } as unknown as Response);

    await expect(
      reconcileMidgardPendingDeposits({
        midgardUrl: 'http://localhost:3000/',
        pendingDeposits: [
          {
            address: 'addr_test1vr4example',
            createdAt: '2026-04-13T00:00:00.000Z',
            eventId: 'd8799fd8799f581c1234ff',
            kind: 'deposit',
            schemaVersion: 1,
            txCbor: '84a40081825820deposit',
            txFormat: 'cardano-legacy',
            txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
          }
        ]
      })
    ).resolves.toEqual({
      completedTxIds: ['23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'],
      pendingUpdates: []
    });

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/deposit-status?eventId=d8799fd8799f581c1234ff');
  });

  test('keeps pending deposits when Midgard has not indexed them yet', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ error: 'Deposit not found' }),
      ok: false,
      status: 404
    } as unknown as Response);

    await expect(
      reconcileMidgardPendingDeposits({
        midgardUrl: 'http://localhost:3000',
        pendingDeposits: [
          {
            address: 'addr_test1vr4example',
            createdAt: '2026-04-13T00:00:00.000Z',
            kind: 'deposit',
            schemaVersion: 1,
            txCbor: '84a40081825820deposit',
            txFormat: 'cardano-legacy',
            txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
          }
        ]
      })
    ).resolves.toEqual({
      completedTxIds: [],
      pendingUpdates: []
    });
  });

  test('uses a derived event id when the pending deposit does not have one yet', async () => {
    mockGetMidgardDepositEventIdFromTxCbor.mockReturnValue('d8799fd8799f581c1234ff');
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        cardanoTxHash: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf',
        eventId: 'd8799fd8799f581c1234ff',
        ledgerAddress: 'addr_test1vr4example',
        ledgerOutput: '4f5554505554',
        ledgerTxId: 'abcd',
        projectedHeaderHash: null,
        status: 'awaiting'
      }),
      ok: true,
      status: 200
    } as unknown as Response);

    await expect(
      reconcileMidgardPendingDeposits({
        midgardUrl: 'http://localhost:3000',
        pendingDeposits: [
          {
            address: 'addr_test1vr4example',
            createdAt: '2026-04-13T00:00:00.000Z',
            kind: 'deposit',
            schemaVersion: 1,
            txCbor: '84a40081825820deposit',
            txFormat: 'cardano-legacy',
            txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
          }
        ]
      })
    ).resolves.toEqual({
      completedTxIds: [],
      pendingUpdates: [
        expect.objectContaining({
          eventId: 'd8799fd8799f581c1234ff',
          txId: '23ac62ed8c58a915af6cf93108f6247e94bce379a43668182db2618792661dbf'
        })
      ]
    });

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/deposit-status?eventId=d8799fd8799f581c1234ff');
  });
});
