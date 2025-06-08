import {CustomModal} from '@/components';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {colors} from '@/theme/colors';

interface LogoutModalProps {
  isLogoutModalVisible: boolean;
  setIsLogoutModalVisible: (visible: boolean) => void;
}

export const LogoutModal = ({
  isLogoutModalVisible,
  setIsLogoutModalVisible,
}: LogoutModalProps) => {
  const {t} = useTranslate();
  const {logout} = useUser();
  const navigation = useAppNavigation();

  const onPressLogoutCancel = () => {
    setIsLogoutModalVisible(false);
  };
  const onPressLogoutConfirm = () => {
    logout();
    navigation.navigate('Splash');
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
