import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LogoutIcon, ProfileIcon} from '@/assets/icons';
import {useTranslate, useUser} from '@/hooks';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface DrawerContentProps {
  openLogoutModal: () => void;
}

export const DrawerContent = ({openLogoutModal}: DrawerContentProps) => {
  const {userData} = useUser();
  const {t} = useTranslate();
  const {name, email} = userData ?? {};

  return (
    <View style={styles.container}>
      <View style={styles.profileContainer}>
        <View style={styles.profileIconContainer}>
          <ProfileIcon />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.name} numberOfLines={2} ellipsizeMode="tail">
            {name}
          </Text>
          {!!email && (
            <Text
              style={[styles.email, email?.length > 30 && styles.emailSmall]}
              numberOfLines={1}
              ellipsizeMode="tail">
              {email}
            </Text>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={styles.logoutContainer}
        onPress={openLogoutModal}>
        <View style={styles.logoutIconContainer}>
          <LogoutIcon />
        </View>
        <Text style={styles.logoutText}>{t('Home.logout.logout')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingTop: '70@mvs',
    paddingHorizontal: '16@ms',
  },
  profileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
    paddingBottom: '16@ms',
  },
  profileIconContainer: {
    width: '40@ms',
    height: '40@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  name: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    lineHeight: '24@mvs',
    color: colors.darkGray2,
  },
  email: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '16@mvs',
    color: colors.darkCharcoal,
  },
  emailSmall: {
    fontSize: '9@ms',
  },
  logoutContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    marginTop: '16@ms',
  },
  logoutIconContainer: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '24@mvs',
    color: colors.black,
  },
});
