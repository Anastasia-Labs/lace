import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { toast, Button } from '@lace/common';
import { Switch } from 'antd';
import SwitchIcon from '@src/assets/icons/switch.component.svg';
import styles from './MidgardBanner.module.scss';
import { config } from '@src/config';
import { Wallet } from '@lace/cardano';

const DEPOSIT_AMOUNT = 10_000_000; // 10 ADA in lovelace
const TX_HASH_PREVIEW_LENGTH = 8;

/* eslint-disable camelcase */
interface WithdrawalBody {
  l2_outref: {
    txHash: { hash: string };
    outputIndex: number | bigint;
  };
  l2_owner: string;
  l2_value: number | bigint;
  l1_address: string;
  l1_datum: string;
}

type WithdrawalSignature = Array<[string, string]>;

const getWalletAddressHex = (walletAddressBech32: string): string => {
  const parsedAddress = Wallet.Cardano.Address.fromBech32(walletAddressBech32);
  return parsedAddress.toBytes();
};

const callDepositEndpoint = async (
  midgardUrl: string,
  addressHex: string,
  amount: number
): Promise<{ txHash: string }> => {
  const response = await fetch(`${midgardUrl}/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount,
      address: addressHex,
      datum: undefined
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
};

const callWithdrawalEndpoint = async (
  midgardUrl: string,
  refundAddressBech32: string,
  withdrawalBody: WithdrawalBody,
  withdrawalSignature: WithdrawalSignature
): Promise<{ txHash: string }> => {
  const response = await fetch(`${midgardUrl}/withdrawal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      withdrawal_body: withdrawalBody,
      withdrawal_signature: withdrawalSignature,
      refund_address: refundAddressBech32,
      refund_datum: ''
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
};

export const MidgardBanner = (): React.ReactElement => {
  const { t } = useTranslation();
  const { environmentName, isMidgardEnabled, setMidgardMode, walletInfo, blockchainProvider } = useWalletStore();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleToggle = () => {
    const newState = !isMidgardEnabled;
    setMidgardMode(newState);

    toast.notify({
      text: newState ? 'Midgard Layer 2 enabled' : 'Midgard Layer 2 disabled',
      withProgressBar: true,
      icon: SwitchIcon
    });
  };

  const handleButtonClick = async () => {
    setIsProcessing(true);

    try {
      if (!walletInfo?.addresses?.[0]?.address) {
        throw new Error('Wallet address not available');
      }

      const walletAddressBech32 = walletInfo.addresses[0].address.toString();
      const appConfig = config();
      const midgardUrl = appConfig.MIDGARD_URLS[environmentName];

      if (!midgardUrl) {
        throw new Error(`Midgard URL not configured for ${environmentName}`);
      }

      if (isMidgardEnabled) {
        // Withdrawal flow
        const utxos = await blockchainProvider.utxoProvider.utxoByAddresses({
          addresses: [walletInfo.addresses[0].address]
        });

        if (!utxos || utxos.length === 0) {
          throw new Error('No L2 UTXOs available for withdrawal');
        }

        const [firstUtxoAddress, firstUtxoOutput] = utxos[0];

        const parsedAddress = Wallet.Cardano.Address.fromBech32(walletAddressBech32);
        const addressProps = parsedAddress.getProps();
        const paymentCredHash = addressProps.paymentPart?.hash;

        if (!paymentCredHash) {
          throw new Error('Could not extract payment credential from address');
        }

        const withdrawalBody: WithdrawalBody = {
          l2_outref: {
            txHash: { hash: firstUtxoAddress.txHash },
            outputIndex: firstUtxoAddress.index
          },
          l2_owner: paymentCredHash,
          l2_value: firstUtxoOutput.value.coins,
          l1_address: walletAddressBech32,
          l1_datum: 'NoDatum'
        };

        // TODO: Generate proper withdrawal signature (requires wallet signing)
        const withdrawalSignature: WithdrawalSignature = [];

        const result = await callWithdrawalEndpoint(
          midgardUrl,
          walletAddressBech32,
          withdrawalBody,
          withdrawalSignature
        );

        toast.notify({
          text: `Withdrawal successful! TX: ${result.txHash?.slice(0, TX_HASH_PREVIEW_LENGTH)}...`,
          withProgressBar: true,
          icon: SwitchIcon
        });
      } else {
        // Deposit flow
        const addressHex = getWalletAddressHex(walletAddressBech32);
        const result = await callDepositEndpoint(midgardUrl, addressHex, DEPOSIT_AMOUNT);

        toast.notify({
          text: `Deposit successful! TX: ${result.txHash?.slice(0, TX_HASH_PREVIEW_LENGTH)}...`,
          withProgressBar: true,
          icon: SwitchIcon
        });
      }
    } catch (error) {
      const action = isMidgardEnabled ? 'Withdrawal' : 'Deposit';
      toast.notify({
        text: `${action} failed: ${error.message}`,
        withProgressBar: true,
        icon: SwitchIcon
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const getButtonText = () => {
    if (isProcessing) {
      return isMidgardEnabled ? 'Withdrawing...' : 'Depositing...';
    }
    return isMidgardEnabled ? 'Withdraw to Cardano' : 'Deposit to Midgard';
  };

  if (environmentName !== 'Preprod') {
    return <></>;
  }

  return (
    <div className={styles.container}>
      <Button
        color="gradient"
        size="medium"
        className={styles.actionButton}
        onClick={handleButtonClick}
        disabled={isProcessing}
      >
        {getButtonText()}
      </Button>
      <div className={`${styles.banner} ${isMidgardEnabled ? styles.enabled : styles.disabled}`} onClick={handleToggle}>
        <span className={styles.text}>{t('general.networks.midgard')} mode</span>
        <Switch checked={isMidgardEnabled} size="default" />
      </div>
    </div>
  );
};
