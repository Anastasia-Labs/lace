import { useMemo } from 'react';
import { walletBalanceTransformer } from '../api/transformers';
import { useObservable } from '@lace/common';
import { useWalletStore } from '../stores';
import { WalletBalance } from '../types';

export interface BalancesReturnedFields {
  /**
   * Wallet's balance in ADA and fiat, including rewards available to claim
   */
  balance: {
    total: WalletBalance;
    available: WalletBalance;
  };
  /**
   * Rewards available to claim in ADA and fiat
   */
  rewards: WalletBalance;
  /**
   * Available deposit in ADA and fiat
   */
  deposit: WalletBalance;
}

export const useBalances = (fiatPrice?: number): BalancesReturnedFields => {
  const { inMemoryWallet, isMidgardEnabled } = useWalletStore();
  const total = useObservable(inMemoryWallet.balance.utxo.total$);
  const available = useObservable(inMemoryWallet.balance.utxo.available$);
  const availableDeposits = useObservable(inMemoryWallet.balance.rewardAccounts.deposit$);
  const availableRewards = useObservable(inMemoryWallet.balance.rewardAccounts.rewards$);
  const rewardsToDisplay = isMidgardEnabled ? BigInt(0) : BigInt(availableRewards || BigInt(0));
  const depositsToDisplay = isMidgardEnabled ? BigInt(0) : BigInt(availableDeposits || BigInt(0));
  const balance = useMemo(
    () =>
      total && available
        ? {
            total: walletBalanceTransformer(
              BigInt((total.coins || BigInt(0)) + rewardsToDisplay).toString(),
              fiatPrice
            ),
            available: walletBalanceTransformer(
              BigInt((available.coins || BigInt(0)) + rewardsToDisplay).toString(),
              fiatPrice
            )
          }
        : undefined,
    [total, available, fiatPrice, rewardsToDisplay]
  );

  const rewards = useMemo(
    () => walletBalanceTransformer(rewardsToDisplay.toString(), fiatPrice),
    [fiatPrice, rewardsToDisplay]
  );

  const deposit = useMemo(
    () => walletBalanceTransformer(depositsToDisplay.toString(), fiatPrice),
    [depositsToDisplay, fiatPrice]
  );

  return { balance, rewards, deposit };
};
