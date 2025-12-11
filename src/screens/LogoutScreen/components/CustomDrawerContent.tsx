import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BoltIcon, LogoutIcon, ProfileIcon} from '@/assets';
import {SecurityCarousel} from '@/components';
import {env} from '@/config/env';
import {CarouselVariant} from '@/constants';
import {useSimulationCredits, useTranslate, useUser} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {getAppVersion} from '@/utils';

interface DrawerContentProps {
  openLogoutModal: () => void;
}

export const DrawerContent = ({openLogoutModal}: DrawerContentProps) => {
  const {userData} = useUser();
  const {t} = useTranslate();
  const {credits, getCreditsInfo} = useSimulationCredits();
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

      <TouchableOpacity
        style={styles.logoutContainer}
        onPress={openLogoutModal}>
        <View style={styles.logoutIconContainer}>
          <LogoutIcon />
        </View>
        <Text style={styles.logoutText}>{t('Logout.logout')}</Text>
      </TouchableOpacity>
      <View style={styles.carouselWrapper}>
        <SecurityCarousel variant={CarouselVariant.DRAWER} />
      </View>
      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>
          {t('Common.version')}: {getAppVersion()}{' '}
          {env.ENVIRONMENT === 'development' && '(Dev)'}
        </Text>
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
    ...typography.label.large,
    color: colors.ds.typography.highEmphasis,
  },
  carouselWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: '4@ms',
  },
  versionContainer: {
    alignItems: 'center',
    paddingBottom: '16@ms',
  },
  versionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
});
