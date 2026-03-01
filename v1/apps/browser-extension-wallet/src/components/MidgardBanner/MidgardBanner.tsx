import React from 'react';
import classnames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '@src/stores';
import { toast, Button } from '@lace/common';
import { Switch } from 'antd';
import SwitchIcon from '@src/assets/icons/switch.component.svg';
import styles from './MidgardBanner.module.scss';

/**
 * Displays the Midgard Mode toggle and a deposit/withdraw action button.
 * Only visible on Preprod.
 *
 * TODO: Wire up deposit/withdrawal when midgard-sdk user-event-protocol builders
 * are implemented (depositTxBuilder, withdrawalOrderTxBuilder).
 */
export const MidgardBanner = (): React.ReactElement => {
  const { t } = useTranslation();
  const { isMidgardEnabled, setMidgardMode } = useWalletStore();

  const isDeposit = !isMidgardEnabled;
  const buttonText = isDeposit ? t('general.midgard.deposit') : t('general.midgard.withdraw');

  const handleToggle = () => {
    const newState = !isMidgardEnabled;
    setMidgardMode(newState);
    toast.notify({
      text: newState ? t('general.midgard.modeEnabled') : t('general.midgard.modeDisabled'),
      withProgressBar: true,
      icon: SwitchIcon
    });
  };

  const handleActionClick = () => {
    toast.notify({
      text: t('general.midgard.comingSoon'),
      withProgressBar: true,
      icon: SwitchIcon
    });
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
      <Button data-testid="midgard-action-button" className={styles.actionButton} onClick={handleActionClick}>
        {buttonText}
      </Button>
    </div>
  );
};
