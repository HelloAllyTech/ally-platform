import {DrawerContentComponentProps} from '@react-navigation/drawer';
import {Image, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  AllyLogoIcon,
  BoltIcon,
  LogoutIcon,
  ProfileIcon,
  ProfileSettingsIcon,
} from '@/assets';
import {env} from '@/config/env';
import {SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useSimulationCredits,
  useTranslate,
  useUser,
} from '@/hooks';
import {useGetLogoUrlQuery} from '@/services/authApi';
import {colors, fontFamily, typography} from '@/theme';
import {getAppVersion} from '@/utils';

import {MenuOption} from './MenuOption';

interface DrawerContentProps extends DrawerContentComponentProps {
  openLogoutModal: () => void;
}

export const DrawerContent = ({
  openLogoutModal,
  navigation: drawerNavigation,
}: DrawerContentProps) => {
  const {userData} = useUser();
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const {credits, getCreditsInfo} = useSimulationCredits();
  const {name, email, profileImageUrl} = userData ?? {};
  const {data: tenantData} = useGetLogoUrlQuery();

  const handleProfileSettingsPress = () => {
    drawerNavigation.closeDrawer();
    navigation.navigate(SCREEN_NAMES.PROFILE_SETTINGS);
  };

  return (
    <View style={styles.container}>
      <View style={styles.profileContainer}>
        <View style={styles.profileIconContainer}>
          {profileImageUrl ? (
            <Image
              source={{uri: profileImageUrl}}
              style={styles.profileImage}
              resizeMode="cover"
            />
          ) : (
            <ProfileIcon />
          )}
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

      {credits && getCreditsInfo && (
        <>
          <View style={styles.creditContainer}>
            <View style={styles.creditHeader}>
              <BoltIcon width={16} height={16} />
              <Text style={styles.creditTitle}>{t('Credits.usage')}</Text>
            </View>
            <View style={styles.creditInfo}>
              <Text>
                <Text style={styles.creditConsumedText}>
                  {credits.consumedCredits}
                </Text>
                <Text style={styles.creditLimitText}>
                  /{credits.creditLimit}
                </Text>
              </Text>
              <Text style={styles.creditPercentage}>
                {getCreditsInfo.usagePercentage}%
              </Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${getCreditsInfo.usagePercentage}%`,
                    backgroundColor: getCreditsInfo.isLow
                      ? colors.softCoralRed
                      : colors.azureBlue,
                  },
                ]}
              />
            </View>
          </View>
          <View style={styles.separator} />
        </>
      )}

      <View style={styles.menuItemsWrapper}>
        <MenuOption
          icon={<ProfileSettingsIcon width={24} height={24} />}
          text={t('Drawer.profileSettings')}
          onPress={handleProfileSettingsPress}
          gap={8}
        />
        <MenuOption
          icon={<LogoutIcon />}
          text={t('Logout.logout')}
          onPress={openLogoutModal}
          gap={8}
        />
      </View>

      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>
          {t('Common.version')}: {getAppVersion()}{' '}
          {env.ENVIRONMENT === 'development' && t('Drawer.dev')}
        </Text>
      </View>

      <View style={styles.logoContainer}>
        {tenantData?.logoUrl && (
          <Image
            source={{uri: tenantData.logoUrl}}
            style={styles.orgLogo}
            resizeMode="contain"
          />
        )}
        <AllyLogoIcon />
      </View>
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
    borderRadius: '20@ms',
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    flex: 1,
  },
  name: {
    ...typography.body.large,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
  },
  email: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
  },
  emailSmall: {
    fontSize: '9@ms',
  },
  creditContainer: {
    marginTop: '20@mvs',
  },
  creditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '18@ms',
    marginBottom: '8@mvs',
  },
  creditTitle: {
    ...typography.label.large,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.highEmphasis,
  },
  creditInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8@mvs',
  },
  creditConsumedText: {
    ...typography.body.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
  },
  creditLimitText: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
  },
  creditPercentage: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  progressBarContainer: {
    height: '6@mvs',
    backgroundColor: colors.lightGray2,
    borderRadius: '4@ms',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: '4@ms',
  },
  separator: {
    height: 0.5,
    backgroundColor: colors.lightGray5,
    marginTop: '20@mvs',
  },
  menuItemsWrapper: {
    flex: 1,
  },
  versionContainer: {
    alignItems: 'center',
    paddingBottom: '16@ms',
    marginTop: 'auto',
  },
  versionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2@ms',
    marginBottom: '20@ms',
    marginTop: '8@mvs',
  },
  orgLogo: {
    height: '40@ms',
    width: '60@ms',
  },
});
