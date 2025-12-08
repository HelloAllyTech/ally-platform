import React, {useCallback, useEffect, useMemo} from 'react';
import {Animated, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DrawerMenuIcon, ReplayIcon} from '@/assets/icons';
import {isIOS} from '@/constants/general';
import {useDrawerNavigation, useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {fontWeights} from '@/theme/typography';

interface CallLogHeaderProps {
  search: string;
  onSearchChange: (text: string) => void;
  onRefresh?: () => void;
  isFetching?: boolean;
  showTitle?: boolean;
  showHamburger?: boolean;
}

export const CallLogHeader: React.FC<CallLogHeaderProps> = ({
  search: _search,
  onSearchChange: _onSearchChange,
  onRefresh,
  isFetching = false,
  showTitle = true,
  showHamburger = false,
}) => {
  const {t} = useTranslate();
  const drawerNavigation = useDrawerNavigation();
  const rotationAnimation = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (isFetching) {
      Animated.timing(rotationAnimation, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    } else {
      setTimeout(() => {
        rotationAnimation.setValue(0);
      }, 600);
    }
  }, [isFetching, rotationAnimation]);

  const rotation = rotationAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleOpenDrawer = useCallback(() => {
    drawerNavigation.openDrawer();
  }, [drawerNavigation]);

  return (
    <View style={styles.headerRow}>
      <View style={styles.leftGroup}>
        {showHamburger && (
          <TouchableOpacity
            style={styles.hamburgerButton}
            onPress={handleOpenDrawer}>
            <DrawerMenuIcon />
          </TouchableOpacity>
        )}
        {showTitle && (
          <Text style={styles.headerTitle}>
            {t('CallLogs.header.title')}{' '}
            <Text style={styles.headerItalic}>
              {t('CallLogs.header.subtitle')}
            </Text>
          </Text>
        )}
      </View>
      {onRefresh && (
        <View style={styles.actionsContainer}>
          <TouchableOpacity onPress={onRefresh} accessibilityLabel="Refresh">
            <Animated.View
              style={[styles.iconContainer, {transform: [{rotate: rotation}]}]}>
              <ReplayIcon width={16} height={16} />
            </Animated.View>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '16@mvs',
    paddingHorizontal: '20@ms',
    paddingBottom: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hamburgerButton: {
    padding: '8@ms',
    marginRight: '8@ms',
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
    ...typography.headline.tiny,
    fontWeight: fontWeights.medium,
  },
  headerItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
    fontWeight: '500',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: '28@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    height: '40@ms',
    minWidth: '180@ms',
    paddingHorizontal: '10@ms',
  },
  searchIcon: {
    marginRight: '10@ms',
  },
  searchInput: {
    height: '40@ms',
    fontSize: '12@ms',
    color: colors.darkSlate,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  filterCircle: {
    marginLeft: '10@ms',
    width: '40@ms',
    height: '40@ms',
    borderRadius: '20@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkSlate,
    fontSize: '16@ms',
  },
  iconContainer: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
