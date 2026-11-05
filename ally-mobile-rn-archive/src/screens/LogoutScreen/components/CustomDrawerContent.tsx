import {useState} from 'react';
import {DrawerContentComponentProps} from '@react-navigation/drawer';
import {Image, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {
  AllyLogoIcon,
  BoltIcon,
  HelpIcon,
  LogoutIcon,
  ProfileSettingsIcon,
} from '@/assets';
import {UserProfileImage} from '@/components';
import {env} from '@/config/env';
import {SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useSimulationCredits,
  useTranslate,
  useUser,
} from '@/hooks';
import {useGetLogoUrlQuery} from '@/services/authApi';
import {colors, fontFamily, radius, typography} from '@/theme';
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
  const [logoError, setLogoError] = useState(false);

  const handleProfileSettingsPress = () => {
    drawerNavigation.closeDrawer();
    navigation.navigate(SCREEN_NAMES.PROFILE_SETTINGS);
  };

  const handleReportProblemPress = () => {
    drawerNavigation.closeDrawer();
    navigation.navigate(SCREEN_NAMES.BUG_REPORT);
  };

  return (
    <View style={styles.container}>
      {tenantData && (
        <>
          <View style={styles.orgLogoContainer}>
            {tenantData.logoUrl && !logoError ? (
              <Image
                source={{uri: tenantData.logoUrl}}
                style={styles.orgLogo}
                resizeMode="contain"
                onError={() => setLogoError(true)}
              />
            ) : (
              <View style={styles.orgLogoPlaceholder}>
                <Text style={styles.orgLogoPlaceholderText}>
                  {tenantData.name?.slice(0, 1)?.toUpperCase() ?? 'NA'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.separator} />
        </>
      )}
      <View style={styles.profileContainer}>
        <UserProfileImage
          {...(profileImageUrl
            ? {
                profileImageUri: profileImageUrl,
                size: ms(32),
              }
            : {
                name: name,
                size: ms(32),
                textSize: 'large',
              })}
        />

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

      <View style={styles.separator} />

      {credits && getCreditsInfo && (
        <>
          <View>
            <View style={styles.creditHeader}>
              <BoltIcon width={16} height={16} />
              <Text style={styles.creditTitle}>{t('user.creditUsage')}</Text>
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
                      : colors.ds.brand.logo,
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
          text={t('profile.settings.title')}
          onPress={handleProfileSettingsPress}
          gap={8}
        />
        <MenuOption
          icon={<HelpIcon width={24} height={24} />}
          text={t('bugReport.menuLabel')}
          onPress={handleReportProblemPress}
          gap={8}
        />
        <MenuOption
          icon={<LogoutIcon />}
          text={t('user.logout')}
          onPress={openLogoutModal}
          gap={8}
        />
      </View>

      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>
          {t('common.version')}: {getAppVersion()}{' '}
          {env.ENVIRONMENT === 'development' && t('drawer.dev')}
        </Text>
      </View>

      <View style={styles.logoContainer}>
        <AllyLogoIcon />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingTop: '50@mvs',
    paddingHorizontal: '16@ms',
  },
  separator: {
    height: '0.5@vs',
    backgroundColor: colors.ds.stroke.primary,
    marginVertical: '12@mvs',
  },
  profileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  textContainer: {
    flex: 1,
  },
  name: {
    ...typography.body.large,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '2@mvs',
  },
  email: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
  },
  emailSmall: {
    fontSize: '9@ms',
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
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.lg,
    padding: '12@ms',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '30@ms',
    marginTop: '8@mvs',
    marginHorizontal: '15@ms',
  },
  orgLogoContainer: {
    width: '40@ms',
    height: '40@ms',
    overflow: 'hidden',
  },
  orgLogo: {
    height: '100%',
    width: '100%',
  },
  orgLogoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.lightGray2,
    borderRadius: '4@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgLogoPlaceholderText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    color: colors.ds.typography.mediumEmphasis,
    textTransform: 'uppercase',
  },
});
