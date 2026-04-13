/* eslint-disable react/no-multi-comp */
/* eslint-disable sonarjs/cognitive-complexity */
import React, { useCallback, useEffect } from 'react';
import classnames from 'classnames';
import { AssetDrawerTitle } from './AssetDrawerTitle';
import { Drawer, DrawerNavigation, Button } from '@lace/common';
import styles from './AssetDetailsDrawer.module.scss';
import { useTranslation } from 'react-i18next';
import { buttonIds } from '@hooks/useEnterKeyPress';
import { ASSET_DRAWER_BODY_ID, AssetDetailsContainer } from './AssetDetailsContainer';
import { useWalletStore } from '@src/stores';
import { useAnalyticsContext } from '@providers';
import { PostHogAction } from '@providers/AnalyticsProvider/analyticsTracker';
import { getMidgardSendBlockReason } from '@src/stores/slices/midgard-slice';

const renderFooter = ({
  click,
  disabled,
  label,
  popupView,
  statusMessage
}: {
  click: () => void;
  disabled?: boolean;
  label: string;
  popupView?: boolean;
  statusMessage?: string;
}) => (
  <div className={classnames(styles.footerContainer, { [styles.footerContainerPopup]: popupView })}>
    <Button id={buttonIds.tokenBtnId} onClick={click} className={styles.footerButton} disabled={disabled}>
      {label}
    </Button>
    {statusMessage && (
      <div
        role="status"
        aria-live="polite"
        style={{ marginTop: '8px', fontSize: '12px', lineHeight: '16px' }}
        data-testid="asset-details-send-status"
      >
        {statusMessage}
      </div>
    )}
  </div>
);

type AssetDetailsDrawerProps = {
  fiatCode: string;
  openSendDrawer: (id: string) => void;
  popupView?: boolean;
  isBalanceDataFetchedCorrectly: boolean;
};

export const AssetDetailsDrawer = ({
  fiatCode,
  openSendDrawer,
  popupView = false
}: AssetDetailsDrawerProps): React.ReactElement => {
  const { t } = useTranslation();
  const {
    blockchainProvider,
    assetDetails,
    setAssetDetails,
    isInMemoryWallet,
    isMidgardEnabled,
    midgardActivationStatus,
    midgardHealthStatus,
    isSharedWallet
  } = useWalletStore();
  const analytics = useAnalyticsContext();
  const sendDisabledMessage = getMidgardSendBlockReason({
    isMidgardEnabled,
    midgardActivationStatus,
    midgardHealthStatus,
    isInMemoryWallet,
    isSharedWallet
  });
  const isSendDisabled = !!sendDisabledMessage;

  const isVisible = !!assetDetails;

  const setVisibility = useCallback(() => setAssetDetails(), [setAssetDetails]);

  useEffect(() => {
    const drawerElement = document.querySelector('.ant-drawer-body');
    if (drawerElement) {
      drawerElement.setAttribute('id', ASSET_DRAWER_BODY_ID);
    }
  }, []);

  const handleOpenSend = () => {
    if (isSendDisabled || !assetDetails?.id) return;
    openSendDrawer(assetDetails.id);
  };

  // Close asset details drawer if network (blockchainProvider) has changed
  useEffect(() => {
    setVisibility();
  }, [blockchainProvider, setVisibility]);

  return (
    <Drawer
      className={styles.drawer}
      navigation={
        <DrawerNavigation
          title={t('browserView.assetDetails.title')}
          onCloseIconClick={() => {
            analytics.sendEventToPostHog(PostHogAction.TokenTokenDetailXClick);
            setVisibility();
          }}
        />
      }
      footer={renderFooter({
        click: handleOpenSend,
        label: t('browserView.assets.send'),
        disabled: isSendDisabled || !assetDetails?.id,
        popupView,
        statusMessage: sendDisabledMessage
      })}
      open={isVisible}
      destroyOnClose
      onClose={setVisibility}
      popupView={popupView}
      closable
    >
      <div className={classnames(styles.container, { [styles.popupContainer]: popupView })}>
        <AssetDrawerTitle
          logo={assetDetails?.logo}
          defaultLogo={assetDetails?.defaultLogo}
          title={assetDetails?.name}
          code={assetDetails?.ticker}
        />
        <AssetDetailsContainer fiatCode={fiatCode} popupView={popupView} />
      </div>
    </Drawer>
  );
};
