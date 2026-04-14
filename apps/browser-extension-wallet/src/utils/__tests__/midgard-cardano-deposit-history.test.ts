/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  enrichTransactionsWithMidgardDepositProvenance,
  loadMidgardCardanoDepositHistory
} from '../midgard-cardano-deposit-history';
import { Wallet } from '@lace/cardano';

const mockGetProviders = jest.fn();
const mockGetMidgardDepositStatusByCardanoTxHash = jest.fn();
const mockGetMidgardUrl = jest.fn();
const mockIsMidgardDepositActivity = jest.fn();
const mockIsMidgardDepositCertificateCandidate = jest.fn();

jest.mock('@lib/scripts/background/config', () => ({
  getProviders: (...args: any[]) => mockGetProviders(...args)
}));

jest.mock('@src/views/browser-view/features/activity/helpers/midgard-activity', () => ({
  isMidgardDepositActivity: (...args: any[]) => mockIsMidgardDepositActivity(...args),
  isMidgardDepositCertificateCandidate: (...args: any[]) => mockIsMidgardDepositCertificateCandidate(...args)
}));

jest.mock('../midgard-deposit-status', () => ({
  getMidgardDepositStatusByCardanoTxHash: (...args: any[]) => mockGetMidgardDepositStatusByCardanoTxHash(...args)
}));

jest.mock('../midgard-url', () => ({
  getMidgardUrl: (...args: any[]) => mockGetMidgardUrl(...args),
  trimTrailingSlashes: (value: string) => value.replace(/\/+$/, '')
}));

describe('loadMidgardCardanoDepositHistory', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetMidgardUrl.mockResolvedValue(undefined);
    mockIsMidgardDepositActivity.mockImplementation((tx: { isDeposit?: boolean }) => tx?.isDeposit === true);
    mockIsMidgardDepositCertificateCandidate.mockImplementation(
      (tx: { isCertificateCandidate?: boolean }) => tx?.isCertificateCandidate === true
    );
  });

  test('loads all Cardano history pages and keeps only deposit transactions', async () => {
    const firstPageResults = Array.from({ length: 100 }, (_, index) => ({
      id: { toString: () => `tx-${index + 1}` },
      isDeposit: index === 0
    }));
    const transactionsByAddresses = jest
      .fn()
      .mockResolvedValueOnce({
        pageResults: firstPageResults,
        totalResultCount: 101
      })
      .mockResolvedValueOnce({
        pageResults: [{ id: { toString: () => 'tx-101' }, isDeposit: true }],
        totalResultCount: 101
      });
    mockGetProviders.mockResolvedValue({
      chainHistoryProvider: { transactionsByAddresses }
    });

    await expect(
      loadMidgardCardanoDepositHistory({
        addresses: [{ address: 'addr_test1vr4example' }, { address: 'addr_test1vr4example' }] as any[],
        chainName: 'Preprod' as any
      })
    ).resolves.toEqual([
      expect.objectContaining({ isDeposit: true }),
      expect.objectContaining({ isDeposit: true })
    ]);

    expect(mockGetProviders).toHaveBeenCalledWith('Preprod', { forceMidgardEnabled: false });
    expect(transactionsByAddresses).toHaveBeenNthCalledWith(1, {
      addresses: ['addr_test1vr4example'],
      pagination: { limit: 100, order: 'desc', startAt: 0 }
    });
    expect(transactionsByAddresses).toHaveBeenNthCalledWith(2, {
      addresses: ['addr_test1vr4example'],
      pagination: { limit: 100, order: 'desc', startAt: 100 }
    });
  });

  test('deduplicates deposits by transaction id across pages', async () => {
    const duplicateDeposit = { id: { toString: () => 'tx-1' }, isDeposit: true };
    const transactionsByAddresses = jest
      .fn()
      .mockResolvedValueOnce({
        pageResults: [duplicateDeposit],
        totalResultCount: 2
      })
      .mockResolvedValueOnce({
        pageResults: [duplicateDeposit],
        totalResultCount: 2
      });
    mockGetProviders.mockResolvedValue({
      chainHistoryProvider: { transactionsByAddresses }
    });

    await expect(
      loadMidgardCardanoDepositHistory({
        addresses: [{ address: 'addr_test1vr4example' }] as any[],
        chainName: 'Preprod' as any
      })
    ).resolves.toEqual([duplicateDeposit]);
  });

  test('marks confirmed certificate-only deposits as Midgard bridge transactions', async () => {
    const certificateOnlyDeposit = { id: { toString: () => 'candidate-tx' }, isCertificateCandidate: true };
    const unrelatedTx = { id: { toString: () => 'other-tx' }, isCertificateCandidate: false };

    mockGetMidgardUrl.mockResolvedValue('http://localhost:3000/');
    mockGetMidgardDepositStatusByCardanoTxHash.mockResolvedValue({
      cardanoTxHash: 'candidate-tx',
      eventId: 'event-1',
      ledgerAddress: 'addr_test1vr4example',
      ledgerOutput: '4f5554505554',
      ledgerTxId: 'ledger-tx-1',
      projectedHeaderHash: 'header',
      status: 'projected'
    });

    await expect(
      enrichTransactionsWithMidgardDepositProvenance({
        environmentName: 'Preprod' as any,
        transactions: [certificateOnlyDeposit, unrelatedTx] as any[]
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: certificateOnlyDeposit.id,
        midgardTxProvenance: Wallet.MidgardTxProvenance.Layer1Bridge
      }),
      unrelatedTx
    ]);

    expect(mockGetMidgardDepositStatusByCardanoTxHash).toHaveBeenCalledWith({
      cardanoTxHash: 'candidate-tx',
      midgardUrl: 'http://localhost:3000/'
    });
  });
});
