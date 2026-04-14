import { Serialization } from '@cardano-sdk/core';
import { getProviders } from '@lib/scripts/background/config';
import { Wallet } from '@lace/cardano';
import { AnyBip32Wallet, AnyWallet, WalletType } from '@cardano-sdk/web-extension';
import { signingCoordinator } from './wallet-api-ui';

export interface ExternalCardanoSigningRequestContext {
  accountIndex: number;
  chainId: Wallet.Cardano.ChainId;
  purpose: Wallet.KeyManagement.KeyPurpose;
  wallet: AnyWallet<Wallet.WalletMetadata, Wallet.AccountMetadata>;
}

type SignExternalCardanoTxArgs = {
  chainName: Wallet.ChainName;
  knownAddresses: Wallet.KeyManagement.GroupedAddress[];
  requestContext: ExternalCardanoSigningRequestContext;
  txCbor: string;
};

const isAnyBip32Wallet = (
  wallet: AnyWallet<Wallet.WalletMetadata, Wallet.AccountMetadata>
): wallet is AnyBip32Wallet<Wallet.WalletMetadata, Wallet.AccountMetadata> =>
  wallet.type === WalletType.InMemory || wallet.type === WalletType.Ledger || wallet.type === WalletType.Trezor;

export const signExternalCardanoTx = async ({
  chainName,
  knownAddresses,
  requestContext,
  txCbor
}: SignExternalCardanoTxArgs): Promise<string> => {
  if (knownAddresses.length === 0) {
    throw new Error('Wallet addresses are not available for Cardano signing');
  }
  if (!isAnyBip32Wallet(requestContext.wallet)) {
    throw new Error('Cardano signing requires a bip32 wallet account');
  }

  const providers = await getProviders(chainName, { forceMidgardEnabled: false });
  const transaction = Serialization.Transaction.fromCbor(Wallet.Serialization.TxCBOR(txCbor));
  const coreTx = transaction.toCore();
  const txInKeyPathMap = await Wallet.KeyManagement.util.createTxInKeyPathMap(
    transaction.body().toCore(),
    knownAddresses,
    providers.inputResolver
  );

  const signatures = await signingCoordinator.signTransaction(
    {
      signContext: {
        knownAddresses,
        scripts: coreTx.witness?.scripts ?? [],
        txInKeyPathMap
      },
      tx: transaction.toCbor()
    },
    {
      ...requestContext,
      wallet: requestContext.wallet
    }
  );

  const mergedSignatures = new Map([...(coreTx.witness?.signatures ?? []), ...signatures]);
  const witnessSet = transaction.witnessSet();
  witnessSet.setVkeys(
    Serialization.CborSet.fromCore([...mergedSignatures.entries()], Serialization.VkeyWitness.fromCore)
  );
  transaction.setWitnessSet(witnessSet);

  return transaction.toCbor();
};
