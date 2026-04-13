import { Cardano } from '@cardano-sdk/core';
import { MidgardInputResolver } from '../input-resolver';
import { MidgardError } from '../client';

const fromCborMock = jest.fn();
const MIDGARD_NOT_FOUND_STATUS = 404;

jest.mock('@cardano-sdk/core', () => {
  const actual = jest.requireActual<typeof import('@cardano-sdk/core')>('@cardano-sdk/core');

  return {
    ...actual,
    Serialization: {
      ...actual.Serialization,
      TransactionOutput: {
        ...actual.Serialization.TransactionOutput,
        fromCbor: (...args: unknown[]) => fromCborMock(...args)
      }
    }
  };
});

describe('MidgardInputResolver', () => {
  const cache = {
    get: jest.fn(),
    set: jest.fn()
  } as const;
  const logger = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  } as const;
  const midgardClient = {
    post: jest.fn()
  } as const;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves tx outputs through the Midgard outrefs endpoint and caches them', async () => {
    const resolvedOutput = {
      address: 'addr_test1qq...',
      value: { coins: 1n }
    } as unknown as Cardano.TxOut;

    cache.get.mockResolvedValue(false);
    cache.set.mockResolvedValue(false);
    midgardClient.post.mockResolvedValue({
      utxos: [{ outref: 'ignored', value: 'deadbeef' }]
    });
    fromCborMock.mockReturnValue({
      toCore: () => resolvedOutput
    });

    const resolver = new MidgardInputResolver({
      cache: cache as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['cache'],
      logger: logger as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['logger'],
      midgardClient: midgardClient as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['midgardClient']
    });

    const input = { txId: 'txhash', index: 0 } as unknown as Cardano.TxIn;

    await expect(resolver.resolveInput(input)).resolves.toBe(resolvedOutput);
    expect(midgardClient.post).toHaveBeenCalledWith('utxos?by-outrefs', ['txhash#0']);
    expect(cache.set).toHaveBeenCalledWith('txhash#0', resolvedOutput);
  });

  test('returns null when Midgard does not know the outref', async () => {
    cache.get.mockResolvedValue(false);
    midgardClient.post.mockRejectedValue(new MidgardError(MIDGARD_NOT_FOUND_STATUS, 'missing'));

    const resolver = new MidgardInputResolver({
      cache: cache as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['cache'],
      logger: logger as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['logger'],
      midgardClient: midgardClient as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['midgardClient']
    });

    const input = { txId: 'unknown', index: 1 } as unknown as Cardano.TxIn;

    await expect(resolver.resolveInput(input)).resolves.toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('uses transaction hints before calling Midgard', async () => {
    const hintedOutput = {
      address: 'addr_test1hint...',
      value: { coins: 2n }
    } as unknown as Cardano.TxOut;

    cache.get.mockResolvedValue(false);

    const resolver = new MidgardInputResolver({
      cache: cache as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['cache'],
      logger: logger as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['logger'],
      midgardClient: midgardClient as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['midgardClient']
    });

    const input = { txId: 'hinted', index: 0 } as unknown as Cardano.TxIn;

    await expect(
      resolver.resolveInput(input, {
        hints: {
          transactions: [
            {
              id: 'hinted',
              body: {
                outputs: [hintedOutput]
              }
            } as unknown as Cardano.Tx
          ]
        }
      })
    ).resolves.toBe(hintedOutput);

    expect(midgardClient.post).not.toHaveBeenCalled();
  });

  test('uses utxo hints before calling Midgard', async () => {
    const hintedOutput = {
      address: 'addr_test1utxo...',
      value: { coins: 3n }
    } as unknown as Cardano.TxOut;

    cache.get.mockResolvedValue(false);

    const resolver = new MidgardInputResolver({
      cache: cache as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['cache'],
      logger: logger as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['logger'],
      midgardClient: midgardClient as unknown as ConstructorParameters<typeof MidgardInputResolver>[0]['midgardClient']
    });

    const input = { txId: 'hinted-utxo', index: 1 } as unknown as Cardano.TxIn;
    const hydratedInput = {
      ...input,
      address: 'addr_test1utxo...'
    } as unknown as Cardano.HydratedTxIn;

    await expect(
      resolver.resolveInput(input, {
        hints: {
          utxos: [[hydratedInput, hintedOutput]]
        }
      })
    ).resolves.toBe(hintedOutput);

    expect(midgardClient.post).not.toHaveBeenCalled();
  });
});
