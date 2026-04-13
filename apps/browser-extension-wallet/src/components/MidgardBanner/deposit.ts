import { Serialization } from '@cardano-sdk/core';
import { Wallet } from '@lace/cardano';
import { getProviders } from '@lib/scripts/background/config';

type FundingAssets = Record<string, string>;

type FundingUtxo = {
  txHash: string;
  outputIndex: number;
  address: string;
  assets: FundingAssets;
};

type BuildDepositResponse = {
  unsignedTxCbor: string;
};

type BuildMidgardDepositArgs = {
  amount: bigint;
  chainName: Wallet.ChainName;
  fundingAddresses: string[];
  l2Address: string;
  midgardUrl: string;
};

type FundingAddressUtxos = {
  address: string;
  availableCoins: bigint;
  utxos: Wallet.Cardano.Utxo[];
};

export type MidgardDepositFundingSummary = {
  fundingAddressCount: number;
  maxSingleAddress: string | undefined;
  maxSingleAddressCoins: bigint;
  totalAvailableCoins: bigint;
};

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();

    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    // Fall through to the HTTP status below when the response body is not JSON.
  }

  return `HTTP ${response.status}`;
};

const toFundingAssets = (value: Wallet.Cardano.Value): FundingAssets => {
  const assets: FundingAssets = {
    lovelace: BigInt(value.coins || 0).toString()
  };

  value.assets?.forEach((quantity, unit) => {
    assets[String(unit)] = BigInt(quantity).toString();
  });

  return assets;
};

const toFundingUtxo = ([txIn, txOut]: Wallet.Cardano.Utxo): FundingUtxo => ({
  txHash: txIn.txId,
  outputIndex: txIn.index,
  address: txOut.address,
  assets: toFundingAssets(txOut.value)
});

const getAvailableCoins = (utxos: Wallet.Cardano.Utxo[]): bigint =>
  utxos.reduce((total, [, txOut]) => total + BigInt(txOut.value.coins || 0), BigInt(0));

const loadFundingSources = async ({
  chainName,
  fundingAddresses
}: Pick<BuildMidgardDepositArgs, 'chainName' | 'fundingAddresses'>): Promise<FundingAddressUtxos[]> => {
  const providers = await getProviders(chainName, { forceMidgardEnabled: false });
  const uniqueFundingAddresses = [...new Set(fundingAddresses.map((address) => address.trim()).filter(Boolean))];

  return (
    await Promise.all(
      uniqueFundingAddresses.map(async (address): Promise<FundingAddressUtxos> => ({
        address,
        availableCoins: BigInt(0),
        utxos: await providers.utxoProvider.utxoByAddresses({
          addresses: [address]
        })
      }))
    )
  ).map((source) => ({
    ...source,
    availableCoins: getAvailableCoins(source.utxos)
  }));
};

export const getMidgardDepositFundingSummary = async ({
  chainName,
  fundingAddresses
}: Pick<BuildMidgardDepositArgs, 'chainName' | 'fundingAddresses'>): Promise<MidgardDepositFundingSummary> => {
  const fundingSources = await loadFundingSources({ chainName, fundingAddresses });
  const richestFundingSource = fundingSources.reduce<FundingAddressUtxos | undefined>(
    (richestSource, source) =>
      !richestSource || source.availableCoins > richestSource.availableCoins ? source : richestSource,
    undefined
  );

  return {
    fundingAddressCount: fundingSources.length,
    maxSingleAddress: richestFundingSource?.address,
    maxSingleAddressCoins: richestFundingSource?.availableCoins ?? BigInt(0),
    totalAvailableCoins: fundingSources.reduce((total, source) => total + source.availableCoins, BigInt(0))
  };
};

export const getTxIdFromTxCbor = (txCbor: string): string =>
  Serialization.Transaction.fromCbor(Wallet.Serialization.TxCBOR(txCbor)).toCore().id.toString();

export const submitSignedCardanoTx = async ({
  chainName,
  signedTxCbor
}: {
  chainName: Wallet.ChainName;
  signedTxCbor: string;
}): Promise<string> => {
  const providers = await getProviders(chainName, { forceMidgardEnabled: false });
  const expectedTxId = getTxIdFromTxCbor(signedTxCbor);

  const providerTxId = (await providers.txSubmitProvider.submitTx({
    signedTransaction: Uint8Array.from(Buffer.from(signedTxCbor, 'hex'))
  })) as unknown;

  if (providerTxId !== undefined) {
    if (typeof providerTxId !== 'string' || providerTxId.length === 0) {
      throw new Error('Cardano submit provider returned an invalid transaction id');
    }

    if (providerTxId !== expectedTxId) {
      throw new Error(`Cardano submit tx id mismatch: expected ${expectedTxId}, got ${providerTxId}`);
    }
  }

  return expectedTxId;
};

export const buildMidgardDeposit = async ({
  amount,
  chainName,
  fundingAddresses,
  l2Address,
  midgardUrl
}: BuildMidgardDepositArgs): Promise<BuildDepositResponse> => {
  let lastBuildError: Error | undefined;
  const fundingSources = await loadFundingSources({ chainName, fundingAddresses });

  const aggregateAvailableCoins = fundingSources.reduce((total, source) => total + source.availableCoins, BigInt(0));
  if (aggregateAvailableCoins < amount) {
    throw new Error('Cardano balance across the selected wallet addresses is not enough to cover this deposit and fees');
  }

  const fundedSources = fundingSources.filter((source) => source.utxos.length > 0);
  if (fundedSources.length === 0) {
    throw new Error('Cardano balance across the selected wallet addresses is not enough to cover this deposit and fees');
  }

  const primaryFundingAddress = fundingAddresses.map((address) => address.trim()).find(Boolean);
  const candidateFundingAddresses = [
    ...(primaryFundingAddress && fundedSources.some((source) => source.address === primaryFundingAddress)
      ? [primaryFundingAddress]
      : []),
    ...fundedSources
      .sort((lhs, rhs) => {
        if (lhs.availableCoins === rhs.availableCoins) return 0;
        return lhs.availableCoins > rhs.availableCoins ? -1 : 1;
      })
      .map(({ address }) => address)
  ].filter((address, index, addresses) => addresses.indexOf(address) === index);
  const fundingUtxos = fundedSources.flatMap((source) => source.utxos).map((utxo) => toFundingUtxo(utxo));

  for (const fundingAddress of candidateFundingAddresses) {
    const response = await fetch(`${trimTrailingSlashes(midgardUrl)}/deposit/build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fundingAddress,
        fundingUtxos,
        l2Address,
        lovelace: amount.toString(),
        additionalAssets: []
      })
    });

    if (!response.ok) {
      lastBuildError = new Error(await readErrorMessage(response));
      continue;
    }

    const payload = (await response.json()) as Partial<BuildDepositResponse>;
    if (typeof payload.unsignedTxCbor !== 'string' || payload.unsignedTxCbor.length === 0) {
      throw new Error('Midgard deposit builder returned an invalid unsigned transaction');
    }

    return {
      unsignedTxCbor: payload.unsignedTxCbor
    };
  }

  throw lastBuildError ?? new Error('Midgard deposit builder did not return an unsigned transaction');
};
