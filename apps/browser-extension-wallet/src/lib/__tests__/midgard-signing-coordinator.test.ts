import { WalletType } from '@cardano-sdk/web-extension';

jest.mock('@lace/cardano', () => ({
  Wallet: {
    HexBlob: (value: string) => value,
    KeyManagement: {
      KeyPurpose: {
        STANDARD: 0
      },
      errors: {
        AuthenticationError: class AuthenticationError extends Error {},
        ProofGenerationError: class ProofGenerationError extends Error {}
      }
    }
  }
}));

import { MidgardSigningCoordinator } from '../midgard-signing-coordinator';

describe('MidgardSigningCoordinator', () => {
  const mockSignBlob = jest.fn();
  const keyAgentFactory = {
    InMemory: jest.fn()
  };
  const logger = {
    error: jest.fn()
  } as const;

  beforeEach(() => {
    jest.clearAllMocks();
    keyAgentFactory.InMemory.mockResolvedValue({
      signBlob: (...args: unknown[]) => mockSignBlob(...args)
    });
    mockSignBlob.mockResolvedValue({
      publicKey: 'pubkey',
      signature: 'signature'
    });
  });

  test('rejects unsupported wallet types before publishing a signing request', async () => {
    const coordinator = new MidgardSigningCoordinator({
      keyAgentFactory: keyAgentFactory as never,
      logger: logger as never
    });
    const observer = jest.fn();
    const subscription = coordinator.transactionWitnessRequest$.subscribe(observer);

    await expect(
      coordinator.signTransaction({
        derivationPaths: [{ index: 0, role: 0 }] as never,
        requestContext: {
          accountIndex: 0,
          chainId: { networkId: 0, networkMagic: 1 } as never,
          wallet: {
            accounts: [{ accountIndex: 0 }],
            type: WalletType.Ledger
          } as never
        },
        signingHash: 'abcd'
      })
    ).rejects.toThrow('Midgard native signing currently supports in-memory wallets only');

    expect(observer).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  test('publishes supported signing requests and de-duplicates derivation paths before signing', async () => {
    const coordinator = new MidgardSigningCoordinator({
      keyAgentFactory: keyAgentFactory as never,
      logger: logger as never
    });

    let requestPromiseResolve: ((value: unknown) => void) | undefined;
    const requestPromise = new Promise((resolve) => {
      requestPromiseResolve = resolve;
    });
    const subscription = coordinator.transactionWitnessRequest$.subscribe((request) => {
      requestPromiseResolve?.(request);
    });

    const signingPromise = coordinator.signTransaction({
      derivationPaths: [
        { index: 0, role: 0 },
        { index: 0, role: 0 }
      ] as never,
      requestContext: {
        accountIndex: 0,
        chainId: { networkId: 0, networkMagic: 1 } as never,
        wallet: {
          accounts: [{ accountIndex: 0, extendedAccountPublicKey: 'acct-pub-key', purpose: 0 }],
          encryptedSecrets: { rootPrivateKeyBytes: 'aa' },
          type: WalletType.InMemory
        } as never
      },
      signingHash: 'abcd'
    });

    const request = (await requestPromise) as {
      sign: (passphrase?: Uint8Array) => Promise<unknown>;
    };

    await request.sign(Uint8Array.from([1, 2, 3]));

    await expect(signingPromise).resolves.toEqual([{ publicKey: 'pubkey', signature: 'signature' }]);
    expect(keyAgentFactory.InMemory).toHaveBeenCalledTimes(1);
    expect(mockSignBlob).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });
});
