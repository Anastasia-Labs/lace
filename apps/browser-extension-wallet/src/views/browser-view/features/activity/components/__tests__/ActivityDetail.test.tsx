const mockUseWalletStore = jest.fn();
const mockUseCurrencyStore = jest.fn();
const mockTransactionDetailsProxy = jest.fn();

/* eslint-disable import/imports-first */
import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import { ActivityStatus, TransactionActivityType } from '@lace/core';
import { Wallet } from '@lace/cardano';
import { TxDirections } from '@src/types';
import { incomingTransactionOutput, missingDataTransactionOutput, outgoingTransactionOutput } from '@src/utils/mocks/test-helpers';

jest.mock('@stores', () => ({
  useWalletStore: () => mockUseWalletStore()
}));

jest.mock('@providers', () => ({
  useCurrencyStore: () => mockUseCurrencyStore()
}));

jest.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

jest.mock('../TransactionDetailsProxy', () => ({
  TransactionDetailsProxy: (props: unknown) => {
    mockTransactionDetailsProxy(props);
    return <div data-testid="transaction-details-proxy" />;
  }
}));

jest.mock('../SharedWalletTransactionDetailsWrapper', () => ({
  SharedWalletTransactionDetailsWrapper: () => <div data-testid="shared-wallet-transaction-details-wrapper" />
}));

const { ActivityDetail, getTransactionData } = require('../ActivityDetail') as typeof import('../ActivityDetail');

const depositAssetId = Wallet.Cardano.AssetId(`${Wallet.MIDGARD_LAYER1_POLICY_IDS.deposit}41`);

const createActivity = ({
  status = ActivityStatus.SUCCESS,
  includeBridgeMint = true,
  provenance
}: {
  status?: ActivityStatus;
  includeBridgeMint?: boolean;
  provenance?: Wallet.MidgardTxProvenance;
}) => {
  const activity = {
    id: Wallet.Cardano.TransactionId('a'.repeat(64)),
    body: {
      mint: includeBridgeMint ? (new Map([[depositAssetId, BigInt(1)]]) as Wallet.Cardano.TokenMap) : undefined
    },
    ...(provenance ? { midgardTxProvenance: provenance } : {})
  } as Wallet.Cardano.HydratedTx;

  return {
    activity,
    activityInfo: {
      status,
      type: TransactionActivityType.outgoing,
      activity: {
        addrInputs: [],
        addrOutputs: [],
        assetAmount: '1',
        hash: Wallet.Cardano.TransactionId('b'.repeat(64)),
        includedUtcDate: '2026-04-12',
        includedUtcTime: '08:00'
      } as never
    }
  };
};

const renderActivityDetail = async ({
  status = ActivityStatus.SUCCESS,
  includeBridgeMint = true,
  provenance
}: {
  status?: ActivityStatus;
  includeBridgeMint?: boolean;
  provenance?: Wallet.MidgardTxProvenance;
} = {}) => {
  const { activity, activityInfo } = createActivity({ status, includeBridgeMint, provenance });
  const getActivityDetail = jest.fn().mockResolvedValue(activityInfo);

  mockUseWalletStore.mockReturnValue({
    environmentName: 'Preprod',
    walletUI: {
      cardanoCoin: {
        symbol: 'ADA'
      }
    },
    getActivityDetail,
    activityDetail: {
      activity,
      direction: TxDirections.Outgoing,
      type: TransactionActivityType.outgoing
    },
    fetchingActivityInfo: false,
    walletActivities: []
  });

  render(<ActivityDetail price={{ cardano: { price: 2 } } as never} />);

  await waitFor(() => expect(mockTransactionDetailsProxy).toHaveBeenCalled());
  return mockTransactionDetailsProxy.mock.calls.at(-1)?.[0] as {
    canOpenExternalHashLink: boolean;
    name: string;
    status: ActivityStatus;
  };
};

describe('Testing Transaction details data function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCurrencyStore.mockReturnValue({
      fiatCurrency: {
        code: 'USD',
        symbol: '$'
      },
      setFiatCurrency: jest.fn()
    });
  });

  test('should return correct data for incoming transactions', async () => {
    const { outputs, inputs, walletAddresses, incomingTransaction } = incomingTransactionOutput;
    const result = getTransactionData({
      addrInputs: inputs,
      addrOutputs: outputs,
      walletAddresses,
      isIncomingTransaction: incomingTransaction
    });

    expect(result.length).toBeGreaterThan(0);
  });

  test('should return correct data for outgoing transactions', async () => {
    const { outputs, walletAddresses, incomingTransaction } = outgoingTransactionOutput;
    const result = getTransactionData({
      addrInputs: [],
      addrOutputs: outputs,
      walletAddresses,
      isIncomingTransaction: incomingTransaction
    });

    expect(result.length).toBeGreaterThan(0);
  });

  test('should return empty array when data is missing', async () => {
    const { outputs, inputs, walletAddresses, incomingTransaction } = missingDataTransactionOutput;
    const result = getTransactionData({
      addrInputs: inputs,
      addrOutputs: outputs,
      walletAddresses,
      isIncomingTransaction: incomingTransaction
    });

    expect(result.length).toEqual(0);
  });

  test('renders the Midgard deposit label for a confirmed bridge activity', async () => {
    const props = await renderActivityDetail({
      provenance: Wallet.MidgardTxProvenance.Layer1Bridge
    });

    expect(props.name).toBe('Midgard L2 Deposit');
    expect(props.status).toBe(ActivityStatus.SUCCESS);
    expect(props.canOpenExternalHashLink).toBe(true);
  });

  test('renders the pending Midgard label while a bridge deposit is confirming', async () => {
    const props = await renderActivityDetail({
      provenance: Wallet.MidgardTxProvenance.Layer1Bridge,
      status: ActivityStatus.PENDING
    });

    expect(props.name).toBe('Depositing');
    expect(props.status).toBe(ActivityStatus.PENDING);
    expect(props.canOpenExternalHashLink).toBe(true);
  });

  test('disables external explorer links for native Midgard layer 2 activity details', async () => {
    const props = await renderActivityDetail({
      includeBridgeMint: false,
      provenance: Wallet.MidgardTxProvenance.Layer2Native
    });

    expect(props.name).toBe('core.activityDetails.sent');
    expect(props.canOpenExternalHashLink).toBe(false);
  });
});
