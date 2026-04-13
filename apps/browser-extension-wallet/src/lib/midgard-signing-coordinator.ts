import { Wallet } from '@lace/cardano';
import { AnyBip32Wallet, AnyWallet, WalletType } from '@cardano-sdk/web-extension';
import { Subject } from 'rxjs';
import { Logger } from 'ts-log';

type InMemoryKeyAgentFactory = {
  InMemory: (args: {
    accountIndex: number;
    chainId: Wallet.Cardano.ChainId;
    encryptedRootPrivateKeyBytes: number[];
    extendedAccountPublicKey: Wallet.Crypto.Bip32PublicKeyHex;
    getPassphrase: () => Promise<Uint8Array>;
    purpose?: Wallet.KeyManagement.KeyPurpose;
  }) => Promise<Wallet.KeyManagement.KeyAgent>;
};

export interface MidgardSigningRequestContext {
  accountIndex: number;
  chainId: Wallet.Cardano.ChainId;
  wallet: AnyWallet<Wallet.WalletMetadata, Wallet.AccountMetadata>;
}

export interface MidgardTransactionWitnessRequest {
  derivationPaths: Wallet.KeyManagement.AccountKeyDerivationPath[];
  reject: (reason?: string) => Promise<void>;
  requestContext: MidgardSigningRequestContext;
  sign: (passphrase?: Uint8Array) => Promise<Wallet.MidgardNativeSignatureWitness[]>;
  signingHash: string;
  walletType: WalletType;
}

const isSupportedMidgardSigningWallet = (
  wallet: AnyWallet<Wallet.WalletMetadata, Wallet.AccountMetadata>
): wallet is Extract<AnyBip32Wallet<Wallet.WalletMetadata, Wallet.AccountMetadata>, { type: WalletType.InMemory }> =>
  wallet.type === WalletType.InMemory;

export class MidgardSigningCoordinator {
  public readonly transactionWitnessRequest$ = new Subject<MidgardTransactionWitnessRequest>();

  private readonly keyAgentFactory: InMemoryKeyAgentFactory;
  private readonly logger: Logger;

  constructor({ keyAgentFactory, logger }: { keyAgentFactory: InMemoryKeyAgentFactory; logger: Logger }) {
    this.keyAgentFactory = keyAgentFactory;
    this.logger = logger;
  }

  async signTransaction({
    derivationPaths,
    requestContext,
    signingHash
  }: {
    derivationPaths: Wallet.KeyManagement.AccountKeyDerivationPath[];
    requestContext: MidgardSigningRequestContext;
    signingHash: string;
  }): Promise<Wallet.MidgardNativeSignatureWitness[]> {
    return new Promise((resolve, reject) => {
      if (!this.transactionWitnessRequest$.observed) {
        reject(new Error('Not expecting Midgard sign requests at this time'));
        return;
      }

      const { wallet } = requestContext;
      if (!isSupportedMidgardSigningWallet(wallet)) {
        reject(new Error('Midgard native signing currently supports in-memory wallets only'));
        return;
      }

      const account = wallet.accounts.find(
        (walletAccount) => walletAccount.accountIndex === requestContext.accountIndex
      );
      if (!account) {
        reject(new Wallet.KeyManagement.errors.ProofGenerationError(`Account not found: index=${requestContext.accountIndex}`));
        return;
      }

      this.transactionWitnessRequest$.next({
        derivationPaths,
        reject: async (reason) => reject(new Wallet.KeyManagement.errors.AuthenticationError(reason)),
        requestContext,
        sign: async (passphrase?: Uint8Array) => {
          try {
            if (!passphrase) {
              throw new TypeError('Invalid state: expected password for in-memory wallet');
            }

            const keyAgent = await this.keyAgentFactory.InMemory({
              accountIndex: account.accountIndex,
              chainId: requestContext.chainId,
              encryptedRootPrivateKeyBytes: [...Buffer.from(wallet.encryptedSecrets.rootPrivateKeyBytes, 'hex')],
              extendedAccountPublicKey: account.extendedAccountPublicKey,
              getPassphrase: async () => passphrase,
              purpose: account.purpose || Wallet.KeyManagement.KeyPurpose.STANDARD
            });

            const uniquePaths = [...new Map(derivationPaths.map((path) => [`${path.role}.${path.index}`, path])).values()];
            const signatures = await Promise.all(
              uniquePaths.map(async (path) => {
                const { publicKey, signature } = await keyAgent.signBlob(path, Wallet.HexBlob(signingHash));
                return { publicKey, signature };
              })
            );

            resolve(signatures);
            return signatures;
          } catch (error) {
            this.logger.error('[MidgardSigningCoordinator] Failed to sign Midgard transaction', error);
            reject(error);
            throw error;
          }
        },
        signingHash,
        walletType: requestContext.wallet.type
      });
    });
  }
}
