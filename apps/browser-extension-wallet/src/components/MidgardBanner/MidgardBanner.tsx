import React from 'react';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { toast } from '@lace/common';
import { Switch } from 'antd';
import SwithIcon from '@src/assets/icons/switch.component.svg';
import styles from './MidgardBanner.module.scss';

export const MidgardBanner = (): React.ReactElement => {
  const { t } = useTranslation();
  const { environmentName, isMidgardEnabled, setMidgardMode } = useWalletStore();

  const handleToggle = (checked: boolean) => {
    setMidgardMode(checked);

    toast.notify({
      text: checked ? 'Midgard Layer 2 enabled' : 'Midgard Layer 2 disabled',
      withProgressBar: true,
      icon: SwithIcon
    });
  };

  // Use conditional rendering instead of early return
  return environmentName === 'Preprod' ? (
    <div className={`${styles.banner} ${isMidgardEnabled ? styles.enabled : styles.disabled}`}>
      <span className={styles.text}>
        {isMidgardEnabled ? `${t('general.networks.midgard')}` : `${t('general.networks.midgard')} mode`}
      </span>
      <Switch checked={isMidgardEnabled} onChange={handleToggle} size="default" />
    </div>
  ) : (
    <></>
  );
};
