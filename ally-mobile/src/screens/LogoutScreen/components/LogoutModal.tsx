import {Image} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {logOut} from '@/assets';
import {IllustratedModal} from '@/components';
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

  const illustration = <Image source={logOut} style={styles.illustration} />;

  return (
    <IllustratedModal
      visible={isLogoutModalVisible}
      onClose={onPressLogoutCancel}
      description={t('nav.logout.content')}
      actionButtonText={t('nav.logout.button')}
      onActionPress={onPressLogoutConfirm}
      actionButtonColor={colors.brightRed}
      illustration={illustration}
      titleMain={t('nav.logout.title.normal')}
      titleItalic={t('nav.logout.title.italic')}
    />
  );
};

const styles = ScaledSheet.create({
  illustration: {
    width: '151.97@ms',
    height: '135.33@ms',
  },
});
