import { logger } from '@lace/common';
import { getProviders } from '@lib/scripts/background/config';
import { Wallet } from '@lace/cardano';
import {
  isMidgardDepositActivity,
  isMidgardDepositCertificateCandidate
} from '@src/views/browser-view/features/activity/helpers/midgard-activity';
import { getMidgardDepositStatusByCardanoTxHash } from './midgard-deposit-status';
import { getMidgardUrl, trimTrailingSlashes } from './midgard-url';

const CARDANO_HISTORY_PAGE_SIZE = 100;
const midgardConfirmedDepositCache = new Map<string, boolean>();

const deduplicateTransactionsById = (transactions: Wallet.Cardano.HydratedTx[]): Wallet.Cardano.HydratedTx[] => {
  const transactionsById = new Map<string, Wallet.Cardano.HydratedTx>();

  for (const transaction of transactions) {
    const txId = transaction.id.toString();
    if (!transactionsById.has(txId)) {
      transactionsById.set(txId, transaction);
    }
  }

  return [...transactionsById.values()];
};

const markAsMidgardLayer1Bridge = (transaction: Wallet.Cardano.HydratedTx): Wallet.Cardano.HydratedTx => ({
  ...transaction,
  midgardTxProvenance: Wallet.MidgardTxProvenance.Layer1Bridge
}) as Wallet.Cardano.HydratedTx;

const getConfirmedDepositCacheKey = ({ midgardUrl, txId }: { midgardUrl: string; txId: string }): string =>
  `${trimTrailingSlashes(midgardUrl)}:${txId}`;

const isConfirmedMidgardDeposit = async ({
  midgardUrl,
  txId
}: {
  midgardUrl: string;
  txId: string;
}): Promise<boolean> => {
  const cacheKey = getConfirmedDepositCacheKey({ midgardUrl, txId });
  const cachedValue = midgardConfirmedDepositCache.get(cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const status = await getMidgardDepositStatusByCardanoTxHash({ midgardUrl, cardanoTxHash: txId });
  const isConfirmedDeposit = !!status;
  midgardConfirmedDepositCache.set(cacheKey, isConfirmedDeposit);
  return isConfirmedDeposit;
};

export const enrichTransactionsWithMidgardDepositProvenance = async ({
  environmentName,
  transactions
}: {
  environmentName?: Wallet.ChainName;
  transactions: Wallet.Cardano.HydratedTx[];
}): Promise<Wallet.Cardano.HydratedTx[]> => {
  if (!environmentName || transactions.length === 0) {
    return transactions;
  }

  const midgardUrl = await getMidgardUrl(environmentName);
  if (!midgardUrl) {
    return transactions;
  }

  return Promise.all(
    transactions.map(async (transaction) => {
      if (isMidgardDepositActivity(transaction, environmentName)) {
        return transaction;
      }

      if (!isMidgardDepositCertificateCandidate(transaction)) {
        return transaction;
      }

      try {
        return (await isConfirmedMidgardDeposit({
          midgardUrl,
          txId: transaction.id.toString()
        }))
          ? markAsMidgardLayer1Bridge(transaction)
          : transaction;
      } catch (error) {
        logger.warn(`[Midgard] Failed to confirm historical deposit status for ${transaction.id}`, error);
        return transaction;
      }
    })
  );
};

export const loadMidgardCardanoDepositHistory = async ({
  addresses,
  chainName
}: {
  addresses: Array<{ address: Wallet.Cardano.PaymentAddress }>;
  chainName: Wallet.ChainName;
}): Promise<Wallet.Cardano.HydratedTx[]> => {
  const walletAddresses = [...new Set(addresses.map(({ address }) => address.toString()))];
  if (walletAddresses.length === 0) {
    return [];
  }

  const { chainHistoryProvider } = await getProviders(chainName, { forceMidgardEnabled: false });
  const cardanoTransactions: Wallet.Cardano.HydratedTx[] = [];
  let startAt = 0;

  while (true) {
    const response = await chainHistoryProvider.transactionsByAddresses({
      addresses: walletAddresses,
      pagination: {
        limit: CARDANO_HISTORY_PAGE_SIZE,
        order: 'desc',
        startAt
      }
    });

    cardanoTransactions.push(...response.pageResults);

    const reachedEnd =
      response.pageResults.length < CARDANO_HISTORY_PAGE_SIZE ||
      startAt + response.pageResults.length >= response.totalResultCount;
    if (reachedEnd) {
      break;
    }

    startAt += CARDANO_HISTORY_PAGE_SIZE;
  }

  const uniqueTransactions = deduplicateTransactionsById(cardanoTransactions);
  const enrichedTransactions = await enrichTransactionsWithMidgardDepositProvenance({
    environmentName: chainName,
    transactions: uniqueTransactions
  });

  return enrichedTransactions.filter((tx) => isMidgardDepositActivity(tx, chainName));
};
