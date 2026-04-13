import { submitMidgardTx } from '../midgard-submit';

describe('submitMidgardTx', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns the queued Midgard tx id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ status: 'queued', txId: 'midgard-tx-id' }),
      ok: true
    } as unknown as Response);

    await expect(
      submitMidgardTx({
        expectedTxId: 'midgard-tx-id',
        midgardUrl: 'http://localhost:3000',
        signedTxCbor: 'abcd'
      })
    ).resolves.toBe('midgard-tx-id');
  });

  test('rejects when the backend returns a different tx id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ status: 'queued', txId: 'different-id' }),
      ok: true
    } as unknown as Response);

    await expect(
      submitMidgardTx({
        expectedTxId: 'expected-id',
        midgardUrl: 'http://localhost:3000',
        signedTxCbor: 'abcd'
      })
    ).rejects.toThrow('Midgard submit tx id mismatch');
  });

  test('rejects invalid payloads', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ status: 'queued' }),
      ok: true
    } as unknown as Response);

    await expect(
      submitMidgardTx({
        midgardUrl: 'http://localhost:3000',
        signedTxCbor: 'abcd'
      })
    ).rejects.toThrow('invalid transaction id');
  });

  test('rejects invalid queued statuses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ status: 'accepted', txId: 'midgard-tx-id' }),
      ok: true
    } as unknown as Response);

    await expect(
      submitMidgardTx({
        midgardUrl: 'http://localhost:3000',
        signedTxCbor: 'abcd'
      })
    ).rejects.toThrow('Unexpected Midgard submit status');
  });
});
