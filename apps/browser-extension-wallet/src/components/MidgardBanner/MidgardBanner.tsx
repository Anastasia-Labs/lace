import React from 'react';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { toast } from '@lace/common';
import { Switch } from 'antd';
import { Button } from '@lace/common';
import SwitchIcon from '@src/assets/icons/switch.component.svg';
import styles from './MidgardBanner.module.scss';

export const MidgardBanner = (): React.ReactElement => {
  const { t } = useTranslation();
  const { environmentName, isMidgardEnabled, setMidgardMode } = useWalletStore();

  const handleToggle = () => {
    const newState = !isMidgardEnabled;
    setMidgardMode(newState);

    toast.notify({
      text: newState ? 'Midgard Layer 2 enabled' : 'Midgard Layer 2 disabled',
      withProgressBar: true,
      icon: SwitchIcon
    });
  };

  const handleButtonClick = () => {
    toast.notify({
      text: isMidgardEnabled ? 'Withdrawing to Cardano...' : 'Depositing to Midgard...',
      withProgressBar: true,
      icon: SwitchIcon
    });
  };

  // Use conditional rendering instead of early return
  return environmentName === 'Preprod' ? (
    <div className={styles.container}>
      <Button 
        color="gradient" 
        size="medium"
        className={styles.actionButton}
        onClick={handleButtonClick}
      >
        {isMidgardEnabled ? 'Withdraw to Cardano' : 'Deposit to Midgard'}
      </Button>
      <div 
        className={`${styles.banner} ${isMidgardEnabled ? styles.enabled : styles.disabled}`}
        onClick={handleToggle}
      >
        <span className={styles.text}>
          {isMidgardEnabled ? `${t('general.networks.midgard')} mode` : `${t('general.networks.midgard')} mode`}
        </span>
        <Switch checked={isMidgardEnabled} size="default" />
      </div>
    </div>
  ) : (
    <></>
  );
};
