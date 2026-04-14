/* eslint-disable unicorn/no-null */
const mockGetFormattedAmount = jest.fn();

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-len */
/* eslint-disable no-magic-numbers */
/* eslint-disable import/imports-first */
import * as txTransformers from '../common-tx-transformer';
import * as txHistoryTransformers from '../tx-history-transformer';
import { Wallet } from '@lace/cardano';
import { DelegationActivityType, TransactionActivityType } from '@lace/core';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { cardanoCoin } from '@src/utils/constants';
import * as txInspection from '@src/utils/tx-inspection';
import type { TxDirections } from '@src/types';
import { currencyCode } from '@providers/currency/constants';

jest.mock('@lace/cardano', () => {
  const actual = jest.requireActual<any>('@lace/cardano');
  return {
    __esModule: true,
    ...actual,
    Wallet: {
      ...actual.Wallet,
      util: {
        ...actual.Wallet.util,
        getFormattedAmount: mockGetFormattedAmount
      }
    }
  };
});

dayjs.extend(utc);

describe('Testing txHistoryTransformer function', () => {
  const txHistory: Wallet.Cardano.HydratedTx = {
    inputSource: Wallet.Cardano.InputSource.inputs,
    id: Wallet.Cardano.TransactionId('d0007e225042e46e70778686262117af16ba2673a17315672e49ea26f34b0198'),
    index: 1,
    txSize: 365,
    blockHeader: {
      hash: Wallet.Cardano.BlockId('f4f01b5b9a1553794443ff64c9f97203d1f97f1cf58b94bc0c81ca529774a993'),
      blockNo: Wallet.Cardano.BlockNo(3_075_825),
      slot: Wallet.Cardano.Slot(42_634_497)
    },
    body: {
      inputs: [
        {
          txId: Wallet.Cardano.TransactionId('d0007e225042e46e70778686262117af16ba2673a17315672e49ea26f34b0198'),
          index: 1,
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
          )
        }
      ],
      outputs: [
        {
          address: Wallet.Cardano.PaymentAddress('addr_test1wrsexavz37208qda7mwwu4k7hcpg26cz0ce86f5e9kul3hqzlh22t'),
          value: {
            coins: BigInt('10000000')
          }
        },
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpr3akacs72xelgd60ucdz0j4uw8dkg86jhntqd6gjpk84adv3qw0nafy8arl48xwhhnlzxre3cwx0xjnlwxfm77l00smqpvpz'
          ),
          value: {
            coins: BigInt('20000000')
          }
        }
      ],
      fee: BigInt('1000000'),
      validityInterval: {
        invalidBefore: Wallet.Cardano.Slot(1),
        invalidHereafter: Wallet.Cardano.Slot(2)
      },
      withdrawals: [
        {
          quantity: BigInt(2),
          stakeAddress: Wallet.Cardano.RewardAccount('stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx')
        } as Wallet.Cardano.Withdrawal
      ]
    },
    witness: {
      signatures: new Map()
    }
  };

  const date = new Date(Date.UTC(2022, 1, 1, 10, 10));

  test('should return parsed incoming tx', async () => {
    mockGetFormattedAmount.mockReturnValueOnce('20.00 ADA');
    const result: any = await txHistoryTransformers.txHistoryTransformer({
      tx: txHistory,
      walletAddresses: [
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpr3akacs72xelgd60ucdz0j4uw8dkg86jhntqd6gjpk84adv3qw0nafy8arl48xwhhnlzxre3cwx0xjnlwxfm77l00smqpvpz'
          ),
          rewardAccount: Wallet.Cardano.RewardAccount(
            'stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx'
          )
        }
      ] as Wallet.KeyManagement.GroupedAddress[],
      date,
      fiatCurrency: {
        code: currencyCode.USD,
        symbol: '$'
      },
      fiatPrice: 1,
      protocolParameters: { poolDeposit: 3, stakeKeyDeposit: 2 } as Wallet.ProtocolParameters,
      cardanoCoin,
      resolveInput: () => Promise.resolve(null)
    });

    expect(result[0].status).toBe('success');
    expect(result[0].amount).toBe('20.00 ADA');
  });

  test('should return parsed outgoing tx', async () => {
    mockGetFormattedAmount.mockReturnValueOnce('30.00 ADA');
    const result: any = await txHistoryTransformers.txHistoryTransformer({
      tx: txHistory,
      walletAddresses: [
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
          ),
          rewardAccount: Wallet.Cardano.RewardAccount(
            'stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx'
          )
        }
      ] as Wallet.KeyManagement.GroupedAddress[],
      date,
      fiatCurrency: {
        code: currencyCode.USD,
        symbol: '$'
      },
      fiatPrice: 1,
      protocolParameters: { poolDeposit: 3, stakeKeyDeposit: 2 } as Wallet.ProtocolParameters,
      cardanoCoin,
      resolveInput: () => Promise.resolve(null)
    });

    expect(result[0].status).toBe('success');
    expect(result[0].amount).toBe('30.00 ADA');
  });

  test('should return outgoing tx with withdrawal only as outgoing tx', async () => {
    const direction = 'tx-direction';
    const formattedAmount = 'getFormattedAmount';
    const formattedFiatAmount = 'getFormattedFiatAmount';
    mockGetFormattedAmount.mockReturnValueOnce(formattedAmount);
    const getFormattedFiatAmountSpy = jest
      .spyOn(txTransformers, 'getFormattedFiatAmount')
      .mockReturnValueOnce(formattedFiatAmount);
    const txTransformerSpy = jest.spyOn(txTransformers, 'txTransformer');
    const inspectTxTypeSpy = jest.spyOn(txInspection, 'inspectTxType');
    const getTxDirectionSpy = jest.spyOn(txInspection, 'getTxDirection').mockReturnValueOnce(direction as TxDirections);

    const props = {
      tx: txHistory,
      walletAddresses: [
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpr3akacs72xelgd60ucdz0j4uw8dkg86jhntqd6gjpk84adv3qw0nafy8arl48xwhhnlzxre3cwx0xjnlwxfm77l00smqpvpz'
          ),
          rewardAccount: Wallet.Cardano.RewardAccount(
            'stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx'
          )
        }
      ] as Wallet.KeyManagement.GroupedAddress[],
      date,
      fiatCurrency: {
        code: currencyCode.USD,
        symbol: '$'
      },
      fiatPrice: 1,
      protocolParameters: { poolDeposit: 3, stakeKeyDeposit: 2 } as Wallet.ProtocolParameters,
      cardanoCoin,
      resolveInput: () => Promise.resolve(null)
    };
    const result: any = await txHistoryTransformers.txHistoryTransformer(props);

    expect(inspectTxTypeSpy).toBeCalledWith({
      inputResolver: { resolveInput: props.resolveInput },
      walletAddresses: props.walletAddresses,
      tx: props.tx
    });
    expect(getTxDirectionSpy).toBeCalledWith({
      type: 'outgoing'
    });
    expect(txTransformerSpy).toBeCalledWith({
      tx: props.tx,
      walletAddresses: props.walletAddresses,
      fiatCurrency: props.fiatCurrency,
      fiatPrice: props.fiatPrice,
      date: props.date,
      protocolParameters: props.protocolParameters,
      cardanoCoin: props.cardanoCoin,
      status: Wallet.TransactionStatus.SUCCESS,
      direction,
      resolveInput: props.resolveInput
    });
    expect(result.length).toBe(1);
    expect(result[0].status).toBe('success');
    expect(result[0].type).toBe('outgoing');

    txTransformerSpy.mockRestore();
    inspectTxTypeSpy.mockRestore();
    getTxDirectionSpy.mockRestore();
    getFormattedFiatAmountSpy.mockRestore();
  });

  test('should label Midgard deposit bridge transactions', async () => {
    mockGetFormattedAmount.mockReset();
    mockGetFormattedAmount.mockReturnValueOnce('NaN ADA').mockReturnValueOnce('10.00 ADA');
    const inspectTxTypeSpy = jest
      .spyOn(txInspection, 'inspectTxType')
      .mockResolvedValue(DelegationActivityType.delegationRegistration);
    const inspectTxValuesSpy = jest
      .spyOn(txInspection, 'inspectTxValues')
      .mockResolvedValueOnce({ coins: BigInt('10000000') } as Wallet.Cardano.Value);
    const depositTx = {
      ...txHistory,
      body: {
        ...txHistory.body,
        mint: new Map([
          [Wallet.Cardano.AssetId(`${Wallet.MIDGARD_LAYER1_POLICY_IDS.deposit}41`), BigInt(1)]
        ]) as Wallet.Cardano.TokenMap
      }
    };

    const result: any = await txHistoryTransformers.txHistoryTransformer({
      tx: depositTx,
      walletAddresses: [
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
          ),
          rewardAccount: Wallet.Cardano.RewardAccount(
            'stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx'
          )
        }
      ] as Wallet.KeyManagement.GroupedAddress[],
      date,
      fiatCurrency: {
        code: currencyCode.USD,
        symbol: '$'
      },
      fiatPrice: 1,
      environmentName: 'Preprod',
      protocolParameters: { poolDeposit: 3, stakeKeyDeposit: 2 } as Wallet.ProtocolParameters,
      cardanoCoin,
      resolveInput: () => Promise.resolve(null)
    });

    expect(result[0].label).toBe('Midgard L2 Deposit');
    expect(result[0].type).toBe(TransactionActivityType.outgoing);
    expect(result[0].direction).toBe('Outgoing');
    expect(result[0].amount).toBe('10.00 ADA');
    expect(result[0].fiatAmount).toBe('10.00 USD');
    expect(inspectTxValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'Outgoing'
      })
    );

    inspectTxTypeSpy.mockRestore();
    inspectTxValuesSpy.mockRestore();
  });

  test('should label Midgard deposit bridge transactions from provenance when mint metadata is unavailable', async () => {
    mockGetFormattedAmount.mockReset();
    mockGetFormattedAmount.mockReturnValueOnce('NaN ADA').mockReturnValueOnce('10.00 ADA');
    const inspectTxTypeSpy = jest
      .spyOn(txInspection, 'inspectTxType')
      .mockResolvedValue(DelegationActivityType.delegationRegistration);
    const inspectTxValuesSpy = jest
      .spyOn(txInspection, 'inspectTxValues')
      .mockResolvedValueOnce({ coins: BigInt('10000000') } as Wallet.Cardano.Value);
    const depositTx = {
      ...txHistory,
      midgardTxProvenance: Wallet.MidgardTxProvenance.Layer1Bridge,
      body: {
        ...txHistory.body,
        mint: undefined as Wallet.Cardano.TokenMap | undefined,
        certificates: [
          ({
            __typename: Wallet.Cardano.CertificateType.Registration,
            deposit: BigInt(2000000),
            stakeCredential: {
              type: Wallet.Cardano.CredentialType.KeyHash,
              hash: Wallet.Crypto.Hash28ByteBase16('0d94e174732ef9aae73f395ab44507bfa983d65023c11a951f0c32e4')
            }
          } as unknown as Wallet.Cardano.Certificate)
        ]
      }
    } as Wallet.Cardano.HydratedTx;

    const result: any = await txHistoryTransformers.txHistoryTransformer({
      tx: depositTx,
      walletAddresses: [
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
          ),
          rewardAccount: Wallet.Cardano.RewardAccount(
            'stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx'
          )
        }
      ] as Wallet.KeyManagement.GroupedAddress[],
      date,
      fiatCurrency: {
        code: currencyCode.USD,
        symbol: '$'
      },
      fiatPrice: 1,
      environmentName: 'Preprod',
      protocolParameters: { poolDeposit: 3, stakeKeyDeposit: 2 } as Wallet.ProtocolParameters,
      cardanoCoin,
      resolveInput: () => Promise.resolve(null)
    });

    expect(result[0].label).toBe('Midgard L2 Deposit');
    expect(result[0].type).toBe(TransactionActivityType.outgoing);
    expect(result[0].direction).toBe('Outgoing');
    expect(result[0].amount).toBe('10.00 ADA');
    expect(result[0].fiatAmount).toBe('10.00 USD');

    inspectTxTypeSpy.mockRestore();
    inspectTxValuesSpy.mockRestore();
  });

  test('should override Midgard layer2 activity amount with Midgard value delta', async () => {
    mockGetFormattedAmount.mockReset();
    mockGetFormattedAmount.mockReturnValueOnce('9999.99 ADA').mockReturnValueOnce('2.00 ADA');
    const inspectTxTypeSpy = jest
      .spyOn(txInspection, 'inspectTxType')
      .mockResolvedValueOnce(TransactionActivityType.outgoing);
    const inspectTxValuesSpy = jest
      .spyOn(txInspection, 'inspectTxValues')
      .mockResolvedValueOnce({ coins: BigInt('2000000') } as Wallet.Cardano.Value);

    const layer2Tx = {
      ...txHistory,
      blockHeader: {
        blockNo: 1,
        hash: Wallet.Cardano.BlockId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        slot: 42
      },
      midgardTxProvenance: Wallet.MidgardTxProvenance.Layer2Native
    };

    const result: any = await txHistoryTransformers.txHistoryTransformer({
      tx: layer2Tx,
      walletAddresses: [
        {
          address: Wallet.Cardano.PaymentAddress(
            'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
          ),
          rewardAccount: Wallet.Cardano.RewardAccount(
            'stake_test1uq7g7kqeucnqfweqzgxk3dw34e8zg4swnc7nagysug2mm4cm77jrx'
          )
        }
      ] as Wallet.KeyManagement.GroupedAddress[],
      date,
      fiatCurrency: {
        code: currencyCode.USD,
        symbol: '$'
      },
      fiatPrice: 1,
      environmentName: 'Preprod',
      protocolParameters: { poolDeposit: 3, stakeKeyDeposit: 2 } as Wallet.ProtocolParameters,
      cardanoCoin,
      resolveInput: () => Promise.resolve(null)
    });

    expect(result[0].label).toBeUndefined();
    expect(result[0].direction).toBe('Outgoing');
    expect(result[0].amount).toBe('2.00 ADA');
    expect(result[0].fiatAmount).toBe('2.00 USD');
    expect(inspectTxValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'Outgoing'
      })
    );

    inspectTxTypeSpy.mockRestore();
    inspectTxValuesSpy.mockRestore();
  });
});
