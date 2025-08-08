import {CustomModal} from '@/components';
import {useTranslate, useUser} from '@/hooks';
import {colors} from '@/theme';

interface LogoutModalProps {
  isLogoutModalVisible: boolean;
  setIsLogoutModalVisible: (visible: boolean) => void;
}

export const LogoutModal = ({
  isLogoutModalVisible,
  setIsLogoutModalVisible,
}: LogoutModalProps) => {
  const {t} = useTranslate();
  const {handleUserLogout} = useUser();

  const onPressLogoutCancel = () => {
    setIsLogoutModalVisible(false);
  };
  const onPressLogoutConfirm = () => {
    handleUserLogout();
    setIsLogoutModalVisible(false);
  };

  return (
    <CustomModal
      visible={isLogoutModalVisible}
      onSecondaryPress={onPressLogoutCancel}
      onPrimaryPress={onPressLogoutConfirm}
      primaryButtonText={t('Home.logout.logout')}
      secondaryButtonText={t('Home.logout.cancel')}
      title={t('Home.logout.confirm')}
      description={t('Home.logout.logoutDescription')}
      onClose={onPressLogoutCancel}
      primaryTextColor={colors.brightRed}
    />
  );
};
