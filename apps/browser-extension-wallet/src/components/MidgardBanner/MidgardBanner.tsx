import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { toast, Button } from '@lace/common';
import { Switch } from 'antd';
import SwitchIcon from '@src/assets/icons/switch.component.svg';
import styles from './MidgardBanner.module.scss';
import { config } from '@src/config';
import { Wallet } from '@lace/cardano';
import { encode as cborEncode } from 'cborg';

const DEPOSIT_AMOUNT = 10_000_000; // 10 ADA in lovelace
const TX_HASH_PREVIEW_LENGTH = 8;

/* eslint-disable camelcase */

/**
 * Serializes a value to CBOR hex string
 * Converts JavaScript/TypeScript structures to CBOR binary format and encodes as hex
 */
const serializeToCborHex = (data: unknown): string => {
  const cborBytes = cborEncode(data);
  return Buffer.from(cborBytes).toString('hex');
};

const callDepositEndpoint = async (
  midgardUrl: string,
  addressBech32: string,
  amount: number
): Promise<{ txHash: string }> => {
  const response = await fetch(`${midgardUrl}/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: amount.toString(),
      address: addressBech32,
      datum: null
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
  l2OutrefTxHash: string,
  l2OutrefIndex: number,
  l2Owner: string,
  l2Value: bigint,
  l1AddressBech32: string
): Promise<{ txHash: string }> => {
  // Construct withdrawal body
  const withdrawalBody = {
    l2_outref: {
      txHash: { hash: l2OutrefTxHash },
      outputIndex: l2OutrefIndex
    },
    l2_owner: l2Owner,
    l2_value: l2Value.toString(),
    l1_address: l1AddressBech32,
    l1_datum: 'NoDatum'
  };

  // Serialize withdrawal_body and withdrawal_signature to CBOR hex
  const withdrawalBodyCbor = serializeToCborHex(withdrawalBody);
  const withdrawalSignatureCbor = serializeToCborHex(new Map()); // Empty signature map

  const response = await fetch(`${midgardUrl}/withdrawal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      withdrawal_body: withdrawalBodyCbor,
      withdrawal_signature: withdrawalSignatureCbor,
      refund_address: refundAddressBech32,
      refund_datum: null
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

        const result = await callWithdrawalEndpoint(
          midgardUrl,
          walletAddressBech32,
          firstUtxoAddress.txHash,
          firstUtxoAddress.index,
          paymentCredHash,
          firstUtxoOutput.value.coins,
          walletAddressBech32
        );

        toast.notify({
          text: `Withdrawal successful! TX: ${result.txHash?.slice(0, TX_HASH_PREVIEW_LENGTH)}...`,
          withProgressBar: true,
          icon: SwitchIcon
        });
      } else {
        // Deposit flow
        const result = await callDepositEndpoint(midgardUrl, walletAddressBech32, DEPOSIT_AMOUNT);

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
