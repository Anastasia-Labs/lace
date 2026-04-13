const mockTransactionFromCbor = jest.fn();

jest.mock('@cardano-sdk/core', () => ({
  Serialization: {
    Transaction: {
      fromCbor: (...args: unknown[]) => mockTransactionFromCbor(...args)
    }
  }
}));

jest.mock('@cardano-sdk/util', () => ({
  HexBlob: (value: string) => value
}));

import { MidgardTxSubmitProvider } from '../tx-submit-provider';

describe('MidgardTxSubmitProvider', () => {
  const midgardClient = {
    post: jest.fn()
  } as const;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  } as const;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransactionFromCbor.mockReturnValue({
      toCore: () => ({
        id: {
          toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        }
      })
    });
  });

  test('submits tx cbor and returns the canonical Midgard tx id', async () => {
    midgardClient.post.mockResolvedValue({
      txId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'queued'
    });

    const provider = new MidgardTxSubmitProvider(midgardClient as never, logger as never);

    await expect(
      provider.submitTx({
        signedTransaction: 'deadbeef'
      })
    ).resolves.toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(midgardClient.post).toHaveBeenCalledWith(
      'submit',
      // eslint-disable-next-line camelcase
      { tx_cbor: 'deadbeef' }
    );
  });

  test('rejects when the backend returns a different tx id', async () => {
    midgardClient.post.mockResolvedValue({
      txId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'queued'
    });

    const provider = new MidgardTxSubmitProvider(midgardClient as never, logger as never);

    await expect(
      provider.submitTx({
        signedTransaction: 'deadbeef'
      })
    ).rejects.toThrow('Midgard submit tx id mismatch');
  });

  test('rejects odd-length hex payloads before attempting submission', async () => {
    const provider = new MidgardTxSubmitProvider(midgardClient as never, logger as never);

    await expect(
      provider.submitTx({
        signedTransaction: 'abc'
      })
    ).rejects.toThrow('Signed transaction string must be hex-encoded CBOR');

    expect(midgardClient.post).not.toHaveBeenCalled();
  });
});
