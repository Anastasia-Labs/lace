import React, { useState } from 'react';
import classnames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { toast, Button } from '@lace/common';
import { Switch } from 'antd';
import SwitchIcon from '@src/assets/icons/switch.component.svg';
import { config } from '@src/config';
import styles from './MidgardBanner.module.scss';

const DEPOSIT_AMOUNT_LOVELACE = 10_000_000; // 10 ADA
const TX_PREVIEW_LENGTH = 8;

type MidgardUtxo = { outref: string; value: string };

const callDepositEndpoint = async (
  midgardUrl: string,
  addressBech32: string,
  amount: number
): Promise<{ txHash: string }> => {
  const response = await fetch(`${midgardUrl}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amount.toString(), address: addressBech32 })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((errorData as { error?: string }).error || `HTTP ${response.status}`);
  }

  return response.json() as Promise<{ txHash: string }>;
};

const fetchMidgardUtxos = async (midgardUrl: string, address: string): Promise<MidgardUtxo[]> => {
  const response = await fetch(`${midgardUrl}/utxos?address=${encodeURIComponent(address)}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((errorData as { error?: string }).error || `HTTP ${response.status}`);
  }

  const data = (await response.json()) as { utxos: MidgardUtxo[] };
  return data.utxos;
};

export const MidgardBanner = (): React.ReactElement => {
  const { t } = useTranslation();
  const { environmentName, isMidgardEnabled, setMidgardMode, walletInfo } = useWalletStore();
  const [isProcessing, setIsProcessing] = useState(false);

  if (environmentName !== 'Preprod') return <></>;

  const handleToggle = () => {
    const newState = !isMidgardEnabled;
    setMidgardMode(newState);
    toast.notify({
      text: newState ? t('general.midgard.modeEnabled') : t('general.midgard.modeDisabled'),
      withProgressBar: true,
      icon: SwitchIcon
    });
  };

  const handleDeposit = async () => {
    setIsProcessing(true);
    try {
      const address = walletInfo?.addresses?.[0]?.address?.toString();
      if (!address) {
        throw new Error(t('general.midgard.noAddress'));
      }

      const midgardUrl = environmentName ? config().MIDGARD_URLS[environmentName] : undefined;
      if (!midgardUrl) {
        throw new Error(`Midgard not configured for ${environmentName ?? 'this network'}`);
      }

      console.info(
        '[MidgardBanner] POST',
        `${midgardUrl}/deposit`,
        '| address:',
        address,
        '| amount:',
        DEPOSIT_AMOUNT_LOVELACE
      );
      const result = await callDepositEndpoint(midgardUrl, address, DEPOSIT_AMOUNT_LOVELACE);
      console.info('[MidgardBanner] Deposit success | txHash:', result.txHash);
      toast.notify({
        text: `${t('general.midgard.depositSuccess')} ${result.txHash?.slice(0, TX_PREVIEW_LENGTH)}...`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    } catch (error) {
      console.error('[MidgardBanner] Deposit failed:', error);
      toast.notify({
        text: `${t('general.midgard.depositFailed')} ${(error as Error).message}`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdrawal = async () => {
    // Withdrawal requires Midgard SDK for Plutus Data CBOR serialization + Ed25519 signing.
    // Pre-flight: verify address and L2 balance so we can surface an accurate message.
    try {
      const address = walletInfo?.addresses?.[0]?.address?.toString();
      if (!address) {
        throw new Error(t('general.midgard.noAddress'));
      }

      const midgardUrl = environmentName ? config().MIDGARD_URLS[environmentName] : undefined;
      if (!midgardUrl) {
        throw new Error(`Midgard not configured for ${environmentName ?? 'this network'}`);
      }

      console.info('[MidgardBanner] GET', `${midgardUrl}/utxos`, '| address:', address);
      const utxos = await fetchMidgardUtxos(midgardUrl, address);
      console.info('[MidgardBanner] L2 UTxOs found:', utxos.length, utxos);

      if (utxos.length === 0) {
        toast.notify({ text: t('general.midgard.noMidgardUtxos'), withProgressBar: true, icon: SwitchIcon });
        return;
      }

      // L2 balance confirmed. Two blockers prevent completing withdrawal:
      //
      // 1. Plutus Data serialization — need Data.from/to (@lucid-evolution/lucid) to:
      //      - decode outref + value CBOR from /utxos response
      //      - build WithdrawalBody { l2_outref, l2_owner, l2_value, l1_address, l1_datum }
      //      - serialize it back to CBOR hex (withdrawal_body)
      //    Importing lucid-evolution directly in the UI layer risks service worker bundling issues.
      //
      // 2. Raw Ed25519 signing — withdrawal_signature = sign(withdrawal_body, user_private_key)
      //    Hardware wallets (Ledger/Trezor) cannot sign arbitrary bytes — in-memory wallets only.
      //    Requires dedicated Midgard SDK support to handle signing via the wallet store.
      console.info('[MidgardBanner] Withdrawal SDK integration pending | utxo outref:', utxos[0].outref);
      toast.notify({ text: t('general.midgard.withdrawComingSoon'), withProgressBar: true, icon: SwitchIcon });
    } catch (error) {
      console.error('[MidgardBanner] Withdrawal pre-flight failed:', error);
      toast.notify({
        text: `${t('general.midgard.withdrawFailed')} ${(error as Error).message}`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    }
  };

  const handleActionClick = async () => {
    await (isMidgardEnabled ? handleWithdrawal() : handleDeposit());
  };

  const getButtonLabel = () => {
    if (isProcessing) return t('general.midgard.depositing');
    return isMidgardEnabled ? t('general.midgard.withdraw') : t('general.midgard.deposit');
  };

  return (
    <div className={styles.container} data-testid="midgard-banner-container">
      <div
        className={classnames(styles.banner, isMidgardEnabled ? styles.enabled : styles.disabled)}
        onClick={handleToggle}
        data-testid="midgard-toggle-banner"
      >
        <span className={styles.text}>{`${t('general.networks.midgard')} mode`}</span>
        <Switch checked={isMidgardEnabled} size="default" />
      </div>
      <Button
        data-testid="midgard-action-button"
        className={styles.actionButton}
        onClick={handleActionClick}
        disabled={isProcessing}
      >
        {getButtonLabel()}
      </Button>
    </div>
  );
};
